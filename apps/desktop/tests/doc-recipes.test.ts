/**
 * A Project's doc recipes as its settings keep them (#146): the defaults proposed from what the
 * main checkout holds and saved only once accepted, every refusal with the sentence the settings
 * show, a recipe written, moved and removed.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DocRecipeDraft } from '@hemera/core/domain'
import { DocRecipeRefused } from '@hemera/ipc'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  acceptDocRecipes,
  listDocRecipes,
  moveDocRecipe,
  proposedDocRecipes,
  removeDocRecipe,
  saveDocRecipe,
} from '../src/engine/doc-recipes.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { atlas, atlasOnDisk, opened, workspaceEngine } from './workspace-engine.ts'

let data: string
let main: string

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('doc-recipes'))
  main = atlasOnDisk(realpathSync.native(temporaryFolder('doc-recipes-work')))
  await opened(data)
})
afterEach(removeFolders)

const recipe = (over: Partial<DocRecipeDraft> = {}): DocRecipeDraft => ({
  repository: 'api',
  path: 'README.md',
  purpose: 'How to install and run the api.',
  applies: 'always',
  words: [],
  ...over,
})

/** Writes a file of the main checkout, its folders with it. */
const written = (path: string) => {
  mkdirSync(join(main, path, '..'), { recursive: true })
  writeFileSync(join(main, path), 'text\n')
}

describe('The proposed recipes come from the main checkout', () => {
  test('proposals come from what exists in the main checkout, saved only when accepted', async () => {
    written('api/README.md')
    written('api/docs/guide.md')
    written('api/openapi.yaml')
    written('api/node_modules/left-pad/README.md')
    written('web/schema.graphql')
    const seen = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const proposed = yield* proposedDocRecipes(project.id, false)
        const before = yield* listDocRecipes(project.id)
        const accepted = yield* acceptDocRecipes(
          project.id,
          proposed.filter((one) => one.path !== 'schema.graphql'),
        )
        const after = yield* listDocRecipes(project.id)
        const again = yield* proposedDocRecipes(project.id, false)
        const asked = yield* proposedDocRecipes(project.id, true)
        return { proposed, before, accepted, after, again, asked }
      }),
    )
    expect(seen.proposed.map((one) => [one.repository, one.path, one.applies])).toEqual([
      ['api', 'README.md', 'always'],
      ['api', 'docs/**/*.md', 'always'],
      ['api', 'openapi.yaml', 'when_impact_names'],
      ['web', 'schema.graphql', 'when_impact_names'],
    ])
    expect(seen.before).toEqual([])
    expect(seen.after.map((one) => [one.repository, one.path, one.rank])).toEqual([
      ['api', 'README.md', 0],
      ['api', 'docs/**/*.md', 1],
      ['api', 'openapi.yaml', 2],
    ])
    expect(seen.after).toEqual(seen.accepted)
    // A Project that has recipes gets no proposal unless asked.
    expect(seen.again).toEqual([])
    expect(seen.asked).toHaveLength(4)
  })
})

describe('A doc recipe is refused with its sentence', () => {
  test('a recipe whose path leaves its repository, or in a repository the Project does not declare, is refused naming it; one refused refuses all', async () => {
    const reasons = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const said = (draft: DocRecipeDraft) =>
          saveDocRecipe(project.id, null, draft).pipe(
            Effect.flip,
            Effect.map((refused) => [refused instanceof DocRecipeRefused, refused.message]),
          )
        return [
          yield* said(recipe({ path: '../web/README.md' })),
          yield* said(recipe({ repository: 'mobile' })),
          yield* acceptDocRecipes(project.id, [recipe(), recipe({ path: '../x.md' })]).pipe(
            Effect.flip,
            Effect.map((refused) => refused.message),
          ),
          (yield* listDocRecipes(project.id)).length,
        ]
      }),
    )
    expect(reasons).toEqual([
      [true, '../web/README.md leaves its repository: name a file inside it.'],
      [true, 'mobile is not a repository of this Project.'],
      '../x.md leaves its repository: name a file inside it.',
      0,
    ])
  })
})

describe('A doc recipe written, moved and removed', () => {
  test('a recipe is saved last, edited in place, moved and removed', async () => {
    const seen = await workspaceEngine(data)(
      Effect.gen(function* () {
        const project = yield* atlas(main)
        const readme = yield* saveDocRecipe(project.id, null, recipe())
        const contract = yield* saveDocRecipe(
          project.id,
          null,
          recipe({ path: 'openapi.yaml', applies: 'when_impact_names', words: ['API'] }),
        )
        const edited = yield* saveDocRecipe(
          project.id,
          readme.id,
          recipe({ purpose: 'What the api is.' }),
        )
        const moved = yield* moveDocRecipe(project.id, contract.id, 0)
        yield* removeDocRecipe(project.id, readme.id)
        return { edited, moved, left: yield* listDocRecipes(project.id) }
      }),
    )
    expect(seen.edited.purpose).toBe('What the api is.')
    expect(seen.moved.map((one) => [one.path, one.rank])).toEqual([
      ['openapi.yaml', 0],
      ['README.md', 1],
    ])
    expect(seen.left.map((one) => [one.path, one.words])).toEqual([['openapi.yaml', ['API']]])
  })
})
