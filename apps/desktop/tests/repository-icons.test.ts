/**
 * The icons a repository may wear, declared twice and held to one list (recette 1, item 11).
 *
 * The domain declares the set the database checks, and the channel declares the one a request is
 * parsed with; neither package imports the other, so the application, which sees both, is where
 * the two are held together.
 */

import { REPOSITORY_ICONS } from '@hemera/core'
import { repositoryIconSchema } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

describe('A repository wears one of a fixed set of icons', () => {
  test('the domain and the channel offer the same eight icons, in the same order', () => {
    expect(repositoryIconSchema.options).toEqual([...REPOSITORY_ICONS])
    expect(REPOSITORY_ICONS).toEqual([
      'folder',
      'server',
      'browser',
      'database',
      'package',
      'book',
      'mobile',
      'terminal',
    ])
  })
})
