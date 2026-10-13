/**
 * A Project's checks as its settings keep them (#143): the defaults proposed from the catalogue's
 * check commands and saved only once accepted, every refusal with the sentence the settings show,
 * a check written, moved and removed.
 */

import { realpathSync } from 'node:fs'

import type { CheckDraft } from '@hemera/core/domain'
import { CheckRefused, type CommandDraft, InvalidProofLimit } from '@hemera/ipc'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { removeCommand, saveCommand } from '../src/engine/catalogue.ts'
import {
  acceptChecks,
  listChecks,
  moveCheck,
  proofLimitOf,
  proposedChecks,
  removeCheck,
  saveCheck,
  setProofLimit,
} from '../src/engine/project-checks.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { atlas, atlasOnDisk, opened, workspaceEngine } from './workspace-engine.ts'

let data: string
let main: string

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('project-checks'))
  main = atlasOnDisk(realpathSync.native(temporaryFolder('project-checks-work')))
  await opened(data)
})
afterEach(removeFolders)

const check = (over: Partial<CheckDraft> = {}): CheckDraft => ({
  name: 'unit',
  commandId: null,
  line: 'node test.js',
  where: 'changed',
  repository: null,
  when: 'requirement',
  expect: null,
  files: null,
  ...over,
})

/** A catalogue command with every role off, run at the root. */
const command = (change: Partial<CommandDraft> = {}): CommandDraft => ({
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

/** Atlas with its catalogue: lint, typecheck, test and build marked as checks, a serve, a script. */
const catalogued = Effect.gen(function* () {
  const project = yield* atlas(main)
  const web = project.repositories.find((one) => one.path === 'web')?.id ?? null
  const save = (name: string, more: Parameters<typeof command>[0]) =>
    saveCommand({ projectId: project.id, id: null, command: command({ name, ...more }) })
  yield* save('lint', { type: 'lint', check: true })
  yield* save('typecheck', { type: 'typecheck', line: 'pnpm typecheck', check: true })
  yield* save('test', { type: 'test', line: 'pnpm test', check: true })
  yield* save('build', { type: 'build', line: 'pnpm build', check: true })
  yield* save('e2e', { type: 'e2e', line: 'pnpm e2e', check: true })
  yield* save('dev', { type: 'serve', line: 'pnpm dev', check: true })
  yield* save('seed', { type: 'script', line: 'pnpm seed', check: true })
  yield* save('web lint', { type: 'lint', line: 'pnpm lint', check: true, repositoryId: web })
  yield* save('slow', { type: 'test', line: 'pnpm slow', check: false })
  return project
})

describe('The proposed defaults', () => {
  test('proposals come from the catalogue’s check commands with the defaults, and nothing is saved until accepted', async () => {
    const seen = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* catalogued
        const proposed = yield* proposedChecks(project.id, false)
        const before = yield* listChecks(project.id)
        const kept = proposed.filter((one) => one.name !== 'e2e')
        const accepted = yield* acceptChecks(project.id, kept)
        const after = yield* listChecks(project.id)
        const again = yield* proposedChecks(project.id, false)
        const asked = yield* proposedChecks(project.id, true)
        return { proposed, before, accepted, after, again, asked }
      }),
    )
    expect(seen.proposed.map((one) => [one.name, one.when, one.where])).toEqual([
      ['lint', 'task', 'changed'],
      ['typecheck', 'task', 'changed'],
      ['test', 'requirement', 'changed'],
      ['build', 'end', 'root'],
      ['e2e', 'end', 'root'],
      ['web lint', 'task', 'root'],
    ])
    expect(seen.before).toEqual([])
    expect(seen.after.map((one) => one.name)).toEqual([
      'lint',
      'typecheck',
      'test',
      'build',
      'web lint',
    ])
    expect(seen.after).toEqual(seen.accepted)
    // A Project that has checks gets no proposal unless asked.
    expect(seen.again).toEqual([])
    expect(seen.asked).toHaveLength(6)
  })
})

describe('A check is refused with its sentence', () => {
  test('a check with both a command and a line, or a pattern without a capture group, is refused with its sentence; a line with | is refused naming it', async () => {
    const refusals = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* catalogued
        const refused = (draft: CheckDraft) => Effect.flip(saveCheck(project.id, null, draft))
        return [
          yield* refused(check({ commandId: 'x' })),
          yield* refused(check({ expect: { pattern: 'Coverage: [0-9.]+%', minimum: 70 } })),
          yield* refused(check({ line: 'node test.js | tee x' })),
        ]
      }),
    )
    expect(refusals.every((one) => one instanceof CheckRefused)).toBe(true)
    expect(refusals.map((one) => one.message)).toEqual([
      'A check runs a command of the catalogue or a line, not both.',
      'Put the number to read between parentheses in the pattern, as in Coverage: ([0-9.]+)%.',
      'Hemera runs a command without a shell, and “|” is shell syntax: put it in a script of the repository and run the script.',
    ])
  })

  test('a command not in the catalogue, a repository the Project does not declare, a name taken, are refused', async () => {
    const reasons = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* catalogued
        yield* saveCheck(project.id, null, check())
        const said = (draft: CheckDraft) =>
          saveCheck(project.id, null, draft).pipe(
            Effect.flip,
            Effect.map((refused) => refused.message),
          )
        return [
          yield* said(check({ name: 'other', line: null, commandId: 'gone' })),
          yield* said(check({ name: 'other', where: 'repository', repository: 'mobile' })),
          yield* said(check()),
          yield* acceptChecks(project.id, [check({ name: 'a' }), check({ name: 'a' })]).pipe(
            Effect.flip,
            Effect.map((refused) => refused.message),
          ),
          (yield* listChecks(project.id)).length,
        ]
      }),
    )
    expect(reasons).toEqual([
      'The command chosen is no longer in the catalogue.',
      'mobile is not a repository of this Project.',
      'A check named “unit” already exists.',
      'A check named “a” already exists.',
      1,
    ])
  })
})

describe('A check written, moved and removed', () => {
  test('a check is saved last, edited in place, moved, and removed; a command’s removal takes its checks with it', async () => {
    const seen = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* catalogued
        const [lint] = yield* acceptChecks(
          project.id,
          (yield* proposedChecks(project.id, false)).slice(0, 1),
        )
        const unit = yield* saveCheck(project.id, null, check())
        const coverage = yield* saveCheck(
          project.id,
          null,
          check({
            name: 'coverage',
            line: 'node coverage.js',
            where: 'root',
            when: 'end',
            expect: { pattern: 'Coverage: ([0-9.]+)%', minimum: 70 },
          }),
        )
        const edited = yield* saveCheck(project.id, unit.id, check({ files: '**/*.test.ts' }))
        const moved = yield* moveCheck(project.id, coverage.id, 0)
        yield* removeCheck(project.id, unit.id)
        yield* removeCommand(project.id, lint?.commandId ?? '')
        return { edited, moved, left: yield* listChecks(project.id) }
      }),
    )
    expect(seen.edited.files).toBe('**/*.test.ts')
    expect(seen.moved.map((one) => one.name)).toEqual(['coverage', 'lint', 'unit'])
    expect(seen.moved.map((one) => one.rank)).toEqual([0, 1, 2])
    expect(seen.left.map((one) => [one.name, one.expect])).toEqual([
      ['coverage', { pattern: 'Coverage: ([0-9.]+)%', minimum: 70 }],
    ])
  })
})

describe('How long a proof may run', () => {
  test('a Project with no value keeps 10 minutes; a value is kept, and emptied back to the default', async () => {
    const seen = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const before = yield* proofLimitOf(project.id)
        const set = yield* setProofLimit(project.id, 25)
        const kept = yield* proofLimitOf(project.id)
        const emptied = yield* setProofLimit(project.id, null)
        return { before, set, kept, emptied, after: yield* proofLimitOf(project.id) }
      }),
    )
    expect(seen).toEqual({ before: null, set: 25, kept: 25, emptied: null, after: null })
  })

  test('a refused value (0, negative, past the bound) is refused with its reason, and the limit stays', async () => {
    const seen = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        yield* setProofLimit(project.id, 30)
        const refused = (minutes: number) => Effect.flip(setProofLimit(project.id, minutes))
        return {
          refusals: [yield* refused(0), yield* refused(-3), yield* refused(121)],
          kept: yield* proofLimitOf(project.id),
        }
      }),
    )
    expect(seen.refusals.every((one) => one instanceof InvalidProofLimit)).toBe(true)
    expect(seen.refusals.map((one) => one.message)).toEqual([
      'A proof needs at least 1 minute.',
      'A proof needs at least 1 minute.',
      'A proof may run 120 minutes at most: a longer one holds the end of the Building for hours.',
    ])
    expect(seen.kept).toBe(30)
  })
})
