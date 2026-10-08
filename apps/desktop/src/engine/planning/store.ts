/**
 * A mission's Spec in the database (#85): read whole in one transaction, written only by the
 * Planner under the one write rule and on the version it read, each write bumping the Spec's
 * version and leaving one change row per item, and its readable file `missions/<key>/spec.md`
 * rewritten after each write (never read back).
 *
 * The user's side is here too: the vision, the version they last read, keeping a mission the
 * Planner triaged, and the Project's Spec language.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  type CompletenessFailure,
  MISSION_TYPES,
  MaskedText,
  type MissionType,
  SECTION_TITLES,
  SPEC_SECTIONS,
  STAGES,
  type SpecSectionName,
  type TriageKind,
  TRIAGE_KINDS,
  DELTAS,
  canonicalLanguage,
  completeness,
  missionKey,
  renderSpecMarkdown,
  searchTextOf,
  specWriteRefusal,
  staleSaid,
} from '@hemera/core/domain'
import {
  InvalidSpecLanguage,
  PlanningRefused,
  type Spec,
  type SpecChange,
  type SpecRequirement,
  type TriageAnswer,
  UnknownMission,
  UnknownProject,
} from '@hemera/ipc'
import { and, asc, eq, gt } from 'drizzle-orm'
import { Effect, Layer } from 'effect'

import type { EventPayload, NewEvent } from '../journal.ts'
import { missionFolder, writeWhole } from '../memory/files.ts'
import { ProfileHome } from '../profile-home.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  memoryNext,
  missions,
  projects,
  specChanges,
  specReads,
  specRequirements,
  specScenarios,
  specSections,
  specVisions,
  specs,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { SpecLanguage } from '../sessions/ports.ts'
import type { SessionOwner } from '../sessions/roles.ts'
import { SpecBoard, type Wrote } from './board.ts'
import { pendingIn, receiveInput } from './inputs.ts'

/** The file a mission's Spec is readable in, in its Memory's folder. */
export const SPEC_FILE = 'spec.md'

const now = (): string => new Date().toISOString()

/** Who writes: a session of the mission, by the role its grant holds. */
export interface SpecWriter {
  readonly sessionId: string
  readonly role: string
  readonly missionId: string
}

/** A write's outcome: refused with the sentence the agent reads, or what it wrote. */
export type Written<A> = { readonly refused: string } | { readonly done: A }

const refused = <A>(sentence: string): Written<A> => ({ refused: sentence })

type MissionRow = typeof missions.$inferSelect

const stageOf = (row: MissionRow) => STAGES.find((one) => one === row.stage) ?? 'cancelled'
const typeOf = (row: MissionRow): MissionType =>
  MISSION_TYPES.find((one) => one === row.type) ?? 'feature'
const triageKindOf = (text: string | null): TriageKind | null =>
  TRIAGE_KINDS.find((one) => one === text) ?? null

/** The mission's triage answer, as its row keeps it. */
export const triageOf = (row: MissionRow): TriageAnswer | null => {
  const kind = triageKindOf(row.triageKind)
  if (kind === null || row.triageText === null || row.triagedAt === null) return null
  return {
    kind,
    ref: row.triageRef,
    text: row.triageText,
    state: row.triageState === 'kept' ? 'kept' : 'pending',
    at: row.triagedAt,
  }
}

export const missionRow = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select()
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (row === undefined) return yield* new UnknownMission({ id: missionId })
    return row
  })

/**
 * The Spec row of a mission, made when it has none yet (a mission from before the Spec existed):
 * its language is then its Project's now.
 */
export const ensureSpec = (transaction: EngineTransaction, mission: MissionRow) =>
  Effect.gen(function* () {
    const [found] = yield* transaction
      .select()
      .from(specs)
      .where(eq(specs.missionId, mission.id))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    if (found !== undefined) return found
    const [project] = yield* transaction
      .select({ language: projects.specLanguage })
      .from(projects)
      .where(eq(projects.id, mission.projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    const [made] = yield* transaction
      .insert(specs)
      .values({ missionId: mission.id, language: project?.language ?? 'en', updatedAt: now() })
      .returning()
      .pipe(Effect.mapError(refusedWhile('writing the Spec')))
    if (made === undefined) return yield* Effect.die(new Error('the Spec row was not written'))
    return made
  })

/** The Spec row of a mission as it stands, read only: a mission without one has an empty Spec. */
const specRowOf = (transaction: EngineTransaction, mission: MissionRow) =>
  Effect.gen(function* () {
    const [found] = yield* transaction
      .select()
      .from(specs)
      .where(eq(specs.missionId, mission.id))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    if (found !== undefined) return found
    const [project] = yield* transaction
      .select({ language: projects.specLanguage })
      .from(projects)
      .where(eq(projects.id, mission.projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    return {
      missionId: mission.id,
      version: 0,
      language: project?.language ?? 'en',
      declaredCompleteVersion: null,
      frozen: false,
      frozenAt: null,
      nextRequirement: 1,
      describedAt: null,
      updatedAt: mission.updatedAt,
    } satisfies typeof specs.$inferSelect
  })

/** A new mission's Spec, in the Project's Spec language as it is now. */
export const newSpec = (transaction: EngineTransaction, missionId: string, projectId: string) =>
  Effect.gen(function* () {
    const [project] = yield* transaction
      .select({ language: projects.specLanguage })
      .from(projects)
      .where(eq(projects.id, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    yield* transaction
      .insert(specs)
      .values({ missionId, language: project?.language ?? 'en', updatedAt: now() })
      .pipe(Effect.mapError(refusedWhile('writing the Spec')))
  })

/** A mission's Spec, read in the transaction given; `writing` the sections being written now. */
export const specIn = (
  transaction: EngineTransaction,
  missionId: string,
  writing: ReadonlySet<SpecSectionName> = new Set(),
) =>
  Effect.gen(function* () {
    const mission = yield* missionRow(transaction, missionId)
    const spec = yield* specRowOf(transaction, mission)
    const sections = yield* transaction
      .select()
      .from(specSections)
      .where(eq(specSections.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    const requirements = yield* transaction
      .select()
      .from(specRequirements)
      .where(eq(specRequirements.missionId, missionId))
      .orderBy(asc(specRequirements.rank))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    const scenarios = yield* transaction
      .select()
      .from(specScenarios)
      .where(and(eq(specScenarios.missionId, missionId), eq(specScenarios.removed, false)))
      .orderBy(asc(specScenarios.rank))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    const [read] = yield* transaction
      .select()
      .from(specReads)
      .where(eq(specReads.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    return {
      missionId,
      key: missionKey(mission.keyPrefix, mission.keyNumber),
      title: mission.title,
      type: typeOf(mission),
      stage: stageOf(mission),
      language: spec.language,
      version: spec.version,
      declaredCompleteVersion: spec.declaredCompleteVersion,
      frozen: spec.frozen,
      readVersion: read?.version ?? null,
      sections: SPEC_SECTIONS.map((name) => {
        const row = sections.find((one) => one.name === name)
        return {
          name,
          title: SECTION_TITLES[name],
          body: row?.body ?? '',
          version: row?.version ?? 0,
          state: writing.has(name) ? 'being_written' : row === undefined ? 'empty' : 'written',
          writtenAt: row?.writtenAt ?? null,
        } as const
      }),
      requirements: requirements.map((row): SpecRequirement => ({
        id: row.id,
        domain: row.domain,
        delta: DELTAS.find((one) => one === row.delta) ?? 'added',
        livingRef: row.livingRef,
        livingVersion: row.livingVersion,
        text: row.text,
        version: row.version,
        removed: row.removed,
        scenarios: scenarios
          .filter((scenario) => scenario.requirementId === row.id)
          .map((scenario) => ({
            id: scenario.id,
            when: scenario.whenText,
            then: scenario.thenText,
            version: scenario.version,
          })),
      })),
      triage: triageOf(mission),
    } satisfies Spec
  })

/** A mission's Spec, read at one moment, with the sections being written now. */
export const readSpec = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const writing = yield* SpecBoard.use((board) => board.beingWritten(missionId))
    return yield* database.transaction((transaction) => specIn(transaction, missionId, writing))
  })

/**
 * Writes the readable file of a mission's Spec: the database is the truth, the file a view. One
 * mission's rewrites run one after the other, each reading the Spec as it is then.
 */
export const writeSpecFile = (missionId: string) =>
  Effect.gen(function* () {
    const board = yield* SpecBoard
    yield* board.filing(missionId)(
      Effect.gen(function* () {
        const spec = yield* readSpec(missionId)
        const home = yield* ProfileHome
        const folder = missionFolder(home.dataFolder, spec.key)
        yield* Effect.try({
          try: () => {
            mkdirSync(folder, { recursive: true })
            writeWhole(join(folder, SPEC_FILE), renderSpecMarkdown(spec))
          },
          catch: refusedWhile(`writing the Spec file of ${spec.key}`),
        })
      }),
    )
  })

/** Where a writer stands: the mission, its Spec, and the rule's refusal, if any. */
export const standingOf = (transaction: EngineTransaction, writer: SpecWriter) =>
  Effect.gen(function* () {
    const mission = yield* missionRow(transaction, writer.missionId)
    const spec = yield* ensureSpec(transaction, mission)
    const key = missionKey(mission.keyPrefix, mission.keyNumber)
    const refusal = specWriteRefusal({
      key,
      stage: stageOf(mission),
      frozen: spec.frozen,
      role: writer.role,
    })
    return { mission, spec, key, refusal }
  })

/** The next Spec version, and the change rows it leaves. */
const bump = (
  transaction: EngineTransaction,
  writer: SpecWriter,
  version: number,
  changes: ReadonlyArray<{ item: string; before: string | null; after: string | null }>,
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const at = now()
    yield* transaction
      .update(specs)
      .set({ version, updatedAt: at })
      .where(eq(specs.missionId, writer.missionId))
      .pipe(Effect.mapError(refusedWhile('writing the Spec')))
    yield* transaction
      .insert(specChanges)
      .values(
        changes.map((change) => ({
          missionId: writer.missionId,
          version,
          item: change.item,
          before: change.before === null ? null : secrets.mask(change.before),
          after: change.after === null ? null : secrets.mask(change.after),
          sessionId: writer.sessionId,
          at,
        })),
      )
      .pipe(Effect.mapError(refusedWhile('writing the Spec')))
  })

/**
 * What a write tells after its commit: the file, the board, and the turn's line. The write has
 * committed: a file that cannot be written is said in the diagnostic log, never to the agent.
 */
const afterWrite = (writer: SpecWriter, items: ReadonlyArray<Wrote>) =>
  Effect.gen(function* () {
    const board = yield* SpecBoard
    yield* writeSpecFile(writer.missionId).pipe(
      Effect.catch((failure) => board.said(`the Spec file was not written: ${failure.message}`)),
    )
    yield* board.wrote(writer.sessionId, writer.missionId, items)
    yield* board.changed(writer.missionId)
  })

/** One prose section, whole, on the version the writer read. */
export const writeSection = (
  writer: SpecWriter,
  name: SpecSectionName,
  content: string,
  base: number,
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const body = secrets.mask(content.trim())
    const outcome = yield* mutate('writing a section of the Spec', (transaction) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(transaction, writer)
        const answer = (result: Written<{ version: number; spec: number }>) => ({
          result,
          events: [],
        })
        if (standing.refusal !== null) return answer(refused(standing.refusal))
        const [row] = yield* transaction
          .select()
          .from(specSections)
          .where(and(eq(specSections.missionId, writer.missionId), eq(specSections.name, name)))
          .pipe(Effect.mapError(refusedWhile('reading the Spec')))
        const current = row?.version ?? 0
        if (base !== current)
          return answer(refused(staleSaid(name, base, current, row?.body ?? '')))
        if (row?.body === body) {
          return answer({ done: { version: current, spec: standing.spec.version } })
        }
        const version = current + 1
        const line = { body, version, sessionId: writer.sessionId, writtenAt: now() }
        yield* transaction
          .insert(specSections)
          .values({ missionId: writer.missionId, name, ...line })
          .onConflictDoUpdate({ target: [specSections.missionId, specSections.name], set: line })
          .pipe(Effect.mapError(refusedWhile('writing a section')))
        const spec = standing.spec.version + 1
        yield* bump(transaction, writer, spec, [
          { item: name, before: row?.body ?? null, after: body },
        ])
        return answer({ done: { version, spec } })
      }),
    )
    // A write identical to the section leaves it at the version read: nothing to tell.
    if ('done' in outcome && outcome.done.version !== base) {
      yield* afterWrite(writer, [{ kind: 'section', name }])
    }
    return outcome
  })

/** A scenario as a requirement write asks for it. */
export interface ScenarioAsked {
  readonly id?: string | undefined
  readonly when: string
  readonly then: string
}

/** A requirement as the Planner writes it, whole with its scenarios. */
export interface RequirementAsked {
  readonly id?: string | undefined
  readonly domain: string
  readonly delta: (typeof DELTAS)[number]
  readonly livingRef?: string | undefined
  readonly livingVersion?: number | undefined
  readonly text: string
  readonly scenarios: ReadonlyArray<ScenarioAsked>
  readonly base?: number | undefined
}

type RequirementRow = typeof specRequirements.$inferSelect

/** A requirement as its change rows say it. */
const requirementSaid = (row: {
  domain: string
  delta: string
  livingRef: string | null
  text: string
}): string =>
  `${[row.delta, row.domain, ...(row.livingRef === null ? [] : [row.livingRef])].join(' · ')}: ${row.text}`

const scenarioSaid = (when: string, then: string): string => `WHEN ${when} THEN ${then}`

/**
 * One requirement and its scenarios, as a whole: a scenario with no id is new, one left out is
 * removed, and ids are never reused. A new requirement takes the next number of its mission.
 */
export const writeRequirement = (writer: SpecWriter, asked: RequirementAsked) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const fields = {
      domain: secrets.mask(asked.domain.trim()),
      delta: asked.delta,
      livingRef: asked.livingRef === undefined ? null : secrets.mask(asked.livingRef.trim()),
      livingVersion: asked.livingVersion ?? null,
      text: secrets.mask(asked.text.trim()),
    }
    const outcome = yield* mutate('writing a requirement of the Spec', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Written<{ id: string; version: number; items: Wrote[] }>) => ({
          result,
          events: [],
        })
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return answer(refused(standing.refusal))
        let existing: RequirementRow | null = null
        if (asked.id !== undefined) {
          const [row] = yield* transaction
            .select()
            .from(specRequirements)
            .where(
              and(
                eq(specRequirements.missionId, writer.missionId),
                eq(specRequirements.id, asked.id),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the Spec')))
          if (row === undefined) {
            return answer(
              refused(
                `refused: the Spec has no requirement ${asked.id}: leave the id out to write a new one.`,
              ),
            )
          }
          if (row.removed) {
            return answer(
              refused(
                `refused: ${asked.id} is removed and its id is never reused: write a new one.`,
              ),
            )
          }
          if (asked.base === undefined) {
            return answer(
              refused(
                `refused: name the base_version of ${asked.id} as you read it (it is at version ${String(row.version)}).`,
              ),
            )
          }
          if (asked.base !== row.version) {
            return answer(
              refused(staleSaid(asked.id, asked.base, row.version, requirementSaid(row))),
            )
          }
          existing = row
        }
        const id = existing?.id ?? `R${String(standing.spec.nextRequirement)}`
        const kept = yield* transaction
          .select()
          .from(specScenarios)
          .where(
            and(eq(specScenarios.missionId, writer.missionId), eq(specScenarios.requirementId, id)),
          )
          .pipe(Effect.mapError(refusedWhile('reading the Spec')))
        const live = kept.filter((one) => !one.removed)
        const unknown = asked.scenarios.find(
          (one) => one.id !== undefined && !live.some((scenario) => scenario.id === one.id),
        )
        if (unknown?.id !== undefined) {
          return answer(
            refused(
              `refused: ${unknown.id} is not a live scenario of ${id}: leave its id out to write a new one.`,
            ),
          )
        }
        const changes: Array<{ item: string; before: string | null; after: string | null }> = []
        const items: Wrote[] = []
        let nextScenario = existing?.nextScenario ?? 1
        const at = now()
        for (const [rank, scenario] of asked.scenarios.entries()) {
          const when = secrets.mask(scenario.when.trim())
          const then = secrets.mask(scenario.then.trim())
          const found = live.find((one) => one.id === scenario.id)
          if (found === undefined) {
            const scenarioId = `${id}.S${String(nextScenario)}`
            nextScenario += 1
            changes.push({ item: scenarioId, before: null, after: scenarioSaid(when, then) })
            yield* transaction
              .insert(specScenarios)
              .values({
                missionId: writer.missionId,
                requirementId: id,
                id: scenarioId,
                whenText: when,
                thenText: then,
                rank,
                version: 1,
              })
              .pipe(Effect.mapError(refusedWhile('writing a scenario')))
            continue
          }
          const same = found.whenText === when && found.thenText === then
          if (!same) {
            changes.push({
              item: found.id,
              before: scenarioSaid(found.whenText, found.thenText),
              after: scenarioSaid(when, then),
            })
          }
          if (same && found.rank === rank) continue
          yield* transaction
            .update(specScenarios)
            .set({
              whenText: when,
              thenText: then,
              rank,
              version: same ? found.version : found.version + 1,
            })
            .where(
              and(eq(specScenarios.missionId, writer.missionId), eq(specScenarios.id, found.id)),
            )
            .pipe(Effect.mapError(refusedWhile('writing a scenario')))
        }
        for (const gone of live.filter(
          (one) => !asked.scenarios.some((scenario) => scenario.id === one.id),
        )) {
          changes.push({
            item: gone.id,
            before: scenarioSaid(gone.whenText, gone.thenText),
            after: null,
          })
          yield* transaction
            .update(specScenarios)
            .set({ removed: true })
            .where(
              and(eq(specScenarios.missionId, writer.missionId), eq(specScenarios.id, gone.id)),
            )
            .pipe(Effect.mapError(refusedWhile('removing a scenario')))
        }
        const fieldsChanged =
          existing === null ||
          existing.domain !== fields.domain ||
          existing.delta !== fields.delta ||
          existing.livingRef !== fields.livingRef ||
          existing.livingVersion !== fields.livingVersion ||
          existing.text !== fields.text
        if (fieldsChanged) {
          changes.unshift({
            item: id,
            before: existing === null ? null : requirementSaid(existing),
            after: requirementSaid(fields),
          })
        }
        if (changes.length === 0 && existing !== null) {
          return answer({ done: { id, version: existing.version, items: [] } })
        }
        const version = (existing?.version ?? 0) + 1
        if (existing === null) {
          const number = standing.spec.nextRequirement
          yield* transaction
            .insert(specRequirements)
            .values({
              missionId: writer.missionId,
              id,
              rank: number,
              ...fields,
              version,
              nextScenario,
              sessionId: writer.sessionId,
              writtenAt: at,
            })
            .pipe(Effect.mapError(refusedWhile('writing a requirement')))
          yield* transaction
            .update(specs)
            .set({ nextRequirement: number + 1 })
            .where(eq(specs.missionId, writer.missionId))
            .pipe(Effect.mapError(refusedWhile('numbering the requirement')))
          items.push({ kind: 'added', id })
        } else {
          yield* transaction
            .update(specRequirements)
            .set({ ...fields, version, nextScenario, sessionId: writer.sessionId, writtenAt: at })
            .where(
              and(eq(specRequirements.missionId, writer.missionId), eq(specRequirements.id, id)),
            )
            .pipe(Effect.mapError(refusedWhile('writing a requirement')))
          items.push({ kind: 'changed', id })
        }
        yield* bump(transaction, writer, standing.spec.version + 1, changes)
        return answer({ done: { id, version, items } })
      }),
    )
    if ('done' in outcome && outcome.done.items.length > 0) {
      yield* afterWrite(writer, outcome.done.items)
    }
    return outcome
  })

/** Marks a requirement removed, on the version the writer read; its id is never reused. */
export const removeRequirement = (writer: SpecWriter, id: string, base: number) =>
  Effect.gen(function* () {
    const outcome = yield* mutate('removing a requirement of the Spec', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Written<{ version: number; removed: boolean }>) => ({
          result,
          events: [],
        })
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return answer(refused(standing.refusal))
        const [row] = yield* transaction
          .select()
          .from(specRequirements)
          .where(and(eq(specRequirements.missionId, writer.missionId), eq(specRequirements.id, id)))
          .pipe(Effect.mapError(refusedWhile('reading the Spec')))
        if (row === undefined) return answer(refused(`refused: the Spec has no requirement ${id}.`))
        if (row.removed) return answer({ done: { version: row.version, removed: false } })
        if (base !== row.version) {
          return answer(refused(staleSaid(id, base, row.version, requirementSaid(row))))
        }
        const version = row.version + 1
        yield* transaction
          .update(specRequirements)
          .set({ removed: true, version, sessionId: writer.sessionId, writtenAt: now() })
          .where(and(eq(specRequirements.missionId, writer.missionId), eq(specRequirements.id, id)))
          .pipe(Effect.mapError(refusedWhile('removing a requirement')))
        yield* bump(transaction, writer, standing.spec.version + 1, [
          { item: id, before: requirementSaid(row), after: null },
        ])
        return answer({ done: { version, removed: true } })
      }),
    )
    if ('done' in outcome && outcome.done.removed) {
      yield* afterWrite(writer, [{ kind: 'removed', id }])
    }
    return outcome
  })

/** An event about the mission, by its Planner. */
export const plannerEvent = (
  writer: SpecWriter,
  type: string,
  payload: EventPayload,
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: writer.missionId,
  source: 'system',
  author: 'agent',
  payload: { ...payload, sessionId: writer.sessionId, role: writer.role },
})

/** Hemera's next step for a mission, as Now says it, with its event. */
export const hemeraNext = (transaction: EngineTransaction, missionId: string, text: string) =>
  Effect.gen(function* () {
    const next = MaskedText.make(text)
    const line = { sessionId: '', role: 'hemera', epoch: 0, text: next, updatedAt: now() }
    yield* transaction
      .insert(memoryNext)
      .values({ missionId, ...line })
      .onConflictDoUpdate({ target: memoryNext.missionId, set: line })
      .pipe(Effect.mapError(refusedWhile('writing Now')))
    const event: NewEvent = {
      type: 'memory.now_set',
      entityKind: 'mission',
      entityId: missionId,
      source: 'system',
      author: 'hemera',
      payload: { sessionId: '', role: 'hemera', epoch: 0, doing: null, next },
    }
    return event
  })

/** The mission's title and type, set by its Planner; the search column follows the title. */
/** What `mission_describe` answers a title with nothing in it. */
export const EMPTY_TITLE = 'The title is empty: name what the mission delivers.'

export const describeMission = (
  writer: SpecWriter,
  asked: { readonly title?: string | undefined; readonly type?: MissionType | undefined },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const asTitled = asked.title === undefined ? null : secrets.mask(asked.title.trim())
    if (asTitled === '') return refused<{ title: string; type: MissionType }>(EMPTY_TITLE)
    const outcome = yield* mutate('naming the mission', (transaction) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) {
          return {
            result: refused<{ title: string; type: MissionType }>(standing.refusal),
            events: [],
          }
        }
        const { mission, key } = standing
        const title = asTitled ?? mission.title
        const type = asked.type ?? typeOf(mission)
        const at = now()
        yield* transaction
          .update(missions)
          .set({
            title,
            type,
            searchText: searchTextOf([key, title, mission.ideaSentence, mission.ideaTicket]),
            updatedAt: at,
          })
          .where(eq(missions.id, mission.id))
          .pipe(Effect.mapError(refusedWhile('naming the mission')))
        yield* transaction
          .update(specs)
          .set({ describedAt: at })
          .where(eq(specs.missionId, mission.id))
          .pipe(Effect.mapError(refusedWhile('naming the mission')))
        return {
          result: { done: { title, type } },
          events: [plannerEvent(writer, 'mission.described', { title, type })],
        }
      }),
    )
    if ('done' in outcome) yield* afterWrite(writer, [{ kind: 'described' }])
    return outcome
  })

/**
 * The Planner's answer that the input is not new work: kept on the mission, waiting on the user,
 * with `planning.triaged` and Now's next step.
 */
export const answerTriage = (
  writer: SpecWriter,
  asked: { readonly kind: TriageKind; readonly ref: string | null; readonly text: string },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const ref = asked.ref === null ? null : secrets.mask(asked.ref.trim())
    const text = secrets.mask(asked.text.trim())
    const outcome = yield* mutate('answering the triage', (transaction) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) {
          return { result: refused<true>(standing.refusal), events: [] }
        }
        yield* transaction
          .update(missions)
          .set({
            triageKind: asked.kind,
            triageRef: ref,
            triageText: text,
            triageState: 'pending',
            triagedAt: now(),
            updatedAt: now(),
          })
          .where(eq(missions.id, writer.missionId))
          .pipe(Effect.mapError(refusedWhile('answering the triage')))
        const next = yield* hemeraNext(
          transaction,
          writer.missionId,
          'The Planner answered the triage: waiting on you',
        )
        return {
          result: { done: true as const },
          events: [plannerEvent(writer, 'planning.triaged', { kind: asked.kind, ref, text }), next],
        }
      }),
    )
    if ('done' in outcome) yield* SpecBoard.use((board) => board.changed(writer.missionId))
    return outcome
  })

/** What a declaration of completeness came to. */
export type Declaration =
  | { readonly failures: ReadonlyArray<CompletenessFailure> }
  | { readonly declared: number; readonly first: boolean; readonly again: boolean }

/**
 * The Planner declares the Spec complete: Hemera's check, then either the full list of failures
 * and nothing recorded but the refusal, or the version recorded with `planning.declared_complete`.
 */
export const declareComplete = (writer: SpecWriter, why: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const said = secrets.mask(why.trim())
    const outcome = yield* mutate('declaring the Spec complete', (transaction) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) {
          return { result: refused<Declaration>(standing.refusal), events: [] }
        }
        const spec = yield* specIn(transaction, writer.missionId)
        const failures = completeness(spec, {
          described: standing.spec.describedAt !== null,
          triagePending: spec.triage?.state === 'pending',
          ...(yield* pendingIn(transaction, writer.missionId)),
        })
        if (failures.length > 0) {
          return {
            result: { done: { failures } satisfies Declaration },
            events: [
              plannerEvent(writer, 'planning.completeness_refused', {
                version: spec.version,
                failures: failures.map((failure) => failure.sentence),
              }),
            ],
          }
        }
        const previous = standing.spec.declaredCompleteVersion
        if (previous === spec.version) {
          return {
            result: { done: { declared: spec.version, first: false, again: true } },
            events: [],
          }
        }
        yield* transaction
          .update(specs)
          .set({ declaredCompleteVersion: spec.version })
          .where(eq(specs.missionId, writer.missionId))
          .pipe(Effect.mapError(refusedWhile('declaring the Spec complete')))
        return {
          result: {
            done: {
              declared: spec.version,
              first: previous === null,
              again: false,
            } satisfies Declaration,
          },
          events: [
            plannerEvent(writer, 'planning.declared_complete', {
              version: spec.version,
              why: said,
            }),
          ],
        }
      }),
    )
    if ('done' in outcome && 'declared' in outcome.done && !outcome.done.again) {
      const { declared, first } = outcome.done
      yield* SpecBoard.use((board) =>
        Effect.andThen(
          board.declared({ missionId: writer.missionId, version: declared, first }),
          board.changed(writer.missionId),
        ),
      )
    }
    return outcome
  })

/** A mission's stage, refused outside Planning with the user's sentence. */
export const inPlanning = (transaction: EngineTransaction, missionId: string, doing: string) =>
  Effect.gen(function* () {
    const mission = yield* missionRow(transaction, missionId)
    const key = missionKey(mission.keyPrefix, mission.keyNumber)
    if (mission.stage !== 'planning') {
      return yield* new PlanningRefused({
        reason: `${key} is not in Planning: ${doing} is for a mission in Planning.`,
      })
    }
    return { mission, key }
  })

/** The vision, as the Planner is handed it. */
export const visionSaid = (text: string, at: string): string =>
  [
    `The user's vision, given ${at}:`,
    text,
    'Check it against the code before you use it; never copy it into the Spec as a decision unchecked.',
  ].join('\n\n')

/**
 * The user's vision: stored with `planning.vision`, and received as an input (CT-26); the caller
 * delivers it to the Planner.
 */
export const addVision = (missionId: string, text: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const vision = secrets.mask(text.trim())
    if (vision === '') return yield* new PlanningRefused({ reason: 'A vision needs some text.' })
    const at = now()
    yield* mutate('keeping the vision', (transaction) =>
      Effect.gen(function* () {
        yield* inPlanning(transaction, missionId, 'a vision')
        const id = crypto.randomUUID()
        yield* transaction
          .insert(specVisions)
          .values({ id, missionId, text: vision, at })
          .pipe(Effect.mapError(refusedWhile('keeping the vision')))
        yield* receiveInput(transaction, {
          missionId,
          kind: 'vision',
          item: id,
          version: null,
          said: visionSaid(vision, at),
          supersedes: false,
        })
        return {
          result: undefined,
          events: [
            {
              type: 'planning.vision',
              entityKind: 'mission',
              entityId: missionId,
              source: 'ui',
              author: 'human',
              payload: { text: vision, at },
            } satisfies NewEvent,
          ],
        }
      }),
    )
    return { text: vision, at }
  })

/** The visions of a mission, oldest first. */
export const visionsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select({ text: specVisions.text, at: specVisions.at })
      .from(specVisions)
      .where(eq(specVisions.missionId, missionId))
      .orderBy(asc(specVisions.at))
      .pipe(Effect.mapError(refusedWhile('reading the visions')))
  })

/**
 * The user keeps planning a mission the Planner triaged: true when this call kept it, false when
 * it was kept already (a double click delivers once).
 */
export const keepAfterTriage = (missionId: string) =>
  mutate('keeping the mission after its triage', (transaction) =>
    Effect.gen(function* () {
      const { mission, key } = yield* inPlanning(transaction, missionId, 'keeping it')
      if (triageOf(mission) === null) {
        return yield* new PlanningRefused({
          reason: `The Planner gave no triage answer for ${key}.`,
        })
      }
      if (mission.triageState === 'kept') return { result: false, events: [] }
      yield* transaction
        .update(missions)
        .set({ triageState: 'kept', updatedAt: now() })
        .where(and(eq(missions.id, missionId), eq(missions.triageState, 'pending')))
        .pipe(Effect.mapError(refusedWhile('keeping the mission')))
      return {
        result: true,
        events: [
          {
            type: 'planning.triage_kept',
            entityKind: 'mission',
            entityId: missionId,
            source: 'ui',
            author: 'human',
            payload: { kind: mission.triageKind, ref: mission.triageRef },
          } satisfies NewEvent,
        ],
      }
    }),
  )

/** Every item changed after a version, in the order written. */
export const changesSince = (missionId: string, version: number) =>
  Effect.gen(function* () {
    const database = yield* Database
    yield* database.transaction((transaction) => missionRow(transaction, missionId))
    const rows = yield* database
      .select()
      .from(specChanges)
      .where(and(eq(specChanges.missionId, missionId), gt(specChanges.version, version)))
      .orderBy(asc(specChanges.sequence))
      .pipe(Effect.mapError(refusedWhile('reading the changes of the Spec')))
    return rows.map((row): SpecChange => ({
      version: row.version,
      item: row.item,
      before: row.before,
      after: row.after,
      at: row.at,
    }))
  })

/** The user read the Spec up to a version it has reached. */
export const markRead = (missionId: string, version: number) =>
  mutate('marking the Spec read', (transaction) =>
    Effect.gen(function* () {
      const mission = yield* missionRow(transaction, missionId)
      const spec = yield* specRowOf(transaction, mission)
      if (!Number.isInteger(version) || version < 0 || version > spec.version) {
        return yield* new PlanningRefused({
          reason: `The Spec of ${missionKey(mission.keyPrefix, mission.keyNumber)} has no version ${String(version)}: it is at version ${String(spec.version)}.`,
        })
      }
      const line = { version, readAt: now() }
      yield* transaction
        .insert(specReads)
        .values({ missionId, ...line })
        .onConflictDoUpdate({ target: specReads.missionId, set: line })
        .pipe(Effect.mapError(refusedWhile('marking the Spec read')))
      return {
        result: undefined,
        events: [
          {
            type: 'planning.read',
            entityKind: 'mission',
            entityId: missionId,
            source: 'ui',
            author: 'human',
            payload: { version },
          } satisfies NewEvent,
        ],
      }
    }),
  )

/** A Project's Spec language. */
export const specLanguageOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ language: projects.specLanguage })
      .from(projects)
      .where(eq(projects.id, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    if (row === undefined) return yield* new UnknownProject({ id: projectId })
    return row.language
  })

/** Sets a Project's Spec language, for its next missions; an existing Spec keeps its own. */
export const setSpecLanguage = (projectId: string, tag: string) =>
  Effect.gen(function* () {
    const language = canonicalLanguage(tag)
    if (language === null) return yield* new InvalidSpecLanguage({ tag })
    return yield* mutate('setting the Spec language', (transaction) =>
      Effect.gen(function* () {
        const written = yield* transaction
          .update(projects)
          .set({ specLanguage: language })
          .where(eq(projects.id, projectId))
          .returning({ id: projects.id })
          .pipe(Effect.mapError(refusedWhile('setting the Spec language')))
        if (written.length === 0) return yield* new UnknownProject({ id: projectId })
        return {
          result: language,
          events: [
            {
              type: 'project.spec_language_set',
              entityKind: 'project',
              entityId: projectId,
              source: 'ui',
              author: 'human',
              payload: { language },
            } satisfies NewEvent,
          ],
        }
      }),
    )
  })

/** The language of a mission's Spec; its Project's setting when it has no Spec yet. */
const missionSpecLanguage = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ language: specs.language, projectId: missions.projectId })
      .from(missions)
      .leftJoin(specs, eq(specs.missionId, missions.id))
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (row === undefined) return yield* new UnknownMission({ id: missionId })
    return row.language ?? (yield* specLanguageOf(row.projectId))
  })

/**
 * The sessions' `SpecLanguage`: a mission's own Spec language, which a later change of its
 * Project's setting never rewrites; a Project's setting; English for what cannot be read.
 */
export const projectSpecLanguages = Layer.effect(
  SpecLanguage,
  Effect.map(
    Effect.context<Database>(),
    (context) => (owner: SessionOwner) =>
      (owner.kind === 'mission'
        ? missionSpecLanguage(owner.missionId)
        : specLanguageOf(owner.projectId)
      ).pipe(
        Effect.provide(context),
        Effect.orElseSucceed(() => 'en'),
      ),
  ),
)
