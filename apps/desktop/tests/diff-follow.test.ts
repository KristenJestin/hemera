/**
 * How the diff view follows a mission (#497): the list read, then each file's sides; a change of a
 * repository reads again only the files it names; a large file's sides asked with `force` once its
 * Show is pressed; the diff read from its checkpoint once the Workspace is gone; Review read again
 * at each change; a comment written on the tree the window showed, and its gestures sent by the
 * feedback they name; a refusal said in words.
 */

import {
  AnchorCurrent,
  CodeAnchorView,
  DiffSides,
  DiffText,
  DiffTooLarge,
  FeedbackRefused,
  FeedbackUser,
  StorageFailed,
  type DiffChange,
  type DiffContents,
  type DiffFile,
  type FeedbackView,
  type MissionDiff,
  type ReviewChange,
  type ReviewStateView,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import { followDiff, type DiffFollowLink, type DiffState } from '../src/renderer/diff-follow.ts'

const file = (repository: string, path: string, rest: Partial<DiffFile> = {}): DiffFile => ({
  repository,
  path,
  treePath: `${repository}/${path}`,
  oldPath: null,
  letter: 'M',
  untracked: false,
  added: 1,
  removed: 1,
  binary: false,
  sizeBefore: 10,
  sizeAfter: 12,
  generated: false,
  large: false,
  changedOutside: null,
  withheld: false,
  ...rest,
})

const LIVE: MissionDiff = {
  source: 'live',
  checkpoint: null,
  repositories: ['api', 'web'].map((name) => ({
    repository: name,
    branch: 'acme-12',
    baseBranch: 'origin/trunk',
    baseCommit: 'c0ffee',
    tree: `tree-${name}`,
    files: [file(name, 'src/export.ts')],
    added: 1,
    removed: 1,
    changedOutside: false,
    sequence: 1,
    unreadable: null,
  })),
}

const sides = (after: string): DiffContents =>
  DiffSides.make({
    before: null,
    after: DiffText.make({ text: after, encoding: 'utf-8', size: after.length }),
  })

const NO_REVIEW: ReviewStateView = {
  missionId: 'm1',
  checkpoints: [],
  rounds: [],
  feedback: [],
  waits: false,
  fixable: false,
}

const feedback = (id: string): FeedbackView => ({
  id,
  missionId: 'm1',
  round: 1,
  author: FeedbackUser.make({}),
  kind: 'code',
  state: 'waiting',
  body: 'Select only the columns the CSV writes.',
  version: 3,
  versions: [],
  images: [],
  anchor: CodeAnchorView.make({
    repository: 'api',
    path: 'src/export.ts',
    side: 'new',
    lines: { start: 2, end: 2 },
    tree: 'tree-api',
    excerpt: null,
    live: AnchorCurrent.make({ path: 'src/export.ts', lines: { start: 2, end: 2 } }),
  }),
  followsUp: null,
  followedBy: [],
  answer: null,
  withdrawable: true,
  resolvable: false,
  createdAt: '2026-10-20T09:00:00Z',
  updatedAt: '2026-10-20T09:00:00Z',
})

/** A link that answers the diff's calls from what the test sets, and records what was asked. */
function fakeLink(diff: MissionDiff = LIVE) {
  const asked: string[] = []
  const reads: { key: string; resolve: (contents: DiffContents) => void }[] = []
  let changes: (change: DiffChange) => void = () => undefined
  let reviewChanges: (change: ReviewChange) => void = () => undefined
  let review = NO_REVIEW
  const link: DiffFollowLink = {
    liveDiff: () => {
      asked.push('live')
      return Promise.resolve(diff)
    },
    onDiffChanges: (_mission, listener) => {
      changes = listener
      return () => undefined
    },
    diffFile: (_mission, repository, path, force) => {
      asked.push(`file ${repository}/${path}${force ? ' force' : ''}`)
      return new Promise((resolve) => reads.push({ key: `${repository}/${path}`, resolve }))
    },
    diffFileAtCheckpoint: (checkpoint, repository, path) => {
      asked.push(`checkpoint ${checkpoint} ${repository}/${path}`)
      return new Promise((resolve) => reads.push({ key: `${repository}/${path}`, resolve }))
    },
    reviewState: () => {
      asked.push('review')
      return Promise.resolve(review)
    },
    onReviewChanges: (_mission, listener) => {
      reviewChanges = listener
      return () => undefined
    },
    addFeedback: (_mission, kind, body, anchor) => {
      asked.push(`add ${kind} ${JSON.stringify(anchor)} ${body}`)
      return Promise.resolve(feedback('new'))
    },
    editFeedback: (id, body, version) => {
      asked.push(`edit ${id} ${String(version)} ${body}`)
      return Promise.resolve(feedback(id))
    },
    withdrawFeedback: (id) => {
      asked.push(`withdraw ${id}`)
      return Promise.reject(new FeedbackRefused({ reason: 'A round already took it.' }))
    },
    resolveFeedback: (id) => {
      asked.push(`resolve ${id}`)
      return Promise.resolve(feedback(id))
    },
    followUpFeedback: (id, body) => {
      asked.push(`follow ${id} ${body}`)
      return Promise.resolve(feedback(id))
    },
  }
  return {
    link,
    asked,
    reads,
    change: (change: DiffChange) => changes(change),
    reviewChanged: (next: ReviewStateView) => {
      review = next
      reviewChanges({ missionId: 'm1', sequence: 2 })
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function following(fake: ReturnType<typeof fakeLink>, link: DiffFollowLink = fake.link) {
  let last: DiffState | null = null
  const handle = followDiff(link, 'm1', (state) => {
    last = state
  })
  return {
    handle,
    state: (): DiffState => {
      if (last === null) throw new Error('nothing emitted yet')
      return last
    },
  }
}

describe('Reading the diff', () => {
  test('the list first, then each file’s sides, as each arrives', async () => {
    const fake = fakeLink()
    const view = following(fake)
    await settle()
    expect(fake.asked).toEqual([
      'live',
      'review',
      'file api/src/export.ts',
      'file web/src/export.ts',
    ])
    expect(view.state().diff).toBe(LIVE)
    fake.reads[0]?.resolve(sides('one\n'))
    await settle()
    expect(view.state().sides.get('api/src/export.ts')).toEqual({
      kind: 'read',
      contents: sides('one\n'),
    })
    expect(view.state().sides.has('web/src/export.ts')).toBe(false)
  })

  test('a change of one repository reads again only the files it names', async () => {
    const fake = fakeLink()
    const view = following(fake)
    await settle()
    for (const read of fake.reads) read.resolve(sides('one\n'))
    await settle()
    fake.asked.length = 0
    fake.change({
      repository: 'web',
      sequence: 2,
      files: [file('web', 'src/export.ts', { added: 4 })],
      gone: [],
      unreadable: null,
    })
    await settle()
    expect(fake.asked).toEqual(['review', 'file web/src/export.ts'])
    expect(view.state().sides.get('api/src/export.ts')).toBeDefined()
    expect(view.state().sides.has('web/src/export.ts')).toBe(false)
  })

  test('a read overtaken by a change is not heard: the next one is', async () => {
    const fake = fakeLink()
    const view = following(fake)
    await settle()
    const stale = fake.reads[1]
    fake.change({
      repository: 'web',
      sequence: 2,
      files: [file('web', 'src/export.ts')],
      gone: [],
      unreadable: null,
    })
    await settle()
    stale?.resolve(sides('old\n'))
    await settle()
    expect(view.state().sides.has('web/src/export.ts')).toBe(false)
    fake.reads.at(-1)?.resolve(sides('new\n'))
    await settle()
    expect(view.state().sides.get('web/src/export.ts')).toEqual({
      kind: 'read',
      contents: sides('new\n'),
    })
  })

  test('a large file’s sides are asked with force once its Show is pressed', async () => {
    const [api] = LIVE.repositories
    if (api === undefined) throw new Error('no api')
    const fake = fakeLink({
      ...LIVE,
      repositories: [{ ...api, files: [file('api', 'big.csv', { large: true })] }],
    })
    const view = following(fake)
    await settle()
    fake.reads[0]?.resolve(
      DiffTooLarge.make({ sizeBefore: null, sizeAfter: 9_000_000, lines: 10_000 }),
    )
    await settle()
    view.handle.show('api/big.csv')
    await settle()
    expect(fake.asked.at(-1)).toBe('file api/big.csv force')
  })

  test('once the Workspace is gone, the sides are read from the checkpoint', async () => {
    const fake = fakeLink({
      ...LIVE,
      source: 'checkpoint',
      checkpoint: { id: 'k1', kind: 'round_end', takenAt: '2026-10-12T17:02:00Z' },
    })
    following(fake)
    await settle()
    expect(fake.asked).toContain('checkpoint k1 api/src/export.ts')
  })

  test('a list the engine could not read is said in words, and read again on Retry', async () => {
    const fake = fakeLink()
    let fail = true
    const link: DiffFollowLink = {
      ...fake.link,
      liveDiff: (mission) =>
        fail
          ? Promise.reject(
              new StorageFailed({
                sentence: 'Hemera could not write its storage: the disk is full.',
              }),
            )
          : fake.link.liveDiff(mission),
    }
    const view = following(fake, link)
    await settle()
    expect(view.state().error).toMatch(/disk is full/)
    fail = false
    view.handle.retry()
    await settle()
    expect(view.state().error).toBeUndefined()
    expect(view.state().diff).toBe(LIVE)
  })
})

describe('Review, and what the user writes', () => {
  test('Review is read again at each change of it', async () => {
    const fake = fakeLink()
    const view = following(fake)
    await settle()
    fake.reviewChanged({ ...NO_REVIEW, feedback: [feedback('f1')] })
    await settle()
    expect(view.state().review?.feedback.map((one) => one.id)).toEqual(['f1'])
  })

  test('a comment is written on its place and the tree the window showed', async () => {
    const fake = fakeLink()
    const view = following(fake)
    await settle()
    view.handle.add({
      kind: 'remark',
      text: 'Name the table after what it holds.',
      place: { repository: 'api', path: 'src/export.ts', side: 'new', lines: { start: 2, end: 3 } },
    })
    view.handle.add({
      kind: 'question',
      text: 'Why a uuid?',
      place: { repository: 'api', path: 'src/export.ts', side: 'new', lines: null },
    })
    await settle()
    expect(fake.asked).toContain(
      'add code {"_tag":"Code","repository":"api","path":"src/export.ts","side":"new","lines":{"start":2,"end":3},"tree":"tree-api"} Name the table after what it holds.',
    )
    expect(
      fake.asked.some((one) => one.startsWith('add question ') && one.includes('"lines":null')),
    ).toBe(true)
  })

  test('each gesture goes to the feedback it names, an edit on the version read', async () => {
    const fake = fakeLink()
    const view = following(fake)
    await settle()
    fake.reviewChanged({ ...NO_REVIEW, feedback: [feedback('uuid-1')] })
    await settle()
    view.handle.edit('F1', 'Only the columns it writes.')
    view.handle.act('F1', 'resolve')
    view.handle.followUp('F1', 'Keyboard presses too.')
    await settle()
    expect(fake.asked).toEqual(
      expect.arrayContaining([
        'edit uuid-1 3 Only the columns it writes.',
        'resolve uuid-1',
        'follow uuid-1 Keyboard presses too.',
      ]),
    )
  })

  test('a gesture refused is said in words', async () => {
    const fake = fakeLink()
    const view = following(fake)
    await settle()
    fake.reviewChanged({ ...NO_REVIEW, feedback: [feedback('uuid-1')] })
    await settle()
    view.handle.act('F1', 'withdraw')
    await settle()
    expect(view.state().notice).toBe('A round already took it.')
  })
})
