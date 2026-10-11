/**
 * A fake `gh` for the ticket suites: a Node script run by `process.execPath`, never a real `gh` and
 * never a real GitHub. Each call is written down (its arguments, the environment variables `gh`
 * reads, what came on its standard input, its pid) as one JSON line, then answered by the first
 * rule whose words all appear in its arguments: a fixture's output and exit code, or a hang.
 *
 * A rule may also answer a grouped `changedSince` query: one alias per issue the query names, each
 * with the update date the rule gives.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { GhSettings } from '../src/engine/tickets/gh.ts'
import { temporaryFolder } from './storage.ts'

export interface GhRule {
  /** Every word must appear in one of the arguments. */
  readonly when: ReadonlyArray<string>
  /** Only for calls made for this host (`GH_HOST`). */
  readonly host?: string
  readonly stdout?: string
  readonly stderr?: string
  readonly code?: number
  /** Never answers: the call is cut at its limit. */
  readonly hang?: boolean
  /** Answers each `iN` alias of a grouped query with this update date. */
  readonly aliasesUpdatedAt?: string
  /** Answers these aliases as not found. */
  readonly missing?: ReadonlyArray<string>
  /** Answers only this many calls, then lets the next rules answer. */
  readonly times?: number
}

export interface GhCall {
  readonly args: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string | null>>
  readonly stdin: string
  readonly pid: number
}

/** The environment variables a call records. */
export const RECORDED_ENV = [
  'GH_CONFIG_DIR',
  'GH_HOST',
  'GH_PROMPT_DISABLED',
  'GH_NO_UPDATE_NOTIFIER',
  'NO_COLOR',
  'GH_TOKEN',
  'GITHUB_TOKEN',
] as const

const FAKE = `
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const rules = JSON.parse(readFileSync(process.env.FAKE_GH_RULES, 'utf8'))
const env = {}
for (const name of ${JSON.stringify(RECORDED_ENV)}) env[name] = process.env[name] ?? null
let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { stdin += chunk })
process.stdin.on('end', () => {
  appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, env, stdin, pid: process.pid }) + '\\n')
  const used = JSON.parse(readFileSync(process.env.FAKE_GH_USED, 'utf8'))
  const index = rules.findIndex((one, at) =>
    (one.host === undefined || one.host === process.env.GH_HOST) &&
    (one.times === undefined || (used[at] ?? 0) < one.times) &&
    one.when.every((word) => args.some((arg) => arg.includes(word))))
  const rule = index < 0 ? undefined : rules[index]
  // Only a counted rule writes its count, replaced whole: a call at once never reads it half written.
  if (rule?.times !== undefined) {
    used[index] = (used[index] ?? 0) + 1
    const next = process.env.FAKE_GH_USED + '.' + process.pid
    writeFileSync(next, JSON.stringify(used))
    renameSync(next, process.env.FAKE_GH_USED)
  }
  if (rule === undefined) {
    process.stderr.write('fake gh: no rule for ' + args.join(' ') + '\\n')
    process.exit(1)
  }
  if (rule.hang) { setInterval(() => {}, 1000); return }
  let out = rule.stdout ?? ''
  if (rule.aliasesUpdatedAt !== undefined) {
    const data = {}
    const errors = []
    for (const arg of args) {
      const match = /^n(\\d+)=/.exec(arg)
      if (match === null) continue
      const alias = 'i' + match[1]
      if ((rule.missing ?? []).includes(alias)) {
        data[alias] = { issue: null }
        errors.push({ type: 'NOT_FOUND', path: [alias, 'issue'], message: 'Could not resolve to an Issue with the number of ' + alias + '.' })
      } else data[alias] = { issue: { updatedAt: rule.aliasesUpdatedAt } }
    }
    out = 'HTTP/2.0 200 OK\\nContent-Type: application/json\\n\\n' + JSON.stringify(errors.length === 0 ? { data } : { data, errors })
  }
  process.stdout.write(out)
  if (rule.stderr) process.stderr.write(rule.stderr)
  process.exit(rule.code ?? 0)
})
`

export interface FakeGh {
  readonly settings: GhSettings
  /** Every call so far, in order. */
  readonly calls: () => ReadonlyArray<GhCall>
  /** Replaces the rules. */
  readonly answer: (rules: ReadonlyArray<GhRule>) => void
}

/**
 * A fake `gh` in a folder of its own. `env` is the environment the engine would have been started
 * with: the user's own `GH_CONFIG_DIR` among it.
 */
export function fakeGh(
  rules: ReadonlyArray<GhRule>,
  options: { readonly env?: Readonly<Record<string, string>>; readonly limitMillis?: number } = {},
): FakeGh {
  const folder = temporaryFolder('fake-gh')
  const script = join(folder, 'gh.mjs')
  const rulesFile = join(folder, 'rules.json')
  const log = join(folder, 'calls.jsonl')
  const used = join(folder, 'used.json')
  writeFileSync(script, FAKE)
  writeFileSync(rulesFile, JSON.stringify(rules))
  writeFileSync(log, '')
  writeFileSync(used, '{}')
  return {
    settings: {
      program: { command: process.execPath, leading: [script] },
      env: {
        PATH: process.env['PATH'] ?? '',
        SYSTEMROOT: process.env['SYSTEMROOT'] ?? '',
        FAKE_GH_RULES: rulesFile,
        FAKE_GH_LOG: log,
        FAKE_GH_USED: used,
        ...options.env,
      },
      limitMillis: options.limitMillis,
    },
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
          // SAFETY: each line is the JSON the fake script above writes, one GhCall per line.
          const call = JSON.parse(line) as GhCall
          return call
        }),
    answer: (next) => {
      writeFileSync(rulesFile, JSON.stringify(next))
      writeFileSync(used, '{}')
    },
  }
}

/** A `gh api --include` answer: a status line, headers, a blank line, then the body. */
export const included = (
  body: string,
  status = 'HTTP/2.0 200 OK',
  headers: Readonly<Record<string, string>> = {},
): string =>
  [
    status,
    'Content-Type: application/json; charset=utf-8',
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    body,
  ].join('\n')
