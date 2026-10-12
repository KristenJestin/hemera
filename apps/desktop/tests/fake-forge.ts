/**
 * A fake `gh` and a fake `bkt` for the forge suites (#253), first and alone on a `PATH` of their
 * own, in a folder whose name holds a space: never a real CLI, never a real forge.
 *
 * Each CLI is a file named as the real one (`gh`, `bkt`; `gh.cmd`, `bkt.cmd` on Windows, a shim as
 * the user's own may be) that runs one Node script. Each call is written down (which CLI, its
 * arguments, the environment variables a CLI reads its account or configuration from) as one JSON
 * line, then answered by the first rule of that CLI whose words all appear in its arguments: an
 * output, an exit code, a hang.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { temporaryFolder } from './storage.ts'

export type FakeCli = 'gh' | 'bkt'

export interface FakeRule {
  readonly cli: FakeCli
  /** Every word must appear among the arguments. */
  readonly when: ReadonlyArray<string>
  readonly stdout?: string
  readonly stderr?: string
  readonly code?: number
  /** Never answers: the call is cut at its limit. */
  readonly hang?: boolean
}

export interface FakeCall {
  readonly cli: FakeCli
  readonly args: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string | null>>
}

/** The variables a forge CLI takes a token or a configuration from: each call records them. */
export const WATCHED_ENV = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'BKT_TOKEN',
  'GH_CONFIG_DIR',
  'BKT_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  'GH_HOST',
] as const

const FAKE = `
const { appendFileSync, readFileSync } = require('node:fs')
module.exports = (cli, args) => {
  const env = {}
  for (const name of ${JSON.stringify(WATCHED_ENV)}) env[name] = process.env[name] ?? null
  appendFileSync(process.env.FAKE_FORGE_LOG, JSON.stringify({ cli, args, env }) + '\\n')
  const rules = JSON.parse(readFileSync(process.env.FAKE_FORGE_RULES, 'utf8'))
  const rule = rules.find((one) => one.cli === cli &&
    one.when.every((word) => args.some((arg) => arg.includes(word))))
  if (rule === undefined) {
    process.stderr.write('fake ' + cli + ': no rule for ' + args.join(' ') + '\\n')
    process.exit(1)
  }
  if (rule.hang) { setInterval(() => {}, 1000); return }
  process.stdout.write(rule.stdout ?? '')
  process.stderr.write(rule.stderr ?? '')
  process.exitCode = rule.code ?? 0
}
`

export interface FakeForge {
  /** The environment the engine runs the CLIs in: the fakes' `PATH`, the user's configuration. */
  readonly env: Readonly<Record<string, string>>
  /** The configuration folder the user's `gh` would read; the fakes never look at it. */
  readonly userConfig: string
  readonly calls: () => ReadonlyArray<FakeCall>
  /** Replaces the rules. */
  readonly answer: (rules: ReadonlyArray<FakeRule>) => void
}

/** The fakes, for the CLIs named (both unless told): a CLI not named is missing from the `PATH`. */
export function fakeForge(
  rules: ReadonlyArray<FakeRule>,
  clis: ReadonlyArray<FakeCli> = ['gh', 'bkt'],
): FakeForge {
  const folder = join(temporaryFolder('fake forge'), 'cli bin')
  const userConfig = temporaryFolder('user config')
  const scripts = temporaryFolder('fake-forge-scripts')
  const fake = join(scripts, 'fake.cjs')
  const rulesFile = join(scripts, 'rules.json')
  const log = join(scripts, 'calls.jsonl')
  writeFileSync(fake, FAKE)
  writeFileSync(rulesFile, JSON.stringify(rules))
  writeFileSync(log, '')
  mkdirSync(folder)
  for (const cli of clis) {
    if (process.platform === 'win32') {
      writeFileSync(
        join(folder, `${cli}.cmd`),
        `@"${process.execPath}" "${join(scripts, `${cli}.cjs`)}" %*\r\n`,
      )
      writeFileSync(
        join(scripts, `${cli}.cjs`),
        `require(${JSON.stringify(fake)})(${JSON.stringify(cli)}, process.argv.slice(2))\n`,
      )
    } else {
      const file = join(folder, cli)
      writeFileSync(
        file,
        `#!${process.execPath}\nrequire(${JSON.stringify(fake)})(${JSON.stringify(cli)}, process.argv.slice(2))\n`,
      )
      chmodSync(file, 0o755)
    }
  }
  const env: FakeForge['env'] & Record<string, string> = {
    PATH: folder,
    GH_CONFIG_DIR: userConfig,
    XDG_CONFIG_HOME: userConfig,
    FAKE_FORGE_RULES: rulesFile,
    FAKE_FORGE_LOG: log,
  }
  // What `cmd.exe` needs to find and run a `.cmd` shim.
  if (process.platform === 'win32') {
    env['SYSTEMROOT'] = process.env['SYSTEMROOT'] ?? ''
    env['ComSpec'] = process.env['ComSpec'] ?? 'cmd.exe'
    env['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'
  }
  return {
    env,
    userConfig,
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
          // SAFETY: each line is the JSON the fake script above writes, one FakeCall per line.
          const call = JSON.parse(line) as FakeCall
          return call
        }),
    answer: (next) => writeFileSync(rulesFile, JSON.stringify(next)),
  }
}

/** `gh` signed in on a host, at a version. */
export const ghReady = (host = 'github.com', version = '2.100.0'): ReadonlyArray<FakeRule> => [
  {
    cli: 'gh',
    when: ['--version'],
    stdout: `gh version ${version} (2026-09-30)\r\nhttps://github.com/cli/cli/releases/tag/v${version}\r\n`,
  },
  {
    cli: 'gh',
    when: ['auth', 'status', host],
    stdout: `${host}\n  ✓ Logged in to ${host} account octo (keyring)\n`,
  },
  // What `--jq .login` leaves of the user.
  { cli: 'gh', when: ['api', 'user', '.login'], stdout: 'octo\r\n' },
]

/** `gh` with no account for a host. */
export const ghSignedOut = (host = 'github.com'): ReadonlyArray<FakeRule> => [
  { cli: 'gh', when: ['--version'], stdout: 'gh version 2.100.0 (2026-09-30)\n' },
  {
    cli: 'gh',
    when: ['auth', 'status'],
    stderr: `You are not logged into any GitHub hosts. To log in, run: gh auth login\n`,
    code: 1,
  },
  { cli: 'gh', when: ['api', 'user'], stderr: 'HTTP 401: Requires authentication\n', code: 1 },
  { cli: 'gh', when: [host], stderr: 'not logged in\n', code: 1 },
]

/** Bitbucket Cloud as bkt stores it: under the API's host, whatever URL the login was given. */
export const BKT_CLOUD = { base: 'https://api.bitbucket.org/2.0', kind: 'cloud' } as const

/**
 * `bkt` signed in on these hosts, at a version, as `bkt auth status --json` prints them: each host
 * keyed by the host of its base URL, port included (`HostKeyFromURL`), indented.
 */
export const bktReady = (
  hosts: ReadonlyArray<{ readonly base: string; readonly kind: 'cloud' | 'dc' }> = [BKT_CLOUD],
): ReadonlyArray<FakeRule> => [
  { cli: 'bkt', when: ['--version'], stdout: 'bkt version 0.26.0\r\n' },
  {
    cli: 'bkt',
    when: ['auth', 'status'],
    stdout: `${JSON.stringify(
      {
        hosts: hosts.map((host) => ({
          key: new URL(host.base).host,
          kind: host.kind,
          base_url: host.base,
          username: 'octo',
          auth_method: host.kind === 'cloud' ? 'basic' : 'bearer',
          token_source: 'keyring',
        })),
        contexts: [],
      },
      null,
      2,
    ).replaceAll('\n', '\r\n')}\r\n`,
  },
]
