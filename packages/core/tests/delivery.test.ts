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
  type Overrides,
  type RepositoryWaves,
  WaveStep,
  applyOverrides,
  approvalsRequired,
  changesOf,
  decodeDeliveryRules,
  defaultDeliveryRules,
  effectiveRepositories,
  inOrder,
  partsOf,
  preparationDifferences,
  proposeDependencies,
  renderTemplate,
  sectionOf,
  validateRules,
  withDependencies,
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
        pushSteps: { off: [], changed: [], added: [] },
        ...over,
      },
    ],
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
    expect(effective.pushSteps).toEqual([])
    expect(effective.steps).toEqual([{ id: 'merge', kind: 'merge', mode: 'auto', method: 'local' }])
  })

  test('a repository given no rules takes Local without a forge and Application with one', () => {
    const project = only(repository('notes', 'none'), repository('api'))
    const rules = defaultDeliveryRules()
    expect(sentences(rules, project)).toEqual([])
    expect(effectiveOf(rules, project, 'notes').preset).toBe('local')
    expect(effectiveOf(rules, project, 'api').preset).toBe('application')
  })

  test('Library and Application push and open the pull request in Review, on a click', () => {
    const shared = effectiveOf(ACME_CHAIN, ACME, 'shared')
    expect(shared.pushSteps).toEqual([
      { id: 'push', kind: 'push', mode: 'click', placement: 'review' },
      { id: 'pull-request', kind: 'pull-request', mode: 'click', placement: 'review' },
    ])
    // shared depends on nothing: the preset's bump is not there.
    expect(kinds(shared.steps)).toEqual(['merge', 'ci', 'published-version'])
    expect(kinds(effectiveOf(ACME_CHAIN, ACME, 'api').steps)).toEqual([
      'bump',
      'merge',
      'ci',
      'published-version',
    ])
    expect(kinds(effectiveOf(ACME_CHAIN, ACME, 'web').steps)).toEqual(['bump', 'merge', 'ci'])
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

  test('the default templates and who commits', () => {
    const rules = defaultDeliveryRules()
    expect(rules.commitRule).toBe('at-push')
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
    expect(effectiveOf(rules, project, 'shared').steps).toEqual([
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
    const base: WaveStep[] = [
      { id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' },
      { id: 'ci', kind: 'ci', mode: 'auto' },
      { id: 'tag', kind: 'confirm', mode: 'click', what: 'the tag is pushed' },
    ]
    const overrides: Overrides<WaveStep> = {
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
    const steps = Arbitrary.array(Arbitrary.schema(WaveStep), {
      maxLength: 8,
    })
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(steps, (drawn) => {
        const base = drawn.map((step, index) => ({ ...step, id: `s${String(index)}` }))
        if (base.length === 0) return true
        const target = base[Math.floor(base.length / 2)]
        if (target === undefined) return true
        const changed: WaveStep = { id: target.id, kind: 'ci', mode: 'click' }
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
      pushSteps: { off: ['pull-request'], changed: [], added: [] },
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
      pushSteps: {
        off: [],
        changed: [{ id: 'push', kind: 'push', mode: 'click', placement: 'waves' }],
        added: [],
      },
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
    const rules = preparedWith(ACME_CHAIN, 'api', {
      requireApproval: true,
      pushSteps: {
        off: [],
        changed: [
          { id: 'push', kind: 'push', mode: 'click', placement: 'waves' },
          { id: 'pull-request', kind: 'pull-request', mode: 'click', placement: 'waves' },
        ],
        added: [],
      },
    })
    expect(validateRules(rules, ACME)).toEqual([
      {
        code: 'approval-after-ship',
        repositoryId: 'api',
        stepId: 'pull-request',
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
          ...base.end.cleanup,
          { id: 'prune', kind: 'command', mode: 'auto', commandId: 'lost' },
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
      { commitTemplate: '{ticket}', pushSteps: { off: ['pull-request'], changed: [], added: [] } },
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
