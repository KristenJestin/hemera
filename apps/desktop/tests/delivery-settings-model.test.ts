/**
 * The delivery rules of a Project's settings, as the window reads and edits them (#465): the
 * engine's rules drawn as the section of #250 shows them, every edit written into the rules the
 * engine saves, and each refusal said at its place.
 */

import {
  type DeliveryAction,
  type DeliveryProblem,
  type DeliveryRulesDraft,
  defaultDeliveryRules,
} from '@hemera/core/domain'
import {
  DeliveryRulesRefused,
  StaleVersion,
  type Command,
  type DeliveryRulesView,
  type ForgeRepositoryStatus,
  type Project,
} from '@hemera/ipc'
import { describe, expect, test, vi } from 'vite-plus/test'

import {
  type DeliveryWorld,
  actionOf,
  deliveryProjectOf,
  shownOf,
  withCleanupAdded,
  withCleanupRemoved,
  withCleanupSaved,
  withPreparation,
  withPreset,
  withPushIn,
  withReviewDrafts,
  withStepAdded,
  withStepPutBack,
  withStepRemoved,
  withStepReset,
  withStepSaved,
  workingOf,
  writeRules,
} from '../src/renderer/delivery-settings-model.ts'

const repository = (id: string, path: string, remote: string | null) => ({
  id,
  projectId: 'acme',
  path,
  includedByDefault: true,
  remote,
  baseBranch: 'main',
  lastFetchedAt: null,
  testReporting: null,
})

const ACME: Project = {
  id: 'acme',
  name: 'Acme',
  mainCheckout: '/work/acme',
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: 'ACME',
  version: 1,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [
    repository('r-api', 'api', 'origin'),
    repository('r-web', 'web', 'origin'),
    repository('r-shared', 'shared', null),
  ],
}

const status = (
  repositoryId: string,
  path: string,
  part: Partial<ForgeRepositoryStatus> = {},
): ForgeRepositoryStatus => ({
  repositoryId,
  path,
  forge: 'github',
  host: 'github.com',
  owner: 'acme',
  slug: path,
  forced: false,
  cli: 'gh',
  version: '2.60.0',
  state: 'ready',
  fix: null,
  detail: null,
  ...part,
})

const FORGES: ReadonlyArray<ForgeRepositoryStatus> = [
  status('r-api', 'api'),
  status('r-web', 'web'),
  status('r-shared', 'shared', {
    forge: 'none',
    host: null,
    owner: null,
    slug: null,
    cli: null,
    version: null,
    state: 'not-needed',
  }),
]

const BUMP_DEPS: Command = {
  id: 'c-bump',
  projectId: 'acme',
  name: 'bump-deps',
  type: 'script',
  line: 'node bump.mjs',
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
}

const world = (part: Partial<DeliveryWorld> = {}): DeliveryWorld => ({
  project: ACME,
  draft: defaultDeliveryRules(),
  proposed: [],
  forges: FORGES,
  remotes: new Map([['r-api', ['origin', 'upstream']]]),
  commands: [BUMP_DEPS],
  problems: [],
  ...part,
})

/** Acme as the rules are resolved against it: its repositories' forges, its commands. */
const DELIVERY = deliveryProjectOf(world())

const shownRepository = (
  draft: DeliveryRulesDraft,
  path: string,
  part: Partial<DeliveryWorld> = {},
) => {
  const found = shownOf(world({ draft, ...part })).rules.repositories.find(
    (one) => one.path === path,
  )
  if (found === undefined) throw new Error(`${path} is not shown`)
  return found
}

const stepsOf = (draft: DeliveryRulesDraft, path: string) =>
  shownRepository(draft, path).steps.map(
    (one) => `${one.moment}:${one.step.id}:${one.step.config.kind}:${one.origin}`,
  )

describe('The delivery rules of a Project, as its settings read them', () => {
  test('a Project with three repositories that never saved rules reads as its presets', () => {
    const { rules } = shownOf(world())
    expect(rules.pullRequests).toEqual({
      placement: 'review',
      start: 'click',
      commit: '{key}: {title}',
      title: '{key}: {title}',
      body: '{summary}\n\n{images}',
      reviewers: [],
      requireApproval: false,
      reviewDrafts: false,
    })
    expect(rules.repositories.map((one) => [one.path, one.preset, one.forge.kind])).toEqual([
      ['api', 'application', 'github'],
      ['web', 'application', 'github'],
      ['shared', 'local', 'none'],
    ])
    expect(stepsOf(defaultDeliveryRules(), 'api')).toEqual([
      'review:commit:commit-by-hemera:preset',
      'review:push:push:preset',
      'review:pull-request:pull-request:preset',
      'waves:merge:merge:preset',
      'waves:ci:ci:preset',
    ])
    expect(stepsOf(defaultDeliveryRules(), 'shared')).toEqual([
      'waves:commit:commit-by-hemera:preset',
      'waves:merge:local-merge:preset',
    ])
    expect(rules.waves).toEqual([['api', 'web', 'shared']])
    expect(rules.cleanup.map((one) => [one.id, one.label, one.config])).toEqual([
      ['pull-main-checkout', 'Pull the main checkout', undefined],
      ['stop-services', 'Stop the mission’s services', undefined],
      ['remove-worktrees', 'Remove the worktrees', undefined],
      ['remove-workspace', 'Remove the Workspace', undefined],
    ])
  })

  test('a repository shows its remote, base and remotes, or this machine with none', () => {
    const api = shownRepository(defaultDeliveryRules(), 'api')
    expect([api.remote, api.base, api.remotes]).toEqual(['origin', 'main', ['origin', 'upstream']])
    const shared = shownRepository(defaultDeliveryRules(), 'shared')
    expect([shared.remote, shared.remotes]).toEqual(['', []])
  })

  test('the forge’s CLI per repository: ready, missing with its command, signed out, being read', () => {
    const forges = [
      status('r-api', 'api', { state: 'missing', fix: 'brew install gh', version: null }),
      status('r-web', 'web', { state: 'signed-out', fix: 'gh auth login --hostname github.com' }),
      ...FORGES.slice(2),
    ]
    const shown = shownOf(world({ forges })).rules.repositories
    expect(shown.map((one) => [one.path, one.forge.cli, one.forge.fix])).toEqual([
      ['api', 'missing', 'brew install gh'],
      ['web', 'signed-out', 'gh auth login --hostname github.com'],
      ['shared', 'ready', undefined],
    ])
    const reading = shownOf(world({ forges: null })).rules.repositories
    expect(reading.map((one) => one.forge.cli)).toEqual([null, null, null])
  })

  test('a forge forced on its host reads as forced, Bitbucket Data Center with its host', () => {
    const forges = [
      status('r-api', 'api', {
        forge: 'bitbucket-datacenter',
        host: 'bitbucket.acme.test',
        forced: true,
        cli: 'bkt',
      }),
      ...FORGES.slice(1),
    ]
    const api = shownOf(world({ forges })).rules.repositories[0]
    expect(api?.forge).toEqual({
      kind: 'bitbucket-dc',
      host: 'bitbucket.acme.test',
      forced: true,
      cli: 'ready',
      fix: undefined,
      sentence: undefined,
    })
  })

  test('a repository’s own changes read in place: left out, changed, added', () => {
    let draft = withStepRemoved(defaultDeliveryRules(), DELIVERY, 'r-api', 'ci')
    draft = withStepSaved(draft, DELIVERY, 'r-api', {
      id: 'merge',
      kind: 'merge',
      mode: 'auto',
      method: 'rebase',
    })
    draft = withStepAdded(draft, DELIVERY, 'r-api', 'waves', 'merge', {
      id: '',
      kind: 'confirm',
      mode: 'click',
      what: 'The release is announced',
    })
    expect(stepsOf(draft, 'api')).toEqual([
      'review:commit:commit-by-hemera:preset',
      'review:push:push:preset',
      'review:pull-request:pull-request:preset',
      'waves:merge:merge:changed',
      'waves:confirm:confirm:added',
      'waves:ci:ci:omitted',
    ])
    expect(stepsOf(draft, 'web')).toEqual(stepsOf(defaultDeliveryRules(), 'web'))
  })

  test('a step saved as its preset has it is no longer a change', () => {
    const changed = withStepSaved(defaultDeliveryRules(), DELIVERY, 'r-api', {
      id: 'ci',
      kind: 'ci',
      mode: 'click',
    })
    expect(stepsOf(changed, 'api')).toContain('waves:ci:ci:changed')
    const back = withStepSaved(changed, DELIVERY, 'r-api', { id: 'ci', kind: 'ci', mode: 'auto' })
    expect(
      back.waves.repositories.find((one) => one.repositoryId === 'r-api')?.steps.changed,
    ).toEqual([])
    expect(stepsOf(back, 'api')).toContain('waves:ci:ci:preset')
  })

  test('a step left out, put back; a step changed, back to the preset', () => {
    const out = withStepRemoved(defaultDeliveryRules(), DELIVERY, 'r-api', 'push')
    expect(stepsOf(withStepPutBack(out, 'r-api', 'push'), 'api')).toContain(
      'review:push:push:preset',
    )
    const changed = withStepSaved(defaultDeliveryRules(), DELIVERY, 'r-api', {
      id: 'ci',
      kind: 'ci',
      mode: 'click',
    })
    expect(stepsOf(withStepReset(changed, 'r-api', 'ci'), 'api')).toContain('waves:ci:ci:preset')
  })

  test('a step added first, then one after it; removing the first keeps the second in its place', () => {
    let draft = withStepAdded(defaultDeliveryRules(), DELIVERY, 'r-api', 'tasks', null, {
      id: '',
      kind: 'commit-by-me',
      mode: 'click',
    })
    draft = withStepAdded(draft, DELIVERY, 'r-api', 'tasks', 'commit-by-me', {
      id: '',
      kind: 'agent',
      mode: 'auto',
      task: 'Write the changelog',
    })
    expect(stepsOf(draft, 'api').slice(0, 2)).toEqual([
      'tasks:commit-by-me:commit-by-me:added',
      'tasks:agent:agent:added',
    ])
    expect(stepsOf(withStepRemoved(draft, DELIVERY, 'r-api', 'commit-by-me'), 'api')[0]).toBe(
      'tasks:agent:agent:added',
    )
  })

  test('a step added with no place named goes last in its moment, under an id of its own', () => {
    const draft = withStepAdded(defaultDeliveryRules(), DELIVERY, 'r-api', 'waves', undefined, {
      id: '',
      kind: 'ci',
      mode: 'auto',
    })
    expect(stepsOf(draft, 'api').at(-1)).toBe('waves:ci-2:ci:added')
  })

  test('a preset changed: the repository’s recipe is the preset’s again', () => {
    const changed = withStepRemoved(defaultDeliveryRules(), DELIVERY, 'r-api', 'ci')
    const library = withPreset(changed, DELIVERY, 'r-api', 'library')
    const api = shownRepository(library, 'api')
    expect(api.preset).toBe('library')
    expect(api.steps.every((one) => one.origin === 'preset')).toBe(true)
    expect(stepsOf(library, 'api').at(-1)).toBe('waves:published-version:published:preset')
  })

  test('a preset’s bump shows only where an upstream publishes, as the engine resolves it', () => {
    const draft = withPreset(defaultDeliveryRules(), DELIVERY, 'r-web', 'library')
    expect(stepsOf(draft, 'api').some((one) => one.includes(':bump:'))).toBe(false)
    const shown = shownOf(world({ draft: withAcceptedForTest(draft) })).rules
    expect(shown.repositories[0]?.steps.some((one) => one.step.config.kind === 'bump')).toBe(true)
    expect(shown.waves).toEqual([['web', 'shared'], ['api']])
    expect(shown.dependencies).toEqual([{ repository: 'api', on: 'web', proposed: false }])
  })

  test('the templates, the reviewers and the approval are written for every repository', () => {
    const draft = withPreparation(defaultDeliveryRules(), DELIVERY, {
      commitTemplate: '{key}: {title} ({slug})',
      reviewers: ['@acme/web', 'dreyes'],
      requireApproval: true,
    })
    expect(
      draft.preparation.repositories.map((one) => [
        one.repositoryId,
        one.commitTemplate,
        one.reviewers,
        one.requireApproval,
      ]),
    ).toEqual([
      ['r-api', '{key}: {title} ({slug})', ['@acme/web', 'dreyes'], true],
      ['r-web', '{key}: {title} ({slug})', ['@acme/web', 'dreyes'], true],
      ['r-shared', '{key}: {title} ({slug})', ['@acme/web', 'dreyes'], true],
    ])
    const { pullRequests } = shownOf(world({ draft })).rules
    expect(pullRequests.commit).toBe('{key}: {title} ({slug})')
    expect(pullRequests.reviewers).toEqual([{ handle: '@acme/web' }, { handle: 'dreyes' }])
    expect(pullRequests.requireApproval).toBe(true)
    expect(
      shownOf(world({ draft: withReviewDrafts(draft, true) })).rules.pullRequests.reviewDrafts,
    ).toBe(true)
  })

  test('push and open after Ship moves the commit, the push and the pull request, keeping what a repository changed', () => {
    const changed = withStepSaved(defaultDeliveryRules(), DELIVERY, 'r-api', {
      id: 'pull-request',
      kind: 'pull-request',
      mode: 'auto',
    })
    const draft = withPushIn(changed, DELIVERY, 'waves', 'auto')
    expect(shownOf(world({ draft })).rules.pullRequests).toMatchObject({
      placement: 'waves',
      start: 'auto',
    })
    expect(stepsOf(draft, 'api')).toEqual([
      'waves:commit:commit-by-hemera:preset',
      'waves:push:push:preset',
      'waves:pull-request:pull-request:changed',
      'waves:merge:merge:preset',
      'waves:ci:ci:preset',
    ])
    expect(stepsOf(draft, 'shared')).toEqual(stepsOf(defaultDeliveryRules(), 'shared'))
    const back = withPushIn(draft, DELIVERY, 'review', 'click')
    expect(stepsOf(back, 'api').slice(0, 3)).toEqual([
      'review:commit:commit-by-hemera:preset',
      'review:push:push:preset',
      'review:pull-request:pull-request:changed',
    ])
  })

  test('a refused rule is said at its step, a cycle above the waves, approvals at their box, the rest under the head', () => {
    const problem = (
      part: Partial<DeliveryProblem> & Pick<DeliveryProblem, 'code' | 'sentence'>,
    ): DeliveryProblem => ({ repositoryId: null, stepId: null, ...part })
    const problems = [
      problem({
        code: 'pull-request-without-push',
        repositoryId: 'r-api',
        stepId: 'pull-request',
        sentence: 'A pull request needs a push: api has no push step before its pull request step.',
      }),
      problem({
        code: 'dependency-cycle',
        sentence: 'api and web wait for each other: no wave can go first.',
      }),
      problem({
        code: 'approval-after-ship',
        repositoryId: 'r-web',
        sentence: 'Approvals are required before Ship, but web opens its pull request after Ship.',
      }),
      problem({
        code: 'step-after-workspace-removed',
        repositoryId: 'r-api',
        stepId: 'pull-main-checkout',
        sentence: 'Nothing runs after the Workspace is removed.',
      }),
      problem({
        code: 'step-after-workspace-removed',
        repositoryId: 'r-web',
        stepId: 'pull-main-checkout',
        sentence: 'Nothing runs after the Workspace is removed.',
      }),
    ]
    const shown = shownOf(world({ problems }))
    const api = shown.rules.repositories[0]
    expect(api?.steps.find((one) => one.step.id === 'pull-request')?.refused).toBe(
      'A pull request needs a push: api has no push step before its pull request step.',
    )
    expect(shown.refusals).toEqual({
      dependencies: 'api and web wait for each other: no wave can go first.',
      approval: 'Approvals are required before Ship, but web opens its pull request after Ship.',
    })
    expect(shown.elsewhere).toBe('Nothing runs after the Workspace is removed.')
  })

  test('proposed dependencies stand apart until accepted', () => {
    const shown = shownOf(
      world({ proposed: [{ repositoryId: 'r-web', deliversAfter: 'r-shared' }] }),
    ).rules
    expect(shown.dependencies).toEqual([{ repository: 'web', on: 'shared', proposed: true }])
    expect(shown.waves).toEqual([['api', 'web', 'shared']])
  })

  test('a cleanup step added, changed and removed', () => {
    let draft = withCleanupAdded(defaultDeliveryRules(), {
      id: '',
      kind: 'confirm',
      mode: 'auto',
      what: 'The board is updated',
    })
    const added = shownOf(world({ draft })).rules.cleanup.at(-1)
    expect(added).toEqual({
      id: 'confirm',
      label: 'Confirm',
      config: { kind: 'confirm', what: 'The board is updated' },
    })
    draft = withCleanupSaved(draft, {
      id: 'confirm',
      kind: 'confirm',
      mode: 'auto',
      what: 'The release is announced',
    })
    expect(draft.end.cleanup.at(-1)).toEqual({
      id: 'confirm',
      kind: 'confirm',
      mode: 'auto',
      what: 'The release is announced',
    })
    draft = withCleanupRemoved(draft, 'stop-services')
    expect(draft.end.cleanup.map((one) => one.id)).toEqual([
      'pull-main-checkout',
      'remove-worktrees',
      'remove-workspace',
      'confirm',
    ])
  })

  test('a Bump’s catalogue command is shown by its name and written back by its id', () => {
    const bump: DeliveryAction = {
      id: 'bump-deps',
      kind: 'bump',
      mode: 'auto',
      how: { by: 'command', commandId: 'c-bump' },
    }
    const draft = withStepAdded(defaultDeliveryRules(), DELIVERY, 'r-api', 'waves', null, bump)
    const shown = shownRepository(draft, 'api').steps.find((one) => one.step.id === 'bump-deps')
    expect(shown?.step.config).toEqual({ kind: 'bump', how: 'command', command: 'bump-deps' })
    expect(
      actionOf({ kind: 'bump', how: 'command', command: 'bump-deps' }, 'auto', 'bump-deps', {
        commands: [BUMP_DEPS],
        forge: 'github',
        before: undefined,
      }),
    ).toEqual(bump)
  })

  test('every kind of the catalogue goes to the engine and back as it was', () => {
    const actions: ReadonlyArray<DeliveryAction> = [
      { id: 'a', kind: 'commit-by-agent', mode: 'auto' },
      { id: 'b', kind: 'merge', mode: 'auto', method: 'local' },
      { id: 'c', kind: 'published-version', mode: 'auto', detect: { by: 'tag', pattern: 'v*' } },
      {
        id: 'd',
        kind: 'published-version',
        mode: 'auto',
        detect: { by: 'registry', packageName: '@acme/shared' },
      },
      { id: 'e', kind: 'published-version', mode: 'auto', detect: { by: 'confirm' } },
      {
        id: 'f',
        kind: 'remote-action',
        mode: 'click',
        action: { type: 'run-workflow', workflow: 'release.yml', inputs: {} },
      },
      { id: 'g', kind: 'command', mode: 'auto', commandId: 'c-bump' },
      { id: 'h', kind: 'agent', mode: 'auto', task: 'Write the changelog' },
      { id: 'i', kind: 'remove-workspace', mode: 'auto' },
    ]
    for (const action of actions) {
      const draft = withStepAdded(defaultDeliveryRules(), DELIVERY, 'r-api', 'tasks', null, action)
      const shown = shownRepository(draft, 'api').steps.find((one) => one.step.id === action.id)
      if (shown === undefined) throw new Error(`${action.id} is not shown`)
      expect(
        actionOf(shown.step.config, shown.step.start, action.id, {
          commands: [BUMP_DEPS],
          forge: 'github',
          before: action,
        }),
      ).toEqual(action)
    }
  })

  test('an action on the remote takes the kind of its forge: a workflow on GitHub, a pipeline on Bitbucket Cloud', () => {
    const config = { kind: 'remote-action', action: 'release' } as const
    expect(
      actionOf(config, 'click', 'x', { commands: [], forge: 'github', before: undefined }),
    ).toEqual({
      id: 'x',
      kind: 'remote-action',
      mode: 'click',
      action: { type: 'run-workflow', workflow: 'release', inputs: {} },
    })
    expect(
      actionOf(config, 'click', 'x', { commands: [], forge: 'bitbucket-cloud', before: undefined }),
    ).toEqual({
      id: 'x',
      kind: 'remote-action',
      mode: 'click',
      action: { type: 'run-pipeline', pipeline: 'release' },
    })
  })
})

/** web depends on nothing, api delivers after web, as an accepted dependency writes it. */
function withAcceptedForTest(draft: DeliveryRulesDraft): DeliveryRulesDraft {
  const others = draft.waves.repositories.filter((one) => one.repositoryId !== 'r-api')
  return {
    ...draft,
    waves: {
      ...draft.waves,
      repositories: [
        {
          repositoryId: 'r-api',
          preset: 'application',
          steps: { off: [], changed: [], added: [] },
          deliversAfter: ['r-web'],
        },
        ...others,
      ],
    },
  }
}

describe('A change of the delivery rules, checked then saved', () => {
  const SAVED: DeliveryRulesView = {
    rules: { ...defaultDeliveryRules(), version: 3, savedAt: '2026-10-18T08:00:00.000Z' },
    repositories: [],
    proposedDependencies: [],
  }
  const NO_PUSH: DeliveryProblem = {
    code: 'pull-request-without-push',
    repositoryId: 'r-api',
    stepId: 'pull-request',
    sentence: 'A pull request needs a push: api has no push step before its pull request step.',
  }
  const leftOut = withStepRemoved(defaultDeliveryRules(), DELIVERY, 'r-api', 'push')

  test('a change the engine refuses is kept with every reason, on its version, and not saved', async () => {
    const save = vi.fn(() => Promise.resolve(SAVED))
    const written = await writeRules(
      { validateDeliveryRules: () => Promise.resolve([NO_PUSH]), saveDeliveryRules: save },
      'acme',
      workingOf(SAVED),
      leftOut,
    )
    expect(written).toEqual({
      kind: 'kept',
      working: { draft: leftOut, version: 3, problems: [NO_PUSH], edited: true },
    })
    expect(save).not.toHaveBeenCalled()
  })

  test('a change that holds is saved on the version it was edited from', async () => {
    const mended = withStepPutBack(leftOut, 'r-api', 'push')
    const save = vi.fn(() => Promise.resolve(SAVED))
    const written = await writeRules(
      { validateDeliveryRules: () => Promise.resolve([]), saveDeliveryRules: save },
      'acme',
      { draft: leftOut, version: 3, problems: [NO_PUSH], edited: true },
      mended,
    )
    expect(written).toEqual({ kind: 'saved', view: SAVED })
    expect(save).toHaveBeenCalledWith('acme', mended, 3)
  })

  test('a save refused after the check is kept with the reasons the save gave', async () => {
    const written = await writeRules(
      {
        validateDeliveryRules: () => Promise.resolve([]),
        saveDeliveryRules: () => Promise.reject(new DeliveryRulesRefused({ problems: [NO_PUSH] })),
      },
      'acme',
      workingOf(SAVED),
      leftOut,
    )
    expect(written).toMatchObject({ kind: 'kept', working: { problems: [NO_PUSH] } })
  })

  test('a save that meets a newer version rejects with the engine’s refusal', async () => {
    const stale = new StaleVersion({ entity: 'delivery rules', id: 'acme', expected: 3 })
    await expect(
      writeRules(
        {
          validateDeliveryRules: () => Promise.resolve([]),
          saveDeliveryRules: () => Promise.reject(stale),
        },
        'acme',
        workingOf(SAVED),
        leftOut,
      ),
    ).rejects.toBe(stale)
  })

  test('the rules read are the draft the editor starts from, nothing refused yet', () => {
    expect(workingOf(SAVED)).toEqual({
      draft: defaultDeliveryRules(),
      version: 3,
      problems: [],
      edited: false,
    })
  })
})
