/**
 * Real repositories for the suites about Git and Workspaces, made with the machine's `git`.
 *
 * A fake Git would be testing the fake: what these suites prove is what the user's own `git`
 * does with a worktree, a branch and a status. Every repository is local and has no remote, so
 * nothing a suite does can reach a network.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

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

/** A repository with one empty commit on `main`, at `path`, made with every folder above it. */
export function repository(path: string): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  git(path, 'commit', '-q', '--allow-empty', '-m', 'base')
  return path
}
