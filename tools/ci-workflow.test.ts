import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vite-plus/test'

// The workflow is read as text: no YAML parser is a dependency of the repository, and the three
// things checked here are lines whose spelling is the contract.

const repository = resolve(import.meta.dirname, '..')
const workflow = readFileSync(join(repository, '.github', 'workflows', 'ci.yml'), 'utf8')

const blockOf = (key: string): string => {
  const start = workflow.indexOf(`\n${key}:`)
  const next = workflow.slice(start + 1).search(/\n\S/)
  return workflow.slice(start, next === -1 ? undefined : start + 1 + next)
}

describe('CI of a feature branch', () => {
  test('a push to main, dev or any feature branch starts the workflow', () => {
    expect(blockOf('on')).toMatch(/push:\s*\n\s*branches: \[main, dev, 'feature\/\*\*'\]/)
  })

  test('a pull request starts the workflow too', () => {
    expect(blockOf('on')).toMatch(/\n\s+pull_request:/)
  })

  test('a newer push to a branch cancels the run still in progress for that branch', () => {
    const concurrency = blockOf('concurrency')
    expect(concurrency).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(concurrency).toContain('cancel-in-progress: true')
  })

  test('a cancelled run leaves the required Windows check failed, never green', () => {
    // `always()` runs the aggregate on a cancelled run, where `needs.windows.result` is
    // `cancelled`; `!cancelled()` would skip it, and a skipped required check counts as passed.
    const aggregate = workflow.slice(workflow.indexOf('  windows-result:'))
    expect(aggregate).toContain('name: verify (windows-latest)')
    expect(aggregate).toMatch(/if: always\(\)/)
    expect(aggregate).toContain('test "${{ needs.windows.result }}" = success')
  })
})

// A job of the workflow, from its key to the next job (a comment above the next job is cut off
// with it), and its steps: each starts at a `- ` indented six spaces.
const jobOf = (key: string): string => {
  const start = workflow.indexOf(`\n  ${key}:\n`)
  const next = workflow.slice(start + 1).search(/\n  \S/)
  return workflow.slice(start, next === -1 ? undefined : start + 1 + next)
}
const stepsOf = (job: string): string[] => job.split(/\n {6}- /).slice(1)
const stepRunning = (job: string, command: string): string | undefined =>
  stepsOf(job).find((step) => new RegExp(`run: ${command}\\s*$`, 'm').test(step))

describe('The Ubuntu verification, split over runners with no check lost', () => {
  const ubuntu = jobOf('ubuntu')
  const parts = /part: \[(.*)\]/.exec(ubuntu)?.[1]?.split(', ') ?? []
  const repositoryParts = parts.filter((part) => part.startsWith('repository '))

  test('the static checks, the stories and the repository suites each have a runner of their own', () => {
    expect(parts.filter((part) => !part.startsWith('repository '))).toEqual(['checks', 'stories'])
    expect(repositoryParts.length).toBeGreaterThan(1)
    expect(ubuntu).toContain('runs-on: ubuntu-latest')
  })

  test('typecheck, lint and the format check run in the checks part', () => {
    for (const command of ['pnpm typecheck', 'pnpm lint', 'pnpm fmt:check']) {
      expect(stepRunning(ubuntu, command), command).toContain("matrix.part == 'checks'")
    }
  })

  test('the build runs in every part, as it did before the split and as it does on Windows', () => {
    expect(stepRunning(ubuntu, 'pnpm build')).not.toContain('if:')
  })

  test('both story projects, light and dark, run in the stories part', () => {
    const step = stepRunning(ubuntu, 'pnpm test --project storybook-light --project storybook-dark')
    expect(step).toContain("matrix.part == 'stories'")
  })

  test('the repository project runs in parts that are numbered 1 to n of n, each shard once', () => {
    const count = repositoryParts.length
    expect(repositoryParts).toEqual(
      Array.from({ length: count }, (_, index) => `repository ${index + 1}/${count}`),
    )
    const step = stepRunning(
      ubuntu,
      'pnpm test --project repository --shard="\\$\\{PART#repository \\}"',
    )
    expect(step).toContain("startsWith(matrix.part, 'repository')")
    expect(step).toContain('PART: ${{ matrix.part }}')
  })

  test('the stories and the repository suites never share a runner, and no step runs every project at once', () => {
    expect(ubuntu).not.toMatch(/run: pnpm test\s*$/m)
    for (const step of stepsOf(ubuntu)) {
      expect(step.includes('--project storybook') && step.includes('--project repository')).toBe(
        false,
      )
    }
  })

  test('the stories keep their browser, fetched in the stories part only', () => {
    const fetched = stepsOf(ubuntu).find((step) => step.includes('playwright install chromium'))
    expect(fetched).toContain("matrix.part == 'stories'")
  })

  test('a cancelled run leaves the required Ubuntu check failed, never green', () => {
    const aggregate = jobOf('ubuntu-result')
    expect(aggregate).toContain('name: verify (ubuntu-latest)')
    expect(aggregate).toContain('needs: ubuntu')
    expect(aggregate).toMatch(/if: always\(\)/)
    expect(aggregate).toContain('test "${{ needs.ubuntu.result }}" = success')
  })

  test('the branch rules still find each required name once', () => {
    for (const name of ['verify (ubuntu-latest)', 'verify (windows-latest)']) {
      expect(workflow.split(`name: ${name}`)).toHaveLength(2)
    }
    expect(jobOf('commit-messages')).toContain('runs-on: ubuntu-latest')
    expect(jobOf('doctor')).toContain('runs-on: ubuntu-latest')
  })
})

// The step of the `commit-messages` job that checks a push, run against a repository of its own
// with the values GitHub would give it for a push that creates a branch.
const NO_BEFORE = '0'.repeat(40)
const OLD_TITLE = 'fix(ui): let the planning page story be ready before its play and then some more'

const commitMessagesStep = (before: string, head: string): string => {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) =>
    line.includes('name: Check the Angular commit convention'),
  )
  const run = lines.findIndex((line, index) => index > start && line.trim() === 'run: |')
  const script: string[] = []
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && !line.startsWith('          ')) break
    script.push(line.slice(10))
  }
  return script
    .join('\n')
    .replaceAll('${{ github.event.pull_request.base.sha || github.event.before }}', before)
    .replaceAll('${{ github.event.pull_request.head.sha || github.sha }}', head)
    .replaceAll(
      'node tools/commit-message.ts',
      // Forward slashes: the script runs in a POSIX shell, where a Windows path's backslashes
      // are escapes.
      `node ${join(repository, 'tools', 'commit-message.ts').replaceAll('\\', '/')}`,
    )
}

describe('The commit-messages job on a push', () => {
  const folders: string[] = []
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  // A repository whose only remote branch, `origin/feature/1.0`, holds a squashed title that is
  // too long, as the real one does; the pushed branch adds `subjects` on top of it.
  const pushOf = (subjects: string[]) => {
    const folder = mkdtempSync(join(tmpdir(), 'hemera-ci-workflow-'))
    folders.push(folder)
    const git = (...args: string[]): string => {
      const result = spawnSync('git', args, { cwd: folder, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout.trim()
    }
    git('init', '-q')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    git('commit', '-q', '--allow-empty', '-m', OLD_TITLE)
    git('update-ref', 'refs/remotes/origin/feature/1.0', 'HEAD')
    for (const subject of subjects) git('commit', '-q', '--allow-empty', '-m', subject)
    const result = spawnSync(
      'bash',
      ['-eo', 'pipefail', '-c', commitMessagesStep(NO_BEFORE, 'HEAD')],
      {
        cwd: folder,
        encoding: 'utf8',
        env: { ...process.env, BRANCH: 'feature/topic' },
      },
    )
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  }

  test('the first push of a new feature branch answers for its own commits, not the history it was cut from', () => {
    expect(pushOf(['feat(repo): add the topic']).status).toBe(0)
  })

  test('the first push of a new feature branch still refuses a commit of its own that breaks the convention', () => {
    const push = pushOf(['feat(repo): add the topic', 'Add the topic again'])
    expect(push.status).not.toBe(0)
    expect(push.output).toContain('Add the topic again')
  })
})
