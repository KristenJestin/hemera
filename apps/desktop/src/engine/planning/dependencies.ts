/**
 * The dependencies between missions (#92): found during Planning, proposed by the Planner
 * (`dependency_propose`), accepted or rejected by the user. A Ready mission with an accepted
 * dependency not Done carries the mark "blocked by ACME-9"; when that mission reaches Done the mark
 * is lifted, `mission.unblocked` tells the user it can be built, `dependency.done` is written for the
 * pre-launch check (B1), and nothing starts. When that mission is cancelled the mark is lifted too,
 * and the dependent is marked outdated. A mission planned before its dependency is delivered marks
 * what relies on it (`relies_on_write`). Nothing crosses Projects.
 *
 * What a mission reaching Done or cancelled lifts is lifted once: each accepted dependency keeps
 * when that was told (`done_at`), in the transaction that lifts it, so a start lifts what a stop
 * left, and only that.
 */

import {
  BlockedMark,
  Dependency,
  type DependencyState,
  DEPENDENCY_STATES,
  OutdatedMark,
  STAGES,
  type Stage,
  type ToolArguments,
  dependencyCycle,
  dependencyCycleSaid,
  isLive,
  missionKey,
  missionKeyParts,
  staleSaid,
} from '@hemera/core/domain'
import {
  type DependencySeen,
  type MissionDependencies,
  PlanningRefused,
  UnknownDependency,
} from '@hemera/ipc'
import { and, eq, inArray, isNull, like, ne, or, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { clearMarkIn, markIn } from '../missions.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  missionDependencies,
  missionMarks,
  missions,
  specRequirements,
  specReliesOn,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { type ToolAnswer, answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { deliverInputs } from './calls.ts'
import { receiveInput } from './inputs.ts'
import { type SpecWriter, afterWrite, bump, missionRow, plannerEvent, standingOf } from './store.ts'

const now = (): string => new Date().toISOString()

type MissionRow = typeof missions.$inferSelect
type DependencyRow = typeof missionDependencies.$inferSelect
type Reader = EngineTransaction | Database['Service']

const stageOf = (row: MissionRow): Stage => STAGES.find((one) => one === row.stage) ?? 'cancelled'
const stateOf = (row: DependencyRow): DependencyState =>
  DEPENDENCY_STATES.find((one) => one === row.state) ?? 'proposed'
const keyOf = (row: MissionRow): string => missionKey(row.keyPrefix, row.keyNumber)
const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** The mission a key names, anywhere in the Profile: keys are never shared. */
const missionNamed = (reader: Reader, key: string) =>
  Effect.gen(function* () {
    const parts = missionKeyParts(key)
    if (parts === null) return null
    const [row] = yield* reader
      .select()
      .from(missions)
      .where(and(eq(missions.keyPrefix, parts.prefix), eq(missions.keyNumber, parts.number)))
      .pipe(Effect.mapError(refusedWhile('reading a mission')))
    return row ?? null
  })

/** The missions named, by identifier. */
const missionsById = (reader: Reader, ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const unique = [...new Set(ids)]
    const named =
      unique.length === 0
        ? []
        : yield* reader
            .select()
            .from(missions)
            .where(inArray(missions.id, unique))
            .pipe(Effect.mapError(refusedWhile('reading the missions')))
    return new Map(named.map((row) => [row.id, row]))
  })

/** The keys of the missions named, by identifier. */
const keysOf = (reader: Reader, ids: ReadonlyArray<string>) =>
  Effect.map(
    missionsById(reader, ids),
    (byId) => new Map([...byId].map(([id, row]) => [id, keyOf(row)])),
  )

/** Dependencies as the window reads them, each with both missions' keys. */
const seenIn = (reader: Reader, rows: ReadonlyArray<DependencyRow>) =>
  Effect.gen(function* () {
    const byId = yield* missionsById(
      reader,
      rows.flatMap((row) => [row.missionId, row.dependsOn]),
    )
    return rows.flatMap((row): ReadonlyArray<DependencySeen> => {
      const mission = byId.get(row.missionId)
      const on = byId.get(row.dependsOn)
      if (mission === undefined || on === undefined) return []
      return [
        {
          id: row.id,
          missionId: row.missionId,
          missionKey: keyOf(mission),
          dependsOnId: row.dependsOn,
          dependsOnKey: keyOf(on),
          dependsOnStage: stageOf(on),
          reason: row.reason,
          state: stateOf(row),
          proposedAt: row.proposedAt,
          decidedAt: row.decidedAt,
        },
      ]
    })
  })

/** A mission's dependencies both ways, in the transaction or reader given. */
export const dependenciesIn = (reader: Reader, missionId: string) =>
  Effect.gen(function* () {
    const rows = yield* reader
      .select()
      .from(missionDependencies)
      .where(
        or(
          eq(missionDependencies.missionId, missionId),
          eq(missionDependencies.dependsOn, missionId),
        ),
      )
      .orderBy(missionDependencies.proposedAt)
      .pipe(Effect.mapError(refusedWhile('reading the dependencies')))
    const seen = yield* seenIn(reader, rows)
    const listed: MissionDependencies = {
      dependsOn: seen.filter((one) => one.missionId === missionId),
      dependedOnBy: seen.filter((one) => one.dependsOnId === missionId),
    }
    return listed
  })

/** A mission's dependencies both ways: those it has, and the missions that depend on it. */
export const dependenciesOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database.transaction((transaction) =>
      Effect.andThen(missionRow(transaction, missionId), dependenciesIn(transaction, missionId)),
    )
  })

/** The writer a grant stands for, when its session works for a mission. */
const writerOf = (grant: Grant): SpecWriter | null =>
  grant.missionId === null
    ? null
    : { sessionId: grant.sessionId, role: grant.role, missionId: grant.missionId }

const NO_MISSION = refusal('refused: this session works for no mission')

const refusedSaid = (sentence: string): ToolAnswer =>
  refusal(sentence.startsWith('refused:') ? sentence : `refused: ${sentence}`)

type Outcome = { readonly refused: string } | { readonly said: string }

/**
 * `dependency_propose`: the Planner proposes that its mission cannot be built before another
 * mission of the Project is delivered. Refused for a key of another Project, for the mission
 * itself, for a mission that ended, and when it would close a cycle of dependencies (named). The
 * same dependency again changes nothing; one the user rejected is not proposed again.
 */
export const dependencyProposeTool = (grant: Grant, args: ToolArguments<'dependency_propose'>) =>
  Effect.gen(function* () {
    const writer = writerOf(grant)
    if (writer === null) return NO_MISSION
    const secrets = yield* Secrets
    const reason = secrets.mask(args.reason.trim())
    const outcome = yield* mutate('proposing a dependency', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Outcome, events: ReadonlyArray<NewEvent> = []) => ({
          result,
          events,
        })
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return answer({ refused: standing.refusal })
        const own = standing.mission
        const target = yield* missionNamed(transaction, args.mission)
        if (target === null) return answer({ refused: `no mission is ${args.mission.trim()}.` })
        const key = keyOf(target)
        if (target.id === own.id) return answer({ refused: 'a mission cannot depend on itself.' })
        if (target.projectId !== own.projectId) {
          return answer({
            refused: `${key} is a mission of another Project, and nothing crosses Projects.`,
          })
        }
        const stage = stageOf(target)
        if (stage === 'done' || stage === 'cancelled') {
          return answer({ refused: `${key} is ${capitalised(stage)}: nothing to wait for.` })
        }
        const [already] = yield* transaction
          .select()
          .from(missionDependencies)
          .where(
            and(
              eq(missionDependencies.missionId, own.id),
              eq(missionDependencies.dependsOn, target.id),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading the dependencies')))
        if (already !== undefined) {
          return answer(
            stateOf(already) === 'rejected'
              ? { refused: `the user rejected the dependency on ${key}.` }
              : {
                  said: `${standing.key} already has this dependency on ${key} (${already.state}): nothing changed.`,
                },
          )
        }
        // Every dependency not rejected, by key: what a new one must not close a cycle with.
        const edges = yield* transaction
          .select({ from: missionDependencies.missionId, to: missionDependencies.dependsOn })
          .from(missionDependencies)
          .where(ne(missionDependencies.state, 'rejected'))
          .pipe(Effect.mapError(refusedWhile('reading the dependencies')))
        const keys = yield* keysOf(
          transaction,
          edges.flatMap((edge) => [edge.from, edge.to]),
        )
        const cycle = dependencyCycle(
          edges.map((edge) => ({ from: keys.get(edge.from) ?? '', to: keys.get(edge.to) ?? '' })),
          standing.key,
          key,
        )
        if (cycle !== null) {
          return answer({
            refused: `it would close a cycle of dependencies: ${dependencyCycleSaid(cycle)}.`,
          })
        }
        const id = crypto.randomUUID()
        yield* transaction
          .insert(missionDependencies)
          .values({
            id,
            missionId: own.id,
            dependsOn: target.id,
            reason,
            state: 'proposed',
            proposedAt: now(),
            decidedAt: null,
            doneAt: null,
          })
          .pipe(Effect.mapError(refusedWhile('proposing a dependency')))
        return answer(
          {
            said: `Proposed: ${standing.key} cannot be built before ${key} is delivered. The user accepts or rejects it.`,
          },
          [plannerEvent(writer, 'dependency.proposed', { dependencyId: id, on: key, reason })],
        )
      }),
    )
    return 'refused' in outcome ? refusedSaid(outcome.refused) : answered(outcome.said)
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))

/** The mark a dependency not Done sets on a Ready mission. */
const blockedBy = (key: string) => BlockedMark.make({ cause: Dependency.make({ missionKey: key }) })

/**
 * The blocked marks of a mission's accepted dependencies not Done yet, set in the transaction given
 * (a Freeze, an acceptance in Ready); answers their events.
 */
export const blockIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const rows = yield* transaction
      .select({ on: missions })
      .from(missionDependencies)
      .innerJoin(missions, eq(missions.id, missionDependencies.dependsOn))
      .where(
        and(
          eq(missionDependencies.missionId, missionId),
          eq(missionDependencies.state, 'accepted'),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the dependencies')))
    const events: NewEvent[] = []
    for (const { on } of rows) {
      // A mission delivered or cancelled holds nothing back.
      if (on.stage === 'done' || on.stage === 'cancelled') continue
      events.push(...(yield* markIn(transaction, missionId, blockedBy(keyOf(on)))))
    }
    return events
  })

/** Clears a mission's blocked marks of its dependencies (a return to Planning); their events. */
export const unblockIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const rows = yield* transaction
      .select({ on: missions })
      .from(missionDependencies)
      .innerJoin(missions, eq(missions.id, missionDependencies.dependsOn))
      .where(eq(missionDependencies.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the dependencies')))
    const events: NewEvent[] = []
    for (const { on } of rows) {
      events.push(...(yield* clearMarkIn(transaction, missionId, blockedBy(keyOf(on)))))
    }
    return events
  })

/**
 * The user accepts or rejects a proposed dependency, in Planning or Ready, once. Accepting in
 * Planning is a human input the Planner integrates (CT-26); in Ready it blocks the mission at once
 * when the mission it depends on is not Done. Accepted on a mission that ended meanwhile, it is
 * lifted at once.
 */
export const decideDependency = (id: string, accept: boolean) =>
  Effect.gen(function* () {
    const decided = yield* mutate('deciding a dependency', (transaction) =>
      Effect.gen(function* () {
        const [row] = yield* transaction
          .select()
          .from(missionDependencies)
          .where(eq(missionDependencies.id, id))
          .pipe(Effect.mapError(refusedWhile('reading the dependency')))
        if (row === undefined) return yield* new UnknownDependency({ id })
        // Its two missions are there: a dependency goes with either of them.
        const mission = yield* missionRow(transaction, row.missionId).pipe(
          Effect.catchTag('UnknownMission', Effect.die),
        )
        const on = yield* missionRow(transaction, row.dependsOn).pipe(
          Effect.catchTag('UnknownMission', Effect.die),
        )
        const key = keyOf(mission)
        const onKey = keyOf(on)
        const stage = stageOf(mission)
        if (stage !== 'planning' && stage !== 'ready') {
          return yield* new PlanningRefused({
            reason: `${key} is ${capitalised(stage)}: a dependency is decided in Planning or Ready.`,
          })
        }
        const state = accept ? 'accepted' : 'rejected'
        const written = yield* transaction
          .update(missionDependencies)
          .set({ state, decidedAt: now() })
          .where(and(eq(missionDependencies.id, id), eq(missionDependencies.state, 'proposed')))
          .returning({ id: missionDependencies.id })
          .pipe(Effect.mapError(refusedWhile('deciding a dependency')))
        if (written.length === 0) {
          return yield* new PlanningRefused({
            reason: `The dependency on ${onKey} is already ${row.state}.`,
          })
        }
        if (accept && stage === 'planning') {
          yield* receiveInput(transaction, {
            missionId: mission.id,
            kind: 'dependency_accepted',
            item: onKey,
            version: null,
            said: `The user accepted that ${key} cannot be built before ${onKey} is delivered (${row.reason}). If you plan before it is delivered, mark what relies on it with relies_on_write.`,
            supersedes: false,
          })
        }
        const blocked = accept && stage === 'ready' ? yield* blockIn(transaction, mission.id) : []
        const decision: NewEvent = {
          type: 'dependency.decided',
          entityKind: 'mission',
          entityId: mission.id,
          source: 'ui',
          author: 'human',
          payload: { dependencyId: id, on: onKey, accepted: accept },
        }
        const [seen] = yield* seenIn(transaction, [{ ...row, state, decidedAt: now() }])
        if (seen === undefined) return yield* Effect.die(new Error('the dependency was not read'))
        return {
          result: { seen, input: accept && stage === 'planning' },
          events: [decision, ...blocked],
        }
      }),
    )
    if (decided.input) yield* deliverInputs(decided.seen.missionId)
    // The mission it depends on may have ended already: what that lifts is lifted now.
    if (accept) yield* liftEnded(decided.seen.dependsOnId)
    return decided.seen
  })

/** A dependency a mission reaching Done lifts. */
const doneEvent = (missionId: string, dependencyId: string, key: string): NewEvent => ({
  type: 'dependency.done',
  entityKind: 'mission',
  entityId: missionId,
  source: 'system',
  author: 'hemera',
  payload: { dependencyId, on: key },
})

/** What a dependency cancelled leaves its dependent: information, as any outdated mark. */
const cancelledMark = (onKey: string, key: string) =>
  OutdatedMark.make({
    reason: 'dependency-cancelled',
    reference: onKey,
    difference: `${onKey} was cancelled: ${key} no longer waits on it.`,
  })

/**
 * Lifts what waited on missions that ended, once each, in one transaction. Each accepted
 * dependency on a mission now Done and not told yet writes `dependency.done` for its mission (B1's
 * pre-launch check), and a Ready mission's mark is cleared; with no dependency left blocking it,
 * `mission.unblocked` tells the user it can be built. Each on a mission now cancelled clears its
 * mark too, and marks its mission outdated (`dependency-cancelled`) while it lives, so the user
 * sees it: nothing waits on it any more, and nothing says it was delivered. Nothing starts.
 * `dependsOn` limits it to one mission; the start lifts every one a stop left.
 */
export const liftEnded = (dependsOn: string | null) =>
  mutate('lifting what waited on a mission that ended', (transaction) =>
    Effect.gen(function* () {
      const rows = yield* transaction
        .select({ dependency: missionDependencies, on: missions })
        .from(missionDependencies)
        .innerJoin(missions, eq(missions.id, missionDependencies.dependsOn))
        .where(
          and(
            eq(missionDependencies.state, 'accepted'),
            isNull(missionDependencies.doneAt),
            inArray(missions.stage, ['done', 'cancelled']),
            dependsOn === null ? undefined : eq(missionDependencies.dependsOn, dependsOn),
          ),
        )
        .pipe(Effect.mapError(refusedWhile('reading the dependencies')))
      const events: NewEvent[] = []
      for (const { dependency, on } of rows) {
        const onKey = keyOf(on)
        yield* transaction
          .update(missionDependencies)
          .set({ doneAt: now() })
          .where(eq(missionDependencies.id, dependency.id))
          .pipe(Effect.mapError(refusedWhile('lifting a dependency')))
        const cleared = yield* clearMarkIn(transaction, dependency.missionId, blockedBy(onKey))
        if (on.stage === 'cancelled') {
          events.push(...cleared)
          const mission = yield* missionRow(transaction, dependency.missionId)
          if (!isLive(stageOf(mission))) continue
          const mark = cancelledMark(onKey, keyOf(mission))
          events.push(...(yield* markIn(transaction, mission.id, mark)), {
            type: 'mission.outdated',
            entityKind: 'mission',
            entityId: mission.id,
            source: 'system',
            author: 'hemera',
            payload: {
              reason: mark.reason,
              reference: mark.reference,
              difference: mark.difference,
            },
          })
          continue
        }
        events.push(doneEvent(dependency.missionId, dependency.id, onKey), ...cleared)
        if (cleared.length === 0) continue
        const [left] = yield* transaction
          .select({ total: sql<number>`count(*)` })
          .from(missionMarks)
          .where(
            and(
              eq(missionMarks.missionId, dependency.missionId),
              like(missionMarks.identity, 'blocked:dependency:%'),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading the marks')))
        if ((left?.total ?? 0) > 0) continue
        events.push({
          type: 'mission.unblocked',
          entityKind: 'mission',
          entityId: dependency.missionId,
          source: 'system',
          author: 'hemera',
          payload: { on: onKey },
        })
      }
      return { result: rows.length, events }
    }),
  )

/**
 * `relies_on_write`: a requirement of this Spec relies on a requirement of an accepted dependency
 * not delivered yet, at the version the Planner read. Written on the requirement's version, it
 * bumps the requirement and the Spec, with its change row.
 */
export const reliesOnWriteTool = (grant: Grant, args: ToolArguments<'relies_on_write'>) =>
  Effect.gen(function* () {
    const writer = writerOf(grant)
    if (writer === null) return NO_MISSION
    const theirs = args.their_requirement.trim()
    const outcome = yield* mutate('marking what relies on a dependency', (transaction) =>
      Effect.gen(function* () {
        const answer = (result: Outcome) => ({ result, events: [] })
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return answer({ refused: standing.refusal })
        const on = yield* missionNamed(transaction, args.dependency)
        const onKey = on === null ? args.dependency.trim() : keyOf(on)
        const [accepted] =
          on === null
            ? []
            : yield* transaction
                .select({ id: missionDependencies.id })
                .from(missionDependencies)
                .where(
                  and(
                    eq(missionDependencies.missionId, writer.missionId),
                    eq(missionDependencies.dependsOn, on.id),
                    eq(missionDependencies.state, 'accepted'),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading the dependencies')))
        if (on === null || accepted === undefined) {
          return answer({
            refused: `${onKey} is not an accepted dependency of ${standing.key}.`,
          })
        }
        const [requirement] = yield* transaction
          .select()
          .from(specRequirements)
          .where(
            and(
              eq(specRequirements.missionId, writer.missionId),
              eq(specRequirements.id, args.requirement.trim()),
              eq(specRequirements.removed, false),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading the Spec')))
        if (requirement === undefined) {
          return answer({ refused: `the Spec has no requirement ${args.requirement.trim()}.` })
        }
        if (args.base_version !== requirement.version) {
          return answer({
            refused: staleSaid(
              requirement.id,
              args.base_version,
              requirement.version,
              requirement.text,
            ),
          })
        }
        const relied = `${onKey} ${theirs} (version ${String(args.their_version)})`
        yield* transaction
          .insert(specReliesOn)
          .values({
            missionId: writer.missionId,
            requirementId: requirement.id,
            dependsOn: on.id,
            theirRequirement: theirs,
            theirVersion: args.their_version,
          })
          .onConflictDoUpdate({
            target: [
              specReliesOn.missionId,
              specReliesOn.requirementId,
              specReliesOn.dependsOn,
              specReliesOn.theirRequirement,
            ],
            set: { theirVersion: args.their_version },
          })
          .pipe(Effect.mapError(refusedWhile('marking what relies on a dependency')))
        yield* transaction
          .update(specRequirements)
          .set({ version: requirement.version + 1 })
          .where(
            and(
              eq(specRequirements.missionId, writer.missionId),
              eq(specRequirements.id, requirement.id),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('marking what relies on a dependency')))
        yield* bump(transaction, writer, standing.spec.version + 1, [
          { item: `${requirement.id} relies on`, before: null, after: relied },
        ])
        return answer({ said: `Kept: ${requirement.id} relies on ${relied}.` })
      }),
    )
    if ('refused' in outcome) return refusedSaid(outcome.refused)
    yield* afterWrite(writer, [{ kind: 'relies_on', id: args.requirement.trim() }])
    return answered(outcome.said)
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))
