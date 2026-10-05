/**
 * The command tools through the gate: a catalogue command or a line runs through the run service,
 * with its intent written before it starts and its outcome when it ends; a line with shell syntax
 * is refused with its clear error; a run that outlasts its timeout keeps going and is read with
 * `commands_output`; and a session reads or stops only the runs of its own mission.
 */

import { realpathSync } from 'node:fs'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { listActions } from '../src/engine/tools/actions.ts'
import { createMission } from '../src/engine/missions.ts'
import { STAYS_UP, commandsEngine, nodeLine, script, until } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { ALLOW, acmeWithMission, callTool, sessionOf, verdictsSaying } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('tool-commands'))
  work = realpathSync.native(temporaryFolder('tool-commands-work'))
})
afterEach(removeFolders)

const engine = () =>
  commandsEngine(data, { tools: { verdicts: verdictsSaying(() => ALLOW).layer } })

const runIdIn = (text: string): string => /^run (\S+):/.exec(text)?.[1] ?? ''

describe('A command runs through the run service, with its intent and its outcome', () => {
  test('a short line answers with its exit code and the end of its output', async () => {
    const says = script('console.log("built in 1s")\nprocess.exit(0)\n')
    const [answer, actions] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const chat = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const ran = yield* callTool(chat.grantId, 'commands_run', { line: nodeLine(says) })
          const settled = yield* until(listActions(), (seen) =>
            seen.every((action) => action.state !== 'started'),
          )
          return [ran, settled] as const
        }),
      ),
    )
    expect(answer.ok).toBe(true)
    expect(answer.text).toContain('is done')
    expect(answer.text).toContain('exit code 0')
    expect(answer.text).toContain('built in 1s')
    expect(actions).toMatchObject([
      { kind: 'command.run', state: 'done', outcome: 'done, exit code 0' },
    ])
  })

  test('a line with shell syntax is refused with a clear error, and nothing runs', async () => {
    const [answer, actions] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const ran = yield* callTool(builder.grantId, 'commands_run', {
            line: 'npm test > out.txt',
          })
          return [ran, yield* listActions()] as const
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).toMatch(/^refused: .*>/)
    expect(actions).toMatchObject([{ kind: 'command.run', state: 'failed' }])
  })

  test('a run that outlasts its timeout keeps going, is read with commands_output and stopped', async () => {
    const stays = script(`console.log('listening')\n${STAYS_UP}`)
    const [first, output, stopped] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const started = yield* callTool(builder.grantId, 'commands_run', {
            line: nodeLine(stays),
            timeout: 1,
          })
          const run = runIdIn(started.text)
          const read = yield* callTool(builder.grantId, 'commands_output', { run })
          const ended = yield* callTool(builder.grantId, 'commands_stop', { run })
          return [started, read, ended] as const
        }),
      ),
    )
    expect(first.text).toContain('it keeps going')
    expect(output.text).toContain('listening')
    expect(stopped.text).toMatch(/is stopped$/)
  })
})

describe('A session reads and stops only the runs of its own mission', () => {
  test("another mission's run is refused, whoever asks", async () => {
    const stays = script(STAYS_UP)
    const [output, stop] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, mission, main } = yield* acmeWithMission(work)
          const other = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Import the invoices', ticket: null },
          })
          const mine = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const theirs = yield* sessionOf('builder', main, { kind: 'mission', id: other.id })
          const started = yield* callTool(theirs.grantId, 'commands_run', {
            line: nodeLine(stays),
            timeout: 1,
          })
          const run = runIdIn(started.text)
          const answers = [
            yield* callTool(mine.grantId, 'commands_output', { run }),
            yield* callTool(mine.grantId, 'commands_stop', { run }),
          ] as const
          yield* callTool(theirs.grantId, 'commands_stop', { run })
          return answers
        }),
      ),
    )
    expect(output.text).toMatch(/^refused: \S+ is not a run this mission started$/)
    expect(stop.text).toMatch(/^refused: \S+ is not a run this mission started$/)
  })
})
