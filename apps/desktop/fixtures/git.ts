/**
 * The machine's `git`, made to give the same commits on every build of a fixture: one invented
 * author, a clock that starts at a fixed date and moves a minute per commit, and none of the
 * machine's own configuration (its signing, its hooks, its line endings).
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Who writes every commit of a fixture: nobody real. */
export const FIXTURE_AUTHOR = { name: 'Fixture Author', email: 'fixture@example.invalid' }

/** When the first commit of a fixture is written; each later one, a minute after the last. */
const FIRST_COMMIT = Date.parse('2026-03-02T09:00:00Z')
const MINUTE = 60_000

/** None of the machine's configuration: the same answer here as on any other machine. */
const SETTINGS = [
  '-c',
  'commit.gpgsign=false',
  '-c',
  'tag.gpgsign=false',
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.hooksPath=',
  '-c',
  'init.defaultBranch=main',
]

export interface FixtureGit {
  /** Runs `git` in a folder and answers what it printed, trimmed. */
  readonly run: (cwd: string, ...args: ReadonlyArray<string>) => string
  /** Writes the files, relative to the repository, and commits them with the message. */
  readonly commit: (
    repository: string,
    message: string,
    files: Readonly<Record<string, string>>,
  ) => string
  /** A repository at `path` on `main`, made with every folder above it. */
  readonly init: (path: string) => string
  /** A bare repository at `path` holding every branch of `from`, its remote `origin`. */
  readonly remote: (from: string, path: string) => string
}

/**
 * A Git of its own for one build: its clock starts again at the fixed date. Its global
 * configuration is an empty file in `folder`, not the null device, which Git cannot read as a
 * configuration file on Windows.
 */
export function fixtureGit(folder: string): FixtureGit {
  const configuration = join(folder, 'gitconfig')
  writeFileSync(configuration, '')
  let commits = 0
  const environment = (): NodeJS.ProcessEnv => {
    const at = new Date(FIRST_COMMIT + commits * MINUTE).toISOString()
    return {
      ...process.env,
      GIT_CONFIG_GLOBAL: configuration,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: FIXTURE_AUTHOR.name,
      GIT_AUTHOR_EMAIL: FIXTURE_AUTHOR.email,
      GIT_COMMITTER_NAME: FIXTURE_AUTHOR.name,
      GIT_COMMITTER_EMAIL: FIXTURE_AUTHOR.email,
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_DATE: at,
    }
  }
  const run = (cwd: string, ...args: ReadonlyArray<string>): string =>
    execFileSync('git', [...SETTINGS, ...args], {
      cwd,
      env: environment(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  return {
    run,
    commit: (repository, message, files) => {
      for (const [path, content] of Object.entries(files)) {
        const file = join(repository, path)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, content)
      }
      run(repository, 'add', '-A')
      run(repository, 'commit', '-q', '-m', message)
      commits += 1
      return run(repository, 'rev-parse', 'HEAD')
    },
    init: (path) => {
      mkdirSync(path, { recursive: true })
      run(path, 'init', '-q', '-b', 'main')
      return path
    },
    remote: (from, path) => {
      mkdirSync(path, { recursive: true })
      run(path, 'init', '-q', '--bare')
      run(from, 'remote', 'add', 'origin', path)
      run(from, 'push', '-q', 'origin', '--all')
      run(from, 'fetch', '-q', 'origin')
      return path
    },
  }
}
