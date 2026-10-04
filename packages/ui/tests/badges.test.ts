/**
 * The `new` and `updated` badges of the sidebar, which Git decides when Storybook indexes the
 * stories rather than each story file writing its own (`.storybook/badges.ts`).
 *
 * The decision is tested twice: on lists of files handed to it, which is the rule itself, and on
 * a throwaway repository, which is what the rule is fed when Storybook starts.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { badgeOf, compareWithBase, withBadges } from '../.storybook/badges.ts'

const STORY = 'packages/ui/src/button/button.stories.tsx'
const COMPONENT = 'packages/ui/src/button/button.tsx'

describe('A badge decided from lists of files', () => {
  test('a story file the base does not hold is new', () => {
    const base = { onBase: new Set([COMPONENT]), changed: new Set([STORY]) }
    expect(badgeOf(base, STORY, COMPONENT)).toBe('new')
  })

  test('a story file the branch changed is updated', () => {
    const base = { onBase: new Set([STORY, COMPONENT]), changed: new Set([STORY]) }
    expect(badgeOf(base, STORY, COMPONENT)).toBe('updated')
  })

  test('a story file whose component the branch changed is updated', () => {
    const base = { onBase: new Set([STORY, COMPONENT]), changed: new Set([COMPONENT]) }
    expect(badgeOf(base, STORY, COMPONENT)).toBe('updated')
  })

  test('a story file the branch left alone wears no badge', () => {
    const base = { onBase: new Set([STORY, COMPONENT]), changed: new Set(['tools/boundaries.ts']) }
    expect(badgeOf(base, STORY, COMPONENT)).toBeNull()
    expect(badgeOf(base, STORY, undefined)).toBeNull()
  })

  test('without a base, no story file wears a badge', () => {
    expect(badgeOf(null, STORY, COMPONENT)).toBeNull()
  })
})

describe('A badge decided from a Git repository', { timeout: 60_000 }, () => {
  const made: string[] = []

  afterEach(() => {
    for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true })
  })

  function git(cwd: string, ...args: string[]): void {
    const result = spawnSync('git', ['-c', 'core.hooksPath=', ...args], { cwd, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  }

  function write(root: string, file: string, content: string): void {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }

  /** A repository whose `dev` holds one story and its component, and a branch taken from it. */
  function repository(): string {
    const root = mkdtempSync(join(tmpdir(), 'hemera-badges-'))
    made.push(root)
    git(root, 'init', '--initial-branch=dev')
    git(root, 'config', 'user.name', 'test')
    git(root, 'config', 'user.email', 'test@example.invalid')
    git(root, 'config', 'commit.gpgsign', 'false')
    write(root, STORY, 'export default {}\n')
    write(root, COMPONENT, 'export function Button() {}\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-m', 'chore(repo): seed')
    git(root, 'checkout', '-b', 'feature/badges')
    return root
  }

  function badgeIn(root: string, story: string, component: string): string | null {
    return badgeOf(compareWithBase(root, 'dev'), story, component)
  }

  test('a story file created on the branch, even uncommitted, is new', () => {
    const root = repository()
    write(root, 'packages/ui/src/card/card.stories.tsx', 'export default {}\n')
    expect(
      badgeIn(root, 'packages/ui/src/card/card.stories.tsx', 'packages/ui/src/card/card.tsx'),
    ).toBe('new')
  })

  test('a story file changed and committed on the branch is updated', () => {
    const root = repository()
    write(root, STORY, 'export default { title: "Components/Button" }\n')
    git(root, 'commit', '-am', 'feat(ui): title the button')
    expect(badgeIn(root, STORY, COMPONENT)).toBe('updated')
  })

  test('a story file whose component changed on the branch is updated', () => {
    const root = repository()
    write(root, COMPONENT, 'export function Button() { return null }\n')
    expect(badgeIn(root, STORY, COMPONENT)).toBe('updated')
  })

  test('a story file the branch left alone wears no badge, even when the base moved on', () => {
    const root = repository()
    git(root, 'checkout', 'dev')
    write(root, STORY, 'export default { tags: [] }\n')
    git(root, 'commit', '-am', 'feat(ui): change the story on the base')
    git(root, 'checkout', 'feature/badges')
    expect(badgeIn(root, STORY, COMPONENT)).toBeNull()
  })

  test('a base that does not exist gives no badge and no failure', () => {
    const root = repository()
    write(root, 'packages/ui/src/card/card.stories.tsx', 'export default {}\n')
    expect(compareWithBase(root, 'origin/dev')).toBeNull()
  })

  test('a folder that is no repository gives no badge and no failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'hemera-badges-'))
    made.push(root)
    expect(compareWithBase(root, 'origin/dev')).toBeNull()
  })

  test('the indexer adds the badge to the tags a story file declares, through its component', async () => {
    const root = repository()
    write(root, COMPONENT, 'export function Button() { return null }\n')
    const [indexer] = withBadges(
      [
        {
          test: /\.stories\.tsx$/,
          createIndex: async () => [
            {
              type: 'story',
              exportName: 'Primary',
              rawComponentPath: './button',
              tags: ['autodocs'],
            },
          ],
        },
      ],
      'dev',
    )
    const entries = await indexer!.createIndex(join(root, STORY), {
      makeTitle: (title) => title ?? '',
    })
    expect(entries.map((entry) => entry.tags)).toEqual([['autodocs', 'updated']])
  })
})
