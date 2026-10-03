/**
 * A Project's command catalogue: saved, listed, edited and removed, with its roles, its read-only
 * mark and its write globs; and everything saving refuses, each with a sentence naming it.
 */

import { realpathSync } from 'node:fs'

import { InvalidCommand, InvalidTemplate, ShellSyntax, UnknownCommand } from '@hemera/ipc'
import type { CommandDraft, Project } from '@hemera/ipc'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  checkLine,
  getCommand,
  listCommands,
  removeCommand,
  saveCommand,
} from '../src/engine/catalogue.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { atlas, atlasOnDisk, opened, refusedBy, workspaceEngine } from './workspace-engine.ts'

let data: string
let main: string

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('catalogue'))
  main = atlasOnDisk(realpathSync.native(temporaryFolder('catalogue-work')))
  await opened(data)
})
afterEach(removeFolders)

/** A command with every role off, run at the root: `change` says what differs. */
export const draft = (change: Partial<CommandDraft> = {}): CommandDraft => ({
  name: 'lint',
  type: 'lint',
  line: 'pnpm lint',
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
  ...change,
})

const repositoryId = (project: Project, path: string) =>
  project.repositories.find((one) => one.path === path)?.id ?? null

describe('Roles, read-only and write globs round-trip through save and list', () => {
  test('every role, the mark and the globs come back as they were saved', async () => {
    const [saved, listed] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const format = yield* saveCommand({
          projectId: project.id,
          id: null,
          command: draft({
            name: 'format',
            type: 'script',
            line: 'pnpm fmt',
            lineWindows: 'pnpm.cmd fmt',
            lineLinux: ' ',
            repositoryId: repositoryId(project, 'web'),
            folder: './packages/../src/',
            check: true,
            atOpen: true,
            askBeforeRunning: true,
            writeGlobs: [' src/**/*.ts ', '.\\generated\\client.ts', 'src/**/*.ts'],
          }),
        })
        const typecheck = yield* saveCommand({
          projectId: project.id,
          id: null,
          command: draft({ name: 'typecheck', type: 'typecheck', line: 'tsc', readOnly: true }),
        })
        const dev = yield* saveCommand({
          projectId: project.id,
          id: null,
          command: draft({
            name: 'dev',
            type: 'serve',
            line: 'pnpm dev --port 5173',
            scope: 'project',
            portless: true,
            portlessName: ' web ',
            writeGlobs: ['.vite/**'],
          }),
        })
        return [[format, typecheck, dev], yield* listCommands(project.id)] as const
      }),
    )

    expect(listed).toEqual(saved)
    const [format, typecheck, dev] = listed
    expect(format).toMatchObject({
      name: 'format',
      line: 'pnpm fmt',
      lineWindows: 'pnpm.cmd fmt',
      lineLinux: null,
      folder: 'src',
      check: true,
      atOpen: true,
      askBeforeRunning: true,
      readOnly: false,
      writeGlobs: ['src/**/*.ts', 'generated/client.ts'],
    })
    expect(typecheck).toMatchObject({ type: 'typecheck', readOnly: true, check: false })
    expect(dev).toMatchObject({
      type: 'serve',
      scope: 'project',
      portless: true,
      portlessName: 'web',
      writeGlobs: ['.vite/**'],
    })
  })

  test('an edit rewrites the command in place, and a removal takes it out', async () => {
    const [edited, after] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const lint = yield* saveCommand({ projectId: project.id, id: null, command: draft() })
        const edited = yield* saveCommand({
          projectId: project.id,
          id: lint.id,
          command: draft({ line: 'pnpm lint --fix', readOnly: false, writeGlobs: ['src/**'] }),
        })
        yield* removeCommand(project.id, lint.id)
        return [edited, yield* listCommands(project.id)] as const
      }),
    )
    expect(edited).toMatchObject({ line: 'pnpm lint --fix', writeGlobs: ['src/**'] })
    expect(after).toEqual([])
  })
})

describe('Saving refuses what cannot be run, naming it', () => {
  const refusalOf = (change: (project: Project) => Partial<CommandDraft>, existing = false) =>
    refusedBy(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        if (existing) {
          yield* saveCommand({ projectId: project.id, id: null, command: draft() })
        }
        return yield* saveCommand({
          projectId: project.id,
          id: null,
          command: draft(change(project)),
        })
      }),
    )

  test.each([
    ['an empty name', () => ({ name: '  ' }), 'its name is empty'],
    ['an empty line', () => ({ line: ' ' }), 'its line is empty'],
    ['a place the Project does not declare', () => ({ repositoryId: 'elsewhere' }), 'repository'],
    ['a folder that leaves its place', () => ({ folder: '../other' }), 'leaves its place'],
    ['an absolute folder', () => ({ folder: '/etc' }), 'it is absolute'],
    ['an invalid write glob', () => ({ writeGlobs: ['../*.ts'] }), 'leaves the folder'],
    ['a write glob never closed', () => ({ writeGlobs: ['src/[ab'] }), 'never closed'],
    ['a Portless name of two words', () => ({ portlessName: 'my web' }), 'not one word'],
  ])('%s', async (_, change, sentence) => {
    const refusal = await refusalOf(change)
    expect(refusal).toBeInstanceOf(InvalidCommand)
    expect(refusal.message).toContain(sentence)
  })

  test('a name another command has', async () => {
    const refusal = await refusalOf(() => ({}), true)
    expect(refusal).toBeInstanceOf(InvalidCommand)
    expect(refusal.message).toBe(
      'This command is refused: a command named lint is already in this Project.',
    )
  })

  test('an unknown {name} in a line', async () => {
    const refusal = await refusalOf(() => ({ line: 'pnpm dev --name {nope}' }))
    expect(refusal).toBeInstanceOf(InvalidTemplate)
    expect(refusal.message).toContain('{nope}')
  })

  test.each([
    ['pnpm lint | tee out', '|'],
    ['pnpm lint || true', '||'],
    ['pnpm dev &', '&'],
    ['pnpm install && pnpm dev', '&&'],
    ['pnpm lint; pnpm test', ';'],
    ['pnpm test < in', '<'],
    ['pnpm test > out', '>'],
    ['pnpm test >> out', '>>'],
    ['pnpm test 2>&1', '2>&1'],
    ['echo $(whoami)', '$('],
    ['echo `whoami`', '`'],
    ['echo $HOME', '$HOME'],
    ['echo ${HOME}', '${'],
    ['echo %USERPROFILE%', '%USERPROFILE%'],
    ['pnpm lint\npnpm test', 'a newline'],
    ['rm build/*', '*'],
    ['ls file?.txt', '?'],
    ['ls file[12].txt', '[…]'],
    ['cat ~/notes', '~'],
  ])('shell syntax in any of its lines is refused with its token: %s', async (line, token) => {
    for (const where of ['line', 'lineWindows', 'lineLinux'] as const) {
      const refusal = await refusalOf(() => ({ [where]: line }))
      expect(refusal).toBeInstanceOf(ShellSyntax)
      expect(refusal).toMatchObject({ token })
      expect(refusal.message).toContain(`“${token}”`)
    }
  })

  test('the same token in single quotes, and a glob in double quotes, are saved', async () => {
    const saved = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        return yield* saveCommand({
          projectId: project.id,
          id: null,
          command: draft({ line: `node -e 'a && b | c' "src/**/*.ts"` }),
        })
      }),
    )
    expect(saved.line).toBe(`node -e 'a && b | c' "src/**/*.ts"`)
  })

  test('an edit of a command the catalogue no longer holds', async () => {
    const refusal = await refusedBy(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        return yield* saveCommand({ projectId: project.id, id: 'gone', command: draft() })
      }),
    )
    expect(refusal).toBeInstanceOf(UnknownCommand)
  })
})

describe('A line is checked as it is typed', () => {
  test('shell syntax and an unknown name are said; a good line is not', async () => {
    const checks = await workspaceEngine(data)(
      Effect.all([
        checkLine('pnpm install && pnpm dev'),
        checkLine('pnpm dev --name {nope}'),
        checkLine('pnpm dev --name {workspace}'),
      ]),
    )
    expect(checks[0].problem).toContain('“&&”')
    expect(checks[1].problem).toContain('{nope}')
    expect(checks[2].problem).toBeNull()
  })

  test('a command is read back by its identifier', async () => {
    const read = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const lint = yield* saveCommand({ projectId: project.id, id: null, command: draft() })
        return yield* getCommand(project.id, lint.id)
      }),
    )
    expect(read.name).toBe('lint')
  })
})
