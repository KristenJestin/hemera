import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  validateBranch,
  validateCommitMessage,
  validatePullRequestDescription,
} from './commit-message.ts'

const repository = resolve(import.meta.dirname, '..')

interface CommandResult {
  code: number
  output: string
}

function git(cwd: string, ...args: string[]): CommandResult {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

/** A throwaway repository carrying this repository's hooks and their validators. */
function repositoryWithHooks(): string {
  const path = mkdtempSync(join(tmpdir(), 'hemera-flow-'))
  cpSync(join(repository, '.githooks'), join(path, '.githooks'), { recursive: true })
  mkdirSync(join(path, 'tools'), { recursive: true })
  // The validators are modules: without a manifest saying so, Node has to guess the goal of
  // a file it strips the types from, and the hook fails for a reason that is not the commit.
  writeFileSync(join(path, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`)
  for (const file of ['commit-message.ts', 'branch-guard.ts']) {
    cpSync(join(repository, 'tools', file), join(path, 'tools', file))
  }
  git(path, 'init', '--initial-branch=main')
  git(path, 'config', 'user.name', 'test')
  git(path, 'config', 'user.email', 'test@example.invalid')
  git(path, 'config', 'commit.gpgsign', 'false')
  git(path, 'add', '-A')
  git(path, '-c', 'core.hooksPath=', 'commit', '-m', 'chore(repo): seed the throwaway repository')
  git(path, 'branch', 'dev')
  git(path, 'config', 'core.hooksPath', '.githooks')
  return path
}

function commit(path: string, message: string, file: string): CommandResult {
  writeFileSync(join(path, file), `${message}\n`)
  git(path, 'add', file)
  return git(path, 'commit', '-m', message)
}

// Each of these starts git and its hooks under Node: seconds on a runner that has just started,
// not the five the suite allows a test by default.
describe("Commit d'agent sur une branche protégée", { timeout: 60_000 }, () => {
  test('a commit made directly on dev is refused', () => {
    const path = repositoryWithHooks()
    try {
      git(path, 'checkout', 'dev')
      const result = commit(path, 'feat(core): add a session entity', 'a.txt')
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('"dev" is protected')
      expect(git(path, 'log', '--oneline', 'dev').output.trim().split('\n')).toHaveLength(1)
    } finally {
      rmSync(path, { recursive: true, force: true })
    }
  })

  test('a commit made directly on main is refused', () => {
    const path = repositoryWithHooks()
    try {
      const result = commit(path, 'feat(core): add a project entity', 'b.txt')
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('"main" is protected')
    } finally {
      rmSync(path, { recursive: true, force: true })
    }
  })

  test('a conforming commit on a feature branch is accepted', () => {
    const path = repositoryWithHooks()
    try {
      git(path, 'checkout', '-b', 'feature/sessions', 'dev')
      const result = commit(path, 'feat(core): add a session entity', 'c.txt')
      expect(result.code).toBe(0)
      expect(git(path, 'log', '--oneline').output).toContain('add a session entity')
    } finally {
      rmSync(path, { recursive: true, force: true })
    }
  })

  test('every protected branch is rejected by the guard', () => {
    expect(validateBranch('main').ok).toBe(false)
    expect(validateBranch('dev').ok).toBe(false)
    expect(validateBranch('feature/sessions').ok).toBe(true)
    expect(validateBranch('hotfix/profile-lock').ok).toBe(true)
  })
})

describe('Commit hors convention', { timeout: 60_000 }, () => {
  test('a commit whose message ignores the convention is refused on a feature branch', () => {
    const path = repositoryWithHooks()
    try {
      git(path, 'checkout', '-b', 'feature/sessions', 'dev')
      const result = commit(path, 'wip', 'd.txt')
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('does not match the convention')
      expect(result.output).toContain('<type>(<scope>): <subject>')
    } finally {
      rmSync(path, { recursive: true, force: true })
    }
  })

  test.each([
    ['wip', 'does not match the convention'],
    ['feat: add a session entity', 'does not match the convention'],
    ['feature(core): add a session entity', 'unknown type "feature"'],
    ['feat(core): Add a session entity', 'uppercase subject'],
    ['feat(core): add a session entity.', 'ends with a period'],
    [`feat(core): ${'a'.repeat(80)}`, 'characters long'],
    ['', 'empty commit message'],
  ])('%p is rejected', (message, reason) => {
    const result = validateCommitMessage(message)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(reason)
  })

  test.each([
    'feat(core): add a session entity',
    'fix(desktop): restore focus after closing the project selector',
    'test(core): cover rank rebalancing with random insertions',
    'chore(db): pin the drizzle version',
    "Merge branch 'feature/sessions' into dev",
    // Seventy-one characters as written, and the number GitHub appends on a squash after.
    'fix(tools): build the beta package on linux, give the type check time (#7)',
  ])('%p is accepted', (message) => {
    expect(validateCommitMessage(message).ok).toBe(true)
  })

  test('the number a squash merge appends is not counted against the author', () => {
    const long = `feat(core): ${'a'.repeat(80)} (#12)`
    expect(validateCommitMessage(long).ok).toBe(false)
    expect(validateCommitMessage(`feat(core): ${'a'.repeat(60)} (#12)`).ok).toBe(true)
  })

  test('comment lines added by git are ignored', () => {
    const message = 'feat(core): add a session entity\n\n# Please enter the commit message'
    expect(validateCommitMessage(message).ok).toBe(true)
  })
})

const SUBJECT = 'feat(core): add a session entity'
const CLAUDE_TRAILER = 'Co-authored-by: Claude <noreply@anthropic.com>'
const FOOTER = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'

describe('Claude attribution in a commit message', () => {
  test('a Co-authored-by trailer naming Claude is refused, naming the line', () => {
    const result = validateCommitMessage(`${SUBJECT}\n\nWhy.\n\n${CLAUDE_TRAILER}`)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(CLAUDE_TRAILER)
    expect(result.error).toContain('remove')
  })

  test('a Co-authored-by trailer naming a Claude model is refused', () => {
    const line = 'Co-Authored-By: Claude Opus 4.5 <someone@example.invalid>'
    const result = validateCommitMessage(`${SUBJECT}\n\n${line}`)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(line)
  })

  test('a Co-authored-by trailer at noreply@anthropic.com under another name is refused', () => {
    const line = 'co-authored-by: Assistant <NoReply@Anthropic.com>'
    const result = validateCommitMessage(`${SUBJECT}\n\n${line}`)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(line)
  })

  test.each([
    ['with its emoji and its link', FOOTER],
    ['with its link and no emoji', 'Generated with [Claude Code](https://claude.com/claude-code)'],
    ['with its emoji and no link', '🤖 Generated with [Claude Code]'],
    ['with neither', 'Generated with [Claude Code]'],
  ])('the "Generated with [Claude Code]" line %s is refused, naming the line', (_name, line) => {
    const result = validateCommitMessage(`${SUBJECT}\n\nWhy.\n\n${line}`)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(line)
    expect(result.error).toContain('remove')
  })

  test('a Co-authored-by trailer naming a person is accepted', () => {
    const message = `${SUBJECT}\n\nCo-authored-by: Ada Example <ada@example.invalid>`
    expect(validateCommitMessage(message).ok).toBe(true)
  })

  test('a body that only talks about Claude Code is accepted', () => {
    const message = `${SUBJECT}\n\nClaude Code writes a Generated with line that this rule refuses.`
    expect(validateCommitMessage(message).ok).toBe(true)
  })

  test('the commit-msg hook refuses a commit carrying the trailer', { timeout: 60_000 }, () => {
    const path = repositoryWithHooks()
    try {
      git(path, 'checkout', '-b', 'feature/sessions', 'dev')
      const result = commit(path, `${SUBJECT}\n\n${CLAUDE_TRAILER}`, 'd.txt')
      expect(result.code).not.toBe(0)
      expect(result.output).toContain(CLAUDE_TRAILER)
    } finally {
      rmSync(path, { recursive: true, force: true })
    }
  })
})

describe('Claude attribution in a pull request description', () => {
  test.each([
    ['the trailer', CLAUDE_TRAILER],
    ['the footer', FOOTER],
  ])('a description holding %s is refused, naming the line', (_name, line) => {
    const result = validatePullRequestDescription(`I add the entity.\n\n${line}\n\nCloses #12`)
    expect(result.ok).toBe(false)
    expect(result.error).toContain(line)
    expect(result.error).toContain('remove')
  })

  test('a description without it is accepted, whatever its subject', () => {
    const body =
      'I add the entity.\n\nCo-authored-by: Ada Example <ada@example.invalid>\n\nCloses #12'
    expect(validatePullRequestDescription(body).ok).toBe(true)
  })

  test('an empty description is accepted', () => {
    expect(validatePullRequestDescription('').ok).toBe(true)
  })

  test('the command line reads the description from a file and refuses the line', () => {
    const folder = mkdtempSync(join(tmpdir(), 'hemera-description-'))
    try {
      const file = join(folder, 'body.md')
      const run = (body: string) => {
        writeFileSync(file, body)
        const result = spawnSync(
          process.execPath,
          [join(repository, 'tools', 'commit-message.ts'), '--description', file],
          { encoding: 'utf8' },
        )
        return { code: result.status, output: `${result.stdout}${result.stderr}` }
      }
      const refused = run(`I add it.\n\n${FOOTER}\n`)
      expect(refused.code).toBe(1)
      expect(refused.output).toContain(FOOTER)
      expect(run('I add it.\n\nCloses #12\n').code).toBe(0)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('Crochet ignoré faute de droit', { timeout: 60_000 }, () => {
  test('both hooks are recorded as executable, or Git skips them without a word', () => {
    // Git for Windows runs a hook whatever its mode; every other system skips one that is
    // not executable, and skips it silently — the protection would simply not exist there.
    const recorded = spawnSync('git', ['ls-files', '-s', '.githooks'], {
      cwd: repository,
      encoding: 'utf8',
    }).stdout

    const modes = recorded
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => ({ mode: line.slice(0, 6), file: line.split('\t')[1] }))

    expect(modes.length).toBeGreaterThanOrEqual(2)
    for (const entry of modes) {
      expect(entry.mode).toBe('100755')
    }
    expect(modes.map((entry) => entry.file)).toContain('.githooks/pre-commit')
    expect(modes.map((entry) => entry.file)).toContain('.githooks/commit-msg')
  })
})
