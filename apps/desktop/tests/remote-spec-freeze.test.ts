/**
 * The Freeze of a remote Spec (#98): in a Project in `remote` mode, the user's Freeze queues the
 * write of the frozen Spec into the mission's ticket in its own transaction, so it never waits on
 * the network; local and linked modes queue none; a return to Planning drops a write not sent yet.
 *
 * On the engine as it starts, with the fake agent of #32 as every cold read, the fake tracker of
 * `fake-tracker.ts` behind the providers' port (never a real tracker), a temporary data folder, and
 * Acme's real repository `api` with a bare remote on the same disk. The Planner the user plans with
 * is a session the test opened: the test calls its tools through its grant. Every wait is on
 * state, never on time.
 */

import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_BASE_BRANCH, SPEC_SECTIONS, parseTicketReference } from '@hemera/core/domain'
import { Effect, type Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { freezeMission, returnToPlanning } from '../src/engine/planning/freeze.ts'
import { listColdReads } from '../src/engine/planning/cold-read-store.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { createProject } from '../src/engine/projects.ts'
import { openSession } from '../src/engine/sessions/store.ts'
import { createStart } from '../src/engine/start/field.ts'
import { addGithub, setSpecMode } from '../src/engine/tickets/store.ts'
import { TicketSync } from '../src/engine/tickets/sync.ts'
import { ticketWritesOf } from '../src/engine/tickets/writes.ts'
import { ToolAccess } from '../src/engine/tools/access.ts'
import { type FakeTracker, fakeTracker } from './fake-tracker.ts'
import { git, remote, repository } from './repositories.ts'
import { BUILDER, HELPER, sessionsEngine, until } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'

let data: string
let work: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('remote-spec-freeze'))
  work = realpathSync.native(temporaryFolder('remote-spec-freeze-work'))
})
afterEach(removeFolders)

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

/** A cold read that reads the Spec and reports no finding. */
const READING: FakeScript = {
  turns: [
    [
      uses('toolu_read', 'spec_read', {}),
      uses('toolu_report', 'cold_read_report', { findings: [] }),
    ],
  ],
  steps: [{ does: 'says', text: 'Done.' }],
}

const engine = (tracker: FakeTracker) =>
  sessionsEngine(data, () => READING, {
    roles: [BUILDER, HELPER],
    tools: { home: work },
    ticketProviders: tracker.layer,
    ticketSync: { schedules: false },
  }).run

/** Acme in a mode: `api` on the default base branch with a bare remote, a GitHub provider. */
const acme = (mode: 'remote' | 'linked' | 'local') =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    const api = repository(join(main, 'api'), DEFAULT_BASE_BRANCH)
    writeFileSync(join(api, 'invoices.ts'), 'export const invoices = []\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'invoices')
    remote(api, join(work, 'remotes', 'api.git'))
    const project = yield* createProject({
      name: 'Acme',
      mainCheckout: main,
      repositories: ['api'],
    })
    yield* addGithub(project.id, { host: 'github.com', repositories: ['acme/shop'] })
    yield* setSpecMode(project.id, mode)
    return { project, main }
  })

const reference = (text: string) => {
  const parsed = parseTicketReference(text)
  if (parsed === null) throw new Error(`${text} is not a reference`)
  return parsed
}

/** A Planner session of a mission, its token minted: the test calls its tools. */
const plannerGrant = (missionId: string, main: string) =>
  Effect.gen(function* () {
    const session = yield* openSession({
      provider: 'claude',
      owner: { kind: 'mission', missionId },
      role: 'planner',
      folder: main,
      parent: null,
      chosen: { model: null, effort: null, mode: null },
      modelLevel: null,
    })
    const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session.id))
    const grant = yield* ToolAccess.use((access) => access.byToken(token))
    if (grant === null) return yield* Effect.die(new Error('the token named no grant'))
    return grant.id
  })

const call = (grantId: string, tool: string, args: Schema.JsonObject) =>
  Effect.map(callTool(grantId, tool, args), (answer) => answer.text)

/** The Planner writes a whole Spec that passes Hemera's check, declares it, and it is read cold. */
const settledSpec = (missionId: string, grantId: string) =>
  Effect.gen(function* () {
    for (const section of SPEC_SECTIONS) {
      yield* call(grantId, 'spec_write_section', {
        section,
        content: `The ${section}.`,
        base_version: 0,
      })
    }
    yield* call(grantId, 'requirement_write', {
      domain: 'invoices',
      delta: 'added',
      text: 'Invoices export as CSV.',
      scenarios: [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }],
    })
    yield* call(grantId, 'mission_describe', { title: 'Invoices as CSV', type: 'feature' })
    yield* call(grantId, 'proof_write', {
      scenario: 'R1.S1',
      proof: {
        mode: 'by_hand',
        actions: ['Export the invoices'],
        starting_data: 'None.',
        expected: 'A CSV file is saved.',
        seen_today: false,
      },
      base_version: 0,
    })
    yield* call(grantId, 'tasks_write', {
      tasks: [
        {
          title: 'Export as CSV',
          result: 'The invoices export as CSV.',
          requirements: ['R1'],
          scenarios: ['R1.S1'],
          targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
          depends_on: [],
        },
      ],
      base_version: 0,
    })
    yield* call(grantId, 'model_recommend', {
      agent: 'codex',
      model: 'gpt-large',
      reason: 'A small change.',
    })
    yield* call(grantId, 'declare_complete', { why: 'A Builder can build it.' })
    yield* until(
      Effect.map(listColdReads(missionId), (passes) =>
        passes.some((one) => one.number === 1 && one.state === 'done'),
      ),
    )
    return (yield* readSpec(missionId)).version
  })

/** A mission of Acme from `acme/shop#1`, planned whole, then frozen. */
const frozenFromIssue = (mode: 'remote' | 'linked' | 'local') =>
  Effect.gen(function* () {
    const { project, main } = yield* acme(mode)
    const mission = yield* createStart({
      projectId: project.id,
      ticket: { reference: reference('acme/shop#1') },
      idempotencyKey: 'issue-1',
    })
    const grantId = yield* plannerGrant(mission.id, main)
    const version = yield* settledSpec(mission.id, grantId)
    const frozen = yield* freezeMission(mission.id, version)
    return { project, mission: frozen }
  })

const check = (projectId: string) => TicketSync.use((sync) => sync.check(projectId))

describe('The Freeze queues the write of a remote Spec, and never waits on the network', () => {
  test('remote mode: one write queued at the Freeze, then the eight sections written, and nothing of the Proof, tasks or model', async () => {
    const tracker = fakeTracker()
    tracker.set(1, { body: '## Why\nExports are slow.\n' })
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission } = yield* frozenFromIssue('remote')
          expect(mission.stage).toBe('ready')
          yield* until(
            Effect.map(
              ticketWritesOf(mission.id),
              (all) => all.map((one) => one.state).join() === 'done',
            ),
          )
          const [write] = yield* ticketWritesOf(mission.id)
          expect(write?.specVersion).toBe((yield* readSpec(mission.id)).version)
          const text = tracker.written()[0]?.text ?? ''
          expect(tracker.written()).toHaveLength(1)
          expect(text).toContain('## Why\n\nThe why.')
          expect(text).toContain('## Open questions\n\nThe open_questions.')
          expect(text).toContain('**R1 · Added · invoices**\n\nInvoices export as CSV.')
          expect(text).toContain('  - **WHEN** the user exports the invoices')
          for (const absent of ['Proof', 'Export as CSV', 'gpt-large', 'ACME-1', 'Ready']) {
            expect(text).not.toContain(absent)
          }
        }),
      ),
    )
  })

  test('offline at the Freeze: it lands at once, the write waits; a return to Planning drops it, and nothing is ever sent', async () => {
    const tracker = fakeTracker()
    tracker.set(1, { body: '## Why\nExports are slow.\n' })
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, main } = yield* acme('remote')
          const mission = yield* createStart({
            projectId: project.id,
            ticket: { reference: reference('acme/shop#1') },
            idempotencyKey: 'issue-1',
          })
          const grantId = yield* plannerGrant(mission.id, main)
          const version = yield* settledSpec(mission.id, grantId)
          tracker.offline(true)
          const frozen = yield* freezeMission(mission.id, version)
          expect(frozen.stage).toBe('ready')
          yield* until(
            Effect.map(ticketWritesOf(mission.id), (all) => all[0]?.state === 'waiting_offline'),
          )
          yield* returnToPlanning(mission.id, null)
          const [write] = yield* ticketWritesOf(mission.id)
          expect(write?.state).toBe('failed')
          expect(write?.error).toBe(
            'Not written: the mission went back to Planning before the Spec reached acme/shop#1. The next Freeze writes it.',
          )
          tracker.offline(false)
          yield* check(project.id)
          expect(tracker.asksToWrite()).toBe(0)
          expect((yield* ticketWritesOf(mission.id)).map((one) => one.state)).toEqual(['failed'])
        }),
      ),
    )
  })

  test.each(['local', 'linked'] as const)('%s mode: the Freeze queues no write', async (mode) => {
    const tracker = fakeTracker()
    tracker.set(1, { body: '## Why\nExports are slow.\n' })
    await engine(tracker)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission } = yield* frozenFromIssue(mode)
          expect(mission.stage).toBe('ready')
          expect(yield* ticketWritesOf(mission.id)).toEqual([])
          expect(tracker.asksToWrite()).toBe(0)
        }),
      ),
    )
  })
})
