/**
 * What the diff view shows of a mission's diff and of Review's feedback (#497): the files with
 * their sides as they are read, what moved when a repository changes, which sides are asked for
 * and when, the comments under their lines (moved, outdated, the agent's answer, a follow-up, the
 * team's), where the diff is read from, and the anchor a new comment is written on.
 */

import { CodeAnchorAsked } from '@hemera/core/domain'
import {
  AnchorCurrent,
  AnchorMoved,
  AnchorOutdated,
  CodeAnchorView,
  DiffSides,
  DiffText,
  DiffTooLarge,
  FeedbackForge,
  FeedbackUser,
  SpecAnchorView,
  type DiffChange,
  type DiffFile,
  type DiffRepository,
  type FeedbackView,
  type MissionDiff,
  type ReviewStateView,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  anchorOf,
  commentsOf,
  repositoriesOf,
  sizeWords,
  sourceOf,
  toRead,
  withChange,
  type SideRead,
} from '../src/renderer/diff-model.ts'

const file = (path: string, rest: Partial<DiffFile> = {}): DiffFile => ({
  repository: 'api',
  path,
  treePath: `api/${path}`,
  oldPath: null,
  letter: 'M',
  untracked: false,
  added: 3,
  removed: 1,
  binary: false,
  sizeBefore: 100,
  sizeAfter: 120,
  generated: false,
  large: false,
  changedOutside: null,
  withheld: false,
  ...rest,
})

const repository = (name: string, files: DiffFile[], rest: Partial<DiffRepository> = {}) => ({
  repository: name,
  branch: 'acme-12-export',
  baseBranch: 'origin/trunk',
  baseCommit: 'c0ffee',
  tree: `tree-${name}`,
  files: files.map((one) => ({ ...one, repository: name, treePath: `${name}/${one.path}` })),
  added: 0,
  removed: 0,
  changedOutside: false,
  sequence: 1,
  unreadable: null,
  ...rest,
})

const live = (...repositories: DiffRepository[]): MissionDiff => ({
  source: 'live',
  checkpoint: null,
  repositories,
})

const text = (value: string) =>
  DiffText.make({ text: value, encoding: 'utf-8', size: value.length })

const read = (before: string | null, after: string | null): SideRead => ({
  kind: 'read',
  contents: DiffSides.make({
    before: before === null ? null : text(before),
    after: after === null ? null : text(after),
  }),
})

describe('The files of the diff', () => {
  test('a file whose sides are read carries them; one still read has none yet', () => {
    const diff = live(repository('api', [file('src/export.ts'), file('src/query.ts')]))
    const sides = new Map([['api/src/export.ts', read('a\n', 'b\n')]])
    const [api] = repositoriesOf(diff, sides)
    expect(api?.name).toBe('api')
    expect(api?.files.map((one) => one.sides)).toEqual([{ before: 'a\n', after: 'b\n' }, undefined])
  })

  test('a rename, an untracked, a generated and a file changed outside keep their marks', () => {
    const diff = live(
      repository(
        'web',
        [
          file('src/table.tsx', { letter: 'R', oldPath: 'src/tables.tsx' }),
          file('notes.md', { letter: 'A', untracked: true }),
          file('src/client.ts', { generated: true }),
          file('src/row.tsx', { changedOutside: '2026-10-20T09:00:00Z' }),
        ],
        { changedOutside: true },
      ),
    )
    const [web] = repositoriesOf(diff, new Map())
    expect(web?.outside).toBe(true)
    expect(
      web?.files.map((one) => [one.path, one.from, one.untracked, one.generated, one.outside]),
    ).toEqual([
      ['src/table.tsx', 'src/tables.tsx', false, false, false],
      ['notes.md', undefined, true, false, false],
      ['src/client.ts', undefined, false, true, false],
      ['src/row.tsx', undefined, false, false, true],
    ])
  })

  test('a binary file shows its sizes in words, a withheld one neither lines nor content', () => {
    const diff = live(
      repository('web', [
        file('icon.png', {
          binary: true,
          sizeBefore: 1229,
          sizeAfter: 1638,
          added: null,
          removed: null,
        }),
        file('.env.local', { withheld: true, added: null, removed: null }),
      ]),
    )
    const [web] = repositoriesOf(diff, new Map())
    expect(web?.files[0]).toMatchObject({ binary: { before: '1.2 KB', after: '1.6 KB' }, added: 0 })
    expect(web?.files[1]).toMatchObject({ withheld: true, added: 0, removed: 0 })
    expect(sizeWords(null)).toBeNull()
    expect(sizeWords(512)).toBe('512 B')
    expect(sizeWords(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  test('a large file waits with its lines counted, and draws once its sides are read', () => {
    const diff = live(
      repository('web', [file('invoices.csv', { large: true, added: 10_000, removed: 0 })]),
    )
    const tooLarge: SideRead = {
      kind: 'read',
      contents: DiffTooLarge.make({ sizeBefore: null, sizeAfter: 812_000, lines: 10_000 }),
    }
    const [waiting] = repositoriesOf(diff, new Map([['web/invoices.csv', tooLarge]]))
    expect(waiting?.files[0]?.large).toEqual({ lines: 10_000 })
    expect(waiting?.files[0]?.sides).toBeUndefined()
    const [shown] = repositoriesOf(diff, new Map([['web/invoices.csv', read(null, 'a\n')]]))
    expect(shown?.files[0]?.sides).toEqual({ before: null, after: 'a\n' })
  })

  test('a side Git could not read, or a repository it could not read, is said in words', () => {
    const diff = live(
      repository('api', [file('src/export.ts')]),
      repository('web', [], { unreadable: 'not a git repository' }),
    )
    const failed: SideRead = { kind: 'failed', why: 'fatal: bad object' }
    const [api, web] = repositoriesOf(diff, new Map([['api/src/export.ts', failed]]))
    expect(api?.files[0]?.unreadable).toBe('fatal: bad object')
    expect(web?.unreadable).toBe('not a git repository')
  })
})

describe('What moves while the user reads', () => {
  test('a change replaces the files it names, adds the new ones and drops the gone ones', () => {
    const diff = live(
      repository('api', [file('src/a.ts'), file('src/b.ts')]),
      repository('web', [file('src/c.ts')]),
    )
    const change: DiffChange = {
      repository: 'api',
      sequence: 2,
      files: [
        { ...file('src/a.ts', { added: 9 }), treePath: 'api/src/a.ts' },
        { ...file('src/new.ts', { letter: 'A' }), treePath: 'api/src/new.ts' },
      ],
      gone: ['src/b.ts'],
      unreadable: null,
    }
    const next = withChange(diff, change)
    const [api, web] = next.repositories
    expect(api?.files.map((one) => [one.path, one.added])).toEqual([
      ['src/a.ts', 9],
      ['src/new.ts', 3],
    ])
    expect(api?.sequence).toBe(2)
    expect(web).toBe(diff.repositories[1])
  })

  test('a change of a repository the diff did not list adds it', () => {
    const change: DiffChange = {
      repository: 'shared',
      sequence: 1,
      files: [{ ...file('src/zone.ts'), repository: 'shared', treePath: 'shared/src/zone.ts' }],
      gone: [],
      unreadable: null,
    }
    expect(withChange(live(), change).repositories.map((one) => one.repository)).toEqual(['shared'])
  })
})

describe('Which sides are asked for', () => {
  const diff = live(
    repository('api', [
      file('src/a.ts'),
      file('src/b.ts'),
      file('icon.png', { binary: true }),
      file('.env.local', { withheld: true }),
      file('invoices.csv', { large: true }),
    ]),
  )

  test('every text file not read nor being read, never a binary or a withheld one', () => {
    const asked = toRead(diff, new Map([['api/src/a.ts', read('', '')]]), new Set(), new Set())
    expect(asked).toEqual([
      { repository: 'api', path: 'src/b.ts', force: false },
      // Its lines counted, its sides kept until asked for.
      { repository: 'api', path: 'invoices.csv', force: false },
    ])
  })

  test('a large file only once its Show was pressed, and then with force', () => {
    expect(
      toRead(
        diff,
        new Map(),
        new Set(['api/invoices.csv']),
        new Set(['api/src/a.ts', 'api/src/b.ts']),
      ),
    ).toEqual([{ repository: 'api', path: 'invoices.csv', force: true }])
  })
})

const feedback = (id: string, rest: Partial<FeedbackView> = {}): FeedbackView => ({
  id,
  missionId: 'm1',
  round: 1,
  author: FeedbackUser.make({}),
  kind: 'code',
  state: 'waiting',
  body: `Body of ${id}`,
  version: 1,
  versions: [],
  images: [],
  anchor: CodeAnchorView.make({
    repository: 'api',
    path: 'src/query.ts',
    side: 'new',
    lines: { start: 57, end: 60 },
    tree: 'tree-api',
    excerpt: { before: [], lines: ['const rows = await db.select("*")'], after: [], start: 57 },
    live: AnchorCurrent.make({ path: 'src/query.ts', lines: { start: 57, end: 60 } }),
  }),
  followsUp: null,
  followedBy: [],
  answer: null,
  withdrawable: true,
  resolvable: false,
  createdAt: '2026-10-20T09:47:00Z',
  updatedAt: '2026-10-20T09:47:00Z',
  ...rest,
})

const reviewOf = (...all: FeedbackView[]): ReviewStateView => ({
  missionId: 'm1',
  checkpoints: [],
  rounds: [],
  feedback: all,
  waits: false,
  fixable: false,
})

const NOW = new Date('2026-10-20T10:00:00Z')

describe('The comments under their lines', () => {
  test('each code comment of the user is named F and its number, in the order it was written', () => {
    const { comments, byName } = commentsOf(
      reviewOf(
        feedback('uuid-b', { createdAt: '2026-10-20T09:50:00Z' }),
        feedback('uuid-a', { createdAt: '2026-10-20T09:40:00Z' }),
        feedback('uuid-spec', {
          kind: 'remark',
          anchor: SpecAnchorView.make({ item: 'R2' }),
          createdAt: '2026-10-20T09:45:00Z',
        }),
      ),
      NOW,
    )
    expect(comments.map((one) => one.id)).toEqual(['F1', 'F3'])
    expect(byName.get('F1')?.id).toBe('uuid-a')
    expect(byName.get('F3')?.id).toBe('uuid-b')
    expect(comments[0]).toMatchObject({
      kind: 'remark',
      state: 'waiting',
      text: 'Body of uuid-a',
      place: {
        repository: 'api',
        path: 'src/query.ts',
        side: 'new',
        lines: { start: 57, end: 60 },
      },
      at: '20 min',
    })
  })

  test('a question stays a question, a comment in a round says which', () => {
    const { comments } = commentsOf(
      reviewOf(feedback('q', { kind: 'question' }), feedback('r', { state: 'in_round', round: 2 })),
      NOW,
    )
    expect(comments.map((one) => [one.kind, one.state, one.round])).toEqual([
      ['question', 'waiting', 1],
      ['remark', 'inRound', 2],
    ])
  })

  test('a comment moved with its lines stands where they are now and says where it was written', () => {
    const { comments } = commentsOf(
      reviewOf(
        feedback('m', {
          anchor: CodeAnchorView.make({
            repository: 'api',
            path: 'src/query.ts',
            side: 'new',
            lines: { start: 57, end: 60 },
            tree: 'tree-api',
            excerpt: null,
            live: AnchorMoved.make({ path: 'src/query.ts', lines: { start: 63, end: 66 } }),
          }),
        }),
      ),
      NOW,
    )
    expect(comments[0]?.place.lines).toEqual({ start: 63, end: 66 })
    expect(comments[0]?.movedFrom).toEqual({ start: 57, end: 60 })
  })

  test('an outdated comment stands at its file’s head with the excerpt and the version it was written on', () => {
    const { comments } = commentsOf(
      reviewOf(
        feedback('o', {
          state: 'addressed',
          anchor: CodeAnchorView.make({
            repository: 'shared',
            path: 'src/time-zone.ts',
            side: 'new',
            lines: { start: 12, end: 14 },
            tree: 'tree-shared',
            excerpt: {
              before: ['// before'],
              lines: ['export function inZone() {', '}'],
              after: [],
              start: 12,
            },
            live: AnchorOutdated.make({ why: 'its lines changed' }),
          }),
        }),
      ),
      NOW,
    )
    expect(comments[0]?.place).toEqual({
      repository: 'shared',
      path: 'src/time-zone.ts',
      side: 'new',
      lines: null,
    })
    expect(comments[0]?.outdated).toEqual({
      excerpt: 'export function inZone() {\n}',
      version: 'round 1, 13 min',
    })
  })

  test('the agent’s answer and the user’s follow-up stand under it, the follow-up never on its own', () => {
    const { comments } = commentsOf(
      reviewOf(
        feedback('a', { state: 'addressed', answer: 'Disabled while it runs.', followedBy: ['f'] }),
        feedback('f', {
          followsUp: 'a',
          body: 'Keyboard presses too.',
          createdAt: '2026-10-20T09:58:00Z',
        }),
      ),
      NOW,
    )
    expect(comments).toHaveLength(1)
    expect(comments[0]?.thread).toEqual([
      { who: 'agent', text: 'Disabled while it runs.' },
      { who: 'you', text: 'Keyboard presses too.', at: '2 min' },
    ])
  })

  test('a team member’s comment from the forge is named C, with its author, resolved there or not', () => {
    const { comments } = commentsOf(
      reviewOf(
        feedback('t', { author: FeedbackForge.make({ login: 'ana.lopez' }), state: 'resolved' }),
      ),
      NOW,
    )
    expect(comments[0]).toMatchObject({
      id: 'C1',
      team: { name: 'ana.lopez', forge: 'GitHub', resolved: true },
    })
  })
})

describe('Where the diff is read from', () => {
  test('the Workspace, live, and while a round writes it, which round', () => {
    expect(sourceOf(live(), 'Building', 2)).toEqual({ kind: 'live', round: 2 })
    expect(sourceOf(live(), 'Review', 1)).toEqual({ kind: 'live' })
    expect(sourceOf(live(), 'Building', 0)).toEqual({ kind: 'live' })
  })

  test('the last checkpoint once the Workspace is gone: when, and why in words', () => {
    const diff: MissionDiff = {
      source: 'checkpoint',
      checkpoint: { id: 'k1', kind: 'round_end', takenAt: '2026-10-12T17:02:00' },
      repositories: [],
    }
    expect(sourceOf(diff, 'Done', 1)).toEqual({
      kind: 'checkpoint',
      at: '12 October at 17:02',
      why: 'done',
    })
    expect(sourceOf(diff, 'Review', 1)).toMatchObject({ why: 'cleanup' })
  })

  test('a mission with neither Workspace nor checkpoint reads as live and empty', () => {
    expect(
      sourceOf({ source: 'checkpoint', checkpoint: null, repositories: [] }, 'Planning', 0),
    ).toEqual({
      kind: 'live',
    })
  })
})

describe('The anchor a new comment is written on', () => {
  test('its place, on the tree the window showed', () => {
    const diff = live(repository('api', [file('src/query.ts')]))
    expect(
      anchorOf(
        { repository: 'api', path: 'src/query.ts', side: 'old', lines: { start: 3, end: 4 } },
        diff,
      ),
    ).toEqual(
      CodeAnchorAsked.make({
        repository: 'api',
        path: 'src/query.ts',
        side: 'old',
        lines: { start: 3, end: 4 },
        tree: 'tree-api',
      }),
    )
    expect(
      anchorOf({ repository: 'web', path: 'a.ts', side: 'new', lines: null }, diff).tree,
    ).toBeNull()
  })
})
