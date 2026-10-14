/**
 * A Project's delivery rules (#340), as the engine keeps them: one Schema-encoded document per
 * Project with its version (the defaults, at version 0, until a first save), saved on the version
 * it was edited from and refused with every reason the validation gives. The rules are checked
 * against what only the engine knows: each repository's forge and what it allows (#253), and the
 * Project's catalogue.
 *
 * The dependencies between repositories are proposed from their `package.json` files at each read
 * and saved only once the user accepts them.
 *
 * A mission copies each section when it starts acting (CT-47): R6 the preparation at its first
 * push or pull request, S1 the waves and the End at Ship. A copy is resolved for the Project as it
 * is, written once with the version it was copied at and a `delivery.rules_copied` event, and
 * never rewritten: asking for it again answers the same copy, whatever the Project changed since.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DELIVERY_SECTIONS,
  type DeliveryDependency,
  type DeliveryProject,
  type DeliveryRules,
  DeliveryRulesJson,
  type DeliveryRulesDraft,
  type DeliverySection,
  ROOT_REPOSITORY,
  SectionCopy,
  decodeDeliveryRules,
  dependencyProblems,
  defaultDeliveryRules,
  effectiveRepositories,
  preparationDifferences,
  proposeDependencies,
  sectionOf,
  validateRules,
  withDependencies,
} from '@hemera/core/domain'
import {
  DeliveryRulesRefused,
  DeliveryRulesUnreadable,
  type DeliveryRulesView,
  type PreparationChange,
  type Project,
} from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect, Result, Schema } from 'effect'

import { listCommands } from './catalogue.ts'
import { ForgePort } from './forges/port.ts'
import type { NewEvent } from './journal.ts'
import { getMission } from './missions.ts'
import { getProject } from './projects.ts'
import { Database, type EngineTransaction, refusedWhile } from './storage/database.ts'
import { deliveryRuleCopies, deliveryRules } from './storage/schema.ts'
import { StaleVersion, mutate } from './transaction.ts'

const writeRules = Schema.encodeSync(DeliveryRulesJson)
const SectionCopyJson = Schema.fromJsonString(SectionCopy)
const writeCopy = Schema.encodeSync(SectionCopyJson)
const readCopy = Schema.decodeUnknownEffect(SectionCopyJson)

/** The repositories' names in the sentences: their path, the Project's name for its root. */
const nameOf = (project: Project, path: string) => (path === ROOT_REPOSITORY ? project.name : path)

/** The Project as the rules are checked against it: each repository's forge, the catalogue. */
const deliveryProjectOf = (project: Project) =>
  Effect.gen(function* () {
    const forge = yield* ForgePort
    const statuses = yield* forge.status(project.id)
    const repositories = yield* Effect.forEach(project.repositories, (repository) =>
      forge.capabilities(repository.id).pipe(
        // A repository removed since the Project was read can do nothing on a forge.
        Effect.catchTag('UnknownRepository', () =>
          Effect.succeed({ runWorkflow: false, approveManualStep: false }),
        ),
        Effect.map((capabilities) => ({
          id: repository.id,
          name: nameOf(project, repository.path),
          forge: statuses.find((one) => one.repositoryId === repository.id)?.forge ?? 'unknown',
          capabilities: {
            runWorkflow: capabilities.runWorkflow,
            approveManualStep: capabilities.approveManualStep,
          },
        })),
      ),
    )
    const commands = yield* listCommands(project.id)
    return {
      repositories,
      commandIds: commands.map((command) => command.id),
    } satisfies DeliveryProject
  })

const rowIn = (reader: EngineTransaction, projectId: string) =>
  reader
    .select()
    .from(deliveryRules)
    .where(eq(deliveryRules.projectId, projectId))
    .pipe(
      Effect.map(([row]) => row),
      Effect.mapError(refusedWhile('reading the delivery rules')),
    )

/** The Project's rules as stored, or its defaults at version 0. */
const rulesIn = (reader: EngineTransaction, projectId: string) =>
  Effect.gen(function* () {
    const row = yield* rowIn(reader, projectId)
    if (row === undefined) {
      return { ...defaultDeliveryRules(), version: 0, savedAt: null } satisfies DeliveryRules
    }
    const read = decodeDeliveryRules(row.document)
    if (Result.isFailure(read)) {
      return yield* new DeliveryRulesUnreadable({
        projectId,
        document: 'rules',
        missionId: null,
        section: null,
        version: row.version,
      })
    }
    return read.success
  })

/** Each repository's `package.json` in the main checkout, or null where it has none. */
const manifestsOf = (project: Project) =>
  project.repositories.map((repository) => {
    let manifest: string | null = null
    try {
      manifest = readFileSync(join(project.mainCheckout, repository.path, 'package.json'), 'utf8')
    } catch {
      manifest = null
    }
    return { repositoryId: repository.id, manifest }
  })

const viewOf = (
  project: Project,
  delivery: DeliveryProject,
  rules: DeliveryRules,
): DeliveryRulesView => {
  const repositories = effectiveRepositories(rules, delivery)
  const accepted = (edge: DeliveryDependency) =>
    repositories.some(
      (one) =>
        one.repositoryId === edge.repositoryId && one.deliversAfter.includes(edge.deliversAfter),
    )
  return {
    rules,
    repositories,
    proposedDependencies: proposeDependencies(manifestsOf(project)).filter(
      (edge) => !accepted(edge),
    ),
  }
}

const savedEvent = (projectId: string, version: number, accepted: number | null): NewEvent => ({
  type: 'delivery.rules_saved',
  entityKind: 'project',
  entityId: projectId,
  source: 'ui',
  author: 'human',
  payload: { version, dependenciesAccepted: accepted },
})

/** Writes the rules at the version after `current`, the one the transaction read. */
const written = (
  transaction: EngineTransaction,
  projectId: string,
  draft: DeliveryRulesDraft,
  current: number,
) =>
  Effect.gen(function* () {
    const rules: DeliveryRules = {
      ...draft,
      version: current + 1,
      savedAt: new Date().toISOString(),
    }
    const columns = {
      version: rules.version,
      savedAt: rules.savedAt ?? '',
      document: writeRules(rules),
    }
    yield* transaction
      .insert(deliveryRules)
      .values({ projectId, ...columns })
      .onConflictDoUpdate({ target: deliveryRules.projectId, set: columns })
      .pipe(Effect.mapError(refusedWhile('writing the delivery rules')))
    return rules
  })

/** The Project's rules, each repository resolved, and the dependencies proposed. */
export const readDeliveryRules = (projectId: string) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const delivery = yield* deliveryProjectOf(project)
    const rules = yield* reading((reader) => rulesIn(reader, projectId))
    return viewOf(project, delivery, rules)
  })

/** Every reason a draft would be refused. */
export const validateDeliveryRules = (projectId: string, draft: DeliveryRulesDraft) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    return validateRules(draft, yield* deliveryProjectOf(project))
  })

/** Saves a draft edited from `version`; refused on a stale version, or with every reason. */
export const saveDeliveryRules = (projectId: string, draft: DeliveryRulesDraft, version: number) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const delivery = yield* deliveryProjectOf(project)
    const problems = validateRules(draft, delivery)
    if (problems.length > 0) return yield* new DeliveryRulesRefused({ problems })
    const rules = yield* mutate('saving the delivery rules', (transaction) =>
      Effect.gen(function* () {
        // Refused when another save came first.
        const current = (yield* rowIn(transaction, projectId))?.version ?? 0
        if (current !== version) {
          return yield* new StaleVersion({
            entity: 'Project’s delivery rules',
            id: projectId,
            expected: version,
          })
        }
        const saved = yield* written(transaction, projectId, draft, current)
        return { result: saved, events: [savedEvent(projectId, saved.version, null)] }
      }),
    )
    return viewOf(project, delivery, rules)
  })

/** Saves the dependencies accepted into the rules as they are, checked like any save. */
export const acceptDependencies = (projectId: string, edges: ReadonlyArray<DeliveryDependency>) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const delivery = yield* deliveryProjectOf(project)
    const rules = yield* mutate('accepting the proposed dependencies', (transaction) =>
      Effect.gen(function* () {
        const unknown = dependencyProblems(edges, delivery)
        if (unknown.length > 0) return yield* new DeliveryRulesRefused({ problems: unknown })
        const current = yield* rulesIn(transaction, projectId)
        const draft = withDependencies(current, delivery, edges)
        const problems = validateRules(draft, delivery)
        if (problems.length > 0) return yield* new DeliveryRulesRefused({ problems })
        const saved = yield* written(transaction, projectId, draft, current.version)
        return { result: saved, events: [savedEvent(projectId, saved.version, edges.length)] }
      }),
    )
    return viewOf(project, delivery, rules)
  })

/** Reads in a transaction of its own: what it reads is one state of the data folder. */
const reading = <A, E, R>(read: (reader: EngineTransaction) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction(read)
  })

const copiesIn = (reader: EngineTransaction, projectId: string, missionId: string) =>
  reader
    .select()
    .from(deliveryRuleCopies)
    .where(eq(deliveryRuleCopies.missionId, missionId))
    .pipe(
      Effect.mapError(refusedWhile('reading the delivery rules copies')),
      Effect.flatMap((rows) =>
        Effect.forEach(
          DELIVERY_SECTIONS.flatMap((section) => rows.filter((row) => row.section === section)),
          (row) =>
            readCopy(row.document).pipe(
              Effect.mapError(
                () =>
                  new DeliveryRulesUnreadable({
                    projectId,
                    document: 'copy',
                    missionId,
                    section: DELIVERY_SECTIONS.find((one) => one === row.section) ?? null,
                    version: row.version,
                  }),
              ),
            ),
        ),
      ),
    )

/**
 * Copies a section of the Project's rules into the mission, resolved, with the rules' version and
 * a `delivery.rules_copied` event; a section already copied answers its copy, unchanged. Whether
 * it was copied is read in the transaction that writes it, so two asked at once make one. `hold`
 * is where a suite holds a copy before that transaction; never held otherwise.
 */
export const copySection = (
  missionId: string,
  section: DeliverySection,
  hold: Effect.Effect<void> = Effect.void,
) =>
  Effect.gen(function* () {
    const mission = yield* getMission(missionId)
    const project = yield* getProject(mission.projectId)
    const delivery = yield* deliveryProjectOf(project)
    yield* hold
    return yield* mutate('copying the delivery rules into a mission', (transaction) =>
      Effect.gen(function* () {
        const kept = (yield* copiesIn(transaction, project.id, missionId)).find(
          (copy) => copy.section === section,
        )
        if (kept !== undefined) return { result: kept, events: [] }
        const rules = yield* rulesIn(transaction, project.id)
        const copy = sectionOf(rules, delivery, section, new Date().toISOString())
        yield* transaction
          .insert(deliveryRuleCopies)
          .values({
            missionId,
            section,
            version: copy.version,
            copiedAt: copy.copiedAt,
            document: writeCopy(copy),
          })
          .pipe(Effect.mapError(refusedWhile('writing a delivery rules copy')))
        const event: NewEvent = {
          type: 'delivery.rules_copied',
          entityKind: 'mission',
          entityId: missionId,
          source: 'system',
          author: 'hemera',
          payload: { section, version: copy.version },
        }
        return { result: copy, events: [event] }
      }),
    )
  })

/** The sections the mission copied, in the order of the rules. */
export const missionCopies = (missionId: string) =>
  Effect.gen(function* () {
    const mission = yield* getMission(missionId)
    return yield* reading((reader) => copiesIn(reader, mission.projectId, missionId))
  })

/**
 * Whether the Project's preparation differs from the mission's copy, with the differences (the
 * Ship confirmation shows them); null when the mission has not copied it yet.
 */
export const preparationChangedSinceCopy = (missionId: string) =>
  Effect.gen(function* () {
    const mission = yield* getMission(missionId)
    const [copy, rules] = yield* reading((reader) =>
      Effect.all([
        Effect.map(copiesIn(reader, mission.projectId, missionId), (copies) =>
          copies.find((one) => one.section === 'preparation'),
        ),
        rulesIn(reader, mission.projectId),
      ]),
    )
    if (copy === undefined || copy.section !== 'preparation') return null
    const project = yield* getProject(mission.projectId)
    const now = sectionOf(rules, yield* deliveryProjectOf(project), 'preparation', copy.copiedAt)
    if (now.section !== 'preparation') return null
    return {
      copiedVersion: copy.version,
      currentVersion: rules.version,
      differences: preparationDifferences(copy, now),
    } satisfies PreparationChange
  })
