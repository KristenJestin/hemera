#!/usr/bin/env bun
/**
 * Angular commit convention of the product repository (see CLAUDE.md).
 *
 *   bun tools/commit-message.ts <file>    validate the message held by <file>
 *   bun tools/commit-message.ts --range <base>..<head>   validate a range of commits
 */

/** Commit types allowed by the convention. */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'test',
  'docs',
  'chore',
  'build',
  'ci',
  'perf',
] as const

/** Branches no commit may land on directly. */
export const PROTECTED_BRANCHES = ['main', 'dev'] as const

const MAX_SUBJECT_LENGTH = 72

const HEADER = /^([a-z]+)\(([a-z0-9-]+)\): (.+)$/

export interface ValidationResult {
  ok: boolean
  error?: string
}

const EXPECTED = `expected "<type>(<scope>): <subject>" with type among ${COMMIT_TYPES.join(', ')}`

/** Strips the comment lines git appends to the message being edited. */
export function stripComments(message: string): string {
  return message
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim()
}

export function validateCommitMessage(message: string): ValidationResult {
  const header = stripComments(message).split('\n')[0] ?? ''
  // Merge commits are produced by the flow itself (feature into dev, dev into main).
  if (header.startsWith('Merge ')) return { ok: true }
  if (header.length === 0) return { ok: false, error: `empty commit message; ${EXPECTED}` }

  const match = HEADER.exec(header)
  if (match === null) {
    return { ok: false, error: `"${header}" does not match the convention; ${EXPECTED}` }
  }
  const type = match[1]!
  const subject = match[3]!
  if (!(COMMIT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `"${header}" uses the unknown type "${type}"; ${EXPECTED}` }
  }
  if (header.length > MAX_SUBJECT_LENGTH) {
    return {
      ok: false,
      error: `"${header}" is ${header.length} characters long; keep the subject line under ${MAX_SUBJECT_LENGTH}`,
    }
  }
  if (subject.endsWith('.')) {
    return { ok: false, error: `"${header}" ends with a period; drop it` }
  }
  if (/^[A-Z]/.test(subject)) {
    return { ok: false, error: `"${header}" starts with an uppercase subject; use lowercase` }
  }
  return { ok: true }
}

export function validateBranch(branch: string): ValidationResult {
  if ((PROTECTED_BRANCHES as readonly string[]).includes(branch)) {
    return {
      ok: false,
      error: `"${branch}" is protected; create a feature/<topic> branch from dev before committing`,
    }
  }
  return { ok: true }
}

function commitsOf(range: string): { subject: string; body: string }[] {
  const result = Bun.spawnSync(['git', 'log', '--format=%H', range], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim())
  }
  return new TextDecoder()
    .decode(result.stdout)
    .trim()
    .split('\n')
    .filter((hash) => hash.length > 0)
    .map((hash) => {
      const message = Bun.spawnSync(['git', 'log', '-1', '--format=%B', hash], { stdout: 'pipe' })
      return { subject: hash, body: new TextDecoder().decode(message.stdout) }
    })
}

if (import.meta.main) {
  const rangeIndex = process.argv.indexOf('--range')
  if (rangeIndex !== -1) {
    const range = process.argv[rangeIndex + 1]
    if (range === undefined) {
      console.error('--range requires a <base>..<head> argument')
      process.exit(2)
    }
    let failed = false
    for (const commit of commitsOf(range)) {
      const result = validateCommitMessage(commit.body)
      if (!result.ok) {
        console.error(`${commit.subject}: ${result.error}`)
        failed = true
      }
    }
    process.exit(failed ? 1 : 0)
  }

  const file = process.argv[2]
  if (file === undefined) {
    console.error('usage: bun tools/commit-message.ts <file> | --range <base>..<head>')
    process.exit(2)
  }
  const result = validateCommitMessage(await Bun.file(file).text())
  if (!result.ok) {
    console.error(`commit rejected: ${result.error}`)
    process.exit(1)
  }
}
