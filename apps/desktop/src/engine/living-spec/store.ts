/**
 * A Project's living spec in the database (#93): its domains, its requirements with their history,
 * and its bootstrap runs.
 *
 * - **The versioned writes** (`addRequirement`, `modifyRequirement`, `removeRequirement`) are the
 *   only way the other engine services change a living requirement: a write whose expected version
 *   is not the current one fails with `LivingRequirementChanged`, carrying both. The merge at
 *   closing (S6) calls them; nothing here calls them at closing.
 * - **The proposals** are the bootstrap agent's, during a run that is still running: proposed
 *   domains and requirements of origin `bootstrap`, and on a run on one domain, a replacement or an
 *   obsolescence pending on an existing requirement, applied only when the user validates.
 * - **The user's calls**: validate a domain, reject it, drop one proposed requirement.
 *
 * Every change writes its domain event in the same transaction, about the Project. Hemera does not
 * detect behaviour changed outside Hemera in 1.0.
 */

import {
  type Masked,
  LIVING_PAGE_DOMAINS,
  LIVING_STATES,
  type LivingDomainText,
  type LivingPendingText,
  LivingScenario,
  type LivingStanding,
  type LivingState,
  livingSpecText,
  missionKey,
  originSaid,
} from '@hemera/core/domain'
import {
  type LivingChange,
  type LivingDomain,
  type LivingOrigin,
  LivingObsolete,
  type LivingPending,
  LivingReplace,
  type LivingRequirement,
  type LivingRequirementDetail,
  type LivingSeen,
  LivingSpecRefused,
} from '@hemera/ipc'
import { and, asc, eq, inArray, max } from 'drizzle-orm'
import { Effect, Option, Predicate, Schema } from 'effect'

import type { EventPayload, NewEvent } from '../journal.ts'
import { getProject } from '../projects.ts'
import { Secrets } from '../secrets.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  livingDomains,
  livingHistory,
  livingRequirements,
  livingRuns,
  missions,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

const now = (): string => new Date().toISOString()

/** A versioned write on a version that is no longer the requirement's (CT-57). */
export class LivingRequirementChanged extends Schema.TaggedError<LivingRequirementChanged>()(
  'LivingRequirementChanged',
  { id: Schema.String, expected: Schema.Number, current: Schema.Number },
) {
  override get message(): string {
    return `${this.id} changed: it is at version ${String(this.current)}, not ${String(this.expected)}.`
  }
}

/** Who changes a living requirement. */
export type LivingBy =
  | { readonly kind: 'bootstrap' }
  | { readonly kind: 'mission'; readonly missionId: string; readonly round: number | null }
  | { readonly kind: 'user' }

const BOOTSTRAP: LivingBy = { kind: 'bootstrap' }
const USER: LivingBy = { kind: 'user' }

/** A write's outcome for an agent: refused with the sentence it reads, or what it wrote. */
export type Proposed<A> = { readonly refused: string } | { readonly done: A }

const refused = <A>(sentence: string): Proposed<A> => ({ refused: `refused: ${sentence}` })
const done = <A>(value: A): Proposed<A> => ({ done: value })

type DomainRow = typeof livingDomains.$inferSelect
type RequirementRow = typeof livingRequirements.$inferSelect
export type RunRow = typeof livingRuns.$inferSelect

const Scenarios = Schema.fromJsonString(Schema.Array(LivingScenario))
const readScenarios = Schema.decodeUnknownOption(Scenarios)
const scenariosOf = (json: string | null): ReadonlyArray<LivingScenario> =>
  json === null ? [] : Option.getOrElse(readScenarios(json), () => [])

const stateOf = (text: string): LivingState =>
  LIVING_STATES.find((one) => one === text) ?? 'proposed'

/** A name as two domains are compared: trimmed, case-folded. */
const nameKey = (name: string): string => name.trim().toLocaleLowerCase()

/** Who an event about a change says did it. */
const AUTHOR_OF = { user: 'human', bootstrap: 'agent', mission: 'hemera' } as const

const projectEvent = (
  projectId: string,
  type: string,
  payload: EventPayload,
  by: LivingBy,
): NewEvent => ({
  type,
  entityKind: 'project',
  entityId: projectId,
  source: by.kind === 'user' ? 'ui' : 'system',
  author: AUTHOR_OF[by.kind],
  payload,
})

const byColumns = (by: LivingBy) => ({
  byKind: by.kind,
  byMissionId: by.kind === 'mission' ? by.missionId : null,
  byRound: by.kind === 'mission' ? by.round : null,
})

// --- reading -------------------------------------------------------------------------------------

/** The missions' keys, by id. */
const keysIn = (transaction: EngineTransaction, ids: ReadonlyArray<string | null>) =>
  Effect.gen(function* () {
    const wanted = [...new Set(ids.filter((id) => id !== null))]
    if (wanted.length === 0) return new Map<string, string>()
    const rows = yield* transaction
      .select({ id: missions.id, prefix: missions.keyPrefix, number: missions.keyNumber })
      .from(missions)
      .where(inArray(missions.id, wanted))
      .pipe(Effect.mapError(refusedWhile('reading the missions')))
    return new Map(rows.map((row) => [row.id, missionKey(row.prefix, row.number)]))
  })

const originOf = (
  missionId: string | null,
  round: number | null,
  keys: ReadonlyMap<string, string>,
): LivingOrigin =>
  missionId === null ? null : { missionId, key: keys.get(missionId) ?? null, round }

const pendingOf = (row: RequirementRow): LivingPending | null => {
  if (row.pendingKind === 'replace') {
    return LivingReplace.make({
      text: row.pendingText ?? '',
      scenarios: scenariosOf(row.pendingScenarios),
      uncertainty: row.pendingUncertainty ?? '',
    })
  }
  if (row.pendingKind === 'obsolete')
    return LivingObsolete.make({ reason: row.pendingReason ?? '' })
  return null
}

/** The change pending on a requirement, as an agent reads it. */
const pendingTextOf = (row: RequirementRow): LivingPendingText | null => {
  if (row.pendingKind === 'replace') {
    return {
      kind: 'replace',
      text: row.pendingText ?? '',
      scenarios: scenariosOf(row.pendingScenarios),
      uncertainty: row.pendingUncertainty ?? '',
    }
  }
  if (row.pendingKind === 'obsolete') return { kind: 'obsolete', reason: row.pendingReason ?? '' }
  return null
}

const requirementOf = (
  row: RequirementRow,
  keys: ReadonlyMap<string, string>,
): LivingRequirement => ({
  id: row.id,
  domainId: row.domainId,
  text: row.text,
  scenarios: scenariosOf(row.scenarios),
  origin: originOf(row.originMissionId, row.originRound, keys),
  state: stateOf(row.state),
  uncertainty: row.uncertainty,
  version: row.version,
  removed: row.removed,
  pending: pendingOf(row),
})

/** The Project's domains not removed, in their order. */
const liveDomainsIn = (transaction: EngineTransaction, projectId: string) =>
  Effect.map(
    transaction
      .select()
      .from(livingDomains)
      .where(eq(livingDomains.projectId, projectId))
      .orderBy(asc(livingDomains.rank))
      .pipe(Effect.mapError(refusedWhile('reading the living spec'))),
    (rows) => rows.filter((row) => row.removedAt === null),
  )

/** The Project's requirements, removed ones included, in their order. */
const requirementRowsIn = (transaction: EngineTransaction, projectId: string) =>
  transaction
    .select()
    .from(livingRequirements)
    .where(eq(livingRequirements.projectId, projectId))
    .orderBy(asc(livingRequirements.seq))
    .pipe(Effect.mapError(refusedWhile('reading the living spec')))

const domainOf = (row: DomainRow, requirements: ReadonlyArray<RequirementRow>): LivingDomain => {
  const own = requirements.filter((one) => one.domainId === row.id)
  const live = own.filter((one) => !one.removed)
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    summary: row.summary,
    uncertainty: row.uncertainty,
    state: stateOf(row.state),
    validatedAt: row.validatedAt,
    proposed: live.filter((one) => one.state === 'proposed').length,
    validated: live.filter((one) => one.state === 'validated').length,
    pending: live.filter((one) => one.pendingKind !== null).length,
    lastChange:
      [row.updatedAt, ...own.map((one) => one.updatedAt)].toSorted().at(-1) ?? row.updatedAt,
  }
}

/** A Project's domains with their state and counts, read in the transaction given. */
export const domainsIn = (transaction: EngineTransaction, projectId: string) =>
  Effect.gen(function* () {
    const domains = yield* liveDomainsIn(transaction, projectId)
    const requirements = yield* requirementRowsIn(transaction, projectId)
    return domains.map((row) => domainOf(row, requirements))
  })

/** A Project's domains with their state and counts. */
export const domainsOf = (projectId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const database = yield* Database
    return yield* database.transaction((transaction) => domainsIn(transaction, projectId))
  })

/** A domain's requirements, removed ones included and marked. */
export const requirementsOf = (projectId: string, domainId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const [domain] = yield* transaction
          .select()
          .from(livingDomains)
          .where(and(eq(livingDomains.id, domainId), eq(livingDomains.projectId, projectId)))
          .pipe(Effect.mapError(refusedWhile('reading the living spec')))
        if (domain === undefined) {
          return yield* new LivingSpecRefused({ reason: 'This domain is not in the living spec.' })
        }
        const rows = (yield* requirementRowsIn(transaction, projectId)).filter(
          (one) => one.domainId === domainId,
        )
        const keys = yield* keysIn(
          transaction,
          rows.map((one) => one.originMissionId),
        )
        return rows.map((row) => requirementOf(row, keys))
      }),
    )
  })

const WHATS = [
  'proposed',
  'validated',
  'rejected',
  'dropped',
  'added',
  'modified',
  'removed',
] as const
const AUTHORS = ['bootstrap', 'mission', 'user'] as const

/** One requirement with its domain and its history, the oldest change first. */
export const requirementDetail = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const [row] = yield* transaction
          .select()
          .from(livingRequirements)
          .where(eq(livingRequirements.id, id))
          .pipe(Effect.mapError(refusedWhile('reading the living spec')))
        if (row === undefined) {
          return yield* new LivingSpecRefused({
            reason: `The living spec has no requirement ${id}.`,
          })
        }
        const [domain] = yield* transaction
          .select({ name: livingDomains.name })
          .from(livingDomains)
          .where(eq(livingDomains.id, row.domainId))
          .pipe(Effect.mapError(refusedWhile('reading the living spec')))
        const history = yield* transaction
          .select()
          .from(livingHistory)
          .where(eq(livingHistory.requirementId, id))
          .orderBy(asc(livingHistory.sequence))
          .pipe(Effect.mapError(refusedWhile('reading the living spec')))
        const keys = yield* keysIn(transaction, [
          row.originMissionId,
          ...history.map((one) => one.byMissionId),
        ])
        return {
          ...requirementOf(row, keys),
          domain: domain?.name ?? '',
          history: history.map((one): LivingChange => ({
            what: WHATS.find((what) => what === one.what) ?? 'modified',
            versionBefore: one.versionBefore,
            versionAfter: one.versionAfter,
            textBefore: one.textBefore,
            textAfter: one.textAfter,
            scenariosBefore: one.scenariosBefore === null ? null : scenariosOf(one.scenariosBefore),
            scenariosAfter: one.scenariosAfter === null ? null : scenariosOf(one.scenariosAfter),
            by: AUTHORS.find((by) => by === one.byKind) ?? 'user',
            byMission: originOf(one.byMissionId, one.byRound, keys),
            at: one.at,
          })),
        } satisfies LivingRequirementDetail
      }),
    )
  })

/** Domains as an agent reads them: their live requirements, each with what it waits on. */
const domainTextsIn = (transaction: EngineTransaction, projectId: string) =>
  Effect.gen(function* () {
    const domains = yield* liveDomainsIn(transaction, projectId)
    const rows = (yield* requirementRowsIn(transaction, projectId)).filter((one) => !one.removed)
    const keys = yield* keysIn(
      transaction,
      rows.map((one) => one.originMissionId),
    )
    return domains.map((domain): LivingDomainText & { readonly id: string } => ({
      id: domain.id,
      name: domain.name,
      summary: domain.summary,
      state: stateOf(domain.state),
      uncertainty: domain.uncertainty,
      requirements: rows
        .filter((one) => one.domainId === domain.id)
        .map((row) => {
          const requirement = requirementOf(row, keys)
          return {
            id: row.id,
            version: row.version,
            state: requirement.state,
            origin: originSaid(
              requirement.origin === null
                ? null
                : {
                    key: requirement.origin.key ?? 'a mission',
                    round: requirement.origin.round,
                  },
            ),
            uncertainty: row.uncertainty,
            text: row.text,
            scenarios: requirement.scenarios,
            pending: pendingTextOf(row),
          }
        }),
    }))
  })

/** The heading level of a domain inside a brief, whose fields are of level 2. */
const BRIEF_LEVEL = 3

/**
 * A Project's living spec as a brief holds it, every domain or one; empty when it has none. Its
 * domains are headings of level 3, nested under the brief's own field: none opens a field.
 */
export const livingTextOf = (projectId: string, domainId: string | null = null) =>
  Effect.gen(function* () {
    const database = yield* Database
    const domains = yield* database.transaction((transaction) =>
      domainTextsIn(transaction, projectId),
    )
    return livingSpecText(
      domainId === null ? domains : domains.filter((one) => one.id === domainId),
      BRIEF_LEVEL,
    )
  })

/**
 * What `living_spec_read` answers: one page of domains, or one domain by its name, each proposed
 * row labelled; never another Project's.
 */
export const livingSpecPage = (
  projectId: string,
  asked: { readonly domain?: string | undefined; readonly page?: number | undefined },
) =>
  Effect.gen(function* () {
    const database = yield* Database
    const project = yield* getProject(projectId)
    const domains = yield* database.transaction((transaction) =>
      domainTextsIn(transaction, projectId),
    )
    if (domains.length === 0) {
      return { found: `The living spec of ${project.name} has no domain yet.` } as const
    }
    if (asked.domain !== undefined) {
      const wanted = nameKey(asked.domain)
      const one = domains.find((domain) => nameKey(domain.name) === wanted)
      if (one === undefined) {
        return {
          missing: `the living spec of ${project.name} has no domain “${asked.domain.trim()}”: its domains are ${domains.map((domain) => domain.name).join(', ')}.`,
        } as const
      }
      return { found: livingSpecText([one]) } as const
    }
    const page = asked.page ?? 1
    const pages = Math.ceil(domains.length / LIVING_PAGE_DOMAINS)
    if (page > pages) {
      return {
        missing: `the living spec of ${project.name} has ${String(pages)} page(s) of domains.`,
      } as const
    }
    const shown = domains.slice((page - 1) * LIVING_PAGE_DOMAINS, page * LIVING_PAGE_DOMAINS)
    const more =
      page < pages
        ? `More follows: living_spec_read with page ${String(page + 1)}.`
        : 'This is the end of the living spec.'
    return {
      found: [
        `The living spec of ${project.name}: ${String(domains.length)} domain(s). A requirement marked [proposed] is not validated by the user: a hint, never a fact.`,
        livingSpecText(shown),
        more,
      ].join('\n\n'),
    } as const
  })

/**
 * A living requirement of a Project as a delta names it, read in the transaction given: its
 * version, whether it is removed, its domain's name, its state; null when the Project has none
 * of that id.
 */
export const livingStandingIn = (transaction: EngineTransaction, projectId: string, id: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select()
      .from(livingRequirements)
      .where(and(eq(livingRequirements.id, id.trim()), eq(livingRequirements.projectId, projectId)))
      .pipe(Effect.mapError(refusedWhile('reading the living spec')))
    if (row === undefined) return null
    const [domain] = yield* transaction
      .select({ name: livingDomains.name })
      .from(livingDomains)
      .where(eq(livingDomains.id, row.domainId))
      .pipe(Effect.mapError(refusedWhile('reading the living spec')))
    return {
      id: row.id,
      version: row.version,
      removed: row.removed,
      domain: domain?.name ?? '',
      state: stateOf(row.state),
    } satisfies LivingStanding & { readonly state: LivingState }
  })

/** The names of a Project's domains not removed, case-folded, read in the transaction given. */
export const domainNamesIn = (transaction: EngineTransaction, projectId: string) =>
  Effect.map(
    liveDomainsIn(transaction, projectId),
    (rows) => new Set(rows.map((row) => nameKey(row.name))),
  )

export { nameKey }

// --- the versioned writes ------------------------------------------------------------------------

const requirementRowIn = (transaction: EngineTransaction, id: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select()
      .from(livingRequirements)
      .where(eq(livingRequirements.id, id))
      .pipe(Effect.mapError(refusedWhile('reading the living spec')))
    if (row === undefined) {
      return yield* new LivingSpecRefused({ reason: `The living spec has no requirement ${id}.` })
    }
    return row
  })

const historyIn = (
  transaction: EngineTransaction,
  row: Omit<typeof livingHistory.$inferInsert, 'sequence' | 'at' | 'byKind'>,
  by: LivingBy,
) =>
  transaction
    .insert(livingHistory)
    .values({ ...row, ...byColumns(by), at: now() })
    .pipe(Effect.mapError(refusedWhile('writing the living spec’s history')))

/** The text and scenarios a write gives a requirement, masked. */
export interface LivingText {
  readonly text: string
  readonly scenarios: ReadonlyArray<LivingScenario>
}

const masked = (asked: LivingText) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return {
      text: secrets.mask(asked.text.trim()),
      scenarios: secrets.mask(
        JSON.stringify(
          asked.scenarios.map((one) => ({ when: one.when.trim(), then: one.then.trim() })),
        ),
      ),
    }
  })

const changedEvent = (
  row: RequirementRow,
  what: string,
  before: number | null,
  after: number,
  by: LivingBy,
  cleared: string | null = null,
) =>
  projectEvent(
    row.projectId,
    'livingSpec.requirement_changed',
    { requirement: row.id, what, versionBefore: before, versionAfter: after, by: by.kind, cleared },
    by,
  )

/** A requirement with no change waiting on it. */
const NOTHING_PENDING = {
  pendingKind: null,
  pendingVersion: null,
  pendingText: null,
  pendingScenarios: null,
  pendingUncertainty: null,
  pendingReason: null,
} as const

/** The next requirement id of the Profile: `LR` and a number never used before. */
const nextSeqIn = (transaction: EngineTransaction) =>
  Effect.map(
    transaction
      .select({ top: max(livingRequirements.seq) })
      .from(livingRequirements)
      .pipe(Effect.mapError(refusedWhile('numbering the requirement'))),
    ([row]) => (row?.top ?? 0) + 1,
  )

/** Adds a validated requirement to a domain of the Project, in the transaction given. */
export const addRequirementIn = (
  transaction: EngineTransaction,
  asked: LivingText & { readonly projectId: string; readonly domainId: string },
  by: LivingBy,
) =>
  Effect.gen(function* () {
    const domain = (yield* liveDomainsIn(transaction, asked.projectId)).find(
      (one) => one.id === asked.domainId,
    )
    if (domain === undefined) {
      return yield* new LivingSpecRefused({ reason: 'This domain is not in the living spec.' })
    }
    const written = yield* masked(asked)
    const secrets = yield* Secrets
    const seq = yield* nextSeqIn(transaction)
    const at = now()
    const [row] = yield* transaction
      .insert(livingRequirements)
      .values({
        id: `LR${String(seq)}`,
        seq,
        projectId: asked.projectId,
        domainId: domain.id,
        ...written,
        originMissionId: by.kind === 'mission' ? by.missionId : null,
        originRound: by.kind === 'mission' ? by.round : null,
        state: 'validated',
        uncertainty: secrets.mask(''),
        version: 1,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .pipe(Effect.mapError(refusedWhile('writing the living spec')))
    if (row === undefined) return yield* Effect.die(new Error('the requirement was not written'))
    yield* historyIn(
      transaction,
      {
        requirementId: row.id,
        what: 'added',
        versionBefore: null,
        versionAfter: 1,
        textAfter: row.text,
        scenariosAfter: row.scenarios,
      },
      by,
    )
    return { id: row.id, events: [changedEvent(row, 'added', null, 1, by)] }
  })

/**
 * Where a requirement now comes from, after a change by this author: the mission and its round,
 * or the bootstrap; the user changes no text, so their call leaves the origin as it is.
 */
const originAfter = (by: LivingBy, row: RequirementRow) => {
  if (by.kind === 'mission') return { originMissionId: by.missionId, originRound: by.round }
  if (by.kind === 'bootstrap') return { originMissionId: null, originRound: null }
  return { originMissionId: row.originMissionId, originRound: row.originRound }
}

/**
 * Changes a requirement's text and scenarios on the version expected, its origin becoming its
 * author's, in the transaction given; `LivingRequirementChanged` when it moved since. A write
 * identical to it changes nothing. A change a re-run proposed on it is cleared, since it was
 * proposed on the version this write replaces, and its event says so: the domain's other
 * proposals are never blocked by it.
 */
export const modifyRequirementIn = (
  transaction: EngineTransaction,
  id: string,
  expectedVersion: number,
  asked: LivingText & { readonly uncertainty?: Masked<string> | undefined },
  by: LivingBy,
) =>
  Effect.gen(function* () {
    const row = yield* requirementRowIn(transaction, id)
    if (row.removed) {
      return yield* new LivingSpecRefused({ reason: `${id} was removed from the living spec.` })
    }
    if (row.version !== expectedVersion) {
      return yield* new LivingRequirementChanged({
        id,
        expected: expectedVersion,
        current: row.version,
      })
    }
    const written = yield* masked(asked)
    if (written.text === row.text && written.scenarios === row.scenarios) {
      return { version: row.version, events: [] }
    }
    const version = row.version + 1
    yield* transaction
      .update(livingRequirements)
      .set({
        ...written,
        ...originAfter(by, row),
        // A change a re-run proposed on the version this one replaces can never apply: it goes.
        ...NOTHING_PENDING,
        uncertainty: asked.uncertainty ?? row.uncertainty,
        version,
        updatedAt: now(),
      })
      .where(and(eq(livingRequirements.id, id), eq(livingRequirements.version, expectedVersion)))
      .pipe(Effect.mapError(refusedWhile('writing the living spec')))
    yield* historyIn(
      transaction,
      {
        requirementId: id,
        what: 'modified',
        versionBefore: row.version,
        versionAfter: version,
        textBefore: row.text,
        textAfter: written.text,
        scenariosBefore: row.scenarios,
        scenariosAfter: written.scenarios,
      },
      by,
    )
    return {
      version,
      events: [changedEvent(row, 'modified', row.version, version, by, row.pendingKind)],
    }
  })

/** Removes a requirement on the version expected, in the transaction given; it stays readable. */
export const removeRequirementIn = (
  transaction: EngineTransaction,
  id: string,
  expectedVersion: number,
  reason: string,
  by: LivingBy,
  what: 'removed' | 'rejected' | 'dropped' = 'removed',
) =>
  Effect.gen(function* () {
    const row = yield* requirementRowIn(transaction, id)
    if (row.removed) {
      return yield* new LivingSpecRefused({ reason: `${id} was removed from the living spec.` })
    }
    if (row.version !== expectedVersion) {
      return yield* new LivingRequirementChanged({
        id,
        expected: expectedVersion,
        current: row.version,
      })
    }
    const secrets = yield* Secrets
    const version = row.version + 1
    yield* transaction
      .update(livingRequirements)
      .set({ removed: true, version, ...NOTHING_PENDING, updatedAt: now() })
      .where(and(eq(livingRequirements.id, id), eq(livingRequirements.version, expectedVersion)))
      .pipe(Effect.mapError(refusedWhile('writing the living spec')))
    yield* historyIn(
      transaction,
      {
        requirementId: id,
        what,
        versionBefore: row.version,
        versionAfter: version,
        textBefore: row.text,
        scenariosBefore: row.scenarios,
        reason: secrets.mask(reason.trim()),
      },
      by,
    )
    return { version, events: [changedEvent(row, what, row.version, version, by)] }
  })

/** Adds a validated requirement to a domain; answers its id. For the other engine services. */
export const addRequirement = (
  asked: LivingText & { readonly projectId: string; readonly domainId: string },
  by: LivingBy,
) =>
  mutate('adding a living requirement', (transaction) =>
    Effect.map(addRequirementIn(transaction, asked, by), (written) => ({
      result: written.id,
      events: written.events,
    })),
  )

/** Changes a requirement on the version expected; answers its version now. */
export const modifyRequirement = (
  id: string,
  expectedVersion: number,
  asked: LivingText,
  by: LivingBy,
) =>
  mutate('changing a living requirement', (transaction) =>
    Effect.map(modifyRequirementIn(transaction, id, expectedVersion, asked, by), (written) => ({
      result: written.version,
      events: written.events,
    })),
  )

/** Removes a requirement on the version expected; answers its version now. */
export const removeRequirement = (
  id: string,
  expectedVersion: number,
  reason: string,
  by: LivingBy,
) =>
  mutate('removing a living requirement', (transaction) =>
    Effect.map(removeRequirementIn(transaction, id, expectedVersion, reason, by), (written) => ({
      result: written.version,
      events: written.events,
    })),
  )

// --- the bootstrap's proposals -------------------------------------------------------------------

/** The run a session reads for, by its lineage; null when it reads for none. */
export const runOfLineage = (lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(livingRuns)
      .where(eq(livingRuns.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading the bootstrap runs')))
    return row ?? null
  })

/** The run, read again in the transaction, while it still runs; the sentence otherwise. */
const runningIn = (transaction: EngineTransaction, runId: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select()
      .from(livingRuns)
      .where(eq(livingRuns.id, runId))
      .pipe(Effect.mapError(refusedWhile('reading the bootstrap run')))
    return row?.state === 'running' ? row : null
  })

const ENDED = 'this reading of the living spec has ended: nothing more is recorded.'

/** A domain that has something proposed again waits on the user. */
const reopenDomainIn = (transaction: EngineTransaction, domain: DomainRow) =>
  domain.state === 'proposed'
    ? Effect.void
    : transaction
        .update(livingDomains)
        .set({ state: 'proposed', updatedAt: now() })
        .where(eq(livingDomains.id, domain.id))
        .pipe(Effect.mapError(refusedWhile('writing the living spec')), Effect.asVoid)

const scopeNameIn = (transaction: EngineTransaction, run: RunRow) =>
  Effect.gen(function* () {
    if (run.domainId === null) return null
    const [row] = yield* transaction
      .select({ name: livingDomains.name })
      .from(livingDomains)
      .where(eq(livingDomains.id, run.domainId))
      .pipe(Effect.mapError(refusedWhile('reading the living spec')))
    return row?.name ?? null
  })

/**
 * A domain the bootstrap proposes; refused on a run on one domain, for a name the Project has, or
 * for one the user rejected since the run started.
 */
export const proposeDomain = (
  runId: string,
  asked: {
    readonly name: string
    readonly summary: string
    readonly uncertainty?: string | undefined
  },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return yield* mutate('proposing a domain', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Proposed<string>) => ({ result, events: [] })
        const run = yield* runningIn(transaction, runId)
        if (run === null) return answer(refused(ENDED))
        const scope = yield* scopeNameIn(transaction, run)
        if (scope !== null) {
          return answer(
            refused(
              `this run reads one domain, ${scope}: propose requirements for it, not a domain.`,
            ),
          )
        }
        const domains = yield* liveDomainsIn(transaction, run.projectId)
        const name = secrets.mask(asked.name.trim())
        const taken = domains.find((one) => nameKey(one.name) === nameKey(name))
        if (taken !== undefined) {
          return answer(
            refused(
              `the living spec already has a domain “${taken.name}”: never propose a domain twice; read it with living_spec_read and propose its missing requirements.`,
            ),
          )
        }
        // The user's no stands for the rest of this reading: a later one may propose it again.
        const rejected = (yield* transaction
          .select()
          .from(livingDomains)
          .where(eq(livingDomains.projectId, run.projectId))
          .pipe(Effect.mapError(refusedWhile('reading the living spec')))).find(
          (one) =>
            one.removedAt !== null &&
            one.removedAt >= run.startedAt &&
            nameKey(one.name) === nameKey(name),
        )
        if (rejected !== undefined) {
          return answer(
            refused(
              `the user rejected the domain “${rejected.name}” during this reading: do not propose it again.`,
            ),
          )
        }
        const at = now()
        yield* transaction
          .insert(livingDomains)
          .values({
            id: crypto.randomUUID(),
            projectId: run.projectId,
            rank: Math.max(0, ...domains.map((one) => one.rank)) + 1,
            name,
            summary: secrets.mask(asked.summary.trim()),
            uncertainty: secrets.mask((asked.uncertainty ?? '').trim()),
            state: 'proposed',
            createdAt: at,
            updatedAt: at,
          })
          .pipe(Effect.mapError(refusedWhile('writing the living spec')))
        return {
          result: done(name),
          events: [projectEvent(run.projectId, 'livingSpec.domain_proposed', { name }, BOOTSTRAP)],
        }
      }),
    )
  })

/**
 * A requirement the bootstrap proposes, of origin `bootstrap`; with `replaces`, on a run on one
 * domain only, a replacement pending on a requirement of that domain, applied at validation.
 */
export const proposeRequirement = (
  runId: string,
  asked: LivingText & {
    readonly domain: string
    readonly uncertainty?: string | undefined
    readonly replaces?: string | undefined
  },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const written = yield* masked(asked)
    const uncertainty = secrets.mask((asked.uncertainty ?? '').trim())
    return yield* mutate('proposing a requirement', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Proposed<string>) => ({ result, events: [] })
        const run = yield* runningIn(transaction, runId)
        if (run === null) return answer(refused(ENDED))
        const domains = yield* liveDomainsIn(transaction, run.projectId)
        const domain = domains.find((one) => nameKey(one.name) === nameKey(asked.domain))
        if (domain === undefined) {
          return answer(
            refused(
              `the living spec has no domain “${asked.domain.trim()}”: propose it first with living_domain_propose.`,
            ),
          )
        }
        if (run.domainId !== null && domain.id !== run.domainId) {
          const scope = yield* scopeNameIn(transaction, run)
          return answer(refused(`this run reads one domain, ${scope ?? ''}: propose for it only.`))
        }
        const own = (yield* requirementRowsIn(transaction, run.projectId)).filter(
          (one) => one.domainId === domain.id && !one.removed,
        )
        if (asked.replaces !== undefined) {
          if (run.domainId === null) {
            return answer(refused('replaces is for a run on one domain only.'))
          }
          const target = own.find((one) => one.id === asked.replaces?.trim())
          if (target === undefined) {
            return answer(
              refused(`${domain.name} has no requirement ${asked.replaces.trim()} to replace.`),
            )
          }
          yield* transaction
            .update(livingRequirements)
            .set({
              pendingKind: 'replace',
              pendingVersion: target.version,
              pendingText: written.text,
              pendingScenarios: written.scenarios,
              pendingUncertainty: uncertainty,
              pendingReason: null,
              updatedAt: now(),
            })
            .where(eq(livingRequirements.id, target.id))
            .pipe(Effect.mapError(refusedWhile('writing the living spec')))
          yield* reopenDomainIn(transaction, domain)
          return {
            result: done(target.id),
            events: [
              projectEvent(
                run.projectId,
                'livingSpec.change_proposed',
                { requirement: target.id, kind: 'replace' },
                BOOTSTRAP,
              ),
            ],
          }
        }
        const twice = own.find((one) => nameKey(one.text) === nameKey(written.text))
        if (twice !== undefined) {
          return answer(
            refused(
              `${domain.name} already has it as ${twice.id}: never propose a requirement twice.`,
            ),
          )
        }
        const seq = yield* nextSeqIn(transaction)
        const id = `LR${String(seq)}`
        const at = now()
        yield* transaction
          .insert(livingRequirements)
          .values({
            id,
            seq,
            projectId: run.projectId,
            domainId: domain.id,
            ...written,
            state: 'proposed',
            uncertainty,
            version: 1,
            createdAt: at,
            updatedAt: at,
          })
          .pipe(Effect.mapError(refusedWhile('writing the living spec')))
        yield* historyIn(
          transaction,
          {
            requirementId: id,
            what: 'proposed',
            versionBefore: null,
            versionAfter: 1,
            textAfter: written.text,
            scenariosAfter: written.scenarios,
          },
          BOOTSTRAP,
        )
        yield* reopenDomainIn(transaction, domain)
        return {
          result: done(id),
          events: [
            projectEvent(
              run.projectId,
              'livingSpec.requirement_proposed',
              { requirement: id, domain: domain.name },
              BOOTSTRAP,
            ),
          ],
        }
      }),
    )
  })

/** On a run on one domain, a requirement of it whose behaviour is gone: a removal pending. */
export const proposeObsolete = (
  runId: string,
  asked: { readonly requirement: string; readonly reason: string },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return yield* mutate('proposing a removal', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Proposed<string>) => ({ result, events: [] })
        const run = yield* runningIn(transaction, runId)
        if (run === null) return answer(refused(ENDED))
        if (run.domainId === null) {
          return answer(refused('living_requirement_obsolete is for a run on one domain only.'))
        }
        const [domain] = (yield* liveDomainsIn(transaction, run.projectId)).filter(
          (one) => one.id === run.domainId,
        )
        const [target] = (yield* requirementRowsIn(transaction, run.projectId)).filter(
          (one) =>
            one.id === asked.requirement.trim() && one.domainId === run.domainId && !one.removed,
        )
        if (domain === undefined || target === undefined) {
          return answer(
            refused(
              `${domain?.name ?? 'this domain'} has no requirement ${asked.requirement.trim()}.`,
            ),
          )
        }
        yield* transaction
          .update(livingRequirements)
          .set({
            pendingKind: 'obsolete',
            pendingVersion: target.version,
            pendingText: null,
            pendingScenarios: null,
            pendingUncertainty: null,
            pendingReason: secrets.mask(asked.reason.trim()),
            updatedAt: now(),
          })
          .where(eq(livingRequirements.id, target.id))
          .pipe(Effect.mapError(refusedWhile('writing the living spec')))
        yield* reopenDomainIn(transaction, domain)
        return {
          result: done(target.id),
          events: [
            projectEvent(
              run.projectId,
              'livingSpec.change_proposed',
              { requirement: target.id, kind: 'obsolete' },
              BOOTSTRAP,
            ),
          ],
        }
      }),
    )
  })

/** What the end of a run says, for Since you left. */
export const readySaid = (projectName: string): string =>
  `The living spec of ${projectName} is ready to review`

/** The run ends with the agent's summary; refused when it has ended already. */
export const finishRun = (runId: string, summary: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return yield* mutate('ending a bootstrap run', (transaction) =>
      Effect.gen(function* () {
        const run = yield* runningIn(transaction, runId)
        if (run === null) return { result: refused<true>(ENDED), events: [] }
        const project = yield* getProject(run.projectId).pipe(
          Effect.catchTag('UnknownProject', () => Effect.succeed(null)),
        )
        const said = secrets.mask(summary.trim())
        yield* transaction
          .update(livingRuns)
          .set({ state: 'done', summary: said, endedAt: now() })
          .where(and(eq(livingRuns.id, runId), eq(livingRuns.state, 'running')))
          .pipe(Effect.mapError(refusedWhile('ending a bootstrap run')))
        return {
          result: done(true),
          events: [
            projectEvent(
              run.projectId,
              'livingSpec.bootstrap_finished',
              {
                run: runId,
                state: 'done',
                summary: said,
                sentence: readySaid(project?.name ?? 'this Project'),
              },
              BOOTSTRAP,
            ),
          ],
        }
      }),
    )
  })

/** A run that cannot go on ends, failed, with why; nothing when it has ended already. */
export const failRun = (runId: string, reason: string) =>
  mutate('ending a bootstrap run', (transaction) =>
    Effect.gen(function* () {
      const run = yield* runningIn(transaction, runId)
      if (run === null) return { result: false, events: [] }
      yield* transaction
        .update(livingRuns)
        .set({ state: 'failed', stateReason: reason, endedAt: now() })
        .where(eq(livingRuns.id, runId))
        .pipe(Effect.mapError(refusedWhile('ending a bootstrap run')))
      const event: NewEvent = {
        type: 'livingSpec.bootstrap_finished',
        entityKind: 'project',
        entityId: run.projectId,
        source: 'system',
        author: 'hemera',
        payload: { run: runId, state: 'failed', reason },
      }
      return { result: true, events: [event] }
    }),
  )

/** A versioned write inside a user's call met another version: the user reads it so. */
const asUser = <A, R>(
  effect: Effect.Effect<A, LivingSpecRefused | LivingRequirementChanged | DatabaseError, R>,
) =>
  effect.pipe(
    Effect.catchTag('LivingRequirementChanged', (changed) =>
      Effect.fail(new LivingSpecRefused({ reason: changed.message })),
    ),
  )

// --- the user's calls ----------------------------------------------------------------------------

const domainRowIn = (transaction: EngineTransaction, domainId: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select()
      .from(livingDomains)
      .where(eq(livingDomains.id, domainId))
      .pipe(Effect.mapError(refusedWhile('reading the living spec')))
    if (row === undefined || row.removedAt !== null) {
      return yield* new LivingSpecRefused({ reason: 'This domain is not in the living spec.' })
    }
    return row
  })

/** A change pending on a requirement as two readings compare it. */
const pendingKey = (pending: LivingPending | null): string => {
  if (pending === null) return ''
  if (Predicate.isTagged(pending, 'Obsolete')) return JSON.stringify(['obsolete', pending.reason])
  return JSON.stringify([
    'replace',
    pending.text,
    pending.scenarios.map((one) => [one.when, one.then]),
    pending.uncertainty,
  ])
}

/**
 * What differs between what the user saw waiting in a domain and what waits in it now, each as
 * a few words; empty when they saw what is there.
 */
const unseen = (
  waiting: ReadonlyArray<RequirementRow>,
  seen: ReadonlyArray<LivingSeen>,
): ReadonlyArray<string> => {
  const shown = new Map(seen.map((one) => [one.id, one]))
  const waits = new Set(waiting.map((one) => one.id))
  return [
    ...waiting.flatMap((row) => {
      const saw = shown.get(row.id)
      if (saw === undefined) {
        return [
          row.state === 'proposed'
            ? `${row.id} was proposed since`
            : `a change was proposed on ${row.id} since`,
        ]
      }
      if (saw.version !== row.version) {
        return [`${row.id} is at version ${String(row.version)}, not ${String(saw.version)}`]
      }
      if (pendingKey(saw.pending) !== pendingKey(pendingOf(row))) {
        return [`the change proposed on ${row.id} is another`]
      }
      return []
    }),
    ...seen.filter((one) => !waits.has(one.id)).map((one) => `${one.id} no longer waits`),
  ]
}

/** Refused, in words, when the user did not see what waits in the domain now. */
const asSeenIn = (
  domain: DomainRow,
  waiting: ReadonlyArray<RequirementRow>,
  seen: ReadonlyArray<LivingSeen>,
) => {
  const differs = unseen(waiting, seen)
  return differs.length === 0
    ? Effect.void
    : Effect.fail(
        new LivingSpecRefused({
          reason: `${domain.name} changed since you read it (${differs.join('; ')}): look at it again, then decide.`,
        }),
      )
}

/**
 * The user validates a domain: its proposed requirements become validated, each replacement and
 * obsolescence a re-run proposed is applied as a new version (origin `bootstrap`) on the version
 * it was proposed on. One of them moved since: nothing is validated, and the user is told which.
 */
export const validateDomain = (domainId: string, seen: ReadonlyArray<LivingSeen>) =>
  asUser(
    mutate('validating a domain', (transaction) =>
      Effect.gen(function* () {
        const domain = yield* domainRowIn(transaction, domainId)
        const rows = (yield* requirementRowsIn(transaction, domain.projectId)).filter(
          (one) => one.domainId === domainId && !one.removed,
        )
        const waiting = rows.filter((one) => one.state === 'proposed' || one.pendingKind !== null)
        if (domain.state === 'validated' && waiting.length === 0)
          return { result: false, events: [] }
        yield* asSeenIn(domain, waiting, seen)
        const events: NewEvent[] = []
        for (const row of waiting) {
          if (row.pendingKind !== null && row.pendingVersion !== row.version) {
            return yield* new LivingSpecRefused({
              reason: `${row.id} changed since the reading of ${domain.name} proposed a change to it (version ${String(row.pendingVersion)}, now ${String(row.version)}): read ${domain.name} again before you validate it.`,
            })
          }
          if (row.pendingKind === 'obsolete') {
            const removed = yield* removeRequirementIn(
              transaction,
              row.id,
              row.version,
              row.pendingReason ?? '',
              BOOTSTRAP,
            )
            events.push(...removed.events)
            continue
          }
          // Validated and nothing waiting on it any more, before the replacement is applied.
          yield* transaction
            .update(livingRequirements)
            .set({ state: 'validated', ...NOTHING_PENDING, updatedAt: now() })
            .where(eq(livingRequirements.id, row.id))
            .pipe(Effect.mapError(refusedWhile('validating a requirement')))
          let version = row.version
          if (row.pendingKind === 'replace') {
            const changed = yield* modifyRequirementIn(
              transaction,
              row.id,
              row.version,
              {
                text: row.pendingText ?? row.text,
                scenarios: scenariosOf(row.pendingScenarios),
                uncertainty: row.pendingUncertainty ?? row.uncertainty,
              },
              BOOTSTRAP,
            )
            version = changed.version
            events.push(...changed.events)
          }
          if (row.state === 'proposed') {
            yield* historyIn(
              transaction,
              {
                requirementId: row.id,
                what: 'validated',
                versionBefore: version,
                versionAfter: version,
              },
              USER,
            )
          }
        }
        const at = now()
        yield* transaction
          .update(livingDomains)
          .set({ state: 'validated', validatedAt: at, updatedAt: at })
          .where(eq(livingDomains.id, domainId))
          .pipe(Effect.mapError(refusedWhile('validating a domain')))
        return {
          result: true,
          events: [
            ...events,
            projectEvent(
              domain.projectId,
              'livingSpec.domain_validated',
              { domain: domain.name, requirements: waiting.length },
              USER,
            ),
          ],
        }
      }),
    ),
  )

/**
 * The user rejects a domain's proposals: its proposed requirements are removed (their history
 * kept), what a re-run proposed on validated ones is dropped, and the domain goes when nothing
 * validated is left in it. A validated requirement is never removed so.
 */
export const rejectDomain = (domainId: string, seen: ReadonlyArray<LivingSeen>) =>
  asUser(
    mutate('rejecting a domain', (transaction) =>
      Effect.gen(function* () {
        const domain = yield* domainRowIn(transaction, domainId)
        const rows = (yield* requirementRowsIn(transaction, domain.projectId)).filter(
          (one) => one.domainId === domainId && !one.removed,
        )
        const proposed = rows.filter((one) => one.state === 'proposed')
        const validated = rows.filter((one) => one.state === 'validated')
        if (
          domain.state === 'validated' &&
          proposed.length === 0 &&
          rows.every((one) => one.pendingKind === null)
        ) {
          return yield* new LivingSpecRefused({
            reason: `${domain.name} has nothing proposed to reject: it is validated.`,
          })
        }
        yield* asSeenIn(
          domain,
          rows.filter((one) => one.state === 'proposed' || one.pendingKind !== null),
          seen,
        )
        const events: NewEvent[] = []
        for (const row of proposed) {
          const removed = yield* removeRequirementIn(
            transaction,
            row.id,
            row.version,
            `the user rejected the proposals of ${domain.name}`,
            USER,
            'rejected',
          )
          events.push(...removed.events)
        }
        yield* transaction
          .update(livingRequirements)
          .set(NOTHING_PENDING)
          .where(eq(livingRequirements.domainId, domainId))
          .pipe(Effect.mapError(refusedWhile('rejecting a domain')))
        const at = now()
        yield* transaction
          .update(livingDomains)
          .set(
            validated.length === 0
              ? { removedAt: at, updatedAt: at }
              : { state: 'validated', updatedAt: at },
          )
          .where(eq(livingDomains.id, domainId))
          .pipe(Effect.mapError(refusedWhile('rejecting a domain')))
        return {
          result: undefined,
          events: [
            ...events,
            projectEvent(
              domain.projectId,
              'livingSpec.domain_rejected',
              { domain: domain.name, removed: proposed.length, kept: validated.length },
              USER,
            ),
          ],
        }
      }),
    ),
  )

/** The user drops one proposed requirement before validating its domain; a validated one stays. */
export const dropRequirement = (requirementId: string) =>
  asUser(
    mutate('dropping a requirement', (transaction) =>
      Effect.gen(function* () {
        const row = yield* requirementRowIn(transaction, requirementId)
        if (row.removed) {
          return yield* new LivingSpecRefused({
            reason: `${row.id} was removed from the living spec already.`,
          })
        }
        if (row.state !== 'proposed') {
          return yield* new LivingSpecRefused({
            reason: `${row.id} is validated: only a proposed requirement is dropped.`,
          })
        }
        const removed = yield* removeRequirementIn(
          transaction,
          row.id,
          row.version,
          'the user dropped it',
          USER,
          'dropped',
        )
        return {
          result: undefined,
          events: [
            ...removed.events,
            projectEvent(
              row.projectId,
              'livingSpec.requirement_dropped',
              { requirement: row.id },
              USER,
            ),
          ],
        }
      }),
    ),
  )
