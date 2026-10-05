/**
 * Real repositories for the suites about Git and Projects, made with the machine's `git`.
 *
 * A fake Git would be testing the fake: what these suites prove is what the user's own `git`
 * does. A remote is a bare repository on the same disk, so nothing a suite does reaches a network.
 */

import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

/** Runs the machine's `git` in a folder and answers what it printed, trimmed. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      // Whatever the machine's own configuration says, a suite's commit is plain and unsigned.
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
}

const execFileAsync = promisify(execFile)

/** The same as `git`, without holding the thread: several can run side by side. */
export async function gitAsync(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  )
  return stdout.trim()
}

/** `repository` then `remote`, side by side with others: on Windows each `git` is a process start. */
export async function repositoryWithRemote(
  path: string,
  branch: string,
  remotePath: string,
): Promise<string> {
  mkdirSync(path, { recursive: true })
  mkdirSync(remotePath, { recursive: true })
  await Promise.all([
    gitAsync(path, 'init', '-q', '-b', branch).then(() =>
      gitAsync(path, 'commit', '-q', '--allow-empty', '-m', 'base'),
    ),
    gitAsync(remotePath, 'init', '-q', '--bare'),
  ])
  await gitAsync(path, 'remote', 'add', 'origin', remotePath)
  await gitAsync(path, 'push', '-q', 'origin', '--all')
  await gitAsync(path, 'fetch', '-q', 'origin')
  return path
}

/** A repository with one empty commit on `branch`, at `path`, made with every folder above it. */
export function repository(path: string, branch = 'trunk'): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', branch)
  git(path, 'commit', '-q', '--allow-empty', '-m', 'base')
  return path
}

/** A bare repository at `path` holding what `from` has, added to `from` as the remote `name`. */
export function remote(from: string, path: string, name = 'origin'): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '--bare')
  git(from, 'remote', 'add', name, path)
  git(from, 'push', '-q', name, '--all')
  git(from, 'fetch', '-q', name)
  return path
}

/** A commit made on `branch` of the bare `remote` by someone else, from a clone of its own. */
export function commitOnRemote(remotePath: string, branch: string, scratch: string): string {
  const clone = join(scratch, `clone-${String(Date.now())}`)
  git(scratch, 'clone', '-q', '-b', branch, remotePath, clone)
  writeFileSync(join(clone, 'theirs.txt'), `${String(Date.now())}\n`)
  git(clone, 'add', 'theirs.txt')
  git(clone, 'commit', '-q', '-m', 'theirs')
  git(clone, 'push', '-q', 'origin', branch)
  return git(clone, 'rev-parse', 'HEAD')
}

/** A folder whose `.git` points nowhere: a repository Git cannot read. */
export function corrupted(path: string): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, '.git'), 'gitdir: /nowhere/hemera\n')
  return path
}
