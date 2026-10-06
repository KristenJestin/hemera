/**
 * The end-to-end suite's one seam into the engine, served only when the suite runs headless
 * (`HEMERA_E2E_HEADLESS=1`, as `window-options.ts`): it lets the suite crash the engine from
 * inside, have it start an agents' process for the test program, stream at a high rate, and
 * create a need as an engine service would. A run of Hemera outside the suite never opens this
 * port.
 */

import { NeedFields, NeedOwner } from '@hemera/core/domain'
import { AgentsProcessGone, LaunchFailed, StorageFailed, type AgentLine } from '@hemera/ipc'
import { Deferred, Effect, Predicate, Schema, Stream } from 'effect'
import type { Scope } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'

import type { AgentsProcess } from './agents.ts'
import { HemeraEndpoint } from './agents/endpoint.ts'
import { openAgentSession } from './agents/sessions.ts'
import { MISSIONS_FOLDER } from './memory/files.ts'
import { createMission, listMissions } from './missions.ts'
import { createNeed, needService } from './needs.ts'
import type { StartedProfile } from './profile.ts'
import { createProject, listProjects } from './projects.ts'
import { Database, refusedWhile } from './storage/database.ts'
import { domainEvents, memoryJournal } from './storage/schema.ts'
import { ToolAccess, ToolGate } from './tools/index.ts'

export const Pid = Schema.TaggedStruct('Pid', { pid: Schema.Number })
export const Line = Schema.TaggedStruct('Line', { line: Schema.String })

/** What the Memory holds, as `probe.memory` answers it. */
export const MemoryState = Schema.Struct({
  /** The `memory.journal_added` events committed. */
  agentEvents: Schema.Number,
  /** The Journal lines they were projected into. */
  agentLines: Schema.Number,
  /** Every Journal line. */
  journalLines: Schema.Number,
  /** The files of each mission's folder, by key, and the lines of its `journal.md`. */
  files: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      names: Schema.Array(Schema.String),
      journalFileLines: Schema.Number,
    }),
  ),
})

/** An item shaped like what an agent streams: a turn's text, numbered. */
export const Item = Schema.Struct({ index: Schema.Number, text: Schema.String })

export const ProbeRpcs = RpcGroup.make(
  Rpc.make('probe.crash', { success: Schema.Void }),
  Rpc.make('probe.agents', {
    payload: { program: Schema.String, input: Schema.Array(Schema.String) },
    success: Schema.Union([Pid, Line]),
    error: Schema.Union([AgentsProcessGone, LaunchFailed]),
    stream: true,
  }),
  Rpc.make('probe.load', {
    payload: { count: Schema.Number, size: Schema.Number },
    success: Item,
    stream: true,
  }),
  /** Creates a pending need of that owner, with those fields, as an engine service would. */
  Rpc.make('probe.need', {
    payload: { owner: NeedOwner, fields: NeedFields },
    success: Schema.String,
    error: StorageFailed,
  }),
  /**
   * A fake agent at work: a mission of a Project over `folder`, and a Builder session that writes
   * `count` lines in its Journal through the real gate, one after the other, in the background.
   * Answers once the first line is written.
   */
  Rpc.make('probe.agentWrites', {
    payload: { folder: Schema.String, count: Schema.Number },
    success: Schema.Void,
    error: StorageFailed,
  }),
  /** What the Memory holds: its agent's events and Journal lines, and each mission's files. */
  Rpc.make('probe.memory', { success: MemoryState, error: StorageFailed }),
)

/** The service the suite's needs belong to: none answers them, so nothing ever delivers one. */
const SUITE = needService('end-to-end suite')

type Launch = (
  program: string,
  args: ReadonlyArray<string>,
  environment: Readonly<Record<string, string>>,
) => Effect.Effect<AgentsProcess, LaunchFailed, Scope.Scope>

const storageFailed = <E>(refusal: E) =>
  refusal instanceof StorageFailed
    ? refusal
    : new StorageFailed({ sentence: refusal instanceof Error ? refusal.message : String(refusal) })

/** The fake agent's mission and session, its token minted, then its writes in the background. */
const agentWrites = (profile: StartedProfile, folder: string, count: number) =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>()
    const writer = profile.use(
      Effect.gen(function* () {
        const project = yield* createProject({
          name: 'Acme',
          mainCheckout: folder,
          repositories: [],
        })
        const mission = yield* createMission({
          projectId: project.id,
          idea: { sentence: 'Export the invoices as CSV', ticket: null },
        })
        const session = yield* openAgentSession({
          provider: 'claude',
          ownerKind: 'mission',
          ownerId: mission.id,
          role: 'builder',
          folder,
        })
        const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session.id))
        const grant = yield* ToolAccess.use((access) => access.byToken(token))
        if (grant === null) return
        for (let step = 1; step <= count; step += 1) {
          yield* ToolGate.use((gate) =>
            gate.call({
              grantId: grant.id,
              tool: 'journal_add',
              arguments: { text: `Step ${String(step)}: chose the streaming writer` },
              callKey: null,
            }),
          )
          yield* Deferred.succeed(first, undefined)
        }
      }),
    )
    yield* writer.pipe(Effect.ignore, Effect.forkDetach)
    yield* Deferred.await(first)
  })

const memoryState = (profile: StartedProfile, dataFolder: string) =>
  profile.use(
    Effect.gen(function* () {
      const database = yield* Database
      const agentEvents = yield* database
        .select({ sequence: domainEvents.sequence })
        .from(domainEvents)
        .where(eq(domainEvents.type, 'memory.journal_added'))
        .pipe(Effect.mapError(refusedWhile('reading the events')))
      const lines = yield* database
        .select({ kind: memoryJournal.kind })
        .from(memoryJournal)
        .pipe(Effect.mapError(refusedWhile('reading the Journal')))
      const keys = (yield* Effect.forEach(yield* listProjects, (project) =>
        listMissions(project.id),
      )).flat()
      return {
        agentEvents: agentEvents.length,
        agentLines: lines.filter((line) => line.kind === 'agent').length,
        journalLines: lines.length,
        files: keys.map((mission) => {
          const folder = join(dataFolder, MISSIONS_FOLDER, mission.key)
          const journal = join(folder, 'journal.md')
          return {
            key: mission.key,
            names: existsSync(folder) ? readdirSync(folder).toSorted() : [],
            journalFileLines: existsSync(journal)
              ? readFileSync(journal, 'utf8')
                  .split('\n')
                  .filter((line) => /^\d+ · /.test(line)).length
              : 0,
          }
        }),
      }
    }),
  )

export const probeHandlers = (launch: Launch, profile: StartedProfile, dataFolder: string) =>
  ProbeRpcs.toLayer({
    'probe.crash': () => Effect.sync(() => process.crash()),
    'probe.agents': ({ program, input }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const agents = yield* launch(program, [], {})
          yield* Effect.forEach(input, agents.write, { discard: true })
          return Stream.concat(
            Stream.make(Pid.make({ pid: agents.pid })),
            Stream.map(agents.output, (line: AgentLine) =>
              Line.make({
                line: Predicate.isTagged(line, 'Output') ? line.line : `! ${line.line}`,
              }),
            ),
          )
        }),
      ),
    'probe.load': ({ count, size }) =>
      // One item per chunk, as an agent's turn arrives: one acknowledgement per item.
      Stream.range(1, count).pipe(
        Stream.map((index) => Item.make({ index, text: 'x'.repeat(size) })),
        Stream.rechunk(1),
      ),
    'probe.need': ({ owner, fields }) =>
      profile.use(createNeed(SUITE, owner, fields)).pipe(
        Effect.map((need) => need.id),
        Effect.mapError((refusal) =>
          refusal instanceof StorageFailed
            ? refusal
            : new StorageFailed({ sentence: refusal.message }),
        ),
      ),
    'probe.agentWrites': ({ folder, count }) =>
      agentWrites(profile, folder, count).pipe(Effect.mapError(storageFailed)),
    'probe.memory': () => memoryState(profile, dataFolder).pipe(Effect.mapError(storageFailed)),
  })
