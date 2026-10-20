/**
 * Red first, then green (#144): Hemera writes each automated scenario's test into the Workspace at
 * the Building's start, runs it before any task and judges its red (CT-35, CT-37), holds the tasks
 * covering a scenario until its red is recorded, runs it green once those tasks are done, marks it
 * to run again when its repository moves (CT-38), and keeps the user's verdict on a scenario
 * verified by hand (CT-36).
 *
 * On the engine as it starts, with the fake agent of #32 as every agent, the test driving the
 * Builder's tools through its grant; Acme's real repositories in temporary folders as the
 * Workspace, and real `node --test` files as the proofs.
 *
 * This file: the proofs written into the Workspace and their red phase, and what the user
 * answers on a red.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { ChosenAnswer, WrittenAnswer } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import type { Schema } from 'effect'
import { Deferred, Duration, Effect, Exit, Layer, Predicate, Semaphore } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { AskBeforeRunning } from '../src/engine/ask-before-running.ts'
import { type BuilderHold, builderLayer, buildingOf } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { OutsideChanges } from '../src/engine/building/outside.ts'
import {
  ACCEPT_RED,
  CANCEL_MISSION,
  LEADS_OUT,
  NOT_REPRODUCIBLE,
  SEND_BACK,
} from '../src/engine/building/proofs.ts'
import { readEvidence } from '../src/engine/memory/evidence.ts'
import { getMission } from '../src/engine/missions.ts'
import { NeedOwners, answerNeed, getNeed, retryNeed } from '../src/engine/needs.ts'
import { TEST_CAP } from '../src/engine/building/proof-runner.ts'
import { saveCheck, setProofLimit } from '../src/engine/project-checks.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { NOT_A_FILE, OVER_CAP, THROUGH_A_LINK } from '../src/engine/tools/judged.ts'
import { fingerprintOf } from '../src/engine/tools/read.ts'
import { Runs } from '../src/engine/runs.ts'
import { Database } from '../src/engine/storage/database.ts'
import { mutate } from '../src/engine/transaction.ts'
import { activeBuildingIn, decisionsIn, tasksIn } from '../src/engine/building/tasks.ts'
import { commandRuns, sessionDeliveries } from '../src/engine/storage/schema.ts'
import { call } from './building-world.ts'
import { PLAN, builderOf, buildingNow, launched, taskIn } from './builder-world.ts'
import { git } from './repositories.ts'
import { until, within } from './sessions-world.ts'
import { removeFolders } from './storage.ts'
import {
  data,
  work,
  scratch,
  proofsEngine,
  launchedWith,
  testLine,
  automated,
  testFile,
  EXPORT_PATH,
  EXPORT_TEST,
  exportProof,
  RIGHT_EXPORT,
  loggedTest,
  runsIn,
  proofsOf,
  proofOf,
  proofIn,
  proofAttemptsOf,
  deliveredTo,
  needOf,
  payloadsOf,
  apiOf,
  builds,
  closedPort,
  EXISTING_PATH,
  EXISTING,
  WITH_ADDITION,
  withExisting,
  outsideFolder,
  linksFiles,
  writtenAfter,
  ranAfter,
  goModuleProof,
  holdOnce,
  redsRun,
  deliveriesOf,
  unmovedOf,
  writes,
  newFolders,
} from './proofs-world.ts'

beforeEach(() => newFolders('building-proofs'))
afterEach(removeFolders)

describe('The proofs written into the Workspace (CT-37)', () => {
  test('a proof in a new file is written whole', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const api = yield* apiOf(mission.id)
          return {
            written: readFileSync(join(api, EXPORT_PATH), 'utf8'),
            events: yield* payloadsOf(mission.id, 'building.proofs_written'),
          }
        }),
      ),
    )
    expect(seen.written).toBe(EXPORT_TEST)
    expect(seen.events).toEqual([{ scenarios: ['R1.S2'], conflicts: [] }])
  })

  test('an addition merges cleanly into an existing test file', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': withExisting(api),
          }))
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const api = yield* apiOf(mission.id)
          return { merged: readFileSync(join(api, EXISTING_PATH), 'utf8') }
        }),
      ),
    )
    // A Windows checkout keeps its CRLF lines through the merge (git.test.ts covers it).
    expect(seen.merged.replaceAll('\r\n', '\n')).toBe(WITH_ADDITION)
  })

  test('an addition against a file changed since the Freeze conflicts, writes nothing, and gives the Builder an attempt with the three versions', async () => {
    const reached = Deferred.makeUnsafe<void>()
    const go = Deferred.makeUnsafe<void>()
    const hold: BuilderHold = (at) =>
      at === 'proving'
        ? Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(go))
        : Effect.void
    const theirs = `${EXISTING}\ntest('another', () => {})\n`
    const seen = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': withExisting(api),
          }))
          yield* Deferred.await(reached)
          // Someone changed the file in the Workspace, where the test goes, since the Freeze.
          const api = yield* apiOf(mission.id)
          writeFileSync(join(api, EXISTING_PATH), theirs)
          yield* Deferred.succeed(go, undefined)
          const { grantId } = yield* builderOf(mission.id)
          const delivered = yield* deliveredTo(mission.id, 'Integrate the test by hand')
          const evidenceId = /\(evidence ([0-9a-f-]+)\)/.exec(delivered)?.[1] ?? ''
          const evidence = yield* readEvidence(mission.id, evidenceId)
          return {
            versions: new TextDecoder().decode(evidence.bytes),
            file: readFileSync(join(api, EXISTING_PATH), 'utf8'),
            attempts: yield* proofAttemptsOf('R1.S2'),
            delivered,
            proof: yield* proofOf(mission.id, 'R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.proofs_written'),
            started: yield* call(grantId, 'task_start', { task: 'T2' }),
          }
        }),
      ),
    )
    expect(seen.file).toBe(theirs)
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.attempts.map((one) => [one.number, one.verdict])).toEqual([[1, 'red']])
    expect(seen.delivered).toContain('changed since the Freeze and the test')
    // The three versions, whole, in the evidence the attempt names.
    expect(seen.versions).toContain(`## api/${EXISTING_PATH} at the Freeze\n\n\`\`\`\n${EXISTING}`)
    expect(seen.versions).toContain(`## api/${EXISTING_PATH} in the Workspace\n\n\`\`\`\n${theirs}`)
    expect(seen.versions).toContain(
      `## api/${EXISTING_PATH} with the proof's addition\n\n\`\`\`\n${WITH_ADDITION}`,
    )
    expect(seen.proof.state).toBe('waiting_red')
    expect(seen.started).toContain('waits for the red of R1.S2')
  })
})

describe('A proof written only where Hemera judged it (#385)', () => {
  test('a link planted where a proof’s new file goes, leading outside, never receives its bytes', async (context) => {
    if (!linksFiles()) context.skip()
    const outside = outsideFolder()
    const seen = await writtenAfter('proving', exportProof, (api) => {
      mkdirSync(join(api, 'tests'), { recursive: true })
      symlinkSync(join(outside, 'export.test.mjs'), join(api, EXPORT_PATH), 'file')
    })
    expect(existsSync(join(outside, 'export.test.mjs'))).toBe(false)
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.delivered).toContain(`api/${EXPORT_PATH} was left as it is: ${LEADS_OUT}`)
  })

  test('a folder of a proof’s path that is a junction leading outside never receives its bytes', async () => {
    const outside = outsideFolder()
    const seen = await writtenAfter('proving', exportProof, (api) =>
      symlinkSync(outside, join(api, 'tests'), 'junction'),
    )
    expect(existsSync(join(outside, 'export.test.mjs'))).toBe(false)
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.delivered).toContain(`api/${EXPORT_PATH} was left as it is: ${LEADS_OUT}`)
  })

  test('an addition to a test file with a second name outside is refused, and that other name keeps its bytes', async () => {
    const outside = outsideFolder()
    const twin = join(outside, 'twin.mjs')
    const seen = await writtenAfter(
      'proving',
      (api) => ({ 'R1.S2': withExisting(api) }),
      (api) => {
        rmSync(join(api, EXISTING_PATH))
        writeFileSync(twin, EXISTING)
        linkSync(twin, join(api, EXISTING_PATH))
      },
    )
    expect(readFileSync(twin, 'utf8')).toBe(EXISTING)
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.delivered).toContain('it is never written over')
  })

  test.skipIf(process.platform === 'win32')(
    'a pipe planted where a proof’s file goes is refused without blocking, and proof_run refuses it too',
    async () => {
      const seen = await writtenAfter(
        'proving',
        (api) => ({ 'R1.S2': withExisting(api) }),
        (api) => {
          rmSync(join(api, EXISTING_PATH))
          execFileSync('mkfifo', [join(api, EXISTING_PATH)])
        },
      )
      expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
      expect(seen.delivered).toContain(`api/${EXISTING_PATH} was left as it is: ${NOT_A_FILE}`)
      expect(seen.proofRun).toContain('test is not in place yet')
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a pipe planted where a proof’s new file goes is refused without blocking, and never run',
    async () => {
      const seen = await writtenAfter('proving', exportProof, (api) => {
        mkdirSync(join(api, 'tests'), { recursive: true })
        execFileSync('mkfifo', [join(api, EXPORT_PATH)])
      })
      expect(seen.delivered).toContain(`api/${EXPORT_PATH} was left as it is: ${NOT_A_FILE}`)
      expect(seen.proofRun).toContain('test is not in place yet')
    },
  )

  test('a Workspace reached through a link has its proofs written: the folders are judged by their real paths', async () => {
    // The data folder holds the Workspaces: reached through a junction, as is the Project.
    const linkedData = join(scratch, 'data')
    const linkedWork = join(scratch, 'work')
    symlinkSync(data, linkedData, 'junction')
    symlinkSync(work, linkedWork, 'junction')
    const seen = await proofsEngine(linkedData).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            linkedWork,
            undefined,
            undefined,
            PLAN,
            undefined,
            undefined,
            exportProof,
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          return {
            written: readFileSync(join(yield* apiOf(mission.id), EXPORT_PATH), 'utf8'),
            events: yield* payloadsOf(mission.id, 'building.proofs_written'),
          }
        }),
      ),
    )
    expect(seen.events).toEqual([{ scenarios: ['R1.S2'], conflicts: [] }])
    expect(seen.written).toBe(EXPORT_TEST)
  })

  test('a link planted between a proof’s read and its write is replaced, never written through', async (context) => {
    if (!linksFiles()) context.skip()
    const outside = outsideFolder()
    const seen = await writtenAfter('placed', exportProof, (api) => {
      mkdirSync(join(api, 'tests'), { recursive: true })
      symlinkSync(join(outside, 'export.test.mjs'), join(api, EXPORT_PATH), 'file')
    })
    expect(existsSync(join(outside, 'export.test.mjs'))).toBe(false)
    expect(lstatSync(join(seen.api, EXPORT_PATH)).isFile()).toBe(true)
    expect(readFileSync(join(seen.api, EXPORT_PATH), 'utf8')).toBe(EXPORT_TEST)
  })

  test('a folder of a proof’s path made a junction between its read and its write fails the write, never lands outside', async () => {
    const outside = outsideFolder()
    const seen = await writtenAfter('placed', exportProof, (api) =>
      symlinkSync(outside, join(api, 'tests'), 'junction'),
    )
    expect(existsSync(join(outside, 'export.test.mjs'))).toBe(false)
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.delivered).toContain(`api/${EXPORT_PATH} was not written: ${THROUGH_A_LINK}`)
    // The write Hemera began is recorded as failed, never left for a restart to guess.
    expect(seen.writes.map((one) => [one.state, one.outcome])).toEqual([['failed', THROUGH_A_LINK]])
  })

  test('a repository folder swapped for a link leading outside never receives the proof’s bytes, nor is its test read there', async () => {
    const outside = outsideFolder()
    const seen = await writtenAfter('proving', exportProof, (api) => {
      renameSync(api, `${api}-moved`)
      symlinkSync(outside, api, 'junction')
    })
    expect(existsSync(join(outside, 'tests', 'export.test.mjs'))).toBe(false)
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.delivered).toContain(`api/${EXPORT_PATH} was left as it is: ${LEADS_OUT}`)
    expect(seen.proofRun).toContain('test is not in place yet')
  })

  test('a folder of a proof’s path that is a junction into another repository of the Workspace is refused: a proof stays in its own', async () => {
    let web = ''
    const seen = await writtenAfter('proving', exportProof, (api) => {
      web = join(api, '..', 'web')
      symlinkSync(web, join(api, 'tests'), 'junction')
    })
    expect(existsSync(join(web, 'export.test.mjs'))).toBe(false)
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.delivered).toContain(`api/${EXPORT_PATH} was left as it is: ${LEADS_OUT}`)
  })

  test('a link loop at a proof’s path is refused as a path that cannot be followed', async (context) => {
    if (!linksFiles()) context.skip()
    const seen = await writtenAfter('proving', exportProof, (api) => {
      mkdirSync(join(api, 'tests'), { recursive: true })
      symlinkSync(join(api, EXPORT_PATH), join(api, EXPORT_PATH), 'file')
    })
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.delivered).toContain(`api/${EXPORT_PATH} was left as it is: ${LEADS_OUT}`)
  })

  test('a proof’s file in a sensitive place of the Workspace is read as its Builder would read it: withheld, never handed over', async () => {
    const secret = 'TOKEN=a value no agent reads\n'
    const seen = await writtenAfter(
      'proving',
      () => ({ 'R1.S2': automated('tests/app.env', EXPORT_TEST) }),
      (api) => {
        mkdirSync(join(api, 'tests'), { recursive: true })
        writeFileSync(join(api, 'tests', 'app.env'), secret)
      },
    )
    expect(seen.events).toEqual([{ scenarios: [], conflicts: ['R1.S2'] }])
    expect(seen.delivered).toContain('api/tests/app.env was left as it is: content withheld: ')
    expect(seen.delivered).not.toContain('a value no agent reads')
    expect(readFileSync(join(seen.api, 'tests', 'app.env'), 'utf8')).toBe(secret)
  })

  test('a test file with a second name (a checkout made of hard links) is in place, and proof_run runs it', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const api = yield* apiOf(mission.id)
          const store = join(api, 'store')
          mkdirSync(store)
          linkSync(join(api, EXPORT_PATH), join(store, 'export.test.mjs'))
          const { grantId } = yield* builderOf(mission.id)
          return yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
        }),
      ),
    )
    expect(seen).not.toMatch(/^refused/)
  })

  test.runIf(process.platform === 'win32')(
    'a proof’s path whose letters differ in case from the disk’s folder is written into that folder',
    async () => {
      const path = 'Tests/export.test.mjs'
      const seen = await writtenAfter(
        'proving',
        () => ({ 'R1.S2': automated(path, EXPORT_TEST) }),
        (api) => mkdirSync(join(api, 'tests')),
      )
      expect(seen.events).toEqual([{ scenarios: ['R1.S2'], conflicts: [] }])
      expect(readFileSync(join(seen.api, 'tests', 'export.test.mjs'), 'utf8')).toBe(EXPORT_TEST)
    },
  )

  test('a second name given to a proof’s file between its read and its write keeps its bytes: the file is replaced', async () => {
    const outside = outsideFolder()
    const twin = join(outside, 'twin.mjs')
    let read = ''
    const seen = await writtenAfter(
      'placed',
      (api) => ({ 'R1.S2': withExisting(api) }),
      (api) => {
        const bytes = readFileSync(join(api, EXISTING_PATH))
        read = fingerprintOf(bytes)
        writeFileSync(twin, bytes)
        rmSync(join(api, EXISTING_PATH))
        linkSync(twin, join(api, EXISTING_PATH))
      },
    )
    expect(readFileSync(twin, 'utf8').replaceAll('\r\n', '\n')).toBe(EXISTING)
    expect(readFileSync(join(seen.api, EXISTING_PATH), 'utf8').replaceAll('\r\n', '\n')).toBe(
      WITH_ADDITION,
    )
    // The write recorded holds the version it replaced, which a restart compares the file with.
    expect(seen.writes.map((one) => [one.state, one.details])).toEqual([
      [
        'done',
        {
          path: join(seen.api, EXISTING_PATH),
          before: read,
          after: fingerprintOf(readFileSync(join(seen.api, EXISTING_PATH))),
        },
      ],
    ])
  })
})

describe('A proof’s test file read before its run (#434)', () => {
  test.skipIf(process.platform === 'win32')(
    'a proof’s test file replaced by a pipe is refused at once, and the engine answers another call meanwhile',
    async () => {
      const seen = await ranAfter((file) => execFileSync('mkfifo', [file]))
      expect(seen.answered).toBe('R1.S2')
      expect(seen.run).toMatchObject({ testSha256: null, testEvidenceId: null })
      expect(seen.evidence).toContain(`Hemera did not read api/${EXPORT_PATH}: ${NOT_A_FILE}\n`)
    },
  )

  test.skipIf(process.platform === 'win32')('a link to /dev/zero is refused', async () => {
    const seen = await ranAfter((file) => symlinkSync('/dev/zero', file))
    expect(seen.run).toMatchObject({ testSha256: null, testEvidenceId: null })
    expect(seen.evidence).toContain(`Hemera did not read api/${EXPORT_PATH}: ${LEADS_OUT}\n`)
  })

  test('a test file over the cap is refused, never read whole', async () => {
    const seen = await ranAfter((file) => writeFileSync(file, 'x'.repeat(TEST_CAP + 1)))
    expect(seen.run).toMatchObject({ testSha256: null, testEvidenceId: null })
    expect(seen.evidence).toContain(`Hemera did not read api/${EXPORT_PATH}: ${OVER_CAP}\n`)
  })

  test('a link to another file of its repository is followed, as fs_write follows one', async (context) => {
    if (!linksFiles()) context.skip()
    const seen = await ranAfter((file) => {
      const twin = join(file, '..', 'twin.test.mjs')
      writeFileSync(twin, EXPORT_TEST)
      symlinkSync(twin, file, 'file')
    })
    expect(seen.run?.testSha256).toBe(fingerprintOf(Buffer.from(EXPORT_TEST, 'utf8')))
    expect(seen.evidence).not.toContain('Hemera did not read')
  })

  test('an ordinary test file is still read, its fingerprint and its evidence recorded', async () => {
    const seen = await ranAfter((file) => writeFileSync(file, EXPORT_TEST))
    expect(seen.run?.testSha256).toBe(fingerprintOf(Buffer.from(EXPORT_TEST, 'utf8')))
    expect(seen.run?.testEvidenceId).not.toBeNull()
    expect(seen.evidence).not.toContain('Hemera did not read')
  })
})

describe('The red phase (CT-35)', () => {
  test('an assertion of the expected result that fails records the red', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          yield* taskIn(mission.id, 'T2', 'available')
          return {
            proof: yield* proofOf(mission.id, 'R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.red_recorded'),
          }
        }),
      ),
    )
    expect(seen.proof.red).toMatchObject({
      phase: 'red',
      classification: 'assertion_failed',
      testPath: `api/${EXPORT_PATH}`,
    })
    expect(seen.proof.red?.evidenceId).not.toBeNull()
    expect(seen.proof.red?.testEvidenceId).not.toBeNull()
    expect(seen.events).toEqual([{ scenario: 'R1.S2' }])
  })

  test('a proof runs its command with the reporting Hemera adds, and its evidence shows the line run and what was added (#342)', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const proof = yield* proofOf(mission.id, 'R1.S2')
          const evidence = yield* readEvidence(mission.id, proof.red?.evidenceId ?? '')
          return { proof, evidence: new TextDecoder().decode(evidence.bytes) }
        }),
      ),
    )
    const added = /--test-reporter=spec .*--test-reporter-destination=('[^']*')/.exec(
      seen.proof.red?.line ?? '',
    )
    expect(seen.proof.red?.line.startsWith(`"${process.execPath}" --test `)).toBe(true)
    expect(added).not.toBeNull()
    expect(
      seen.evidence.startsWith(`$ ${seen.proof.red?.line}\nHemera added: --test-reporter=spec`),
    ).toBe(true)
  })

  test('a red whose output was cut at its start is not read from its report: without a key line it is no red (#342)', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(
              EXPORT_PATH,
              testFile(
                [
                  "  console.log('x'.repeat(100_000))",
                  "  assert.equal(existsSync(new URL('../export.ts', import.meta.url)), true, 'export.ts exports nothing yet')",
                ].join('\n'),
              ),
            ),
          }))
          yield* until(
            Effect.map(
              payloadsOf(mission.id, 'building.red_invalid'),
              (events) => events.length > 0,
            ),
            20_000,
          )
          return {
            proof: yield* proofOf(mission.id, 'R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.red_invalid'),
          }
        }),
      ),
    )
    expect(seen.proof.state).toBe('waiting_red')
    expect(seen.proof.runs.map((one) => one.classification)).toEqual(['assertion_failed'])
    expect(seen.events).toEqual([{ scenario: 'R1.S2', classification: 'assertion_failed' }])
  })

  test('a catalogue command marked "ask before running" is asked about with the line Hemera runs, its reporting included (#342)', async () => {
    const asked: string[] = []
    const allowed = Layer.succeed(AskBeforeRunning, {
      decide: (run) =>
        Effect.sync(() => {
          asked.push(run.line)
          return 'allowed' as const
        }),
    })
    const seen = await proofsEngine(data, undefined, undefined, undefined, {
      askBeforeRunning: allowed,
    }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          let proofCommand = ''
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                const saved = yield* saveCommand({
                  projectId,
                  id: null,
                  command: {
                    name: 'export proof',
                    type: 'script',
                    line: testLine(`api/${EXPORT_PATH}`),
                    lineWindows: null,
                    lineLinux: null,
                    repositoryId: null,
                    folder: null,
                    scope: 'workspace',
                    portless: false,
                    portlessName: null,
                    check: false,
                    atOpen: false,
                    askBeforeRunning: true,
                    readOnly: false,
                    writeGlobs: [],
                  },
                })
                proofCommand = saved.id
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
                test: {
                  repository: 'api',
                  path: EXPORT_PATH,
                  code: EXPORT_TEST,
                  insertion: 'new_file',
                  command: proofCommand,
                },
              }),
            }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(asked.length).toBeGreaterThan(0)
    expect(asked[0]?.startsWith(`"${process.execPath}" --test `)).toBe(true)
    expect(asked[0]).toContain('--test-reporter=junit --test-reporter-destination=')
    expect(asked[0]).toBe(seen.red?.line)
  })

  test('a compilation error is error_before_test and comes back as an attempt', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile('  const = 1')),
          }))
          const delivered = yield* deliveredTo(mission.id, 'Fix the setup')
          return {
            delivered,
            proof: yield* proofsOf(mission.id),
            attempts: yield* proofAttemptsOf('R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.red_invalid'),
          }
        }),
      ),
    )
    const s2 = seen.proof.scenarios.find((one) => one.scenario === 'R1.S2')
    expect(s2?.state).toBe('waiting_red')
    expect(s2?.runs.map((one) => one.classification)).toEqual(['error_before_test'])
    expect(seen.events).toEqual([{ scenario: 'R1.S2', classification: 'error_before_test' }])
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['red'])
    expect(seen.delivered).toContain('did not run')
  })

  test('an unreachable service gives an environment need, its words untouched by the time limit', async () => {
    const port = await closedPort()
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(
              EXPORT_PATH,
              testFile(
                `  await new Promise((done, fail) => connect(${String(port)}, '127.0.0.1').on('connect', done).on('error', fail))`,
                ["import { connect } from 'node:net'"],
              ),
            ),
          }))
          const need = yield* needOf(mission.id, 'Environment')
          const held = yield* proofOf(mission.id, 'R1.S2')
          const view = yield* buildingNow(mission.id)
          yield* retryNeed(need.id)
          yield* until(
            Effect.map(proofOf(mission.id, 'R1.S2'), (proof) => proof.runs.length === 2),
            20_000,
          )
          return { held, view, need }
        }),
      ),
    )
    expect(seen.held.state).toBe('held')
    expect(seen.held.runs.map((one) => one.classification)).toEqual(['environment'])
    expect(seen.need.fields).toMatchObject({
      missing: expect.stringContaining(
        "R1.S2's proof could not run: the environment kept it from running.",
      ),
      action: 'Fix what it says (a service, a port), then Retry: Hemera runs the proof again.',
      settingsSection: null,
    })
    expect(seen.view.tasks.find((task) => task.id === 'T2')?.state).toBe('blocked')
  })

  test('a stop between an environment need’s Retry and its decision leaves nothing behind the withdrawn need: after the start, the proof is run again and asked about anew', async () => {
    const port = await closedPort()
    const spec = () => ({
      'R1.S2': automated(
        EXPORT_PATH,
        testFile(
          `  await new Promise((done, fail) => connect(${String(port)}, '127.0.0.1').on('connect', done).on('error', fail))`,
          ["import { connect } from 'node:net'"],
        ),
      ),
    })
    // The engine stops once the need is withdrawn, before anything else of the Retry is done.
    const stop = holdOnce('releasing')
    const first = await proofsEngine(data, stop.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(spec)
          const need = yield* needOf(mission.id, 'Environment')
          yield* retryNeed(need.id)
          yield* Deferred.await(stop.reached)
          return { mission, need }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const again = yield* needOf(first.mission.id, 'Environment')
          const database = yield* Database
          const building = yield* activeBuildingIn(database, first.mission.id)
          if (building === null) return yield* Effect.die(new Error('no Building'))
          const decision = (yield* decisionsIn(database, building.id)).find(
            (one) => one.needId === first.need.id,
          )
          const cause = (yield* tasksIn(database, building.id)).find(
            (one) => one.id === 'T2',
          )?.blockedBy
          const blockedOn = Predicate.isTagged(cause, 'Need') ? cause.needId : null
          return { again, decision: decision?.state, blockedOn }
        }),
      ),
    )
    expect(seen.again.id).not.toBe(first.need.id)
    expect(seen.decision).toBe('withdrawn')
    expect(seen.blockedOn).toBe(seen.again.id)
  })

  test('a Retry that reaches the Builder’s needs before the Builder runs is refused, never taken without moving its proof', async () => {
    const port = await closedPort()
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(
              EXPORT_PATH,
              testFile(
                `  await new Promise((done, fail) => connect(${String(port)}, '127.0.0.1').on('connect', done).on('error', fail))`,
                ["import { connect } from 'node:net'"],
              ),
            ),
          }))
          const need = yield* needOf(mission.id, 'Environment')
          // The handler of a Builder whose layer is not built yet, as at the engine's start.
          const early = builderLayer(() => undefined).handler.retriedIn
          if (early === undefined) return yield* Effect.die(new Error('no Retry hook'))
          return Exit.isFailure(
            yield* Effect.exit(
              mutate('a Retry before the Builder runs', (transaction) =>
                Effect.map(early(need, transaction), (events) => ({ result: undefined, events })),
              ),
            ),
          )
        }),
      ),
    )
    expect(seen).toBe(true)
  })

  /** A bug seen today: what Planning observed, its key line, and where it was seen. */
  const seenToday = (api: string, observed: string, keyLine: string): Schema.JsonObject =>
    automated(
      EXPORT_PATH,
      testFile('  assert.fail(`total is wrong in ${fileURLToPath(import.meta.url)} after 12ms`)', [
        "import { fileURLToPath } from 'node:url'",
      ]),
      {
        seen_today: true,
        observed,
        key_line: keyLine,
        base_commit: [{ repository: 'api', commit: git(api, 'rev-parse', 'HEAD').trim() }],
      },
    )

  test('a bug scenario whose key line is found again after normalising colours, paths and durations matches', async () => {
    const line = "error: 'total is wrong in /home/planner/acme/api/tests/export.test.mjs after 3ms'"
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': seenToday(api, `not ok 1 - the scenario holds\n  ${line}`, line),
          }))
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.red?.keyLineMatched).toBe(true)
  })

  test('a different key line gives the decision need with both outputs, and only the covering tasks are blocked', async () => {
    const line = "error: 'rounding is off by a cent'"
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': seenToday(api, `not ok 1 - the scenario holds\n  ${line}`, line),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          return {
            need,
            proof: yield* proofOf(mission.id, 'R1.S2'),
            view: yield* buildingNow(mission.id),
            events: yield* payloadsOf(mission.id, 'building.red_mismatch'),
          }
        }),
      ),
    )
    const fields = seen.need.fields
    const question = Predicate.isTagged(fields, 'Decision') ? fields.question : ''
    expect(question).toContain('rounding is off by a cent')
    expect(question).toContain('total is wrong in')
    expect(seen.proof.state).toBe('held')
    expect(seen.events).toEqual([{ scenario: 'R1.S2' }])
    const states = Object.fromEntries(seen.view.tasks.map((task) => [task.id, task.state]))
    expect(states).toMatchObject({ T1: 'available', T2: 'blocked', T4: 'available' })
  })

  const PASSING = { 'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")) }

  test('a scenario that already passes gives the three-choice need; "cancel" cancels the mission', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => PASSING)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: CANCEL_MISSION }),
            key: 'answer-1',
          })
          yield* until(
            Effect.map(getMission(mission.id), (one) => one.stage === 'cancelled'),
            20_000,
          )
          // Its stops run with it: the Building ends as cancelled.
          yield* until(Effect.map(buildingOf(mission.id), (view) => view?.state === 'cancelled'))
          return { need, events: yield* payloadsOf(mission.id, 'building.already_passes') }
        }),
      ),
    )
    const fields = seen.need.fields
    expect(Predicate.isTagged(fields, 'Decision') ? fields.options : []).toEqual([
      'More information',
      NOT_REPRODUCIBLE,
      CANCEL_MISSION,
    ])
    expect(seen.events).toEqual([{ scenario: 'R1.S2' }])
  })

  test('a scenario that already passes, judged "not reproducible", lets its tasks go on', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => PASSING)
          const need = yield* needOf(mission.id, 'Decision')
          const before = yield* buildingNow(mission.id)
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: NOT_REPRODUCIBLE }),
            key: 'answer-1',
          })
          yield* taskIn(mission.id, 'T2', 'available')
          return {
            before: before.tasks.find((task) => task.id === 'T2')?.state,
            proof: yield* proofOf(mission.id, 'R1.S2'),
            events: yield* payloadsOf(mission.id, 'building.not_reproducible'),
          }
        }),
      ),
    )
    expect(seen.before).toBe('blocked')
    expect(seen.proof.state).toBe('not_reproducible')
    expect(seen.events).toEqual([{ scenario: 'R1.S2' }])
  })

  test('a requirement whose other automated scenarios are green is proven without its scenario set aside as not reproducible', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S1': automated(
              'tests/invoices.test.mjs',
              testFile(
                "  assert.ok(readFileSync(new URL('../invoices.ts', import.meta.url), 'utf8').includes('[1]'), 'no invoice yet')",
              ),
            ),
            ...PASSING,
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: NOT_REPRODUCIBLE }),
            key: 'answer-1',
          })
          yield* proofIn(mission.id, 'R1.S1', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          yield* builds(grantId, 'T4')
          yield* proofIn(mission.id, 'R1.S1', 'green')
          return yield* buildingNow(mission.id)
        }),
      ),
    )
    expect(seen.requirements.find((one) => one.id === 'R1')?.proven).toBe(true)
  })

  test('a task covering S3 does not start before the red of S3', async () => {
    const log = join(scratch, 's3.log')
    const release = join(scratch, 's3.release')
    const plan = PLAN.map((task) =>
      task.title === 'Document the exports' ? Object.assign({}, task, { depends_on: [] }) : task,
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(
            () => ({ 'R1.S3': automated('tests/readme.test.mjs', loggedTest(log, release)) }),
            plan,
          )
          const { grantId } = yield* builderOf(mission.id)
          yield* until(Effect.sync(() => runsIn(log) === 1))
          const early = yield* call(grantId, 'task_start', { task: 'T3' })
          const before = (yield* buildingNow(mission.id)).tasks.find(
            (task) => task.id === 'T3',
          )?.state
          writeFileSync(release, '')
          yield* proofIn(mission.id, 'R1.S3', 'red_recorded')
          yield* taskIn(mission.id, 'T3', 'available')
          return { early, before, later: yield* call(grantId, 'task_start', { task: 'T3' }) }
        }),
      ),
    )
    expect(seen.early).toContain('waits for the red of R1.S3')
    expect(seen.before).not.toBe('available')
    expect(seen.later).not.toContain('refused')
  })
})

describe('A Go red read against the module its go.mod names (#462)', () => {
  test('a red of package example.com/m/internal/pkg is not the red of a test file at pkg/', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': goModuleProof(api, 'pkg/saves_test.go'),
          }))
          yield* deliveredTo(mission.id, 'Fix the setup')
          return {
            proof: yield* proofsOf(mission.id),
            events: yield* payloadsOf(mission.id, 'building.red_invalid'),
          }
        }),
      ),
    )
    const s2 = seen.proof.scenarios.find((one) => one.scenario === 'R1.S2')
    expect(s2?.state).toBe('waiting_red')
    expect(s2?.runs.map((one) => one.classification)).toEqual(['assertion_failed'])
    expect(seen.events).toEqual([{ scenario: 'R1.S2', classification: 'assertion_failed' }])
  })

  test('a go.mod changed between the end of the run and its judgement is not read: the module the run ran under decides', async () => {
    const ran = Deferred.makeUnsafe<void>()
    const changed = Deferred.makeUnsafe<void>()
    const hold: BuilderHold = (point) =>
      point === 'red-ran'
        ? Effect.andThen(Deferred.succeed(ran, undefined), Deferred.await(changed))
        : Effect.void
    const seen = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': goModuleProof(api, 'pkg/saves_test.go'),
          }))
          yield* Deferred.await(ran)
          // A write once the run's locks are released: the printed package would now be the file's.
          writeFileSync(join(yield* apiOf(mission.id), 'go.mod'), 'module example.com/m/internal\n')
          yield* Deferred.succeed(changed, undefined)
          yield* deliveredTo(mission.id, 'Fix the setup')
          return {
            proof: yield* proofsOf(mission.id),
            events: yield* payloadsOf(mission.id, 'building.red_invalid'),
          }
        }),
      ),
    )
    const s2 = seen.proof.scenarios.find((one) => one.scenario === 'R1.S2')
    expect(s2?.state).toBe('waiting_red')
    expect(seen.events).toEqual([{ scenario: 'R1.S2', classification: 'assertion_failed' }])
  })

  test('the same red is the red of a test file at internal/pkg', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith((api) => ({
            'R1.S2': goModuleProof(api, 'internal/pkg/saves_test.go'),
          }))
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.red).toMatchObject({
      classification: 'assertion_failed',
      testPath: 'api/internal/pkg/saves_test.go',
    })
  })
})

describe('A restart in the middle of the red phase', () => {
  test('a restart in the middle of the red phase keeps the reds recorded and runs the others', async () => {
    const s1 = join(scratch, 's1.log')
    const s2 = join(scratch, 's2.log')
    const release = join(scratch, 's2.release')
    const proofs = () => ({
      'R1.S1': automated('tests/csv.test.mjs', loggedTest(s1)),
      'R1.S2': automated(EXPORT_PATH, loggedTest(s2, release)),
    })
    const first = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(proofs)
          yield* proofIn(mission.id, 'R1.S1', 'red_recorded')
          yield* until(Effect.sync(() => runsIn(s2) === 1))
          return { mission }
        }),
      ),
    )
    writeFileSync(release, '')
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* proofIn(first.mission.id, 'R1.S2', 'red_recorded')
          return yield* proofsOf(first.mission.id)
        }),
      ),
    )
    expect(runsIn(s1)).toBe(1)
    expect(runsIn(s2)).toBe(2)
    const runs = (scenario: string) =>
      seen.scenarios.find((one) => one.scenario === scenario)?.runs.map((one) => one.phase)
    expect(runs('R1.S1')).toEqual(['red'])
    expect(runs('R1.S2')).toEqual(['red'])
  })
})

describe('What the reviewers see of the red phase', () => {
  test('the Builder’s writes outside the proof files before a scenario’s red are recorded for the reviewers', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // R1.S2 already passes: it waits for its red on the user's answer, its file lock free.
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* writes(grantId, 'invoices.ts', 'export const invoices = [1]\n')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: NOT_REPRODUCIBLE }),
            key: 'answer-1',
          })
          yield* proofIn(mission.id, 'R1.S2', 'not_reproducible')
          yield* writes(grantId, 'README.md', 'Acme api, once nothing waits for a red\n')
          return yield* proofsOf(mission.id)
        }),
      ),
    )
    expect(
      seen.writtenBeforeRed.map((one) => [one.repository, one.path, one.task, one.scenarios]),
    ).toEqual([['api', 'invoices.ts', 'T1', ['R1.S2']]])
  })

  test('a green held on its environment is no red to wait for: the Builder’s writes meanwhile are not recorded as written before it', async () => {
    let proofCommand = ''
    let held = false
    const seen = await proofsEngine(data, undefined, undefined, undefined, {
      proofMinute: Duration.seconds(2),
    }).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                yield* setProofLimit(projectId, 1)
                const saved = yield* saveCommand({
                  projectId,
                  id: null,
                  command: {
                    name: 'export proof',
                    type: 'script',
                    line: testLine(`api/${EXPORT_PATH}`),
                    lineWindows: null,
                    lineLinux: null,
                    repositoryId: null,
                    folder: null,
                    scope: 'workspace',
                    portless: false,
                    portlessName: null,
                    check: false,
                    atOpen: false,
                    askBeforeRunning: false,
                    readOnly: false,
                    writeGlobs: [],
                  },
                })
                proofCommand = saved.id
                // Free for the red; from the green on, another mission's service holds the port.
                const runs = yield* Runs
                const real = runs.reservations.current
                runs.reservations.current = {
                  enter: (run) =>
                    run.commandId === proofCommand && held
                      ? Effect.succeed({ names: ['the dev port'], wait: () => Effect.never })
                      : real.enter(run),
                }
              }),
            undefined,
            undefined,
            undefined,
            undefined,
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST, {
                test: {
                  repository: 'api',
                  path: EXPORT_PATH,
                  code: EXPORT_TEST,
                  insertion: 'new_file',
                  command: proofCommand,
                },
              }),
            }),
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          held = true
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* needOf(mission.id, 'Environment')
          const waiting = (yield* proofOf(mission.id, 'R1.S2')).state
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* writes(grantId, 'invoices.ts', 'export const invoices = [1]\n')
          return { waiting, view: yield* proofsOf(mission.id) }
        }),
      ),
    )
    expect(seen.waiting).toBe('held')
    expect(seen.view.writtenBeforeRed).toEqual([])
  })

  test('the detector of changes outside Hemera does not report Hemera’s proof writes', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(exportProof)
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          yield* OutsideChanges.use((outside) => outside.compare(mission.id, null))
          return yield* OutsideChanges.use((outside) => outside.list(mission.id))
        }),
      ),
    )
    expect(seen.flatMap((repository) => repository.changes.map((one) => one.path))).toEqual([])
  })

  test('the ready set says why: T3 waits for the red of R1.S3', async () => {
    const log = join(scratch, 's3.log')
    const release = join(scratch, 's3.release')
    const plan = PLAN.map((task) =>
      task.title === 'Document the exports' ? Object.assign({}, task, { depends_on: [] }) : task,
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // R1.S2's red lets T2 on, which is delivered while R1.S3's red still runs.
          const { mission } = yield* launchedWith(
            () => ({
              'R1.S2': automated(EXPORT_PATH, EXPORT_TEST),
              'R1.S3': automated('tests/readme.test.mjs', loggedTest(log, release)),
            }),
            plan,
          )
          yield* until(Effect.sync(() => runsIn(log) === 1))
          const delivered = yield* deliveredTo(mission.id, 'T3 waits for the red of R1.S3')
          const view = yield* buildingNow(mission.id)
          writeFileSync(release, '')
          return { delivered, t3: view.tasks.find((task) => task.id === 'T3') }
        }),
      ),
    )
    expect(seen.delivered).toContain('T3 waits for the red of R1.S3')
    expect(seen.t3?.waiting).toBe('waits for the red of R1.S3')
  })
})

describe('What the user answers on a red', () => {
  const line = "error: 'rounding is off by a cent'"
  const mismatch = (api: string) => ({
    'R1.S2': automated(
      EXPORT_PATH,
      testFile('  assert.fail(`total is wrong in ${fileURLToPath(import.meta.url)} after 12ms`)', [
        "import { fileURLToPath } from 'node:url'",
      ]),
      {
        seen_today: true,
        observed: `not ok 1 - the scenario holds\n  ${line}`,
        key_line: line,
        base_commit: [{ repository: 'api', commit: git(api, 'rev-parse', 'HEAD').trim() }],
      },
    ),
  })

  test('"accept this red" records it and lets the covering tasks on', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: ACCEPT_RED }),
            key: 'answer-1',
          })
          yield* taskIn(mission.id, 'T2', 'available')
          return yield* proofOf(mission.id, 'R1.S2')
        }),
      ),
    )
    expect(seen.state).toBe('red_recorded')
    expect(seen.red?.keyLineMatched).toBe(false)
  })

  test('"send it back" opens an attempt for the Builder with both outputs', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          const delivered = yield* deliveredTo(mission.id, 'the user sent this red back')
          return {
            delivered,
            attempts: yield* proofAttemptsOf('R1.S2'),
            proof: yield* proofOf(mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(seen.delivered).toContain('rounding is off by a cent')
    expect(seen.delivered).toContain('total is wrong in')
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['red'])
    expect(seen.proof.state).toBe('waiting_red')
  })

  test('"more information" is delivered to the Builder', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: WrittenAnswer.make({ text: 'It fails on the March invoices only.' }),
            key: 'answer-1',
          })
          return {
            // The answer itself is kept for the Builder as it is applied; what it means comes next.
            delivered: yield* deliveredTo(
              mission.id,
              'R1.S2 already passes, and the user says more',
            ),
            proof: yield* proofOf(mission.id, 'R1.S2'),
          }
        }),
      ),
    )
    expect(seen.delivered).toContain(
      'R1.S2 already passes, and the user says more: It fails on the March invoices only.',
    )
    expect(seen.proof.state).toBe('waiting_red')
  })

  /** The engine stopped once an answer is applied, its follower not past it. */
  const stoppedOnAnswer = () => {
    const answering = holdOnce('answering')
    const hold: BuilderHold = (at) =>
      at === 'answering' ? Effect.andThen(answering.hold(at), Effect.never) : Effect.void
    return { answering, hold }
  }

  /** Once the start acted on the answer, or asked the user again. */
  const actedOrAsked = (missionId: string, acted: Effect.Effect<boolean, unknown, Database>) =>
    until(
      Effect.gen(function* () {
        if (yield* acted) return true
        const mission = yield* getMission(missionId)
        return mission.needs.some((need) => Predicate.isTagged(need.fields, 'Decision'))
      }),
    )

  test('"send it back" answered right before a stop opens the attempt with both outputs after the start, and asks nothing again', async () => {
    const stop = stoppedOnAnswer()
    const first = await proofsEngine(data, stop.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          yield* Deferred.await(stop.answering.reached)
          return { mission }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* actedOrAsked(
            first.mission.id,
            Effect.map(proofAttemptsOf('R1.S2'), (rows) => rows.length > 0),
          )
          return {
            attempts: yield* proofAttemptsOf('R1.S2'),
            mission: yield* getMission(first.mission.id),
            delivered: yield* deliveredTo(first.mission.id, 'the user sent this red back'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['red'])
    expect(seen.mission.needs).toEqual([])
    expect(seen.delivered).toContain('total is wrong in')
    expect(seen.unmoved).toEqual([])
  })

  test('"send it back" answered a second time right before a stop opens its own attempt after the start, and asks nothing again', async () => {
    const stop = stoppedOnAnswer()
    let stopping = false
    const hold: BuilderHold = (at) => (stopping ? stop.hold(at) : Effect.void)
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const once = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: once.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          yield* deliveredTo(mission.id, 'the user sent this red back')
          // The Builder runs the proof again: the same red, asked about again.
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          const pendingDecision = Effect.map(getMission(mission.id), (one) =>
            one.needs.find((need) => Predicate.isTagged(need.fields, 'Decision')),
          )
          yield* until(Effect.map(pendingDecision, (found) => found !== undefined))
          const twice = yield* pendingDecision
          if (twice === undefined) return yield* Effect.die(new Error('not asked again'))
          stopping = true
          yield* answerNeed({
            id: twice.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-2',
          })
          yield* Deferred.await(stop.answering.reached)
          return { mission, before: yield* proofAttemptsOf('R1.S2') }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* actedOrAsked(
            first.mission.id,
            Effect.map(proofAttemptsOf('R1.S2'), (rows) => rows.length > first.before.length),
          )
          return {
            attempts: yield* proofAttemptsOf('R1.S2'),
            mission: yield* getMission(first.mission.id),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.attempts).toHaveLength(first.before.length + 1)
    expect(seen.attempts.at(-1)?.verdict).toBe('red')
    expect(seen.mission.needs).toEqual([])
    expect(seen.unmoved).toEqual([])
  })

  test('"more information" answered right before a stop reaches the Builder after the start', async () => {
    const stop = stoppedOnAnswer()
    const first = await proofsEngine(data, stop.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: WrittenAnswer.make({ text: 'It fails on the March invoices only.' }),
            key: 'answer-1',
          })
          yield* Deferred.await(stop.answering.reached)
          return { mission }
        }),
      ),
    )
    const told = 'R1.S2 already passes, and the user says more'
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const database = yield* Database
          const bodies = Effect.map(
            database
              .select({ body: sessionDeliveries.body })
              .from(sessionDeliveries)
              .where(eq(sessionDeliveries.ownerId, first.mission.id)),
            (rows) => rows.map((row) => row.body).join('\n'),
          )
          yield* actedOrAsked(
            first.mission.id,
            Effect.map(bodies, (all) => all.includes(told)),
          )
          return { bodies: yield* bodies, unmoved: yield* unmovedOf(first.mission.id) }
        }),
      ),
    )
    expect(seen.bodies).toContain(`${told}: It fails on the March invoices only.`)
    expect(seen.unmoved).toEqual([])
  })

  test('"cancel the mission" answered right before a stop cancels the mission and its Building after the start', async () => {
    const stop = stoppedOnAnswer()
    const first = await proofsEngine(data, stop.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: CANCEL_MISSION }),
            key: 'answer-1',
          })
          yield* Deferred.await(stop.answering.reached)
          return { mission }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          // The cancel's stops run after its transaction: both are waited for.
          yield* until(
            Effect.map(
              Effect.all([buildingOf(first.mission.id), getMission(first.mission.id)]),
              ([view, mission]) => view?.state === 'cancelled' && mission.unstopped.length === 0,
            ),
          )
          return {
            mission: yield* getMission(first.mission.id),
            building: yield* buildingOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.mission.stage).toBe('cancelled')
    expect(seen.mission.unstopped).toEqual([])
    expect(seen.building?.state).toBe('cancelled')
  })

  test('"cancel the mission" answered, then a stop before its hand-over: after the start the mission and its Building are cancelled, and no proof runs first', async () => {
    const handing = Deferred.makeUnsafe<void>()
    const runsOfMission = (missionId: string) =>
      Effect.gen(function* () {
        const database = yield* Database
        return yield* database
          .select()
          .from(commandRuns)
          .where(eq(commandRuns.missionId, missionId))
      })
    const first = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          // Another round of answers holds the hand-over: this one is answered, not handed yet.
          const owners = yield* NeedOwners
          yield* Semaphore.withPermits(
            owners.delivering,
            1,
          )(Deferred.await(handing)).pipe(Effect.forkChild)
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: CANCEL_MISSION }),
            key: 'answer-1',
          }).pipe(Effect.forkChild)
          yield* until(Effect.map(getNeed(need.id), (one) => one.state === 'answered'))
          return {
            mission,
            stage: (yield* getMission(mission.id)).stage,
            runs: (yield* runsOfMission(mission.id)).length,
          }
        }),
      ),
    )
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(
              getMission(first.mission.id),
              (one) => one.stage === 'cancelled' && one.unstopped.length === 0,
            ),
          )
          return {
            building: yield* buildingOf(first.mission.id),
            runs: (yield* runsOfMission(first.mission.id)).length,
          }
        }),
      ),
    )
    expect(first.stage).toBe('building')
    expect(seen.building?.state).toBe('cancelled')
    expect(seen.runs).toBe(first.runs)
  })

  test('"more information" told to the Builder, then a stop before its proof_run: after the start the proof waits for the Builder, and nothing is asked again', async () => {
    const first = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile("  assert.equal(1, 1, 'it passes')")),
          }))
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: WrittenAnswer.make({ text: 'It fails on the March invoices only.' }),
            key: 'answer-1',
          })
          yield* deliveredTo(mission.id, 'R1.S2 already passes, and the user says more')
          return { mission, runs: (yield* proofOf(mission.id, 'R1.S2')).runs.length }
        }),
      ),
    )
    const start = redsRun()
    const seen = await proofsEngine(data, start.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Deferred.await(start.over)
          return {
            mission: yield* getMission(first.mission.id),
            proof: yield* proofOf(first.mission.id, 'R1.S2'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.mission.needs).toEqual([])
    expect(seen.proof.state).toBe('waiting_red')
    expect(seen.proof.runs).toHaveLength(first.runs)
    expect(seen.unmoved).toEqual([])
  })

  test('"send it back" whose attempt is opened right before a stop, the Builder not told yet: after the start the Builder is told, and nothing is asked again', async () => {
    const telling = holdOnce('telling')
    const hold: BuilderHold = (at) =>
      at === 'telling' ? Effect.andThen(telling.hold(at), Effect.never) : Effect.void
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(mismatch)
          const need = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: need.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          yield* Deferred.await(telling.reached)
          return { mission }
        }),
      ),
    )
    const start = redsRun()
    const seen = await proofsEngine(data, start.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Deferred.await(start.over)
          return {
            mission: yield* getMission(first.mission.id),
            delivered: yield* deliveriesOf(first.mission.id),
            attempts: yield* proofAttemptsOf('R1.S2'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.delivered).toContain('the user sent this red back')
    expect(seen.delivered).toContain('total is wrong in')
    expect(seen.attempts.map((one) => one.verdict)).toEqual(['red'])
    expect(seen.mission.needs).toEqual([])
    expect(seen.unmoved).toEqual([])
  })

  test('a third red of a proof opened right before a stop, its need not raised yet: after the start the user is asked', async () => {
    let tellings = 0
    const third = Deferred.makeUnsafe<void>()
    const hold: BuilderHold = (at) =>
      at === 'telling' && ++tellings === 3
        ? Effect.andThen(Deferred.succeed(third, undefined), Effect.never)
        : Effect.void
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(() => ({
            'R1.S2': automated(EXPORT_PATH, testFile('  const = 1')),
          }))
          yield* deliveredTo(mission.id, 'Fix the setup')
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          yield* Effect.forkChild(call(grantId, 'proof_run', { scenario: 'R1.S2' }))
          yield* Deferred.await(third)
          return { mission }
        }),
      ),
    )
    const start = redsRun()
    const seen = await proofsEngine(data, start.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Deferred.await(start.over)
          return {
            mission: yield* getMission(first.mission.id),
            attempts: yield* proofAttemptsOf('R1.S2'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(seen.attempts).toHaveLength(3)
    expect(seen.mission.needs).toHaveLength(1)
    expect(
      seen.mission.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
    ).toHaveLength(1)
    expect(seen.unmoved).toEqual([])
  })

  test('a Retry of the Builder’s environment need after a red sent back, stopped before its follower: after the start the red runs again', async () => {
    const port = await closedPort()
    const log = join(scratch, 'runs.log')
    // The red unlike Planning's, then the Builder's run kept from running, then that red again.
    const spec = (api: string) => ({
      'R1.S2': automated(
        EXPORT_PATH,
        testFile(
          [
            `  appendFileSync(${JSON.stringify(log)}, 'ran\\n')`,
            `  if (readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length === 2)`,
            `    await new Promise((done, fail) => connect(${String(port)}, '127.0.0.1').on('connect', done).on('error', fail))`,
            '  assert.fail(`total is wrong in ${fileURLToPath(import.meta.url)} after 12ms`)',
          ].join('\n'),
          ["import { connect } from 'node:net'", "import { fileURLToPath } from 'node:url'"],
        ),
        {
          seen_today: true,
          observed: `not ok 1 - the scenario holds\n  ${line}`,
          key_line: line,
          base_commit: [{ repository: 'api', commit: git(api, 'rev-parse', 'HEAD').trim() }],
        },
      ),
    })
    const releasing = holdOnce('releasing')
    let stopping = false
    const hold: BuilderHold = (at) =>
      stopping && at === 'releasing'
        ? Effect.andThen(releasing.hold(at), Effect.never)
        : Effect.void
    const first = await proofsEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launchedWith(spec)
          const asked = yield* needOf(mission.id, 'Decision')
          yield* answerNeed({
            id: asked.id,
            answer: ChosenAnswer.make({ option: SEND_BACK }),
            key: 'answer-1',
          })
          yield* deliveredTo(mission.id, 'the user sent this red back')
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'proof_run', { scenario: 'R1.S2' })
          const need = yield* needOf(mission.id, 'Environment')
          stopping = true
          yield* retryNeed(need.id)
          yield* Deferred.await(releasing.reached)
          return { mission }
        }),
      ),
    )
    const start = redsRun()
    const seen = await proofsEngine(data, start.hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* Deferred.await(start.over)
          return {
            proof: yield* proofOf(first.mission.id, 'R1.S2'),
            unmoved: yield* unmovedOf(first.mission.id),
          }
        }),
      ),
    )
    expect(runsIn(log)).toBe(3)
    expect(seen.proof.state).toBe('held')
    expect(seen.unmoved).toEqual([])
  })

  test('touched names the proofs and the final checks whose repository changed', async () => {
    const seen = await proofsEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.asVoid(
                saveCheck(projectId, null, {
                  name: 'build',
                  commandId: null,
                  line: `"${process.execPath}" --version`,
                  where: 'root',
                  repository: null,
                  when: 'end',
                  expect: null,
                  files: null,
                }),
              ),
            undefined,
            undefined,
            undefined,
            undefined,
            exportProof,
          )
          yield* proofIn(mission.id, 'R1.S2', 'red_recorded')
          const { grantId } = yield* builderOf(mission.id)
          yield* builds(grantId, 'T2', [['export.ts', RIGHT_EXPORT]])
          yield* proofIn(mission.id, 'R1.S2', 'green')
          yield* BuildDesk.use((desk) => desk.judgeScope(mission.id, 'end', null))
          const untouched = yield* BuildDesk.use((desk) => desk.touchedProofs(mission.id, ['api']))
          yield* builds(grantId, 'T1', [['invoices.ts', 'export const invoices = [1]\n']])
          return {
            untouched,
            api: yield* BuildDesk.use((desk) => desk.touchedProofs(mission.id, ['api'])),
            web: yield* BuildDesk.use((desk) => desk.touchedProofs(mission.id, ['web'])),
          }
        }),
      ),
    )
    expect(seen.untouched).toEqual({ proofs: [], checks: [] })
    expect(seen.api).toEqual({ proofs: ['R1.S2'], checks: ['build'] })
    expect(seen.web).toEqual({ proofs: [], checks: [] })
  })
})
