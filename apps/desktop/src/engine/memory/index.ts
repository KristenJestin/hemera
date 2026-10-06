/**
 * The mission's Memory, as the engine holds it: Now, the Journal, the Notes, their markdown files,
 * and the evidence store, behind two services, `Memory` and `Evidence`.
 *
 * At the engine's start the Journal's projection catches up with the event log before
 * `Memory.ready` completes, and the markdown files of every mission are written once; nothing
 * that reads the Memory (a session's start, the window) does so before. Then each committed event
 * is projected as it comes, and the files of the missions it touched are written again a second
 * later.
 *
 * Hemera writes what it already knows through the domain events of the services that own it; an
 * agent writes, through its MCP tools, only what it alone knows. Every write of an agent carries
 * its session and epoch: a replaced or ended session writes nothing.
 */

import { JOURNAL_TAIL, type Masked, ROLE_NAMES, mainRoleOf } from '@hemera/core/domain'
import type {
  EvidenceFile,
  EvidenceItem,
  JournalLine,
  JournalPage,
  MemoryChanged,
  MemoryNote,
  Now,
  UnknownEvidence,
  UnknownMission,
} from '@hemera/ipc'
import {
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  PubSub,
  Ref,
  Semaphore,
  Schema,
  Stream,
} from 'effect'
import type { Scope } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import type { DomainEvent } from '../journal.ts'
import { type MissionActivity, getMission } from '../missions.ts'
import { ProfileHome } from '../profile-home.ts'
import { RestoreJournal } from '../reconciliation.ts'
import { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import {
  type EvidencePut,
  type EvidenceRefused,
  listEvidence,
  putEvidence,
  readEvidence,
} from './evidence.ts'
import { missionFolder, writeMarkdown } from './files.ts'
import {
  DEFAULT_MAPPERS,
  JOURNAL_PROJECTION,
  type JournalMapper,
  journalPage,
  lastLineOf,
  projectBatch,
  rewindTo,
  wholeJournal,
} from './journal.ts'
import { addNote, condenseNotes, readNotes } from './notes.ts'
import { nextRefusal, nowOf, readNow, writeNow } from './now.ts'
import {
  MissionDependencies,
  RunningSessions,
  SessionEpochs,
  epochsInMemory,
  noDependencies,
  noRunningSessions,
} from './ports.ts'
import { linesText, notesText, nowText, sections } from './render.ts'

export { dropSessionLines } from './now.ts'
export { MissionDependencies, RunningSessions, SessionEpochs }
export type { JournalMapper }

/** How long after a change the markdown files of its mission are written again. */
export const FILES_DELAY = '1 second'

/** An agent's write the Memory refused, and why, in words. */
export class MemoryRefused extends Schema.TaggedError<MemoryRefused>()('MemoryRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `refused: ${this.reason}`
  }
}

/** Who writes: an agent's session, at the epoch its call carries, for its own mission. */
export interface MemoryCaller {
  readonly sessionId: string
  readonly role: string
  readonly epoch: number
  readonly missionId: string
}

type Failure = DatabaseError | UnknownMission

export class Memory extends Context.Service<
  Memory,
  {
    /** Completes once the Journal has caught up with the event log at the engine's start. */
    readonly ready: Effect.Effect<void>
    /** Projects every event not yet projected. */
    readonly catchUp: Effect.Effect<void, DatabaseError>
    /** Sets the Journal's cursor back, as a replay would. */
    readonly rewind: (cursor: number) => Effect.Effect<void, DatabaseError>
    readonly now: (missionId: string) => Effect.Effect<Now, Failure>
    readonly journal: (
      missionId: string,
      before: number | null,
    ) => Effect.Effect<JournalPage, Failure>
    readonly notes: (
      missionId: string,
      all: boolean,
    ) => Effect.Effect<ReadonlyArray<MemoryNote>, Failure>
    /**
     * What every Memory-reading session starts with: Now (the main session's line first), the
     * current notes, and the last `JOURNAL_TAIL` Journal lines; a section with nothing is left out.
     */
    readonly briefBlock: (missionId: string) => Effect.Effect<string, Failure>
    /** The last Journal line written by or about a session lineage, for its resume. */
    readonly lastRecorded: (
      missionId: string,
      lineage: string,
    ) => Effect.Effect<JournalLine | null, DatabaseError>
    /** Each change of a mission's Memory, for as long as the caller listens. */
    readonly changes: (missionId: string) => Stream.Stream<MemoryChanged>
    readonly setNow: (
      caller: MemoryCaller,
      asked: { readonly doing: string | null; readonly next: string | null },
    ) => Effect.Effect<void, MemoryRefused | Failure>
    readonly addJournal: (
      caller: MemoryCaller,
      text: string,
    ) => Effect.Effect<void, MemoryRefused | Failure>
    readonly addNote: (
      caller: MemoryCaller,
      text: string,
      topic: string | null,
    ) => Effect.Effect<number, MemoryRefused | Failure>
    readonly condenseNotes: (
      caller: MemoryCaller,
      replaces: ReadonlyArray<number>,
      text: string,
      topic: string | null,
    ) => Effect.Effect<number, MemoryRefused | Failure>
    /** Refused when the caller's epoch is no longer its session's. */
    readonly checkEpoch: (caller: MemoryCaller) => Effect.Effect<void, MemoryRefused>
    /** Writes a mission's markdown files now. */
    readonly writeFiles: (missionId: string) => Effect.Effect<void, Failure>
    /** The engine's start: catch up, write the files, be ready, then follow the events. */
    readonly start: Effect.Effect<void, never, Scope.Scope>
  }
>()('Memory') {}

export class Evidence extends Context.Service<
  Evidence,
  {
    readonly put: (asked: EvidencePut) => Effect.Effect<EvidenceItem, EvidenceRefused | Failure>
    readonly read: (
      missionId: string,
      id: string,
    ) => Effect.Effect<EvidenceFile, UnknownEvidence | Failure>
    readonly list: (
      missionId: string,
      about: string | null,
    ) => Effect.Effect<ReadonlyArray<EvidenceItem>, DatabaseError>
  }
>()('Evidence') {}

/** What later tickets plug into the Memory; the defaults otherwise. */
export interface MemoryParts {
  /** The sessions' epochs (#40); every session at its first epoch otherwise. */
  readonly epochs?: Layer.Layer<SessionEpochs, never, Database>
  /** The sub-agents running for a mission (#40); none otherwise. */
  readonly running?: Layer.Layer<RunningSessions, never, Database>
  /** The accepted dependencies of a mission (P9); none otherwise. */
  readonly dependencies?: MissionDependencies['Service']
  /** The Journal mappers of later tickets, beside this one's. */
  readonly mappers?: ReadonlyMap<string, JournalMapper>
  /** Runs before each projection writes what it read: a test holds the projection there. */
  readonly beforeProjecting?: (events: ReadonlyArray<DomainEvent>) => Effect.Effect<void>
  /** The line a restore leaves in each Journal; a `mission.restored` event otherwise. */
  readonly restoreJournal?: Layer.Layer<RestoreJournal> | undefined
}

const STALE = 'this session has been replaced; nothing was written'

type Services =
  | Database
  | DomainEvents
  | Secrets
  | ProfileHome
  | MissionActivity
  | SessionEpochs
  | RunningSessions
  | MissionDependencies

/** The Memory of a mission's markdown files, as text. */
const markdownOf = (missionId: string) =>
  Effect.gen(function* () {
    const now = yield* readNow(missionId)
    const notes = yield* readNotes(missionId, true)
    const journal = yield* wholeJournal(missionId)
    return {
      key: now.key,
      files: {
        now: `# ${now.key} · Now\n\n${nowText(now)}\n`,
        notes: `# ${now.key} · Notes\n\n${notesText(notes)}\n`,
        journal: `# ${now.key} · Journal\n\n${linesText(journal)}\n`,
      },
    }
  })

const memoryService = (parts: MemoryParts, log: Log) =>
  Layer.effect(
    Memory,
    Effect.gen(function* () {
      const context = yield* Effect.context<Services>()
      const scope = yield* Effect.scope
      const ready = yield* Deferred.make<void>()
      const projecting = Semaphore.makeUnsafe(1)
      const changed = yield* PubSub.unbounded<MemoryChanged>()
      const mappers = new Map([...DEFAULT_MAPPERS, ...(parts.mappers ?? [])])
      const before = parts.beforeProjecting ?? (() => Effect.void)
      const run = <A, E>(effect: Effect.Effect<A, E, Services>) => Effect.provide(effect, context)
      const waiting = yield* Ref.make<ReadonlySet<string>>(new Set())
      let scheduled = false

      const writeFiles = (missionId: string) =>
        run(
          Effect.gen(function* () {
            const home = yield* ProfileHome
            const { key, files } = yield* markdownOf(missionId)
            yield* Effect.try({
              try: () => writeMarkdown(missionFolder(home.dataFolder, key), files),
              catch: refusedWhile(`writing the Memory files of ${key}`),
            })
          }),
        )

      const flushFiles = Effect.gen(function* () {
        scheduled = false
        const ids = yield* Ref.getAndSet(waiting, new Set())
        yield* Effect.forEach(
          ids,
          (id) =>
            writeFiles(id).pipe(
              Effect.catch((failure) =>
                Effect.sync(() => log(`the Memory files were not written: ${failure.message}`)),
              ),
            ),
          { discard: true },
        )
      })

      /** The files of these missions, written again a moment after the last change. */
      const scheduleFiles = (ids: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (ids.length === 0) return
          yield* Ref.update(waiting, (set) => new Set([...set, ...ids]))
          if (scheduled) return
          scheduled = true
          yield* Effect.sleep(FILES_DELAY).pipe(Effect.andThen(flushFiles), Effect.forkIn(scope))
        })

      /** Projects to the end of the event log, then tells what changed. */
      const pass = run(
        Effect.gen(function* () {
          const touched = new Set<string>()
          const added: JournalLine[] = []
          for (;;) {
            const batch = yield* projectBatch(mappers, before)
            for (const id of batch.missions) touched.add(id)
            added.push(...batch.added)
            if (batch.done) break
          }
          return { touched: [...touched], added }
        }),
      ).pipe(Semaphore.withPermits(projecting, 1))

      const tell = (projected: {
        touched: ReadonlyArray<string>
        added: ReadonlyArray<JournalLine>
      }) =>
        Effect.gen(function* () {
          for (const missionId of projected.touched) {
            const now = yield* run(readNow(missionId)).pipe(Effect.option)
            if (Option.isNone(now)) continue
            yield* PubSub.publish(changed, {
              missionId,
              now: now.value,
              added: projected.added.filter((line) => line.missionId === missionId),
            })
          }
          yield* scheduleFiles(projected.touched)
        })

      const catchUp = Effect.flatMap(pass, tell)

      const afterReady = <A, E>(effect: Effect.Effect<A, E, Services>) =>
        Effect.andThen(Deferred.await(ready), run(effect))

      const checkEpoch = (caller: MemoryCaller) =>
        run(
          Effect.gen(function* () {
            const current = yield* SessionEpochs.use((epochs) =>
              epochs.isCurrent(caller.sessionId, caller.epoch),
            )
            if (!current) return yield* new MemoryRefused({ reason: STALE })
          }),
        )

      const mask = (text: string) => Secrets.useSync((secrets) => secrets.mask(text))
      const maskOrNull = (text: string | null) =>
        text === null ? Effect.succeed(null) : mask(text)

      /** A write of an agent: its epoch checked, then the write, then the projection caught up. */
      const written = <A, E>(
        caller: MemoryCaller,
        write: Effect.Effect<A, E | MemoryRefused, Services>,
      ) =>
        Effect.gen(function* () {
          yield* Deferred.await(ready)
          yield* checkEpoch(caller)
          const result = yield* run(write)
          yield* catchUp.pipe(Effect.catch(() => Effect.void))
          return result
        })

      const mainOnly = (caller: MemoryCaller, doing: string) =>
        Effect.gen(function* () {
          const mission = yield* getMission(caller.missionId)
          const main = mainRoleOf(mission.stage)
          if (main === null) {
            return yield* new MemoryRefused({
              reason: `no session ${doing} of this mission while it is in ${mission.stage}`,
            })
          }
          if (main !== caller.role) {
            return yield* new MemoryRefused({
              reason: `only ${ROLE_NAMES[main]} ${doing} of this mission`,
            })
          }
        })

      const agentEvent = (caller: MemoryCaller, type: string, text: Masked<string>) => ({
        type,
        entityKind: 'mission',
        entityId: caller.missionId,
        source: 'system' as const,
        author: 'agent' as const,
        payload: { text, role: caller.role, sessionId: caller.sessionId, epoch: caller.epoch },
      })

      return {
        ready: Deferred.await(ready),
        catchUp,
        rewind: (cursor) => run(rewindTo(JOURNAL_PROJECTION, cursor)),
        now: (missionId) => afterReady(readNow(missionId)),
        journal: (missionId, older) =>
          afterReady(Effect.andThen(getMission(missionId), journalPage(missionId, older))),
        notes: (missionId, all) =>
          afterReady(Effect.andThen(getMission(missionId), readNotes(missionId, all))),
        briefBlock: (missionId) =>
          afterReady(
            Effect.gen(function* () {
              const now = yield* nowOf(yield* getMission(missionId))
              const notes = yield* readNotes(missionId, false)
              const tail = yield* journalPage(missionId, null, JOURNAL_TAIL)
              return sections([
                ['Now', nowText(now)],
                ['Notes', notesText(notes)],
                [
                  `Journal (the last ${String(tail.lines.length)} lines; memory_read reads further back)`,
                  linesText(tail.lines.toReversed()),
                ],
              ])
            }),
          ),
        lastRecorded: (missionId, lineage) => afterReady(lastLineOf(missionId, lineage)),
        changes: (missionId) =>
          Stream.unwrap(
            Effect.map(PubSub.subscribe(changed), (subscription) =>
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((change) => change.missionId === missionId),
              ),
            ),
          ),
        setNow: (caller, asked) =>
          written(
            caller,
            Effect.gen(function* () {
              const mission = yield* getMission(caller.missionId)
              if (asked.next !== null) {
                const refused = nextRefusal(mission, caller.role)
                if (refused !== null) return yield* new MemoryRefused({ reason: refused })
              }
              const doing = yield* maskOrNull(asked.doing)
              const next = yield* maskOrNull(asked.next)
              yield* mutate('writing Now', (transaction) =>
                Effect.map(
                  writeNow(transaction, {
                    missionId: caller.missionId,
                    sessionId: caller.sessionId,
                    role: caller.role,
                    epoch: caller.epoch,
                    doing,
                    next,
                  }),
                  (event) => ({ result: undefined, events: [event] }),
                ),
              )
            }),
          ),
        addJournal: (caller, text) =>
          written(
            caller,
            Effect.gen(function* () {
              yield* getMission(caller.missionId)
              const masked = yield* mask(text)
              yield* mutate('writing in the Journal', () =>
                Effect.succeed({
                  result: undefined,
                  events: [agentEvent(caller, 'memory.journal_added', masked)],
                }),
              )
            }),
          ),
        addNote: (caller, text, topic) =>
          written(
            caller,
            Effect.gen(function* () {
              yield* getMission(caller.missionId)
              const masked = yield* mask(text)
              const about = yield* maskOrNull(topic)
              return yield* mutate('adding a note', (transaction) =>
                Effect.map(
                  addNote(transaction, caller.missionId, masked, about, caller),
                  ({ number, event }) => ({ result: number, events: [event] }),
                ),
              )
            }),
          ),
        condenseNotes: (caller, replaces, text, topic) =>
          written(
            caller,
            Effect.gen(function* () {
              yield* mainOnly(caller, 'condenses the notes')
              const masked = yield* mask(text)
              const about = yield* maskOrNull(topic)
              return yield* mutate('condensing the notes', (transaction) =>
                Effect.gen(function* () {
                  const outcome = yield* condenseNotes(
                    transaction,
                    caller.missionId,
                    replaces,
                    masked,
                    about,
                    caller,
                  )
                  if ('missing' in outcome) {
                    const [one, ...more] = outcome.missing
                    return yield* new MemoryRefused({
                      reason:
                        more.length === 0
                          ? `note ${String(one)} is not a current note of this mission`
                          : `notes ${outcome.missing.join(', ')} are not current notes of this mission`,
                    })
                  }
                  return { result: outcome.number, events: [outcome.event] }
                }),
              )
            }),
          ),
        checkEpoch,
        writeFiles,
        start: Effect.gen(function* () {
          const events = yield* DomainEvents.use((domain) => domain.subscribe).pipe(
            Effect.provide(context),
          )
          yield* catchUp.pipe(
            Effect.catch((failure) =>
              Effect.sync(() => log(`the Journal did not catch up at start: ${failure.message}`)),
            ),
          )
          const all = yield* run(
            Database.use((database) =>
              database
                .select({ id: missions.id })
                .from(missions)
                .pipe(Effect.mapError(refusedWhile('reading the missions'))),
            ),
          ).pipe(Effect.orElseSucceed(() => []))
          yield* Effect.forEach(
            all,
            ({ id }) =>
              writeFiles(id).pipe(
                Effect.catch((failure) =>
                  Effect.sync(() => log(`the Memory files were not written: ${failure.message}`)),
                ),
              ),
            { discard: true },
          )
          yield* Deferred.succeed(ready, undefined)
          yield* events.pipe(
            Stream.runForEach(() =>
              catchUp.pipe(
                Effect.catch((failure) =>
                  Effect.sync(() => log(`the Journal was not projected: ${failure.message}`)),
                ),
              ),
            ),
            Effect.forkIn(scope),
          )
        }),
      }
    }),
  )

const evidenceService = Layer.effect(
  Evidence,
  Effect.gen(function* () {
    const context = yield* Effect.context<Services>()
    const run = <A, E>(effect: Effect.Effect<A, E, Services>) => Effect.provide(effect, context)
    return {
      put: (asked) => run(putEvidence(asked)),
      read: (missionId, id) => run(readEvidence(missionId, id)),
      list: (missionId, about) => run(listEvidence(missionId, about)),
    }
  }),
)

/** The line each mission's Journal gets once its restored Profile is reconciled. */
export const restoreJournalLayer = Layer.effect(
  RestoreJournal,
  Effect.gen(function* () {
    const context = yield* Effect.context<Database | DomainEvents>()
    return {
      restored: (mission, takenAt) =>
        mutate('writing down a restore', () =>
          Effect.succeed({
            result: undefined,
            events: [
              {
                type: 'mission.restored',
                entityKind: 'mission',
                entityId: mission,
                source: 'system' as const,
                author: 'hemera' as const,
                payload: { takenAt },
              },
            ],
          }),
        ).pipe(Effect.provide(context)),
    }
  }),
)

/** The Memory and the evidence store, over their ports. */
export const memoryLayer = (parts: MemoryParts, log: Log) =>
  Layer.mergeAll(
    memoryService(parts, log),
    evidenceService,
    parts.restoreJournal ?? restoreJournalLayer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        parts.epochs ?? epochsInMemory().layer,
        parts.running ?? noRunningSessions,
        parts.dependencies === undefined
          ? noDependencies
          : Layer.succeed(MissionDependencies, parts.dependencies),
      ),
    ),
  )
