/**
 * The delivery rules of a Project (#340): the presets, a repository's overrides and its effective
 * recipe, every refusal of the validation with its sentence, the templates, the dependencies
 * proposed from `package.json` files, and the sections a mission copies.
 */

import { Arbitrary, Effect, Predicate, Result, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type DeliveryProject,
  type DeliveryRepository,
  DeliveryRules,
  type DeliveryRulesDraft,
  ACTION_KINDS,
  ACTION_RETRIES,
  type ActionKind,
  DELIVERY_MOMENTS,
  DeliveryAction,
  type DeliveryMoment,
  type Overrides,
  type RepositoryWaves,
  applyOverrides,
  approvalsRequired,
  changesOf,
  decodeDeliveryRules,
  defaultDeliveryRules,
  effectiveRepositories,
  inOrder,
  mayWriteToNetwork,
  partsOf,
  preparationDifferences,
  proposeDependencies,
  renderTemplate,
  rowsOf,
  decodeSectionCopy,
  sectionOf,
  stepsOfRepository,
  validateCopies,
  validateRules,
  withDependencies,
  dependencyProblems,
} from '../src/domain/index.ts'

const repository = (
  id: string,
  forge: DeliveryRepository['forge'] = 'github',
  capabilities: DeliveryRepository['capabilities'] = {
    runWorkflow: forge === 'github' || forge === 'bitbucket-cloud',
    approveManualStep: forge === 'github',
  },
): DeliveryRepository => ({ id, name: id, forge, capabilities })

/** Acme: a shared library, the api built on it, and the web app built on the api. */
const ACME: DeliveryProject = {
  repositories: [repository('shared'), repository('api'), repository('web')],
  commandIds: ['bump-deps', 'changeset'],
}

const only = (...repositories: DeliveryRepository[]): DeliveryProject => ({
  repositories,
  commandIds: ACME.commandIds,
})

const waves = (
  repositoryId: string,
  preset: RepositoryWaves['preset'],
  over: Partial<Omit<RepositoryWaves, 'repositoryId' | 'preset'>> = {},
): RepositoryWaves => ({
  repositoryId,
  preset,
  steps: { off: [], changed: [], added: [] },
  deliversAfter: [],
  ...over,
})

/** The default rules with the repositories' waves given, the rest as the defaults say. */
const rulesWith = (
  repositories: ReadonlyArray<RepositoryWaves>,
  over: Partial<DeliveryRulesDraft> = {},
): DeliveryRulesDraft => {
  const base = defaultDeliveryRules()
  return { ...base, waves: { ...base.waves, repositories }, ...over }
}

/** Acme as a chain: shared publishes, api bumps on it and publishes too, web bumps on api. */
const ACME_CHAIN = rulesWith([
  waves('shared', 'library'),
  waves('api', 'library', { deliversAfter: ['shared'] }),
  waves('web', 'application', { deliversAfter: ['api'] }),
])

const sentences = (rules: DeliveryRulesDraft, project: DeliveryProject = ACME) =>
  validateRules(rules, project).map((problem) => problem.sentence)

const kinds = (steps: ReadonlyArray<{ readonly kind: string }>) => steps.map((step) => step.kind)

const effectiveOf = (rules: DeliveryRulesDraft, project: DeliveryProject, id: string) => {
  const found = effectiveRepositories(rules, project).find((one) => one.repositoryId === id)
  if (found === undefined) throw new Error(`no repository ${id}`)
  return found
}

/** The preparation of one repository, its fields as given, the rest as the defaults say. */
const preparedWith = (
  rules: DeliveryRulesDraft,
  repositoryId: string,
  over: Partial<DeliveryRulesDraft['preparation']['repositories'][number]>,
): DeliveryRulesDraft => ({
  ...rules,
  preparation: {
    ...rules.preparation,
    repositories: [
      {
        repositoryId,
        commitTemplate: '{key}: {title}',
        pullRequestTitle: '{key}: {title}',
        pullRequestBody: '{summary}\n\n{images}',
        reviewers: [],
        requireApproval: false,
        steps: { off: [], changed: [], added: [] },
        ...over,
      },
    ],
  },
})

/** Hemera's commit, as the presets place it. */
const COMMIT: DeliveryAction = { id: 'commit', kind: 'commit-by-hemera', mode: 'auto' }
const LOCAL_MERGE: DeliveryAction = { id: 'merge', kind: 'merge', mode: 'auto', method: 'local' }

/** A repository's push and pull request moved from Review into its waves, first. */
const movedToWaves = (rules: DeliveryRulesDraft, repositoryId: string): DeliveryRulesDraft => ({
  ...rules,
  preparation: {
    ...rules.preparation,
    repositories: rules.preparation.repositories.map((one) =>
      one.repositoryId === repositoryId
        ? { ...one, steps: { ...one.steps, off: ['push', 'pull-request'] } }
        : one,
    ),
  },
  waves: {
    ...rules.waves,
    repositories: rules.waves.repositories.map((one) =>
      one.repositoryId === repositoryId
        ? {
            ...one,
            steps: {
              ...one.steps,
              added: [
                { after: null, step: { id: 'late-push', kind: 'push', mode: 'click' } },
                {
                  after: 'late-push',
                  step: { id: 'late-pull-request', kind: 'pull-request', mode: 'click' },
                },
              ],
            },
          }
        : one,
    ),
  },
})

describe('Each preset validates clean', () => {
  test('each preset validates clean; Local has no forge step and a local merge', () => {
    expect(sentences(ACME_CHAIN)).toEqual([])
    expect(sentences(rulesWith([waves('shared', 'library')]), only(repository('shared')))).toEqual(
      [],
    )
    expect(sentences(rulesWith([waves('web', 'application')]), only(repository('web')))).toEqual([])
    const notes = only(repository('notes', 'none'))
    const local = rulesWith([waves('notes', 'local')])
    expect(sentences(local, notes)).toEqual([])

    const effective = effectiveOf(local, notes, 'notes')
    expect(effective.stacks.preparation).toEqual([])
    expect(effective.stacks.waves).toEqual([COMMIT, LOCAL_MERGE])
  })

  test('a repository given no rules takes Local without a forge and Application with one', () => {
    const project = only(repository('notes', 'none'), repository('api'))
    const rules = defaultDeliveryRules()
    expect(sentences(rules, project)).toEqual([])
    expect(effectiveOf(rules, project, 'notes').preset).toBe('local')
    expect(effectiveOf(rules, project, 'api').preset).toBe('application')
  })

  test('Library and Application commit, push and open the pull request in Review, the push on a click', () => {
    const shared = effectiveOf(ACME_CHAIN, ACME, 'shared')
    expect(shared.stacks.preparation).toEqual([
      COMMIT,
      { id: 'push', kind: 'push', mode: 'click' },
      { id: 'pull-request', kind: 'pull-request', mode: 'click' },
    ])
    // shared depends on nothing: the preset's bump is not there.
    expect(kinds(shared.stacks.waves)).toEqual(['merge', 'ci', 'published-version'])
    expect(kinds(effectiveOf(ACME_CHAIN, ACME, 'api').stacks.waves)).toEqual([
      'bump',
      'merge',
      'ci',
      'published-version',
    ])
    expect(kinds(effectiveOf(ACME_CHAIN, ACME, 'web').stacks.waves)).toEqual([
      'bump',
      'merge',
      'ci',
    ])
  })

  test('the End is Closing, then the four Cleanup steps', () => {
    const { end } = defaultDeliveryRules()
    expect(end.closing).toBe('merge-spec')
    expect(kinds(end.cleanup)).toEqual([
      'pull-main-checkout',
      'stop-services',
      'remove-worktrees',
      'remove-workspace',
    ])
  })

  test('the default templates', () => {
    const rules = defaultDeliveryRules()
    expect(rules.preparation.reviewDrafts).toBe(false)
    expect(effectiveOf(rules, ACME, 'api').preparation).toEqual({
      commitTemplate: '{key}: {title}',
      pullRequestTitle: '{key}: {title}',
      pullRequestBody: '{summary}\n\n{images}',
      reviewers: [],
      requireApproval: false,
    })
  })
})

describe('A repository overrides its preset', () => {
  test('a repository overriding one step of its preset keeps the rest (effective recipe)', () => {
    const rules = rulesWith([
      waves('shared', 'library', {
        steps: {
          off: [],
          changed: [{ id: 'merge', kind: 'merge', mode: 'click', method: 'rebase' }],
          added: [],
        },
      }),
    ])
    const project = only(repository('shared'))
    expect(effectiveOf(rules, project, 'shared').stacks.waves).toEqual([
      { id: 'merge', kind: 'merge', mode: 'click', method: 'rebase' },
      { id: 'ci', kind: 'ci', mode: 'auto' },
      {
        id: 'published-version',
        kind: 'published-version',
        mode: 'auto',
        detect: { by: 'registry', packageName: null },
      },
    ])
    // The recipe is computed, never stored: the rules hold only the change.
    expect(rules.waves.repositories[0]?.steps.changed).toHaveLength(1)
  })

  test('a step left out, a step changed and steps of its own after an anchor, in order', () => {
    const base: DeliveryAction[] = [
      { id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' },
      { id: 'ci', kind: 'ci', mode: 'auto' },
      { id: 'tag', kind: 'confirm', mode: 'click', what: 'the tag is pushed' },
    ]
    const overrides: Overrides<DeliveryAction> = {
      off: ['ci'],
      changed: [{ id: 'tag', kind: 'confirm', mode: 'auto', what: 'the release is out' }],
      added: [
        { after: null, step: { id: 'notes', kind: 'agent', mode: 'auto', task: 'Notes' } },
        { after: 'merge', step: { id: 'smoke', kind: 'command', mode: 'auto', commandId: 'x' } },
        { after: 'smoke', step: { id: 'look', kind: 'confirm', mode: 'click', what: 'it works' } },
        // An anchor its preset no longer has: the step goes last rather than nowhere.
        { after: 'gone', step: { id: 'last', kind: 'ci', mode: 'auto' } },
      ],
    }
    expect(applyOverrides(base, overrides).map((step) => step.id)).toEqual([
      'notes',
      'merge',
      'smoke',
      'look',
      'tag',
      'last',
    ])
    expect(applyOverrides(base, overrides)[4]).toEqual({
      id: 'tag',
      kind: 'confirm',
      mode: 'auto',
      what: 'the release is out',
    })
    expect(changesOf(overrides)).toBe(6)
  })

  test('any one step changed leaves every other step of the base where it was', async () => {
    const steps = Arbitrary.array(Arbitrary.schema(DeliveryAction), {
      maxLength: 8,
    })
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(steps, (drawn) => {
        const base = drawn.map((step, index) => ({ ...step, id: `s${String(index)}` }))
        if (base.length === 0) return true
        const target = base[Math.floor(base.length / 2)]
        if (target === undefined) return true
        const changed: DeliveryAction = { id: target.id, kind: 'ci', mode: 'click' }
        const effective = applyOverrides(base, { off: [], changed: [changed], added: [] })
        return (
          effective.length === base.length &&
          effective.every((step, index) =>
            step.id === target.id ? step === changed : step === base[index],
          )
        )
      }),
    )
    expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
    expect(Predicate.isTagged(result, 'Passed')).toBe(true)
  })

  test('the table of a preset shows, per repository, where each step comes from', () => {
    const rules = rulesWith([
      waves('shared', 'library'),
      waves('api', 'library', {
        deliversAfter: ['shared'],
        steps: {
          off: ['ci'],
          changed: [{ id: 'merge', kind: 'merge', mode: 'click', method: 'rebase' }],
          added: [
            {
              after: 'merge',
              step: { id: 'look', kind: 'confirm', mode: 'click', what: 'it works' },
            },
          ],
        },
      }),
      waves('web', 'application', { deliversAfter: ['api'] }),
    ])
    const rows = rowsOf(rules, ACME, 'library', 'waves')
    expect(
      rows.map((row) => [row.step.id, row.owner, row.cells.map((cell) => cell.origin)]),
    ).toEqual([
      ['bump', null, ['inherited', 'inherited']],
      ['merge', null, ['inherited', 'changed']],
      ['look', 'api', [null, 'added']],
      ['ci', null, ['inherited', 'off']],
      ['published-version', null, ['inherited', 'inherited']],
    ])
    expect(rows[0]?.cells.map((cell) => cell.repositoryId)).toEqual(['shared', 'api'])
    // What one repository runs: its moments, in the order they happen.
    expect(stepsOfRepository(effectiveOf(rules, ACME, 'api')).map((step) => step.id)).toEqual([
      'commit',
      'push',
      'pull-request',
      'bump',
      'merge',
      'look',
      'published-version',
    ])
  })

  test('a command and an agent may always write to the network', () => {
    expect(mayWriteToNetwork({ id: 'c', kind: 'command', mode: 'auto', commandId: 'x' })).toBe(true)
    expect(mayWriteToNetwork({ id: 'a', kind: 'agent', mode: 'auto', task: 'Release notes' })).toBe(
      true,
    )
    expect(mayWriteToNetwork({ id: 'm', kind: 'merge', mode: 'auto', method: 'squash' })).toBe(
      false,
    )
  })

  test('a step read as what it is and what it acts on', () => {
    expect(partsOf({ id: 'm', kind: 'merge', mode: 'auto', method: 'squash' })).toEqual({
      what: 'Merge',
      on: 'squash',
    })
    expect(
      partsOf({
        id: 'p',
        kind: 'published-version',
        mode: 'auto',
        detect: { by: 'tag', pattern: 'v*' },
      }),
    ).toEqual({ what: 'Published version', on: 'tag v*' })
    expect(
      partsOf({
        id: 'r',
        kind: 'remote-action',
        mode: 'click',
        action: { type: 'approve-deployment', environment: 'production' },
      }),
    ).toEqual({ what: 'Approve deployment', on: 'production' })
  })
})

describe('Inconsistent rules are refused with their reason', () => {
  test('a merge without a pull request is refused', () => {
    const rules = preparedWith(ACME_CHAIN, 'api', {
      steps: { off: ['pull-request'], changed: [], added: [] },
    })
    expect(validateRules(rules, ACME)).toEqual([
      {
        code: 'merge-without-pull-request',
        repositoryId: 'api',
        stepId: 'merge',
        sentence: 'Merge needs a pull request: api has no pull request step.',
      },
    ])
  })

  test('a pull request without a push before it is refused', () => {
    const rules = preparedWith(ACME_CHAIN, 'api', {
      steps: { off: ['push'], changed: [], added: [] },
    })
    expect(validateRules(rules, ACME)).toEqual([
      {
        code: 'pull-request-without-push',
        repositoryId: 'api',
        stepId: 'pull-request',
        sentence: 'A pull request needs a push: api has no push step before its pull request step.',
      },
    ])
  })

  test('a cycle between repositories is refused, naming it', () => {
    const rules = rulesWith([
      waves('shared', 'library', { deliversAfter: ['api'] }),
      waves('api', 'library', { deliversAfter: ['shared'] }),
    ])
    expect(validateRules(rules, only(repository('shared'), repository('api')))).toEqual([
      {
        code: 'dependency-cycle',
        repositoryId: 'shared',
        stepId: null,
        sentence: 'These repositories deliver after each other in a cycle: shared → api → shared.',
      },
    ])
  })

  test('a cycle of three repositories is named in order', () => {
    const rules = rulesWith([
      waves('shared', 'library', { deliversAfter: ['web'] }),
      waves('api', 'library', { deliversAfter: ['shared'] }),
      waves('web', 'library', { deliversAfter: ['api'] }),
    ])
    expect(sentences(rules)).toEqual([
      'These repositories deliver after each other in a cycle: shared → web → api → shared.',
    ])
  })

  test('a bump without a publishing upstream is refused', () => {
    const rules = rulesWith([
      waves('shared', 'application'),
      waves('web', 'application', {
        deliversAfter: ['shared'],
        steps: {
          off: [],
          changed: [{ id: 'bump', kind: 'bump', mode: 'auto', how: { by: 'agent' } }],
          added: [],
        },
      }),
    ])
    expect(validateRules(rules, only(repository('shared'), repository('web')))).toEqual([
      {
        code: 'bump-without-publisher',
        repositoryId: 'web',
        stepId: 'bump',
        sentence: 'web bumps its dependencies, but nothing it depends on publishes a version.',
      },
    ])
  })

  test('approvals required before Ship while the pull request opens after Ship are refused', () => {
    const rules = movedToWaves(preparedWith(ACME_CHAIN, 'api', { requireApproval: true }), 'api')
    expect(validateRules(rules, ACME)).toEqual([
      {
        code: 'approval-after-ship',
        repositoryId: 'api',
        stepId: 'late-pull-request',
        sentence:
          'api requires team approval before Ship, but its pull request is opened after Ship.',
      },
    ])
  })

  test('a forge step on a repository without a forge is refused', () => {
    const rules = rulesWith([waves('notes', 'application')])
    const problems = validateRules(rules, only(repository('notes', 'none')))
    expect(problems.map((one) => [one.code, one.stepId, one.sentence])).toEqual([
      [
        'forge-step-without-forge',
        'pull-request',
        'notes has no forge, so it cannot have a pull request step.',
      ],
      [
        'forge-step-without-forge',
        'merge',
        'notes has no forge, so it cannot merge through a pull request.',
      ],
    ])
  })

  test('a remote action the forge cannot do is refused', () => {
    const action = (id: string, type: 'run-pipeline' | 'approve-deployment') => ({
      after: 'ci',
      step:
        type === 'run-pipeline'
          ? ({
              id,
              kind: 'remote-action',
              mode: 'click',
              action: { type, pipeline: 'release' },
            } as const)
          : ({
              id,
              kind: 'remote-action',
              mode: 'click',
              action: { type, environment: 'prod' },
            } as const),
    })
    const rules = rulesWith([
      waves('api', 'application', {
        steps: { off: [], changed: [], added: [action('release', 'run-pipeline')] },
      }),
      waves('web', 'application', {
        steps: { off: [], changed: [], added: [action('deploy', 'approve-deployment')] },
      }),
    ])
    const project = only(
      repository('api', 'bitbucket-datacenter'),
      repository('web', 'bitbucket-cloud'),
    )
    expect(validateRules(rules, project)).toEqual([
      {
        code: 'remote-action-not-allowed',
        repositoryId: 'api',
        stepId: 'release',
        sentence: 'api’s forge, Bitbucket Data Center, cannot run a pipeline.',
      },
      {
        code: 'remote-action-not-allowed',
        repositoryId: 'web',
        stepId: 'deploy',
        sentence: 'web’s forge, Bitbucket Cloud, cannot approve a deployment.',
      },
    ])
  })

  test('a template using an unknown variable is refused, naming it', () => {
    const rules = preparedWith(ACME_CHAIN, 'api', { pullRequestTitle: '{key}: {titel}' })
    expect(validateRules(rules, ACME)).toEqual([
      {
        code: 'unknown-template-variable',
        repositoryId: 'api',
        stepId: null,
        field: 'pullRequestTitle',
        sentence: 'The pull request title of api uses an unknown variable: {titel}.',
      },
    ])
  })

  test('a command step or a bump by command naming a command the catalogue lacks is refused', () => {
    const rules = rulesWith([
      waves('shared', 'library'),
      waves('api', 'library', {
        deliversAfter: ['shared'],
        steps: {
          off: [],
          changed: [
            { id: 'bump', kind: 'bump', mode: 'auto', how: { by: 'command', commandId: 'gone' } },
          ],
          added: [],
        },
      }),
      waves('web', 'application', { deliversAfter: ['api'] }),
    ])
    const base = defaultDeliveryRules()
    const withCleanup: DeliveryRulesDraft = {
      ...rules,
      end: {
        ...base.end,
        cleanup: [
          { id: 'prune', kind: 'command', mode: 'auto', commandId: 'lost' },
          ...base.end.cleanup,
        ],
      },
    }
    expect(validateRules(withCleanup, ACME)).toEqual([
      {
        code: 'unknown-command',
        repositoryId: 'api',
        stepId: 'bump',
        sentence: 'api’s step “bump” names a command that is not in the catalogue.',
      },
      {
        code: 'unknown-command',
        repositoryId: null,
        stepId: 'prune',
        sentence: 'The Cleanup step “prune” names a command that is not in the catalogue.',
      },
    ])
  })

  test('a local merge outside a repository with the Local preset is refused', () => {
    const rules = rulesWith([
      waves('web', 'application', {
        steps: {
          off: [],
          changed: [{ id: 'merge', kind: 'merge', mode: 'auto', method: 'local' }],
          added: [],
        },
      }),
    ])
    expect(validateRules(rules, only(repository('web')))).toEqual([
      {
        code: 'local-merge-outside-local',
        repositoryId: 'web',
        stepId: 'merge',
        sentence: 'web merges locally, but only a repository with the Local preset can.',
      },
    ])
  })

  test('several refusals at once are all listed', () => {
    const broken = preparedWith(
      rulesWith([
        waves('shared', 'library', { deliversAfter: ['api'] }),
        waves('api', 'library', { deliversAfter: ['shared'] }),
      ]),
      'api',
      { commitTemplate: '{ticket}', steps: { off: ['pull-request'], changed: [], added: [] } },
    )
    expect(
      validateRules(broken, only(repository('shared'), repository('api'))).map((one) => one.code),
    ).toEqual(['merge-without-pull-request', 'dependency-cycle', 'unknown-template-variable'])
  })

  test('validating any rules never throws, and names only repositories of the Project', async () => {
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(Arbitrary.schema(Schema.toType(DeliveryRules)), (rules) => {
        const named = validateRules(rules, ACME).map((one) => one.repositoryId)
        return named.every((id) => id === null || ACME.repositories.some((one) => one.id === id))
      }),
    )
    expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
  })

  test('validating any overrides of the Project’s repositories never throws', async () => {
    const drawn = Arbitrary.map(Arbitrary.schema(Schema.toType(DeliveryRules)), onAcme)
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(drawn, (rules) => {
        effectiveRepositories(rules, ACME)
        const named = validateRules(rules, ACME).map((one) => one.repositoryId)
        return named.every((id) => id === null || ACME.repositories.some((one) => one.id === id))
      }),
    )
    expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
  })
})

describe('Steps are addressed by their id', () => {
  const adding = (repositoryId: string, added: Overrides<DeliveryAction>['added']) =>
    rulesWith([waves(repositoryId, 'application', { steps: { off: [], changed: [], added } })])

  test('an added step placed after itself is refused, never thrown', () => {
    const rules = adding('web', [
      { after: 'look', step: { id: 'look', kind: 'confirm', mode: 'click', what: 'it works' } },
    ])
    expect(validateRules(rules, only(repository('web')))).toEqual([
      {
        code: 'step-placed-after-itself',
        repositoryId: 'web',
        stepId: 'look',
        sentence: 'web places its step “look” after itself: look → look.',
      },
    ])
  })

  test('two added steps placed after each other are refused, never thrown', () => {
    const rules = adding('web', [
      { after: 'b', step: { id: 'a', kind: 'confirm', mode: 'click', what: 'one' } },
      { after: 'a', step: { id: 'b', kind: 'confirm', mode: 'click', what: 'two' } },
    ])
    expect(sentences(rules, only(repository('web')))).toEqual([
      'web places its step “a” after itself: a → b → a.',
    ])
  })

  test('an added step with the id of another, placed after it, is refused, never thrown', () => {
    const rules = adding('web', [
      { after: 'ci', step: { id: 'ci', kind: 'confirm', mode: 'click', what: 'it works' } },
    ])
    expect(sentences(rules, only(repository('web')))).toEqual([
      'web has two steps with the id “ci”: each step needs its own.',
    ])
    const pair = adding('web', [
      { after: 'merge', step: { id: 'a', kind: 'confirm', mode: 'click', what: 'one' } },
      { after: 'a', step: { id: 'merge', kind: 'confirm', mode: 'click', what: 'two' } },
    ])
    expect(sentences(pair, only(repository('web')))).toEqual([
      'web has two steps with the id “merge”: each step needs its own.',
    ])
  })

  test('a step id used in two moments of a repository is refused', () => {
    const rules = withActions(
      preparedWith(ACME_CHAIN, 'api', {
        steps: { off: [], changed: [], added: [{ after: null, step: sample('confirm', 'check') }] },
      }),
      'tasks',
      [sample('confirm', 'check')],
    )
    expect(
      validateRules(rules, ACME).map((one) => [one.code, one.repositoryId, one.stepId]),
    ).toEqual([['duplicate-step-id', 'api', 'check']])
  })

  test('a duplicate step id is refused', () => {
    const base = defaultDeliveryRules()
    const rules: DeliveryRulesDraft = {
      ...base,
      preparation: {
        ...base.preparation,
        presets: {
          ...base.preparation.presets,
          application: [
            ...base.preparation.presets.application,
            { id: 'push', kind: 'push', mode: 'auto' },
          ],
        },
      },
      waves: {
        ...base.waves,
        presets: {
          ...base.waves.presets,
          library: [...base.waves.presets.library, { id: 'ci', kind: 'ci', mode: 'auto' }],
        },
        repositories: [
          waves('web', 'local', {
            steps: {
              off: [],
              changed: [],
              added: [
                {
                  after: null,
                  step: { id: 'merge', kind: 'confirm', mode: 'click', what: 'merged' },
                },
              ],
            },
          }),
        ],
      },
      end: {
        ...base.end,
        cleanup: [
          { id: 'stop-services', kind: 'stop-services', mode: 'click' },
          ...base.end.cleanup,
        ],
      },
    }
    expect(
      validateRules(rules, only(repository('web', 'none'))).map((one) => [
        one.code,
        one.repositoryId,
        one.sentence,
      ]),
    ).toEqual([
      [
        'duplicate-step-id',
        null,
        'The Library preset has two steps with the id “ci”: each step needs its own.',
      ],
      [
        'duplicate-step-id',
        null,
        'The Application preset has two steps with the id “push”: each step needs its own.',
      ],
      [
        'duplicate-step-id',
        'web',
        'web has two steps with the id “merge”: each step needs its own.',
      ],
      [
        'duplicate-step-id',
        null,
        'Cleanup has two steps with the id “stop-services”: each step needs its own.',
      ],
    ])
  })
})

describe('Closing cannot be removed', () => {
  test('an unknown key trying to remove Closing is refused by the schema', () => {
    const encoded = Schema.encodeSync(DeliveryRules)({ ...ACME_CHAIN, version: 1, savedAt: null })
    const read = (document: string) => Result.isSuccess(decodeDeliveryRules(document))
    expect(read(JSON.stringify(encoded))).toBe(true)
    const { cleanup } = encoded.end
    expect(read(JSON.stringify({ ...encoded, end: { ...encoded.end, removeClosing: true } }))).toBe(
      false,
    )
    expect(read(JSON.stringify({ ...encoded, end: { cleanup, closing: null } }))).toBe(false)
    expect(read(JSON.stringify({ ...encoded, end: { cleanup } }))).toBe(false)
  })
})

describe('Repository dependencies', () => {
  const MANIFESTS = [
    { repositoryId: 'shared', manifest: '{"name":"@acme/shared","version":"1.0.0"}' },
    {
      repositoryId: 'api',
      manifest: '{"name":"@acme/api","dependencies":{"@acme/shared":"^1.0.0","effect":"4.0.0"}}',
    },
    { repositoryId: 'web', manifest: null },
    { repositoryId: 'docs', manifest: 'not json' },
  ]

  test('the dependency proposal from two package.json files finds the edge; nothing is saved without accept', () => {
    const proposed = proposeDependencies(MANIFESTS)
    expect(proposed).toEqual([{ repositoryId: 'api', deliversAfter: 'shared' }])
    const rules = defaultDeliveryRules()
    // Proposing changes nothing; accepting writes the edge into the rules.
    expect(rules.waves.repositories).toEqual([])
    const accepted = withDependencies(rules, ACME, proposed)
    expect(effectiveOf(accepted, ACME, 'api').deliversAfter).toEqual(['shared'])
    expect(effectiveOf(accepted, ACME, 'shared').deliversAfter).toEqual([])
  })

  test('a repository delivering after one the Project does not have is refused', () => {
    const rules = rulesWith([waves('web', 'application', { deliversAfter: ['mobile'] })])
    expect(validateRules(rules, only(repository('web')))).toEqual([
      {
        code: 'unknown-repository',
        repositoryId: 'web',
        stepId: null,
        sentence: 'web delivers after a repository that is not in this Project.',
      },
    ])
    expect(
      dependencyProblems(
        [{ repositoryId: 'mobile', deliversAfter: 'web' }],
        only(repository('web')),
      ),
    ).toEqual([
      {
        code: 'unknown-repository',
        repositoryId: null,
        stepId: null,
        sentence: 'A dependency names a repository that is not in this Project.',
      },
    ])
    expect(dependencyProblems([{ repositoryId: 'api', deliversAfter: 'shared' }], ACME)).toEqual([])
  })

  test('the repositories in the order they deliver: each after those it depends on', () => {
    expect(inOrder(effectiveRepositories(ACME_CHAIN, ACME)).map((one) => one.repositoryId)).toEqual(
      ['shared', 'api', 'web'],
    )
    const reversed = rulesWith([
      waves('shared', 'application', { deliversAfter: ['web', 'api'] }),
      waves('api', 'application', { deliversAfter: ['web'] }),
    ])
    expect(inOrder(effectiveRepositories(reversed, ACME)).map((one) => one.repositoryId)).toEqual([
      'web',
      'api',
      'shared',
    ])
  })
})

describe('Templates', () => {
  test('rendering replaces the five variables and keeps the {images} slot', () => {
    expect(
      renderTemplate('{key} {title} {slug} {branch}\n\n{summary}\n\n{images}', {
        key: 'ACME-12',
        title: 'Export as CSV',
        slug: 'export-as-csv',
        branch: 'acme/ACME-12-export-as-csv',
        summary: 'Adds the export.',
      }),
    ).toEqual({
      text: 'ACME-12 Export as CSV export-as-csv acme/ACME-12-export-as-csv\n\nAdds the export.\n\n{images}',
      missing: [],
    })
  })

  test('a missing value renders as empty and is reported', () => {
    expect(renderTemplate('{key}: {title} {summary}', { key: 'ACME-12' })).toEqual({
      text: 'ACME-12:  ',
      missing: ['title', 'summary'],
    })
  })
})

describe('The sections a mission copies', () => {
  test('the preparation copy holds what the Project said at that time', () => {
    const rules = {
      ...preparedWith(ACME_CHAIN, 'api', { requireApproval: true, reviewers: ['acme/web'] }),
      version: 4,
      savedAt: null,
    }
    const copy = sectionOf(rules, ACME, 'preparation', '2026-10-14T10:00:00.000Z')
    expect(copy.section).toBe('preparation')
    expect(copy.version).toBe(4)
    expect(approvalsRequired(copy)).toEqual(['api'])
  })

  test('after a Project change, the differences with the copy are listed', () => {
    const before = { ...ACME_CHAIN, version: 1, savedAt: null }
    const copy = sectionOf(before, ACME, 'preparation', '2026-10-14T10:00:00.000Z')
    const after = {
      ...preparedWith(ACME_CHAIN, 'web', {
        reviewers: ['acme/design'],
        pullRequestTitle: '{title}',
      }),
      version: 2,
      savedAt: null,
    }
    const now = sectionOf(after, ACME, 'preparation', '2026-10-14T11:00:00.000Z')
    if (copy.section !== 'preparation' || now.section !== 'preparation') throw new Error('section')
    expect(preparationDifferences(copy, now)).toEqual([
      { repositoryId: 'web', field: 'pullRequestTitle' },
      { repositoryId: 'web', field: 'reviewers' },
    ])
    expect(preparationDifferences(copy, copy)).toEqual([])
  })

  test('the waves and the End are copied resolved', () => {
    const rules = { ...ACME_CHAIN, version: 3, savedAt: null }
    const copied = sectionOf(rules, ACME, 'waves', '2026-10-14T10:00:00.000Z')
    if (copied.section !== 'waves') throw new Error('section')
    expect(
      copied.repositories.map((one) => [one.repositoryId, kinds(one.steps), one.deliversAfter]),
    ).toEqual([
      ['shared', ['merge', 'ci', 'published-version'], []],
      ['api', ['bump', 'merge', 'ci', 'published-version'], ['shared']],
      ['web', ['bump', 'merge', 'ci'], ['api']],
    ])
    const end = sectionOf(rules, ACME, 'end', '2026-10-14T10:00:00.000Z')
    if (end.section !== 'end') throw new Error('section')
    expect(end.closing).toBe('merge-spec')
  })
})

describe('The two copies a mission holds at Ship are checked together', () => {
  const at = '2026-10-14T10:00:00.000Z'

  test('copies of one version are consistent together', () => {
    const rules = { ...ACME_CHAIN, version: 1, savedAt: null }
    const preparation = sectionOf(rules, ACME, 'preparation', at)
    const copied = sectionOf(rules, ACME, 'waves', at)
    if (preparation.section !== 'preparation' || copied.section !== 'waves')
      throw new Error('section')
    expect(validateCopies({ tasks: null, preparation, waves: copied })).toEqual([])
  })

  test('a preparation copied under Local and waves copied under Application: a merge without a pull request across both is refused', () => {
    const local = { ...rulesWith([waves('api', 'local')]), version: 1, savedAt: null }
    const application = { ...rulesWith([waves('api', 'application')]), version: 2, savedAt: null }
    const project = only(repository('api'))
    const preparation = sectionOf(local, project, 'preparation', at)
    const copied = sectionOf(application, project, 'waves', at)
    if (preparation.section !== 'preparation' || copied.section !== 'waves')
      throw new Error('section')
    expect(validateCopies({ tasks: null, preparation, waves: copied })).toEqual([
      {
        code: 'merge-without-pull-request',
        repositoryId: 'api',
        stepId: 'merge',
        sentence: 'Merge needs a pull request: api has no pull request step.',
      },
    ])
  })

  test('a pull request copied in the waves without its push is refused across both', () => {
    const rules = {
      ...preparedWith(rulesWith([waves('api', 'application')]), 'api', {
        steps: { off: ['push'], changed: [], added: [] },
      }),
      version: 1,
      savedAt: null,
    }
    const project = only(repository('api'))
    const preparation = sectionOf(rules, project, 'preparation', at)
    const copied = sectionOf(rules, project, 'waves', at)
    if (preparation.section !== 'preparation' || copied.section !== 'waves')
      throw new Error('section')
    expect(
      validateCopies({ tasks: null, preparation, waves: copied }).map((one) => one.code),
    ).toEqual(['pull-request-without-push'])
  })
})

/** An action of each kind, as a user adds it. */
function sample(kind: ActionKind, id: string): DeliveryAction {
  switch (kind) {
    case 'bump':
      return { id, kind, mode: 'auto', how: { by: 'agent' } }
    case 'merge':
      return { id, kind, mode: 'auto', method: 'squash' }
    case 'remote-action':
      return {
        id,
        kind,
        mode: 'click',
        action: { type: 'run-workflow', workflow: 'release.yml', inputs: {} },
      }
    case 'published-version':
      return { id, kind, mode: 'auto', detect: { by: 'tag', pattern: 'v*' } }
    case 'command':
      return { id, kind, mode: 'auto', commandId: 'changeset' }
    case 'agent':
      return { id, kind, mode: 'auto', task: 'Write the release notes' }
    case 'confirm':
      return { id, kind, mode: 'click', what: 'the docs are published' }
    case 'commit-by-hemera':
    case 'commit-by-me':
    case 'commit-by-agent':
    case 'push':
    case 'pull-request':
    case 'ci':
    case 'pull-main-checkout':
    case 'stop-services':
    case 'remove-worktrees':
    case 'remove-workspace':
      return { id, kind, mode: 'auto' }
  }
}

/** What an action needs before it for its check to hold: a commit, a push, a pull request. */
const NEEDS: Partial<Record<ActionKind, ReadonlyArray<ActionKind>>> = {
  push: ['commit-by-hemera'],
  'pull-request': ['commit-by-hemera', 'push'],
  merge: ['commit-by-hemera', 'push', 'pull-request'],
}

/** The actions given, in order, first in api's stack of a moment, or first in Cleanup. */
function withActions(
  rules: DeliveryRulesDraft,
  moment: DeliveryMoment | 'cleanup',
  actions: ReadonlyArray<DeliveryAction>,
): DeliveryRulesDraft {
  if (moment === 'cleanup') {
    return { ...rules, end: { ...rules.end, cleanup: [...actions, ...rules.end.cleanup] } }
  }
  const added = actions.map((step, index) => ({ after: actions[index - 1]?.id ?? null, step }))
  const steps = { off: [], changed: [], added }
  switch (moment) {
    case 'tasks':
      return { ...rules, tasks: { ...rules.tasks, repositories: [{ repositoryId: 'api', steps }] } }
    case 'preparation':
      return preparedWith(rules, 'api', { steps })
    case 'waves':
      return {
        ...rules,
        waves: {
          ...rules.waves,
          repositories: rules.waves.repositories.map((one) =>
            one.repositoryId === 'api' ? { ...one, steps } : one,
          ),
        },
      }
  }
}

/** What a moment holds but cannot run, each refused with its reason ("Checks explain", below). */
const CANNOT_RUN_IN: Partial<Record<DeliveryMoment | 'cleanup', ReadonlyArray<ActionKind>>> = {
  // Done once per delivery; a bump before Ship, while shared publishes only after Ship.
  tasks: ['pull-request', 'merge', 'ci', 'bump', 'remove-worktrees', 'remove-workspace'],
  // A removal ends a delivery: placed first, what follows it cannot run. Cleanup ends on both.
  preparation: ['bump', 'remove-worktrees', 'remove-workspace'],
  waves: ['remove-worktrees', 'remove-workspace'],
  cleanup: ['remove-worktrees', 'remove-workspace'],
}

describe('The moments of a delivery', () => {
  const SHARED_AND_API = only(repository('shared'), repository('api'))
  const CHAIN = rulesWith([
    waves('shared', 'library'),
    waves('api', 'library', { deliversAfter: ['shared'] }),
  ])

  test('After each task, Preparation and the waves hold a stack each, then the End', () => {
    expect(DELIVERY_MOMENTS).toEqual(['tasks', 'preparation', 'waves'])
    const rules = defaultDeliveryRules()
    expect(rules.tasks.presets).toEqual({ library: [], application: [], local: [] })
    expect(effectiveOf(ACME_CHAIN, ACME, 'api').stacks.tasks).toEqual([])
    expect(rules.end.closing).toBe('merge-spec')
  })

  test('every catalogue action is accepted in every moment, when its check holds', () => {
    const refused = ACTION_KINDS.flatMap((kind) =>
      (['tasks', 'preparation', 'waves', 'cleanup'] as const).flatMap((moment) => {
        if (CANNOT_RUN_IN[moment]?.includes(kind)) return []
        const before = (NEEDS[kind] ?? []).map((need) => sample(need, `before-${need}`))
        const rules = withActions(CHAIN, moment, [...before, sample(kind, `added-${kind}`)])
        const document = JSON.stringify(
          Schema.encodeSync(DeliveryRules)({ ...rules, version: 1, savedAt: null }),
        )
        const read = Result.isSuccess(decodeDeliveryRules(document))
        const problems = validateRules(rules, SHARED_AND_API).map((one) => one.sentence)
        return read && problems.length === 0 ? [] : [{ kind, moment, read, problems }]
      }),
    )
    expect(refused).toEqual([])
  })

  test('a refused action stays in its stack: the check explains, nothing is taken away', () => {
    const rules = withActions(CHAIN, 'tasks', [sample('push', 'early-push')])
    expect(validateRules(rules, SHARED_AND_API)).toEqual([
      {
        code: 'push-without-commit',
        repositoryId: 'api',
        stepId: 'early-push',
        sentence: 'A push needs a commit: api has no commit action before its push.',
      },
    ])
    expect(effectiveOf(rules, SHARED_AND_API, 'api').stacks.tasks).toEqual([
      sample('push', 'early-push'),
    ])
  })
})

describe('Committing is an action', () => {
  test('Hemera commits, I commit myself and an agent commits are three actions of the catalogue', () => {
    const commits = ['commit-by-hemera', 'commit-by-me', 'commit-by-agent'] as const
    expect(commits.every((kind) => ACTION_KINDS.includes(kind))).toBe(true)
    expect(commits.map((kind) => partsOf(sample(kind, 'commit')))).toEqual([
      { what: 'Commit', on: 'by Hemera' },
      { what: 'Commit', on: 'by me' },
      { what: 'Commit', on: 'by an agent' },
    ])
    // An agent commits under the permission rules: it may write to the network, as any agent.
    expect(commits.map((kind) => mayWriteToNetwork(sample(kind, 'commit')))).toEqual([
      false,
      false,
      true,
    ])
  })

  test('a push with no commit action before it is refused', () => {
    const rules = preparedWith(ACME_CHAIN, 'api', {
      steps: { off: ['commit'], changed: [], added: [] },
    })
    expect(validateRules(rules, ACME)).toEqual([
      {
        code: 'push-without-commit',
        repositoryId: 'api',
        stepId: 'push',
        sentence: 'A push needs a commit: api has no commit action before its push.',
      },
    ])
  })

  test('a commit after the push does not count for it', () => {
    const rules = preparedWith(ACME_CHAIN, 'api', {
      steps: {
        off: ['commit'],
        changed: [],
        added: [{ after: 'push', step: sample('commit-by-me', 'late-commit') }],
      },
    })
    expect(validateRules(rules, ACME).map((one) => [one.code, one.stepId])).toEqual([
      ['push-without-commit', 'push'],
    ])
  })

  test('Cleanup is checked in each repository’s order, after its waves', () => {
    const rules = preparedWith(
      rulesWith([
        waves('api', 'application', { steps: { off: ['merge'], changed: [], added: [] } }),
      ]),
      'api',
      { steps: { off: ['commit', 'push', 'pull-request'], changed: [], added: [] } },
    )
    expect(
      validateRules(
        withActions(rules, 'cleanup', [sample('push', 'cleanup-push')]),
        only(repository('api')),
      ),
    ).toEqual([
      {
        code: 'push-without-commit',
        repositoryId: 'api',
        stepId: 'cleanup-push',
        sentence: 'A push needs a commit: api has no commit action before its push.',
      },
    ])
  })

  test('a commit after each task is a commit before the push', () => {
    const rules = withActions(
      preparedWith(ACME_CHAIN, 'api', { steps: { off: ['commit'], changed: [], added: [] } }),
      'tasks',
      [sample('commit-by-me', 'mine')],
    )
    expect(validateRules(rules, ACME)).toEqual([])
    expect(kinds(stepsOfRepository(effectiveOf(rules, ACME, 'api')))).toEqual([
      'commit-by-me',
      'push',
      'pull-request',
      'bump',
      'merge',
      'ci',
      'published-version',
    ])
  })
})

describe('Checks explain the orders an action cannot run in', () => {
  const SHARED_AND_API = only(repository('shared'), repository('api'))
  const CHAIN = rulesWith([
    waves('shared', 'library'),
    waves('api', 'library', { deliversAfter: ['shared'] }),
  ])

  test('a merge before Ship while team approval is required is refused', () => {
    const rules = preparedWith(CHAIN, 'api', {
      requireApproval: true,
      steps: {
        off: [],
        changed: [],
        added: [{ after: 'pull-request', step: sample('merge', 'early-merge') }],
      },
    })
    expect(validateRules(rules, SHARED_AND_API)).toEqual([
      {
        code: 'merge-before-approval',
        repositoryId: 'api',
        stepId: 'early-merge',
        sentence:
          'api requires team approval before Ship, but merges before Ship, before its pull request can be approved.',
      },
    ])
    // Without the approvals, merging in Review is the user's choice.
    expect(
      validateRules(
        { ...rules, preparation: { ...rules.preparation, repositories: [] } },
        SHARED_AND_API,
      ),
    ).toEqual([])
  })

  test('a bump before Ship is refused when the upstream publishes only after Ship', () => {
    const rules = withActions(CHAIN, 'preparation', [sample('bump', 'early-bump')])
    expect(validateRules(rules, SHARED_AND_API)).toEqual([
      {
        code: 'bump-before-publisher',
        repositoryId: 'api',
        stepId: 'early-bump',
        sentence:
          'api bumps its dependencies before Ship, but what it depends on publishes only after Ship.',
      },
    ])
    // shared publishing in its preparation too feeds the bump before Ship.
    const fed = {
      ...rules,
      preparation: {
        ...rules.preparation,
        repositories: [
          ...rules.preparation.repositories,
          ...preparedWith(CHAIN, 'shared', {
            steps: {
              off: [],
              changed: [],
              added: [
                { after: 'pull-request', step: sample('published-version', 'early-publish') },
              ],
            },
          }).preparation.repositories,
        ],
      },
    }
    expect(validateRules(fed, SHARED_AND_API)).toEqual([])
  })

  test('a pull request, a merge or CI after each task is refused: each is done once per delivery', () => {
    const rules = withActions(CHAIN, 'tasks', [
      sample('commit-by-hemera', 'task-commit'),
      sample('push', 'task-push'),
      sample('pull-request', 'task-pull-request'),
      sample('merge', 'task-merge'),
      sample('ci', 'task-ci'),
    ])
    const once = (stepId: string, sentence: string) => ({
      code: 'once-per-delivery-after-each-task',
      repositoryId: 'api',
      stepId,
      sentence,
    })
    expect(validateRules(rules, SHARED_AND_API)).toEqual([
      once(
        'task-pull-request',
        'api opens a pull request after each task, but a pull request is opened once per delivery.',
      ),
      once('task-merge', 'api merges after each task, but a branch is merged once per delivery.'),
      once(
        'task-ci',
        'api waits for CI after each task, but CI checks a delivery once, after it is pushed.',
      ),
    ])
    // A commit and a push after each task are not refused.
    expect(effectiveOf(rules, SHARED_AND_API, 'api').stacks.tasks).toHaveLength(5)
  })

  test('a pull request after each task is opened before Ship, for the approvals', () => {
    const rules = withActions(
      preparedWith(CHAIN, 'api', {
        requireApproval: true,
        steps: { off: ['commit', 'push', 'pull-request'], changed: [], added: [] },
      }),
      'tasks',
      [
        sample('commit-by-hemera', 'task-commit'),
        sample('push', 'task-push'),
        sample('pull-request', 'task-pull-request'),
      ],
    )
    expect(validateRules(rules, SHARED_AND_API).map((one) => one.code)).toEqual([
      'once-per-delivery-after-each-task',
    ])
  })

  test('a merge after each task waits for the approvals too', () => {
    const rules = withActions(preparedWith(CHAIN, 'api', { requireApproval: true }), 'tasks', [
      sample('merge', 'task-merge'),
    ])
    expect(
      validateRules(rules, SHARED_AND_API)
        .filter((one) => one.code === 'merge-before-approval')
        .map((one) => [one.repositoryId, one.stepId]),
    ).toEqual([['api', 'task-merge']])
  })

  test('removing the Workspace or the worktrees after each task is refused', () => {
    const refused = (['remove-worktrees', 'remove-workspace'] as const).map((kind) =>
      validateRules(withActions(CHAIN, 'tasks', [sample(kind, 'early-removal')]), SHARED_AND_API)
        .filter((one) => one.code === 'once-per-delivery-after-each-task')
        .map((one) => [one.stepId, one.sentence]),
    )
    expect(refused).toEqual([
      [
        [
          'early-removal',
          'api removes the worktrees after each task, but they are removed once, when the mission ends.',
        ],
      ],
      [
        [
          'early-removal',
          'api removes the Workspace after each task, but it is removed once, when the mission ends.',
        ],
      ],
    ])
  })

  test('any action after removing the Workspace, in any moment, is refused', () => {
    const rules = withActions(CHAIN, 'preparation', [sample('remove-workspace', 'early-removal')])
    const problems = validateRules(rules, SHARED_AND_API)
    expect(problems.map((one) => [one.code, one.repositoryId, one.stepId])).toEqual(
      [
        'commit',
        'push',
        'pull-request',
        'bump',
        'merge',
        'ci',
        'published-version',
        'pull-main-checkout',
        'stop-services',
        'remove-worktrees',
        'remove-workspace',
      ].map((stepId) => ['step-after-workspace-removed', 'api', stepId]),
    )
    expect(problems[0]?.sentence).toBe(
      'api runs “commit” after removing the Workspace, but nothing runs once it is gone.',
    )
  })

  test('after removing the worktrees, only the Workspace can be removed', () => {
    const rules = withActions(CHAIN, 'waves', [sample('remove-worktrees', 'early-removal')])
    const problems = validateRules(rules, SHARED_AND_API)
    expect(problems.map((one) => [one.code, one.repositoryId, one.stepId])).toEqual(
      [
        'bump',
        'merge',
        'ci',
        'published-version',
        'pull-main-checkout',
        'stop-services',
        'remove-worktrees',
      ].map((stepId) => ['step-after-worktrees-removed', 'api', stepId]),
    )
    expect(problems[0]?.sentence).toBe(
      'api runs “bump” after removing the worktrees, but only the Workspace can be removed once they are gone.',
    )
  })

  test('any action after removing the Workspace in Cleanup is refused', () => {
    const rules = {
      ...CHAIN,
      end: {
        ...CHAIN.end,
        cleanup: [...CHAIN.end.cleanup, sample('push', 'late-push'), sample('confirm', 'late-ok')],
      },
    }
    const after = (stepId: string) => ({
      code: 'step-after-workspace-removed',
      repositoryId: null,
      stepId,
      sentence: `Cleanup runs “${stepId}” after removing the Workspace, but nothing runs once it is gone.`,
    })
    expect(validateRules(rules, SHARED_AND_API)).toEqual([after('late-push'), after('late-ok')])
  })
})

describe('Each action type declares whether it is safe to run again', () => {
  test('every action type declares retry safety and a post-condition', () => {
    expect(Object.keys(ACTION_RETRIES).toSorted()).toEqual([...ACTION_KINDS].toSorted())
    for (const kind of ACTION_KINDS) {
      const { postCondition } = ACTION_RETRIES[kind]
      expect(postCondition === null || postCondition.endsWith('.')).toBe(true)
    }
  })

  const NEW_COMMIT = 'A new commit exists on the branch since the action started.'
  test.each([
    ['commit-by-hemera', true, 'The Workspace has no uncommitted change.'],
    ['commit-by-me', true, NEW_COMMIT],
    ['commit-by-agent', false, NEW_COMMIT],
    ['push', true, 'The remote head equals the local head.'],
    ['pull-request', false, 'A pull request from the branch into the base branch is open.'],
    ['bump', false, 'The manifests name the versions the upstream repositories published.'],
    ['merge', false, 'The branch is merged into the base branch.'],
    ['ci', true, 'The checks of the pushed commit are green.'],
    ['remote-action', false, null],
    ['published-version', true, 'The version is seen published.'],
    ['command', false, null],
    ['agent', false, null],
    ['confirm', true, 'The user confirmed it.'],
    ['pull-main-checkout', true, 'The main checkout’s base branch equals its remote’s.'],
    ['stop-services', true, 'No service of the mission runs.'],
    ['remove-worktrees', true, 'The mission’s worktrees are gone.'],
    ['remove-workspace', true, 'The mission’s Workspace is gone.'],
  ] as const)('%s: safe to run again %s, done when %s', (kind, safeToRunAgain, postCondition) => {
    expect(ACTION_RETRIES[kind]).toEqual({ safeToRunAgain, postCondition })
  })
})

describe('Presets are starting stacks', () => {
  test('presets give the expected stacks', () => {
    const rules = defaultDeliveryRules()
    const stacks = (preset: 'library' | 'application' | 'local') =>
      DELIVERY_MOMENTS.map((moment) => kinds(rules[moment].presets[preset]))
    expect(stacks('library')).toEqual([
      [],
      ['commit-by-hemera', 'push', 'pull-request'],
      ['bump', 'merge', 'ci', 'published-version'],
    ])
    expect(stacks('application')).toEqual([
      [],
      ['commit-by-hemera', 'push', 'pull-request'],
      ['bump', 'merge', 'ci'],
    ])
    expect(stacks('local')).toEqual([[], [], ['commit-by-hemera', 'merge']])
  })

  test('a repository keeps only what it changes of its preset, in each moment', () => {
    const rules = withActions(
      preparedWith(rulesWith([waves('web', 'application')]), 'web', {
        steps: { off: ['commit'], changed: [], added: [] },
      }),
      'tasks',
      [],
    )
    const mine = {
      ...rules,
      tasks: {
        ...rules.tasks,
        repositories: [
          {
            repositoryId: 'web',
            steps: {
              off: [],
              changed: [],
              added: [{ after: null, step: sample('commit-by-agent', 'agent-commit') }],
            },
          },
        ],
      },
    }
    const web = effectiveOf(mine, only(repository('web')), 'web')
    expect(kinds(web.stacks.tasks)).toEqual(['commit-by-agent'])
    expect(kinds(web.stacks.preparation)).toEqual(['push', 'pull-request'])
    expect(web.changes).toBe(2)
    expect(validateRules(mine, only(repository('web')))).toEqual([])
  })
})

/** The rules as #340 stored them, before the moments held any action: `commitRule` beside them. */
const V1_RULES = {
  version: 3,
  savedAt: '2026-10-14T10:00:00.000Z',
  commitRule: 'at-push',
  preparation: {
    reviewDrafts: false,
    pushSteps: [
      { id: 'push', kind: 'push', mode: 'click', placement: 'review' },
      { id: 'pull-request', kind: 'pull-request', mode: 'click', placement: 'review' },
    ],
    repositories: [],
  },
  waves: {
    presets: {
      library: [
        { id: 'bump', kind: 'bump', mode: 'auto', how: { by: 'agent' } },
        { id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' },
        { id: 'ci', kind: 'ci', mode: 'auto' },
        {
          id: 'published-version',
          kind: 'published-version',
          mode: 'auto',
          detect: { by: 'registry', packageName: null },
        },
      ],
      application: [
        { id: 'bump', kind: 'bump', mode: 'auto', how: { by: 'agent' } },
        { id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' },
        { id: 'ci', kind: 'ci', mode: 'auto' },
      ],
      local: [{ id: 'merge', kind: 'merge', mode: 'auto', method: 'local' }],
    },
    repositories: [],
  },
  end: {
    closing: 'merge-spec',
    cleanup: [
      { id: 'pull-main-checkout', kind: 'pull-main-checkout', mode: 'auto' },
      { id: 'stop-services', kind: 'stop-services', mode: 'auto' },
      { id: 'remove-worktrees', kind: 'remove-worktrees', mode: 'auto' },
      { id: 'remove-workspace', kind: 'remove-workspace', mode: 'auto' },
    ],
  },
}

/** A copy of the preparation as #340 stored it: its push steps placed, no commit before them. */
const V1_PREPARATION_COPY = {
  section: 'preparation',
  version: 1,
  copiedAt: '2026-10-14T10:00:00.000Z',
  reviewDrafts: false,
  repositories: [
    {
      repositoryId: 'api',
      name: 'api',
      commitTemplate: '{key}: {title}',
      pullRequestTitle: '{key}: {title}',
      pullRequestBody: '{summary}',
      reviewers: [],
      requireApproval: false,
      pushSteps: [{ id: 'push', kind: 'push', mode: 'click', placement: 'review' }],
    },
  ],
}

describe('A stored document of another shape is refused, never guessed', () => {
  // #340's shape was never released: no profile holds it, so nothing upgrades it.
  test('rules and a copy of the shape before committing was an action are refused, not misread', () => {
    expect(Result.isFailure(decodeDeliveryRules(JSON.stringify(V1_RULES)))).toBe(true)
    expect(Result.isFailure(decodeSectionCopy(JSON.stringify(V1_PREPARATION_COPY)))).toBe(true)
  })
})

describe('After each task is copied when the first task is done', () => {
  test('the copy of After each task holds each repository’s stack and its commit template', () => {
    const rules = withActions({ ...ACME_CHAIN }, 'tasks', [
      sample('commit-by-hemera', 'commit-task'),
    ])
    const copy = sectionOf(
      { ...rules, version: 2, savedAt: null },
      ACME,
      'tasks',
      '2026-10-14T10:00:00.000Z',
    )
    if (copy.section !== 'tasks') throw new Error('section')
    expect(
      copy.repositories.map((one) => [one.repositoryId, one.commitTemplate, kinds(one.steps)]),
    ).toEqual([
      ['shared', '{key}: {title}', []],
      ['api', '{key}: {title}', ['commit-by-hemera']],
      ['web', '{key}: {title}', []],
    ])
  })
})

/** Rules drawn at random, put on Acme's repositories and on a few step ids, so overrides meet. */
function onAcme(rules: DeliveryRules): DeliveryRules {
  const ids = ACME.repositories.map((one) => one.id)
  const STEP_IDS = ['commit', 'merge', 'ci', 'bump', 'push', 'pull-request', 'a', 'b']
  const pick = (text: string, from: ReadonlyArray<string>) => from[text.length % from.length] ?? ''
  const repo = (id: string) => pick(id, ids)
  const step = <S extends { readonly id: string }>(one: S): S => ({
    ...one,
    id: pick(one.id, STEP_IDS),
  })
  const overrides = <S extends { readonly id: string }>(one: Overrides<S>): Overrides<S> => ({
    off: one.off.map((id) => pick(id, STEP_IDS)),
    changed: one.changed.map(step),
    added: one.added.map((added) => ({
      after: added.after === null ? null : pick(added.after, STEP_IDS),
      step: step(added.step),
    })),
  })
  return {
    ...rules,
    tasks: {
      ...rules.tasks,
      repositories: rules.tasks.repositories.map((one) => ({
        ...one,
        repositoryId: repo(one.repositoryId),
        steps: overrides(one.steps),
      })),
    },
    preparation: {
      ...rules.preparation,
      repositories: rules.preparation.repositories.map((one) => ({
        ...one,
        repositoryId: repo(one.repositoryId),
        steps: overrides(one.steps),
      })),
    },
    waves: {
      ...rules.waves,
      repositories: rules.waves.repositories.map((one) => ({
        ...one,
        repositoryId: repo(one.repositoryId),
        deliversAfter: one.deliversAfter.map(repo),
        steps: overrides(one.steps),
      })),
    },
  }
}
