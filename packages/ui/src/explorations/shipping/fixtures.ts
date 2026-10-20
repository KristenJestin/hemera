import type { NeedRow } from '../../blocks/need/needs-you-list.tsx'
import type { MarkState } from '../../components/status-mark/mark-legends.ts'
import type {
  CancelledMoment,
  CiCheck,
  CleanupItem,
  Delivered,
  DeliveryWave,
  DoneMoment,
  MissionRecord,
  RepositoryDelivery,
  RepositoryState,
  ShippingMoment,
  Step,
  StepKind,
  TeamComment,
} from './types.ts'

/**
 * ACME-12 shipping, for #265: five repositories in three waves — `shared` first, then `lib-a` and
 * `lib-b` which depend on it, then `api` and `web` — each with its recipe from the delivery rules
 * (#250). `shared` and `lib-a` publish a version, `lib-b` lives on Bitbucket with a manual step,
 * `api` deploys to staging behind an approval, `web` merges on a click. Neutral data only: Acme,
 * the forge `acme/shop` on GitHub and `acme/libs` on Bitbucket.
 */

export const KEY = 'ACME-12'

export const TITLE = 'Export invoices as CSV from the billing page'

export const BRANCH = 'feat/acme-12-export-invoices'

export const LONG_TITLE =
  'Export invoices as CSV from the billing page, with the customer filters kept, the dates in the customer’s own time zone, and a progress for the long ones'

/** A repository name as long as a monorepo's package can make it. */
export const LONG_REPOSITORY = 'billing-ledger-reconciliation-service-for-enterprise-customers'

/** A forge's error as it comes, at length, a token masked. */
export const LONG_ERROR = [
  'Run pnpm --filter @acme/lib-a test --reporter=verbose',
  '  FAIL  src/currency/format.test.ts > formats a yen amount without decimals',
  "    AssertionError: expected '¥1,200.00' to be '¥1,200'",
  '      at src/currency/format.test.ts:42:18',
  '  FAIL  src/currency/format.test.ts > keeps the customer’s locale when the invoice has none of its own and the account default is missing from the settings that were migrated last spring',
  "    AssertionError: expected 'en-US' to be 'ja-JP'",
  '  Test Files  1 failed | 37 passed (38)',
  '       Tests  2 failed | 412 passed (414)',
  'npm notice Publishing with token ***',
  'Error: Process completed with exit code 1.',
].join('\n')

/** A step's task as long as a remote action's description gets. */
export const LONG_TASK =
  'acme/shop · workflow deploy-staging.yml · environment staging-eu-west-with-the-customer-sandbox-and-the-billing-replay-of-last-month · on approval'

const URL = 'https://github.example/acme/shop'

const LIBS = 'https://bitbucket.example/acme/libs'

const check = (name: string, state: MarkState, at: string): CiCheck => ({
  name,
  state,
  url: `${at}/checks/${name.toLowerCase().replaceAll(' ', '-')}`,
})

const CHECK_NAMES = ['Lint', 'Types', 'Unit tests', 'Build', 'End-to-end']

/** The checks of a CI step: how many are green, the next running, the rest to do. */
const checks = (green: number, at: string): readonly CiCheck[] =>
  CHECK_NAMES.map((name, index) =>
    check(name, index < green ? 'done' : index === green ? 'running' : 'todo', at),
  )

/** The checks of a CI step that ended red on one of them: the others green. */
const redAt = (failed: number, at: string): readonly CiCheck[] =>
  CHECK_NAMES.map((name, index) => check(name, index === failed ? 'failed' : 'done', at))

/** A cleanup item once the cleanup went through: removed, unless the guard keeps it. */
export const removedUnlessKept = (one: CleanupItem): CleanupItem =>
  one.state === 'kept' ? one : { ...one, state: 'removed' }

const step = (
  id: string,
  kind: StepKind,
  name: string,
  task: string,
  state: MarkState,
  extra: Partial<Step> = {},
): Step => ({ id, kind, name, task, state, ...extra })

// --- Recipes --------------------------------------------------------------------------------

/** Where a recipe stands: every step before `at` done, `at` in `state`, the rest to do. */
type Progress = { at: number; state: MarkState; extra?: Partial<Step> | undefined }

const DONE: Progress = { at: Number.POSITIVE_INFINITY, state: 'done' }

const NOT_STARTED: Progress = { at: 0, state: 'todo' }

function walk(steps: readonly Step[], progress: Progress): readonly Step[] {
  return steps.map((one, index) => {
    if (index < progress.at) return { ...one, state: 'done' }
    if (index === progress.at) return { ...one, state: progress.state, ...progress.extra }
    return {
      ...one,
      state: 'todo',
      outcome: undefined,
      url: undefined,
      checks: undefined,
      journal: undefined,
    }
  })
}

const journal = (...lines: [string, string][]): Step['journal'] =>
  lines.map(([at, text]) => ({ at, text }))

function shared(progress: Progress): readonly Step[] {
  return walk(
    [
      step('shared-pr', 'pullRequest', 'Pull request', 'into develop', 'done', {
        outcome: '#41',
        url: `${URL}/pull/41`,
        journal: journal(['10:02', 'Opened #41 into develop, reviewers ana.lopez and chen.wei']),
      }),
      step('shared-ci', 'ci', 'CI', 'acme/shop · workflow ci.yml', 'done', {
        outcome: '5 of 5 checks',
        url: `${URL}/actions/runs/7781`,
        checks: checks(5, URL),
        journal: journal(['10:03', 'CI started on #41'], ['10:11', '5 of 5 checks green']),
      }),
      step('shared-merge', 'merge', 'Merge', 'squash into develop', 'done', {
        outcome: 'a1b2c3d',
        url: `${URL}/commit/a1b2c3d`,
        journal: journal(['10:12', 'Merged #41 with squash as a1b2c3d']),
      }),
      step('shared-bump', 'bump', 'Bump', 'minor, from the mission’s changes', 'done', {
        outcome: '2.4.0',
        journal: journal(['10:12', 'Bumped 2.3.1 to 2.4.0: a new export in the public surface']),
      }),
      step('shared-version', 'version', 'Published version', 'tag v2.4.0 on the registry', 'done', {
        outcome: '2.4.0',
        url: `${URL}/releases/tag/v2.4.0`,
        journal: journal(['10:16', 'Found 2.4.0 on the registry, 4 minutes after the tag']),
      }),
    ],
    progress,
  )
}

function libA(progress: Progress): readonly Step[] {
  return walk(
    [
      step('lib-a-bump-shared', 'bump', 'Bump shared', 'to 2.4.0', 'done', { outcome: '2.4.0' }),
      step('lib-a-pr', 'pullRequest', 'Pull request', 'into develop', 'done', {
        outcome: '#18',
        url: `${URL}/pull/18`,
      }),
      step('lib-a-ci', 'ci', 'CI', 'acme/shop · workflow ci.yml', 'done', {
        outcome: '5 of 5 checks',
        url: `${URL}/actions/runs/7790`,
        checks: checks(5, URL),
      }),
      step('lib-a-merge', 'merge', 'Merge', 'squash into develop', 'done', { outcome: 'e4f5a6b' }),
      step('lib-a-version', 'version', 'Published version', 'tag v1.3.0', 'done', {
        outcome: '1.3.0',
      }),
    ],
    progress,
  )
}

function libB(progress: Progress): readonly Step[] {
  return walk(
    [
      step('lib-b-bump-shared', 'bump', 'Bump shared', 'to 2.4.0', 'done', { outcome: '2.4.0' }),
      step('lib-b-pr', 'pullRequest', 'Pull request', 'into develop, on Bitbucket', 'done', {
        outcome: '#22',
        url: `${LIBS}/pull-requests/22`,
      }),
      step('lib-b-ci', 'ci', 'CI', 'acme/libs · pipeline default', 'done', {
        outcome: '3 of 3 steps',
        url: `${LIBS}/pipelines/results/310`,
      }),
      step('lib-b-release', 'remote', 'Release', 'acme/libs · manual step release', 'done', {
        outcome: 'released',
        url: `${LIBS}/pipelines/results/310/steps/release`,
      }),
      step('lib-b-merge', 'merge', 'Merge', 'merge commit into develop', 'done', {
        outcome: '7c8d9e0',
      }),
    ],
    progress,
  )
}

function api(progress: Progress): readonly Step[] {
  return walk(
    [
      step('api-bump', 'bump', 'Bump lib-a and lib-b', 'to 1.3.0 and 0.9.0', 'done', {
        outcome: '2 bumped',
      }),
      step('api-pr', 'pullRequest', 'Pull request', 'into develop', 'done', {
        outcome: '#412',
        url: `${URL}/pull/412`,
      }),
      step('api-ci', 'ci', 'CI', 'acme/shop · workflow ci.yml', 'done', {
        outcome: '5 of 5 checks',
        url: `${URL}/actions/runs/7802`,
        checks: checks(5, URL),
      }),
      step('api-merge', 'merge', 'Merge', 'squash into develop', 'done', { outcome: '0f1e2d3' }),
      step('api-deploy', 'remote', 'Deploy to staging', 'acme/shop · deploy-staging.yml', 'done', {
        outcome: 'deployed',
        url: `${URL}/deployments/staging`,
      }),
    ],
    progress,
  )
}

function web(progress: Progress): readonly Step[] {
  return walk(
    [
      step('web-bump', 'bump', 'Bump lib-a', 'to 1.3.0', 'done', { outcome: '1.3.0' }),
      step('web-pr', 'pullRequest', 'Pull request', 'into develop', 'done', {
        outcome: '#413',
        url: `${URL}/pull/413`,
      }),
      step('web-ci', 'ci', 'CI', 'acme/shop · workflow ci.yml', 'done', {
        outcome: '5 of 5 checks',
        url: `${URL}/actions/runs/7803`,
        checks: checks(5, URL),
      }),
      step('web-merge', 'confirm', 'Merge on your click', 'squash into develop', 'done', {
        outcome: '9a8b7c6',
      }),
      step('web-ci-after', 'ci', 'CI on develop', 'acme/shop · workflow ci.yml', 'done', {
        outcome: '5 of 5 checks',
        url: `${URL}/actions/runs/7811`,
        checks: checks(5, URL),
      }),
    ],
    progress,
  )
}

const repo = (
  repository: string,
  state: RepositoryState,
  steps: readonly Step[],
): RepositoryDelivery => ({ repository, state, steps })

/** The three waves, each repository at the progress given. */
function waves(
  given: Partial<Record<'shared' | 'lib-a' | 'lib-b' | 'api' | 'web', [RepositoryState, Progress]>>,
): readonly DeliveryWave[] {
  const at = (name: 'shared' | 'lib-a' | 'lib-b' | 'api' | 'web'): [RepositoryState, Progress] =>
    given[name] ?? ['todo', NOT_STARTED]
  const [sharedState, sharedProgress] = at('shared')
  const [libAState, libAProgress] = at('lib-a')
  const [libBState, libBProgress] = at('lib-b')
  const [apiState, apiProgress] = at('api')
  const [webState, webProgress] = at('web')
  return [
    { n: 1, repositories: [repo('shared', sharedState, shared(sharedProgress))] },
    {
      n: 2,
      repositories: [
        repo('lib-a', libAState, libA(libAProgress)),
        repo('lib-b', libBState, libB(libBProgress)),
      ],
    },
    {
      n: 3,
      repositories: [
        repo('api', apiState, api(apiProgress)),
        repo('web', webState, web(webProgress)),
      ],
    },
  ]
}

// --- Needs ----------------------------------------------------------------------------------

export const MANUAL_STEP_NEED: NeedRow = {
  id: 'n-release',
  project: 'Acme',
  need: {
    ask: { kind: 'environment', action: 'It ran' },
    title: 'lib-b waits for its manual step release on Bitbucket',
    text: `Bitbucket runs a manual step only from its own page: ${LIBS}/pipelines/results/310/steps/release — run it there, then say it ran. Hemera also sees it on its own within a minute.`,
    when: '2 min',
  },
}

export const CLICK_NEED: NeedRow = {
  id: 'n-merge',
  project: 'Acme',
  need: {
    ask: {
      kind: 'decision',
      options: [
        { label: 'Merge web #413', recommended: 'its CI is green and ana.lopez approved it' },
        { label: 'Not yet' },
      ],
    },
    title: 'web waits for your click to merge #413',
    text: 'The delivery rules merge web on a click: it changes what customers see.',
    when: '1 min',
  },
}

export const APPROVAL_NEED: NeedRow = {
  id: 'n-approve',
  project: 'Acme',
  need: {
    ask: {
      kind: 'decision',
      options: [
        {
          label: 'Approve the deployment',
          recommended: 'staging only; production is not in this mission',
        },
        { label: 'Not yet' },
      ],
    },
    title: 'api’s deployment to staging waits for your approval',
    text: `GitHub asks a reviewer of the environment staging to approve: ${URL}/actions/runs/7820`,
    when: 'now',
  },
}

export const SIGNED_OUT_NEED: NeedRow = {
  id: 'n-gh',
  project: 'Acme',
  need: {
    ask: { kind: 'environment', action: 'Check again' },
    title: 'GitHub’s CLI is signed out',
    text: 'Run `gh auth login` in a terminal, then Check again. api and web wait for it; lib-b, on Bitbucket, goes on.',
    when: '4 min',
  },
}

export const MISSING_NEED: NeedRow = {
  id: 'n-bkt',
  project: 'Acme',
  need: {
    ask: { kind: 'environment', action: 'Check again', settings: 'Forges' },
    title: 'Bitbucket’s CLI is not installed',
    text: 'lib-b is on Bitbucket: install `bkt` and sign in, then Check again. The other repositories go on.',
    when: '6 min',
  },
}

export const BROKEN_NEED: NeedRow = {
  id: 'n-broken',
  project: 'Acme',
  need: {
    ask: {
      kind: 'error',
      attempts: [
        {
          what: 'CI on develop after merging web #413 · Unit tests',
          output:
            "FAIL src/billing/export-button.test.tsx > keeps the filter after a reload\n  expected 'Northwind' received 'Globex'\nTests 1 failed | 211 passed (212)",
        },
      ],
      proposed:
        'Fix it in a round: the agent reads the failure, fixes it, proves it, and you accept the fix before its pull request.',
    },
    title: 'web’s CI is red on develop after the merge',
    text: 'The merge went in before lib-a 1.3.0 reached the registry the CI reads: the test ran against 1.2.0.',
    when: 'now',
  },
}

// --- Team -----------------------------------------------------------------------------------

export const TEAM: readonly TeamComment[] = [
  {
    id: 'C4',
    author: 'chen.wei',
    anchor: 'api #412',
    text: 'Nice. While you are in there: the same export would help the refunds page, which still has no way to get its rows out.',
    when: '10:41',
  },
]

export const LONG_COMMENT: TeamComment = {
  id: 'C5',
  author: 'eleni.papadopoulou',
  anchor: 'web/src/features/billing/invoices/export/components/export-button/export-button.tsx:88',
  text: 'This works, thanks. One thing for later, not for this pull request: the finance team exports every month by hand for the auditors, and they would like the same file sent to them on the first of the month, with the same filters as the last export they made, and a line at the top saying which filters were used and who made the export, so that the auditors can tell the files apart.',
  when: '10:52',
}

// --- Moments of Shipping --------------------------------------------------------------------

const ON_CI: Progress = {
  at: 1,
  state: 'running',
  extra: {
    outcome: '3 of 5 checks',
    checks: checks(3, URL),
    actions: [{ id: 'stop-pipeline', label: 'Stop pipeline' }],
    waits: 'Waiting on #41’s CI',
    journal: journal(['10:02', 'Opened #41 into develop'], ['10:03', 'CI started on #41']),
  },
}

const LIB_A_FAILED: Progress = {
  at: 2,
  state: 'failed',
  extra: {
    outcome: '4 of 5 checks',
    checks: redAt(2, URL),
    failure: [
      '  FAIL  src/currency/format.test.ts > formats a yen amount without decimals',
      "    AssertionError: expected '¥1,200.00' to be '¥1,200'",
      'npm notice Publishing with token ***',
      'Error: Process completed with exit code 1.',
    ].join('\n'),
    actions: [{ id: 'rerun-failed', label: 'Re-run failed jobs' }],
    journal: journal(['10:24', 'CI started on #18'], ['10:31', 'Unit tests failed: 1 of 414']),
  },
}

const LIB_B_MANUAL: Progress = {
  at: 3,
  state: 'waiting',
  extra: { waits: 'Waiting for you to run it on Bitbucket' },
}

const API_APPROVAL: Progress = {
  at: 4,
  state: 'waiting',
  extra: { waits: 'Waiting for your approval' },
}

const WEB_CLICK: Progress = { at: 3, state: 'waiting', extra: { waits: 'Waiting for your click' } }

const DELIVERED_NOW: [RepositoryState, Progress] = ['delivered', DONE]

/** The first two waves delivered. */
const SHIPPED = { shared: DELIVERED_NOW, 'lib-a': DELIVERED_NOW, 'lib-b': DELIVERED_NOW }

function base(given: Partial<ShippingMoment>): ShippingMoment {
  return {
    face: 'running',
    now: 'Delivering wave 1 of 3: shared',
    progress: { step: 'Wave 1 of 3', detail: '0 of 5 repositories delivered' },
    ball: 'agent',
    marks: [],
    waves: waves({}),
    needs: [],
    team: [],
    ...given,
  }
}

export const MOMENTS = {
  /** Wave 1: shared's CI runs on the forge; nothing else has started. */
  started: () =>
    base({
      now: 'shared’s CI runs: 3 of 5 checks green',
      ball: 'someone',
      ballWords: 'Waiting on shared #41’s CI',
      waves: waves({ shared: ['waiting', ON_CI] }),
    }),
  /** Wave 2: shared delivered as 2.4.0, lib-a's CI failed, lib-b waits for its manual step. */
  failed: () =>
    base({
      face: 'question',
      now: 'lib-a’s CI failed: 1 test of 414',
      progress: { step: 'Wave 2 of 3', detail: '1 of 5 repositories delivered' },
      ball: 'you',
      marks: [{ kind: 'needsYou' }],
      waves: waves({
        shared: ['delivered', DONE],
        'lib-a': ['failed', LIB_A_FAILED],
        'lib-b': ['needsYou', LIB_B_MANUAL],
      }),
      needs: [MANUAL_STEP_NEED],
    }),
  /** Wave 3: what waits for the user — a click to merge, a deployment approval — as needs. */
  needs: () =>
    base({
      face: 'question',
      now: 'Two steps wait for you: web’s merge and api’s deployment',
      progress: { step: 'Wave 3 of 3', detail: '3 of 5 repositories delivered' },
      ball: 'you',
      marks: [{ kind: 'needsYou' }],
      waves: waves({
        ...SHIPPED,
        api: ['needsYou', API_APPROVAL],
        web: ['needsYou', WEB_CLICK],
      }),
      needs: [CLICK_NEED, APPROVAL_NEED],
    }),
  /** Wave 3: api's deployment waits for a teammate's approval; web's CI runs. */
  waitingOnSomeone: () =>
    base({
      now: 'api waits for ana.lopez’s approval; web’s CI runs',
      progress: { step: 'Wave 3 of 3', detail: '3 of 5 repositories delivered' },
      ball: 'someone',
      ballWords: 'Waiting on ana.lopez’s approval of api’s deployment and web #413’s CI',
      waves: waves({
        ...SHIPPED,
        api: [
          'waiting',
          { at: 4, state: 'waiting', extra: { waits: 'Waiting on ana.lopez’s approval' } },
        ],
        web: [
          'waiting',
          {
            at: 2,
            state: 'running',
            extra: {
              outcome: '4 of 5 checks',
              checks: checks(4, URL),
              waits: 'Waiting on #413’s CI',
              actions: [{ id: 'stop-pipeline', label: 'Stop pipeline' }],
            },
          },
        ],
      }),
    }),
  /** GitHub's CLI signed out: the GitHub repositories wait, lib-b on Bitbucket goes on. */
  signedOut: () =>
    base({
      face: 'question',
      now: 'GitHub’s CLI is signed out: api and web wait for it',
      progress: { step: 'Wave 3 of 3', detail: '3 of 5 repositories delivered' },
      ball: 'you',
      marks: [{ kind: 'needsYou' }],
      waves: waves({
        ...SHIPPED,
        api: ['needsYou', { at: 1, state: 'blocked', extra: { waits: 'Waits for GitHub’s CLI' } }],
        web: ['needsYou', { at: 1, state: 'blocked', extra: { waits: 'Waits for GitHub’s CLI' } }],
      }),
      needs: [SIGNED_OUT_NEED],
    }),
  /** Bitbucket's CLI not installed: lib-b waits, the others go on. */
  missingCli: () =>
    base({
      face: 'question',
      now: 'Bitbucket’s CLI is not installed: lib-b waits for it',
      progress: { step: 'Wave 2 of 3', detail: '2 of 5 repositories delivered' },
      ball: 'you',
      marks: [{ kind: 'needsYou' }],
      waves: waves({
        shared: ['delivered', DONE],
        'lib-a': ['delivered', DONE],
        'lib-b': [
          'needsYou',
          { at: 1, state: 'blocked', extra: { waits: 'Waits for Bitbucket’s CLI' } },
        ],
      }),
      needs: [MISSING_NEED],
    }),
  /** The user stopped the delivery: shared stays delivered, lib-a's step was stopped. */
  stopped: () =>
    base({
      face: 'asleep',
      now: 'Delivery stopped by you at 10:27: shared stays delivered',
      progress: { step: 'Stopped', detail: '1 of 5 repositories delivered' },
      ball: 'you',
      stopped: true,
      waves: waves({
        shared: ['delivered', DONE],
        'lib-a': [
          'stopped',
          {
            at: 2,
            state: 'skipped',
            extra: { outcome: 'stopped', waits: 'Stopped at 10:27, its pipeline with it' },
          },
        ],
        'lib-b': ['stopped', { at: 2, state: 'skipped', extra: { outcome: 'stopped' } }],
      }),
    }),
  /** Four repositories delivered, api failed at its deployment: a partial delivery. */
  partial: () =>
    base({
      face: 'question',
      now: '4 of 5 delivered: api’s deployment to staging failed',
      progress: { step: 'Wave 3 of 3', detail: '4 of 5 repositories delivered' },
      ball: 'you',
      marks: [{ kind: 'needsYou' }],
      waves: waves({
        ...SHIPPED,
        web: ['delivered', DONE],
        api: [
          'failed',
          {
            at: 4,
            state: 'failed',
            extra: {
              outcome: 'failed',
              failure:
                'Error: the environment staging is locked by another deployment (run 7815, started by the release pipeline).\nRetry once it ends.',
            },
          },
        ],
      }),
    }),
  /** web's CI on develop is red after its merge: an error need, before the fix starts. */
  broken: () =>
    base({
      face: 'question',
      now: 'web’s CI went red after the merge: a fix is proposed',
      progress: { step: 'Wave 3 of 3', detail: '4 of 5 repositories delivered' },
      ball: 'you',
      marks: [{ kind: 'needsYou' }],
      waves: waves({
        ...SHIPPED,
        api: ['delivered', DONE],
        web: [
          'failed',
          {
            at: 4,
            state: 'failed',
            extra: {
              outcome: '4 of 5 checks',
              checks: redAt(2, URL),
              failure:
                "FAIL src/billing/export-button.test.tsx > keeps the filter after a reload\n  expected 'Northwind' received 'Globex'",
              actions: [{ id: 'rerun-failed', label: 'Re-run failed jobs' }],
            },
          },
        ],
      }),
      needs: [BROKEN_NEED],
    }),
  /** The fix runs, as a round: the mark `fixing`, its steps in the rail; web waits for it. */
  fixing: () =>
    base({
      now: 'Fixing web’s CI: writing the fix',
      progress: { step: 'Fix · round 3', detail: 'writing the fix in web' },
      marks: [{ kind: 'fixing' }],
      waves: waves({
        ...SHIPPED,
        api: ['delivered', DONE],
        web: ['running', { at: 4, state: 'blocked', extra: { waits: 'Waits for the fix' } }],
      }),
      fix: {
        round: 3,
        repository: 'web',
        steps: [
          { name: 'Read the failure', state: 'done', detail: 'lib-a 1.2.0 was read, not 1.3.0' },
          { name: 'Write the fix', state: 'running', detail: 'web/package.json, web/src/billing' },
          { name: 'Prove it', state: 'todo' },
          { name: 'Your acceptance', state: 'todo' },
          { name: 'Pull request', state: 'todo' },
        ],
      },
    }),
  /** The fix is proven: it waits for the user's acceptance, its diff under it. */
  fixToAccept: () =>
    base({
      face: 'question',
      now: 'The fix of web is proven: it waits for you',
      progress: { step: 'Fix · round 3', detail: 'proven, to accept' },
      ball: 'you',
      marks: [{ kind: 'fixing' }, { kind: 'needsYou' }],
      waves: waves({
        ...SHIPPED,
        api: ['delivered', DONE],
        web: ['running', { at: 4, state: 'blocked', extra: { waits: 'Waits for the fix' } }],
      }),
      fix: {
        round: 3,
        repository: 'web',
        steps: [
          { name: 'Read the failure', state: 'done', detail: 'lib-a 1.2.0 was read, not 1.3.0' },
          { name: 'Write the fix', state: 'done', detail: '2 files' },
          { name: 'Prove it', state: 'done', detail: 'S4 red then green, CI green on the branch' },
          { name: 'Your acceptance', state: 'waiting' },
          { name: 'Pull request', state: 'todo' },
        ],
        diff: [
          'web/package.json',
          '-    "@acme/lib-a": "^1.2.0",',
          '+    "@acme/lib-a": "^1.3.0",',
          'web/src/billing/export-button.tsx',
          '-  const filters = useMemo(() => readFilters(), [])',
          '+  const filters = useFilters()',
        ].join('\n'),
      },
    }),
  /** The fix accepted: its pull request is open, its CI runs. */
  fixPull: () =>
    base({
      now: 'The fix’s pull request web #415 is open: its CI runs',
      progress: { step: 'Fix · round 3', detail: 'web #415, CI running' },
      ball: 'someone',
      ballWords: 'Waiting on web #415’s CI',
      marks: [{ kind: 'fixing' }],
      waves: waves({
        ...SHIPPED,
        api: ['delivered', DONE],
        web: ['running', { at: 4, state: 'blocked', extra: { waits: 'Waits for the fix' } }],
      }),
      fix: {
        round: 3,
        repository: 'web',
        steps: [
          { name: 'Read the failure', state: 'done', detail: 'lib-a 1.2.0 was read, not 1.3.0' },
          { name: 'Write the fix', state: 'done', detail: '2 files' },
          { name: 'Prove it', state: 'done', detail: 'S4 red then green, CI green on the branch' },
          { name: 'Your acceptance', state: 'done', detail: 'accepted at 11:02' },
          { name: 'Pull request', state: 'running', detail: '#415, 3 of 5 checks' },
        ],
        pull: { number: 415, state: 'running', words: '3 of 5 checks' },
      },
    }),
  /** The fix merged: the mark is gone, web's steps resumed where they stopped. */
  resumed: () =>
    base({
      now: 'The fix is merged: web’s CI on develop runs again',
      progress: { step: 'Wave 3 of 3', detail: '4 of 5 repositories delivered' },
      ball: 'someone',
      ballWords: 'Waiting on web’s CI on develop',
      waves: waves({
        ...SHIPPED,
        api: ['delivered', DONE],
        web: [
          'waiting',
          {
            at: 4,
            state: 'running',
            extra: {
              outcome: '2 of 5 checks',
              checks: checks(2, URL),
              waits: 'Waiting on CI on develop',
              journal: journal(
                ['10:49', 'CI on develop red after #413'],
                ['11:09', 'Fix #415 merged; CI on develop started again'],
              ),
            },
          },
        ],
      }),
      fix: {
        round: 3,
        repository: 'web',
        steps: [],
        pull: { number: 415, state: 'done', words: 'merged at 11:09' },
      },
    }),
  /** A team comment during Shipping, which can start a mission of its own. */
  teamComment: () =>
    base({
      now: 'api waits for ana.lopez’s approval; web’s CI runs',
      progress: { step: 'Wave 3 of 3', detail: '3 of 5 repositories delivered' },
      ball: 'someone',
      ballWords: 'Waiting on ana.lopez’s approval of api’s deployment',
      waves: waves({
        ...SHIPPED,
        api: [
          'waiting',
          { at: 4, state: 'waiting', extra: { waits: 'Waiting on ana.lopez’s approval' } },
        ],
        web: ['running', { at: 2, state: 'running', extra: { checks: checks(4, URL) } }],
      }),
      team: TEAM,
    }),
} satisfies Record<string, () => ShippingMoment>

export type ShippingMomentName = keyof typeof MOMENTS

/** Long text in every field: a long repository, a long forge error, a long step task. */
export function lengthen(moment: ShippingMoment): ShippingMoment {
  return {
    ...moment,
    ballWords:
      moment.ballWords === undefined
        ? undefined
        : `${moment.ballWords}, and on ${LONG_REPOSITORY} #57’s CI, which has run for twenty minutes`,
    waves: moment.waves.map((wave) =>
      wave.n !== 2
        ? wave
        : {
            ...wave,
            repositories: [
              ...wave.repositories,
              {
                repository: LONG_REPOSITORY,
                state: 'failed',
                steps: [
                  step('long-pr', 'pullRequest', 'Pull request', 'into develop', 'done', {
                    outcome: '#57',
                  }),
                  step('long-deploy', 'remote', 'Deploy to staging', LONG_TASK, 'failed', {
                    failure: LONG_ERROR,
                    actions: [{ id: 'rerun-failed', label: 'Re-run failed jobs' }],
                  }),
                ],
              },
            ],
          },
    ),
    team: moment.team.length > 0 ? [...moment.team, LONG_COMMENT] : moment.team,
  }
}

// --- Done and Cancelled ---------------------------------------------------------------------

const SHARED_DELIVERED: Delivered = {
  repository: 'shared',
  outcomes: [
    { what: 'Pull request', outcome: '#41', url: `${URL}/pull/41` },
    { what: 'Merged', outcome: 'a1b2c3d' },
    { what: 'Version', outcome: '2.4.0', url: `${URL}/releases/tag/v2.4.0` },
  ],
}

export const DELIVERED: readonly Delivered[] = [
  SHARED_DELIVERED,
  {
    repository: 'lib-a',
    outcomes: [
      { what: 'Pull request', outcome: '#18', url: `${URL}/pull/18` },
      { what: 'Version', outcome: '1.3.0' },
    ],
  },
  {
    repository: 'lib-b',
    outcomes: [
      { what: 'Pull request', outcome: '#22', url: `${LIBS}/pull-requests/22` },
      { what: 'Released', outcome: '0.9.0' },
    ],
  },
  {
    repository: 'api',
    outcomes: [
      { what: 'Pull request', outcome: '#412', url: `${URL}/pull/412` },
      { what: 'Deployed', outcome: 'staging' },
    ],
  },
  {
    repository: 'web',
    outcomes: [
      { what: 'Pull request', outcome: '#413', url: `${URL}/pull/413` },
      { what: 'Fix', outcome: '#415', url: `${URL}/pull/415` },
    ],
  },
]

const RECORD: MissionRecord = {
  rounds: [
    { n: 1, points: 4, words: 'the filters kept, the yen without decimals' },
    { n: 2, points: 3, words: 'the progress hidden under a second, the zone named' },
    { n: 3, points: 1, words: 'the fix of web’s CI after the merge' },
  ],
  feedback: 11,
  proofs: [
    { id: 'S1', title: 'Exports the invoices of the filtered customer' },
    { id: 'S4', title: 'Keeps the filter after a reload' },
    { id: 'S7', title: 'Names the time zone of the dates' },
    { id: 'S12', title: 'The button shrinks to its icon on a narrow window', byHand: true },
  ],
  evidence: [
    { what: 'Final checks', detail: '7 of 7 green at 09:40' },
    { what: 'Automatic review', detail: '3 findings, 2 fixed, 1 dismissed' },
    { what: 'Captures', detail: '4 images of S12, validated by you' },
  ],
  memory: { now: 'Done: delivered in 3 waves, one fix', journal: 86, notes: 5 },
}

const MERGED: DoneMoment['merged'] = [
  { id: 'R14', title: 'An export keeps the customer filters of the list', origin: 'new' },
  {
    id: 'R15',
    title: 'Dates are written in the customer’s time zone, which the header names',
    origin: 'new',
  },
  { id: 'R3', title: 'Amounts follow the currency’s own decimals', origin: 'changed R3 of ACME-4' },
]

const REMOVED: readonly CleanupItem[] = [
  { what: 'The Workspace of ACME-12', kind: 'workspace', state: 'removed' },
  { what: 'feat/acme-12-export-invoices in 5 repositories', kind: 'branch', state: 'removed' },
  { what: 'The service web · dev server', kind: 'service', state: 'removed' },
]

const KEPT: readonly CleanupItem[] = [
  { what: 'The Workspace of ACME-12', kind: 'workspace', state: 'removed' },
  {
    what: 'feat/acme-12-export-invoices in api',
    kind: 'branch',
    state: 'kept',
    reason: 'it holds 1 commit that no branch of the forge has: “Log the export’s duration”',
  },
  {
    what: 'web/.env.local',
    kind: 'file',
    state: 'kept',
    reason: 'it is not tracked by Git and was changed outside Hemera',
  },
  { what: 'The service web · dev server', kind: 'service', state: 'removed' },
]

export const DONE_MOMENTS = {
  /** Everything delivered, closed and cleaned up: the mission readable in full. */
  done: (): DoneMoment => ({
    delivered: DELIVERED,
    merged: MERGED,
    cleanup: REMOVED,
    leftovers: [],
    record: RECORD,
  }),
  /** The living spec changed under the mission: both versions of R3, one to keep. */
  conflict: (): DoneMoment => ({
    delivered: DELIVERED,
    merged: MERGED,
    conflict: {
      requirement: 'R3',
      title: 'Amounts follow the currency’s own decimals',
      mission:
        'An amount is written with its currency’s decimals: none for the yen, two for the euro and the dollar, three for the dinar.',
      living:
        'An amount is written with two decimals, except where the customer’s contract says otherwise.',
      livingFrom: 'ACME-15, done yesterday at 16:40',
    },
    cleanup: REMOVED.map((one) => ({ ...one, state: 'todo' })),
    leftovers: [],
    record: RECORD,
  }),
  /** The cleanup runs: one item removed, one on its way, one to do. */
  cleaning: (): DoneMoment => ({
    delivered: DELIVERED,
    merged: MERGED,
    cleanup: [
      { what: 'The Workspace of ACME-12', kind: 'workspace', state: 'removed' },
      {
        what: 'feat/acme-12-export-invoices in 5 repositories',
        kind: 'branch',
        state: 'running',
      },
      { what: 'The service web · dev server', kind: 'service', state: 'todo' },
    ],
    leftovers: [],
    record: RECORD,
  }),
  /** The guard kept two items, each with its reason. */
  kept: (): DoneMoment => ({
    delivered: DELIVERED,
    merged: MERGED,
    cleanup: KEPT,
    leftovers: [],
    record: RECORD,
  }),
  /** What still runs after Done: each with its reason and Stop. */
  leftovers: (): DoneMoment => ({
    delivered: DELIVERED,
    merged: MERGED,
    cleanup: REMOVED,
    leftovers: [
      {
        id: 'preview',
        what: 'The preview deployment of web #413',
        reason:
          'the forge keeps it until the pull request’s branch is deleted, which the rules leave to the team',
      },
      {
        id: 'db',
        what: 'The service api · database',
        reason: 'ACME-15 uses it too, and is still in Building',
      },
    ],
    record: RECORD,
  }),
} satisfies Record<string, () => DoneMoment>

export type DoneMomentName = keyof typeof DONE_MOMENTS

const STOPPED: CancelledMoment['stopped'] = [
  { what: 'The delivery', detail: 'stopped at wave 2: lib-a’s CI and lib-b’s pipeline' },
  { what: 'The service web · dev server', detail: 'stopped' },
  { what: 'The agent of Shipping', detail: 'its turn ended' },
]

/** Cancelled in Review: web's unpushed commits are kept, the rest is pushed or disposable. */
const REVIEW_CLEANUP: readonly CleanupItem[] = [
  { what: 'The Workspace of ACME-12', kind: 'workspace', state: 'todo' },
  {
    what: 'feat/acme-12-export-invoices in web',
    kind: 'branch',
    state: 'kept',
    reason: '2 of its commits are not pushed: nothing else holds them',
  },
  { what: 'feat/acme-12-export-invoices in api, shared', kind: 'branch', state: 'todo' },
  { what: 'The service web · dev server', kind: 'service', state: 'todo' },
]

/** Cancelled while shipping: the open pull requests and web's unpushed commits are kept. */
const CANCEL_CLEANUP: readonly CleanupItem[] = [
  { what: 'The Workspace of ACME-12', kind: 'workspace', state: 'todo' },
  {
    what: 'feat/acme-12-export-invoices in lib-a, lib-b',
    kind: 'branch',
    state: 'kept',
    reason: 'their pull requests #18 and #22 are still open',
  },
  {
    what: 'feat/acme-12-export-invoices in web',
    kind: 'branch',
    state: 'kept',
    reason: '2 of its commits are not pushed: nothing else holds them',
  },
  { what: 'feat/acme-12-export-invoices in shared, api', kind: 'branch', state: 'todo' },
  { what: 'The service web · dev server', kind: 'service', state: 'todo' },
]

export const CANCELLED_MOMENTS = {
  /** Cancelled in Review, before anything was delivered: the cleanup waits for the user. */
  cancelled: (): CancelledMoment => ({
    stopped: [
      { what: 'The service web · dev server', detail: 'stopped' },
      { what: 'The agent of Review', detail: 'its turn ended' },
    ],
    delivered: [],
    kept: [
      { repository: 'api', branch: BRANCH, detail: '14 commits, pushed to acme/shop' },
      { repository: 'web', branch: BRANCH, detail: '9 commits, 2 not pushed' },
      { repository: 'shared', branch: BRANCH, detail: '3 commits, pushed' },
    ],
    cleanup: REVIEW_CLEANUP,
    cleaned: false,
  }),
  /** Cancelled while shipping: shared was delivered and stays so. */
  partial: (): CancelledMoment => ({
    stopped: STOPPED,
    delivered: [SHARED_DELIVERED],
    kept: [
      { repository: 'lib-a', branch: BRANCH, detail: '#18 open, its CI stopped' },
      { repository: 'lib-b', branch: BRANCH, detail: '#22 open' },
      { repository: 'api', branch: BRANCH, detail: '14 commits, pushed' },
      { repository: 'web', branch: BRANCH, detail: '9 commits, 2 not pushed' },
    ],
    cleanup: CANCEL_CLEANUP,
    cleaned: false,
  }),
  /** The cleanup confirmed: what it removed, what the guard kept. */
  cleaned: (): CancelledMoment => ({
    stopped: STOPPED,
    delivered: [SHARED_DELIVERED],
    kept: [
      { repository: 'lib-a', branch: BRANCH, detail: '#18 open, its CI stopped' },
      { repository: 'lib-b', branch: BRANCH, detail: '#22 open' },
      { repository: 'web', branch: BRANCH, detail: '9 commits, 2 not pushed' },
    ],
    cleanup: CANCEL_CLEANUP.map(removedUnlessKept),
    cleaned: true,
  }),
} satisfies Record<string, () => CancelledMoment>

export type CancelledMomentName = keyof typeof CANCELLED_MOMENTS
