import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..')
const turbo = join(repository, 'node_modules', '.bin', 'turbo')

interface TurboTask {
  taskId: string
  package: string
  task: string
  hash: string
  dependencies: string[]
  dependents: string[]
  resolvedTaskDefinition: { cache: boolean; dependsOn: string[] }
}

function run(command: string[]): { code: number; output: string } {
  const result = Bun.spawnSync(command, { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
  const decoder = new TextDecoder()
  return {
    code: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  }
}

function dryRun(task: string): TurboTask[] {
  const result = Bun.spawnSync([turbo, 'run', task, '--dry=json'], {
    cwd: repository,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const plan = JSON.parse(new TextDecoder().decode(result.stdout)) as { tasks: TurboTask[] }
  return plan.tasks
}

function taskNamed(tasks: TurboTask[], taskId: string): TurboTask {
  const found = tasks.find((task) => task.taskId === taskId)
  if (found === undefined) throw new Error(`${taskId} is absent from the plan`)
  return found
}

/** Runs `body` with `content` appended to a file, then restores the file. */
function withAppended(path: string, content: string, body: () => void): void {
  const original = readFileSync(path, 'utf8')
  try {
    writeFileSync(path, `${original}${content}`)
    body()
  } finally {
    writeFileSync(path, original)
  }
}

describe('Commandes de développement communes', () => {
  test('the plan orders a consumer typecheck after the package it depends on', () => {
    const tasks = dryRun('typecheck')
    expect(taskNamed(tasks, '@hemera/core#typecheck').dependencies).toEqual([])
    expect(taskNamed(tasks, '@hemera/runtime#typecheck').dependencies).toContain(
      '@hemera/core#typecheck',
    )
    expect(taskNamed(tasks, '@hemera/desktop#typecheck').dependencies).toEqual(
      expect.arrayContaining([
        '@hemera/core#typecheck',
        '@hemera/runtime#typecheck',
        '@hemera/ui#typecheck',
      ]),
    )
  })

  test('a failing package fails the root verification instead of being masked', () => {
    const core = join(repository, 'packages', 'core', 'src', 'index.ts')
    withAppended(core, 'export const broken: number = "not a number"\n', () => {
      const result = run([turbo, 'run', 'typecheck'])
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('@hemera/core')
      expect(result.output).toMatch(/Failed:\s+@hemera\/core#typecheck/)
    })
  })
})

describe('Vérification après modification partagée', () => {
  test('changing core invalidates the hashes of its consumers', () => {
    const core = join(repository, 'packages', 'core', 'src', 'index.ts')
    const before = dryRun('typecheck')
    const beforeHashes = {
      core: taskNamed(before, '@hemera/core#typecheck').hash,
      runtime: taskNamed(before, '@hemera/runtime#typecheck').hash,
      desktop: taskNamed(before, '@hemera/desktop#typecheck').hash,
    }
    withAppended(core, '\n/** Touched by the invalidation check. */\n', () => {
      const after = dryRun('typecheck')
      expect(taskNamed(after, '@hemera/core#typecheck').hash).not.toBe(beforeHashes.core)
      expect(taskNamed(after, '@hemera/runtime#typecheck').hash).not.toBe(beforeHashes.runtime)
      expect(taskNamed(after, '@hemera/desktop#typecheck').hash).not.toBe(beforeHashes.desktop)
    })
  })
})

describe('Tâche à effets sans cache', () => {
  test('effectful tasks are declared without cache', () => {
    const definition = JSON.parse(readFileSync(join(repository, 'turbo.json'), 'utf8')) as {
      tasks: Record<string, { cache?: boolean }>
    }
    for (const task of ['build', 'test:system', 'dev']) {
      expect(definition.tasks[task]).toBeDefined()
      expect(definition.tasks[task]!.cache).toBe(false)
    }
  })

  test('deterministic verifications stay cacheable', () => {
    const tasks = dryRun('typecheck')
    expect(taskNamed(tasks, '@hemera/core#typecheck').resolvedTaskDefinition.cache).toBe(true)
  })
})

describe('Squelettes non demandés', () => {
  test('the monorepo holds no server or mobile application', () => {
    expect(readdirSync(join(repository, 'apps'))).toEqual(['desktop'])
    expect(readdirSync(join(repository, 'packages')).toSorted()).toEqual(['core', 'runtime', 'ui'])
  })
})
