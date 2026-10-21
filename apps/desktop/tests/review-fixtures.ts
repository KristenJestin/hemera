/**
 * The engine's reads of a mission in Review, as the window receives them, for the Review page's
 * model and follower: neutral data of ACME-12, each builder taking what a test changes.
 */

import {
  FeedbackUser,
  type FeedbackView,
  type Question,
  type MissionPushes,
  type ProofsView,
  type RepositoryPush,
  type ReviewStateView,
  type RoundDetailView,
  type ShipPreview,
  type ShipProgress,
  type TeamCommentView,
} from '@hemera/ipc'

import { at } from './building-fixtures.ts'

export const feedback = (more: Partial<FeedbackView> = {}): FeedbackView => ({
  id: 'fb-1',
  missionId: 'm12',
  round: 1,
  author: FeedbackUser.make({}),
  kind: 'remark',
  state: 'waiting',
  body: 'The date column follows the browser, not the customer.',
  version: 1,
  versions: [
    {
      version: 1,
      body: 'The date column follows the browser, not the customer.',
      writtenAt: at(10, 0),
    },
  ],
  images: [],
  anchor: null,
  followsUp: null,
  followedBy: [],
  answer: null,
  withdrawable: true,
  resolvable: false,
  createdAt: at(10, 0),
  updatedAt: at(10, 0),
  ...more,
})

export const reviewState = (more: Partial<ReviewStateView> = {}): ReviewStateView => ({
  missionId: 'm12',
  checkpoints: [],
  rounds: [{ number: 1, state: 'collecting', createdAt: at(9, 30), movedAt: at(9, 30) }],
  feedback: [],
  waits: false,
  fixable: false,
  ...more,
})

export const roundDetail = (more: Partial<RoundDetailView> = {}): RoundDetailView => ({
  missionId: 'm12',
  number: 1,
  state: 'grilling',
  readyWhy: null,
  points: [],
  tasks: [],
  decisions: [],
  questions: [],
  progress: { done: 0, tasks: 0 },
  ...more,
})

export const proofsView = (more: Partial<ProofsView> = {}): ProofsView => ({
  missionId: 'm12',
  scenarios: [],
  finalChecks: [],
  writtenBeforeRed: [],
  ...more,
})

export const repositoryPush = (more: Partial<RepositoryPush> = {}): RepositoryPush => ({
  repositoryId: 'repo-api',
  repository: 'api',
  state: 'done',
  step: null,
  message: null,
  waitingFor: null,
  commit: 'c0ffee',
  pushedAt: at(10, 30),
  pullRequest: {
    forge: 'github',
    host: 'github.com',
    number: 412,
    url: 'https://github.com/acme/api/pull/412',
    state: 'open',
    head: 'c0ffee',
    reviewDecision: null,
    approvals: [],
  },
  images: [],
  imagesReason: null,
  ...more,
})

export const pushes = (more: Partial<MissionPushes> = {}): MissionPushes => ({
  missionId: 'm12',
  rulesVersion: 1,
  repositories: [],
  ...more,
})

export const teamComment = (more: Partial<TeamCommentView> = {}): TeamCommentView => ({
  id: 'tc-1',
  missionId: 'm12',
  repository: 'api',
  forge: 'github',
  host: 'github.com',
  slug: 'acme/api',
  number: 412,
  commentId: '9001',
  kind: 'inline',
  review: null,
  thread: null,
  author: 'ana.lopez',
  mine: false,
  body: 'Two exports at once would both hit the database.',
  version: 1,
  versions: [
    { version: 1, body: 'Two exports at once would both hit the database.', at: at(10, 40) },
  ],
  createdAt: at(10, 40),
  updatedAt: at(10, 40),
  url: 'https://github.com/acme/api/pull/412#discussion_r9001',
  anchor: null,
  forgeResolved: false,
  removedOnForge: false,
  state: 'received',
  arrivedIn: 'review',
  reading: 'Asks for a limit on concurrent exports.',
  reply: 'Good catch: one export per user at a time.',
  myTake: null,
  feedbackId: null,
  editedAfterIntegration: false,
  ...more,
})

export const shipPreview = (more: Partial<ShipPreview> = {}): ShipPreview => ({
  missionId: 'm12',
  previewId: 'preview-1',
  possible: false,
  reasons: ['round 1 waits for its Fix'],
  repositories: [],
  manualProofs: [],
  preparationChange: null,
  delivered: null,
  ...more,
})

export const shipProgress = (more: Partial<ShipProgress> = {}): ShipProgress => ({
  missionId: 'm12',
  step: 'idle',
  reruns: [],
  message: null,
  ...more,
})

export const question = (more: Partial<Question> = {}): Question => ({
  id: 'Q7',
  wave: 3,
  text: 'Should the progress stay hidden for exports under a second?',
  why: 'R4 shows it from the first row.',
  options: [
    { id: 'A', label: 'Clarify with a note', detail: '' },
    { id: 'B', label: 'Withdraw the remark', detail: '' },
    { id: 'C', label: 'Cancel the mission', detail: '' },
  ],
  recommended: 'A',
  recommendedReason: 'The remark asks for less noise, not another rule.',
  section: null,
  fromFinding: null,
  replaces: null,
  replacedBy: null,
  state: 'open',
  waitingNote: null,
  retiredReason: null,
  mootDecision: null,
  askedAt: at(10, 50),
  answers: [],
  drafts: [],
  proposals: [],
  ...more,
})
