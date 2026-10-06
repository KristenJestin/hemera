/**
 * The tester mode on the engine (#45), with the fake agent of #32: off, no paragraph and no tester
 * tool reach the agent, and a stale call is refused and writes nothing; on, a new session of any
 * role gets the paragraph once in its base layer and both tools, and an occurrence carries the
 * mission's key, the role, the stage and the call from the session's hidden thread.
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { TESTER_PARAGRAPH } from '@hemera/core/domain'
import { Effect, type Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeStep } from '../src/engine/agents/fake.ts'
import { writePreferences } from '../src/engine/preferences.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeIn, sessionsEngine, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('tester-mode'))
  work = realpathSync.native(temporaryFolder('tester-mode-work'))
})
afterEach(removeFolders)

const acme = Effect.suspend(() => acmeIn(work))

const REPORT: Schema.JsonObject = {
  title: 'fs_read answers a page past the end',
  kind: 'tool_error',
  place: 'fs_read',
  severity: 'hurts',
  trying: 'Read the end of api/README.md.',
  happened: 'The answer said the file had more to read.',
  expected: 'The end of the file said as the end.',
  steps: 'Read api/README.md, then the next page.',
  files: ['api/README.md'],
  callId: 'toolu_read',
}

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

/** A turn that reads a file, then reports a problem with that call, then lists the reports. */
const TESTING = {
  steps: [
    uses('toolu_read', 'fs_read', { path: 'api/CLAUDE.md' }),
    uses('toolu_report', 'hemera_report', REPORT),
    uses('toolu_reports', 'hemera_reports', {}),
    { does: 'says' as const, text: 'Done.' },
  ],
}

const findingsOf = (folder: string) => {
  const findings = join(folder, 'tester', 'findings')
  return existsSync(findings)
    ? readdirSync(findings).map((file) => readFileSync(join(findings, file), 'utf8'))
    : []
}

const systemPrompt = (meta: string | null | undefined): string =>
  JSON.parse(meta ?? '{}').claudeCode?.options?.systemPrompt?.prompt ?? ''

describe('The tester mode off', () => {
  test('no paragraph, no tester tool, and nothing written', async () => {
    const { world, run } = sessionsEngine(data, () => TESTING)
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', provider: 'claude', folder: main }),
          )
          yield* Sessions.use((sessions) => sessions.settled(session.id))
        }),
      ),
    )
    const agent = world.agents[0]
    expect(systemPrompt(agent?.answers.metas[0])).not.toContain('## Tester mode')
    const [, report, reports] = agent?.answers.toolAnswers ?? []
    expect(report?.text).toBe('refused: the Builder has no tool hemera_report')
    expect(reports?.text).toBe('refused: the Builder has no tool hemera_reports')
    expect(findingsOf(data)).toEqual([])
  })

  test('a call that comes once the mode is turned off is refused and writes nothing', async () => {
    const { world, run } = sessionsEngine(data, () => ({
      turns: [[{ does: 'says' as const, text: 'Ready.' }]],
      steps: [uses('toolu_report', 'hemera_report', REPORT), { does: 'says', text: 'Done.' }],
    }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* writePreferences({ testerMode: true })
          const { owner, main } = yield* acme
          const session = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', provider: 'claude', folder: main }),
          )
          yield* Sessions.use((sessions) => sessions.settled(session.id))
          yield* writePreferences({ testerMode: false })
          yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { lineage: session.lineage },
              kind: 'answers',
              body: 'Go on.',
            }),
          )
          yield* Sessions.use((sessions) => sessions.settled(session.id))
        }),
      ),
    )
    expect(world.agents[0]?.answers.toolAnswers[0]?.text).toBe(
      'refused: the tester mode is off; nothing was written',
    )
    expect(findingsOf(data)).toEqual([])
  })
})

describe('The tester mode on', () => {
  test('every role gets the paragraph once and both tools; a report carries the mission, the role, the stage and the call', async () => {
    const { world, run } = sessionsEngine(data, () => TESTING)
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* writePreferences({ testerMode: true })
          const { owner, main } = yield* acme
          for (const role of ['builder', 'code-reviewer']) {
            const session = yield* Sessions.use((sessions) =>
              sessions.open({ owner, role, provider: 'claude', folder: main }),
            )
            yield* Sessions.use((sessions) => sessions.settled(session.id))
          }
        }),
      ),
    )
    for (const agent of world.agents) {
      const prompt = systemPrompt(agent.answers.metas[0])
      expect(prompt.split('## Tester mode')).toHaveLength(2)
      expect(prompt).toContain(TESTER_PARAGRAPH)
    }
    const [builder, reviewer] = world.agents
    expect(builder?.answers.toolAnswers[1]?.text).toMatch(/^Recorded as #1: fs_read answers/)
    expect(reviewer?.answers.toolAnswers[1]?.text).toMatch(
      /^Recorded as one more occurrence of #1 \(2 now\)/,
    )
    expect(builder?.answers.toolAnswers[2]?.text).toContain(
      '#1 · fs_read answers a page past the end',
    )
    const [finding] = findingsOf(data)
    expect(finding).toContain('missions: ["ACME-1"]')
    expect(finding).toContain('roles: ["builder","code-reviewer"]')
    expect(finding).toContain('- Where: ACME-1 · role builder · stage building')
    expect(finding).toMatch(
      /- Call: `fs_read` `toolu_read` · done · \d+ ms · call 1 of the session/,
    )
    expect(readFileSync(join(data, 'tester', 'README.md'), 'utf8')).toContain(
      '1 finding · 2 occurrences',
    )
  })
})

describe('The files a report names', () => {
  test('are written relative to the place, or from ~ under the home: never a full path', async () => {
    const elsewhere = join(homedir(), 'notes', 'acme.txt')
    const { run } = sessionsEngine(data, () => ({
      steps: [
        uses('toolu_report', 'hemera_report', {
          ...REPORT,
          files: [join(work, 'acme', 'api', 'README.md'), elsewhere, 'api/package.json'],
        }),
        { does: 'says' as const, text: 'Done.' },
      ],
    }))
    const main = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* writePreferences({ testerMode: true })
          const { owner, main: folder } = yield* acme
          const session = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', provider: 'claude', folder }),
          )
          yield* Sessions.use((sessions) => sessions.settled(session.id))
          return folder
        }),
      ),
    )
    const [finding] = findingsOf(data)
    expect(finding).toContain('api/README.md')
    expect(finding).toContain('~/notes/acme.txt')
    expect(finding).toContain('api/package.json')
    expect(finding).not.toContain(main)
    expect(finding).not.toContain(homedir())
  })
})
