/**
 * The Project's checks, and how a build runs them (design D10-06, D10-07, L4, L5, L12).
 *
 * Every suite is named after the scenario of `Spec · build-checks` it covers, or after what it
 * proves, and runs over the whole engine on the fake agent `window.ts` composes: the checks are
 * real runs of the Commands service, `node` itself started in real repositories.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CheckDraft } from '@hemera/core'
import { Effect } from 'effect'
import { afterEach, beforeEach, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { ProjectChecks } from '#engine/build/checks.ts'
import { Commands } from '#engine/commands/service.ts'
import { Projects } from '#engine/projects.ts'
import { SqliteClient } from '#engine/storage/database.ts'

import { repository } from './repositories.ts'
import { type OpenWindow, openWindow } from './window.ts'

let dataFolder: string
let opened: OpenWindow | undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-checks-')))
})

afterEach(async () => {
  await opened?.close()
  opened = undefined
  rmSync(dataFolder, { recursive: true, force: true })
})

/** The folder of the Project's `main`, which holds its three repositories. */
const mainOf = () => join(dataFolder, 'main')

/** `Atlas` on a real `main` of three repositories: `sources/api`, `sources/front`, `sources/docs`. */
const atlas = Effect.gen(function* () {
  const main = mainOf()
  const locations = ['sources/api', 'sources/front', 'sources/docs']
  for (const location of locations) repository(join(main, location))
  const projects = yield* Projects
  let project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: main })
  for (const location of locations) {
    project = yield* projects.addRepository(project.id, project.version, `./${location}`)
  }
  return project
})

/** A command of the catalogue, of the type given, run at the root unless a base is named. */
const command = (
  projectId: string,
  name: string,
  type: 'serve' | 'test' | 'lint' | 'build',
  line: string,
  folderBase: string | null = null,
) =>
  Effect.gen(function* () {
    return yield* (yield* Commands).save(
      {
        projectId,
        name,
        line,
        type,
        lineWindows: null,
        lineLinux: null,
        folderBase,
        folder: null,
        scope: 'workspace',
        portless: false,
        portlessName: null,
      },
      false,
    )
  })

/** A check of a line of the user's, at the Workspace root after each task, unless told otherwise. */
const draft = (name: string, line: string, changes: Partial<CheckDraft> = {}): CheckDraft => ({
  name,
  commandId: null,
  line,
  where: 'root',
  repository: null,
  when: 'task',
  expect: null,
  files: null,
  ...changes,
})

/** The Journal lines of the Project's checks, in the order they were written. */
const checkLines = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{ type: string; entity_kind: string; payload: string }>`
    SELECT type, entity_kind, payload FROM domain_events
    WHERE type LIKE 'check.%' ORDER BY sequence`
})

test('Defaults come from the catalogue', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const seen = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      yield* command(project.id, 'lint', 'lint', 'oxlint')
      yield* command(project.id, 'unit', 'test', 'vitest run')
      yield* command(project.id, 'e2e', 'test', 'wdio run')
      yield* command(project.id, 'bundle', 'build', 'vite build')
      yield* command(project.id, 'dev', 'serve', 'vite')
      const checks = yield* ProjectChecks
      const proposed = yield* checks.proposed(project.id)
      // Shown, and nothing saved by being shown: asked twice, it is proposed twice.
      const listedBefore = yield* checks.list(project.id)
      const proposedAgain = yield* checks.proposed(project.id)
      // The user edits one proposal before accepting them all.
      const edited = proposed.map((one): CheckDraft =>
        one.name === 'unit' ? { ...one, when: 'task' } : one,
      )
      const accepted = yield* checks.acceptProposed(project.id, edited)
      return {
        proposed,
        listedBefore,
        proposedAgain,
        accepted,
        listedAfter: yield* checks.list(project.id),
        proposedAfter: yield* checks.proposed(project.id),
      }
    }),
  )

  // From the types (D10-06): a lint after each task in each changed repository, a test after
  // each story, an end-to-end suite and a build at the end at the root; a server never.
  // The catalogue's order is its commands' creation, which one millisecond may not tell apart.
  const byName = <T extends { name: string }>(list: readonly T[]) =>
    [...list].sort((left, right) => left.name.localeCompare(right.name))
  expect(byName(seen.proposed).map(({ name, when, where }) => ({ name, when, where }))).toEqual([
    { name: 'bundle', when: 'end', where: 'root' },
    { name: 'e2e', when: 'end', where: 'root' },
    { name: 'lint', when: 'task', where: 'changed' },
    { name: 'unit', when: 'story', where: 'changed' },
  ])
  expect(seen.listedBefore).toEqual([])
  expect(seen.proposedAgain).toEqual(seen.proposed)

  // Accepted, they are the Project's, in the order proposed, the edit kept.
  expect(seen.listedAfter).toEqual(seen.accepted)
  expect(seen.listedAfter.map(({ name }) => name)).toEqual(seen.proposed.map(({ name }) => name))
  expect(byName(seen.listedAfter).map(({ name, when }) => ({ name, when }))).toEqual([
    { name: 'bundle', when: 'end' },
    { name: 'e2e', when: 'end' },
    { name: 'lint', when: 'task' },
    { name: 'unit', when: 'task' },
  ])
  // Once the Project has a check, nothing is proposed any more.
  expect(seen.proposedAfter).toEqual([])
})

test('A check is saved last, refused with its reason, edited and removed', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const seen = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      const checks = yield* ProjectChecks
      const first = yield* checks.save(project.id, draft('types', 'tsc --noEmit'), null)
      const second = yield* checks.save(project.id, draft('unit', 'vitest run'), null)
      const twice = yield* Effect.flip(
        checks.save(project.id, draft('types', 'tsc --noEmit'), null),
      )
      const nowhere = yield* Effect.flip(
        checks.save(project.id, draft('api', 'vitest run', { where: 'repository' }), null),
      )
      const edited = yield* checks.save(
        project.id,
        draft('types', 'tsc -b', {
          where: 'repository',
          repository: './sources/api',
          expect: { pattern: 'Coverage: ([\\d.]+)', minimum: 70 },
        }),
        first.id,
      )
      yield* checks.remove(second.id)
      const gone = yield* Effect.flip(checks.remove(second.id))
      return {
        first,
        second,
        twice: twice.message,
        nowhere: nowhere.message,
        edited,
        gone: gone.message,
        listed: yield* checks.list(project.id),
        lines: yield* checkLines,
      }
    }),
  )

  // A new check goes last.
  expect(seen.second.rank > seen.first.rank).toBe(true)
  // Refused with the sentence the dialog shows (D10-06), nothing written.
  expect(seen.twice).toBe('A check named “types” already exists.')
  expect(seen.nowhere).toBe('Choose the repository the check runs in.')
  // Edited in place, its rank kept.
  expect(seen.edited).toEqual({
    ...seen.first,
    line: 'tsc -b',
    where: 'repository',
    repository: './sources/api',
    expect: { pattern: 'Coverage: ([\\d.]+)', minimum: 70 },
  })
  expect(seen.listed).toEqual([seen.edited])
  expect(seen.gone).toBe(`no check of this Project has the identifier "${seen.second.id}"`)
  expect(seen.lines.map(({ type, entity_kind }) => [type, entity_kind])).toEqual([
    ['check.created', 'project'],
    ['check.created', 'project'],
    ['check.updated', 'project'],
    ['check.removed', 'project'],
  ])
})
