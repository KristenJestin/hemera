/**
 * ACME-12 as the engine answers it once it is Ready or Building: the read models of the Ready and
 * Building pages, plain values a test spreads its own case over. Neutral data only.
 */

import { AgentWorking } from '@hemera/core/domain'
import { AgentAuthor, FetchedNow, Qualified } from '@hemera/ipc'
import type {
  AgentState,
  AutoReviewView,
  BuildingAttemptView,
  BuildingPreparation,
  BuildingTaskView,
  BuildingView,
  CheckModel,
  Command,
  HelperChip,
  JournalLine,
  MissionBudget,
  MissionDiff,
  MissionGrant,
  MissionService,
  Now,
  PrelaunchView,
  ScenarioProofView,
  Spec,
  SpecRequirement,
} from '@hemera/ipc'

/** Monday 12 October 2026, 11:00 local time: the moment the pages are read at. */
export const NOW = new Date(2026, 9, 12, 11, 0)

/** A local moment of `NOW`'s day, or of the day before. */
export const at = (hours: number, minutes: number, daysBefore = 0): string =>
  new Date(2026, 9, 12 - daysBefore, hours, minutes).toISOString()

const scenario = (id: string, when: string, then: string) => ({
  id,
  when,
  then,
  version: 1,
  proof: null,
  proofVersion: 0,
})

export const requirement = (more: Partial<SpecRequirement> = {}): SpecRequirement => ({
  id: 'R1',
  domain: 'Billing',
  delta: 'added',
  livingRef: null,
  livingVersion: null,
  text: 'Export the invoices of the current filters as CSV',
  version: 1,
  removed: false,
  scenarios: [
    scenario('S1', 'the user exports with a filter', 'The file holds the filtered invoices'),
    scenario('S2', 'the user exports without a filter', 'No filter exports every invoice'),
  ],
  newDomain: false,
  againstProposed: false,
  reliesOn: [],
  ...more,
})

export const spec = (more: Partial<Spec> = {}): Spec => ({
  missionId: 'm12',
  key: 'ACME-12',
  title: 'Export invoices as CSV from the billing page',
  type: 'feature',
  stage: 'ready',
  language: 'en',
  version: 9,
  declaredCompleteVersion: 9,
  frozen: true,
  readVersion: 9,
  sections: [
    {
      name: 'why',
      title: 'Why',
      body: 'Customers ask for their invoices in a spreadsheet.',
      version: 1,
      state: 'written',
      writtenAt: at(16, 0, 1),
    },
  ],
  requirements: [
    requirement(),
    requirement({
      id: 'R2',
      text: 'Name the file after the filters',
      scenarios: [scenario('S3', 'a filter is set', 'The name carries the customer and the range')],
    }),
    requirement({ id: 'R3', text: 'A requirement taken out', removed: true, scenarios: [] }),
  ],
  triage: null,
  tasks: [],
  tasksVersion: 1,
  recommendation: {
    agent: 'claude',
    model: 'opus',
    effort: 'high',
    reason: 'Nine requirements across three repositories: a model that holds a long plan.',
    checked: true,
    at: at(16, 50, 1),
  },
  ...more,
})

export const model = (more: Partial<CheckModel> = {}): CheckModel => ({
  setting: { agent: 'claude', model: 'opus', effort: 'high' },
  level: 'project',
  recommendation: {
    agent: 'claude',
    model: 'opus',
    effort: 'high',
    reason: 'Nine requirements across three repositories: a model that holds a long plan.',
  },
  ...more,
})

export const check = (more: Partial<PrelaunchView> = {}): PrelaunchView => ({
  id: 'c1',
  missionId: 'm12',
  missionKey: 'ACME-12',
  kind: 'full',
  state: 'done',
  startedAt: at(10, 50),
  endedAt: at(10, 52),
  steps: [
    { step: 'dependencies', state: 'done', said: 'ACME-9 is Done' },
    { step: 'base', state: 'done', said: 'api, web and shared fetched' },
    { step: 'moved', state: 'done', said: 'Nothing moved' },
    { step: 'handed', state: 'skipped', said: 'Nothing to hand' },
    { step: 'agent', state: 'skipped', said: 'No agent needed' },
    { step: 'model', state: 'done', said: 'Claude Code · opus · high' },
  ],
  dependencies: [{ key: 'ACME-9', stage: 'done', done: true }],
  bases: [
    {
      repositoryId: 'r-api',
      repository: 'api',
      frozen: 'a1',
      commit: 'a1',
      ref: 'origin/main',
      freshness: FetchedNow.make({ at: at(10, 51) }),
    },
  ],
  moved: [],
  handed: [],
  agent: { state: 'skipped', summary: null, said: 'Nothing was handed' },
  model: model(),
  verdict: { outdated: false, blockedBy: [], actions: ['launch'], said: 'Nothing moved' },
  ...more,
})

export const preparation = (more: Partial<BuildingPreparation> = {}): BuildingPreparation => ({
  missionId: 'm12',
  launchId: 'l1',
  state: 'preparing',
  workspaceId: 'w1',
  branch: 'feat/acme-12-export-invoices',
  steps: [
    {
      id: 'p1',
      position: 1,
      kind: 'worktree',
      base: 'api',
      path: null,
      commandId: null,
      line: null,
      state: 'done',
      failure: null,
    },
    {
      id: 'p2',
      position: 2,
      kind: 'copy',
      base: 'api',
      path: '.env',
      commandId: null,
      line: null,
      state: 'done',
      failure: null,
    },
    {
      id: 'p3',
      position: 3,
      kind: 'run',
      base: 'web',
      path: null,
      commandId: 'install',
      line: 'pnpm install',
      state: 'running',
      failure: null,
    },
  ],
  needId: null,
  now: 'Preparing the Workspace (step 3 of 3)',
  ...more,
})

export const AGENTS: AgentState[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    installed: true,
    version: '2.1.0',
    signedIn: true,
    installer: 'npm',
    qualification: Qualified.make({}),
    installHint: '',
    loginHint: '',
    latest: null,
  },
]

export const grant = (more: Partial<MissionGrant> = {}): MissionGrant => ({
  id: 'g1',
  missionId: 'm12',
  action: 'Run the api’s database migrations on the test database',
  givenBy: 'user',
  givenAt: at(9, 31),
  uses: 4,
  state: 'live',
  reason: null,
  ...more,
})

export const budget = (more: Partial<MissionBudget> = {}): MissionBudget => ({
  counters: [
    { counter: 'launches', spent: 1, limit: 8 },
    { counter: 'attempts', spent: 12, limit: 30 },
    { counter: 'rounds', spent: 0, limit: 3 },
  ],
  usage: {
    inputTokens: 3_200_000,
    outputTokens: 900_000,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    cachedShare: null,
    cost: { amount: 12.4, currency: 'USD' },
    measured: true,
  },
  ...more,
})

const tree = (repository: string) => ({ repository, tree: `${repository}-tree` })

export const attempt = (more: Partial<BuildingAttemptView> = {}): BuildingAttemptView => ({
  id: 'a1',
  scope: 'task',
  subject: null,
  number: 1,
  runner: 'Builder · Claude Code · opus · high',
  startedAt: at(10, 0),
  endedAt: at(10, 11),
  outcome: 'done',
  summary: null,
  starts: [tree('web')],
  ends: [tree('web')],
  outside: [],
  verdict: 'green',
  files: [],
  checks: [],
  conflicts: [],
  ...more,
})

export const task = (more: Partial<BuildingTaskView> = {}): BuildingTaskView => ({
  id: 'T1',
  title: 'Add the export endpoint',
  result: 'An endpoint streams the invoices of the filters.',
  origin: 'spec',
  requirements: ['R1'],
  scenarios: ['S1'],
  targets: [{ repository: 'api', path: 'src/invoices/export.ts', intent: 'create' }],
  dependsOn: [],
  state: 'done',
  verified: true,
  runner: null,
  blockedBy: null,
  waiting: null,
  skippedReason: null,
  replacedBy: [],
  decisionId: null,
  attempts: [],
  changes: [],
  ...more,
})

export const proof = (more: Partial<ScenarioProofView> = {}): ScenarioProofView => ({
  scenario: 'S1',
  requirement: 'R1',
  mode: 'automated',
  state: 'green',
  red: null,
  green: null,
  upToDate: true,
  testChanged: false,
  manual: null,
  ...more,
})

export const building = (more: Partial<BuildingView> = {}): BuildingView => ({
  missionId: 'm12',
  buildingId: 'b1',
  label: 'Building',
  round: null,
  state: 'active',
  phase: 'tasks',
  percent: 40,
  counts: { tasksDone: 1, tasks: 3, requirementsProven: 0, requirements: 2 },
  special: { done: 0, total: 0 },
  elapsedSeconds: 3600,
  startedAt: at(9, 0),
  endedAt: null,
  repositories: [
    {
      name: 'api',
      folder: '/tmp/acme-12/api',
      branch: 'feat/acme-12-export-invoices',
      baseCommit: 'a1',
    },
    {
      name: 'web',
      folder: '/tmp/acme-12/web',
      branch: 'feat/acme-12-export-invoices',
      baseCommit: 'b1',
    },
  ],
  requirements: [
    {
      id: 'R1',
      done: false,
      tasks: ['T1', 'T2'],
      proven: false,
      scenarios: [proof(), proof({ scenario: 'S2', state: 'red_recorded' })],
      byHand: { total: 0, validated: 0 },
    },
    {
      id: 'R2',
      done: false,
      tasks: ['T3'],
      proven: false,
      scenarios: [proof({ scenario: 'S3', requirement: 'R2', state: 'waiting_red' })],
      byHand: { total: 0, validated: 0 },
    },
  ],
  tasks: [
    task(),
    task({
      id: 'T2',
      title: 'The export button on the billing page',
      targets: [{ repository: 'web', path: 'src/billing/export-button.tsx', intent: 'change' }],
      state: 'in_progress',
      verified: null,
      runner: 'builder-1',
    }),
    task({
      id: 'T3',
      title: 'Build the file name from the filters',
      requirements: ['R2'],
      scenarios: ['S3'],
      state: 'waiting',
      verified: null,
    }),
  ],
  decisions: [],
  scopes: [],
  unattributed: [],
  documenter: [],
  summary: null,
  ...more,
})

export const now = (more: Partial<Now> = {}): Now => ({
  missionId: 'm12',
  key: 'ACME-12',
  stage: 'building',
  round: 0,
  marks: [],
  ball: AgentWorking.make({}),
  waiting: [],
  running: [],
  slotWait: null,
  end: [],
  next: null,
  doing: [
    {
      sessionId: 's2',
      role: 'helper',
      text: 'Writes the labels of the export menu',
      main: false,
      updatedAt: at(10, 58),
    },
    {
      sessionId: 's1',
      role: 'builder',
      text: 'Writes the export button (T2)',
      main: true,
      updatedAt: at(10, 59),
    },
  ],
  ...more,
})

export const line = (more: Partial<JournalLine> = {}): JournalLine => ({
  sequence: 10,
  missionId: 'm12',
  at: at(10, 58),
  kind: 'agent',
  author: AgentAuthor.make({ role: 'builder', sessionId: 's1' }),
  text: 'R1 proven: S1 green',
  fields: {},
  refs: { need: null, task: null, run: null, evidence: null, session: 's1' },
  ...more,
})

export const service = (more: Partial<MissionService> = {}): MissionService => ({
  runId: 'run-api',
  commandId: 'cmd-api',
  name: 'api',
  state: 'ready',
  url: 'http://localhost:3012',
  startedBy: 'user',
  sessionId: null,
  since: at(10, 0),
  endedAt: null,
  outputTail: '',
  dismissable: false,
  ...more,
})

export const command = (more: Partial<Command> = {}): Command => ({
  id: 'cmd-api',
  projectId: 'acme',
  name: 'api',
  type: 'serve',
  line: 'pnpm --filter api dev',
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
  ...more,
})

export const helper = (more: Partial<HelperChip> = {}): HelperChip => ({
  id: 'h1',
  missionId: 'm12',
  number: 1,
  label: 'H1',
  name: 'Helper',
  definition: null,
  icon: 'user',
  letter: 'H',
  tone: 'info',
  depth: 1,
  task: 'T2',
  state: 'running',
  stuck: false,
  step: 'Writes the labels of the export menu',
  verdict: null,
  startedAt: at(10, 50),
  endedAt: null,
  ...more,
})

export const review = (more: Partial<AutoReviewView> = {}): AutoReviewView => ({
  missionId: 'm12',
  buildingId: 'b1',
  phase: 'review',
  checkpoint: null,
  passes: [],
  findings: [],
  changedAfter: [],
  ...more,
})

export const diff = (more: Partial<MissionDiff> = {}): MissionDiff => ({
  source: 'live',
  checkpoint: null,
  repositories: [],
  ...more,
})
