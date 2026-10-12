/**
 * The write shapes of the forge runner are closed (#253, round 2): each CT-50 write is registered
 * with its exact flags, and anything else, a flag that writes more (`--delete-branch`, `--admin`),
 * a body read from a local file, a flag written `--name=value`, is refused.
 */

import { describe, expect, test } from 'vite-plus/test'

import { COMMAND_SHAPES, aimsAt, shapeOf } from '../src/engine/forges/shapes.ts'

/** One allowed command per CT-50 write the runner runs, as its operation names it. */
const ALLOWED: ReadonlyArray<readonly ['gh' | 'bkt', string, ReadonlyArray<string>]> = [
  [
    'gh',
    'pr.create',
    [
      'pr',
      'create',
      '--repo',
      'github.com/acme/shop',
      '--base',
      'main',
      '--head',
      'feat/export',
      '--title',
      'Export notes',
      '--body-file',
      '-',
    ],
  ],
  [
    'gh',
    'pr.edit',
    ['pr', 'edit', '7', '--repo', 'github.com/acme/shop', '--title', 'Export', '--body-file', '-'],
  ],
  [
    'gh',
    'pr.attach',
    ['pr', 'edit', '7', '--repo', 'github.com/acme/shop', '--attach', 'shot.png#The list'],
  ],
  ['gh', 'pr.merge', ['pr', 'merge', '7', '--repo', 'github.com/acme/shop', '--squash']],
  [
    'gh',
    'workflow.run',
    ['workflow', 'run', 'release.yml', '--repo', 'github.com/acme/shop', '--ref', 'main'],
  ],
  ['gh', 'run.rerun', ['run', 'rerun', '123', '--repo', 'github.com/acme/shop']],
  [
    'gh',
    'deployment.approve',
    [
      'api',
      '--hostname',
      'github.com',
      '--method',
      'POST',
      'repos/acme/shop.js/actions/runs/123/pending_deployments',
      '--input',
      '-',
    ],
  ],
  [
    'bkt',
    'pr.create',
    [
      'pr',
      'create',
      '--context',
      'oss',
      '--workspace',
      'acme-team',
      '--repo',
      'shop',
      '--source',
      'feat/export',
      '--target',
      'main',
      '--title',
      'Export notes',
      '--description',
      'Why',
    ],
  ],
  [
    'bkt',
    'pr.edit',
    ['pr', 'edit', '7', '--context', 'work', '--project', 'PROJ', '--repo', 'shop', '--title', 'X'],
  ],
  [
    'bkt',
    'pr.merge',
    [
      'pr',
      'merge',
      '7',
      '--context',
      'oss',
      '--workspace',
      'acme-team',
      '--repo',
      'shop',
      '--close-source=false',
    ],
  ],
  [
    'bkt',
    'pipeline.run',
    [
      'pipeline',
      'run',
      '--context',
      'oss',
      '--workspace',
      'acme-team',
      '--repo',
      'shop',
      '--ref',
      'main',
    ],
  ],
]

describe('Every write shape is closed', () => {
  test.each(ALLOWED)('%s %s: its exact form is allowed', (cli, operation, args) => {
    const shape = shapeOf(cli, args)
    expect(shape?.operation).toBe(operation)
    expect(shape?.class).toBe('network-write')
  })

  test.each(ALLOWED)('%s %s: nothing may be added to it', (cli, _operation, args) => {
    for (const extra of [
      ['--delete-branch'],
      ['--admin'],
      ['--auto'],
      ['--body-file', '/home/someone/notes.md'],
      ['--repo=other/x'],
      ['--', 'more'],
      ['positional'],
    ]) {
      expect(shapeOf(cli, [...args, ...extra]), extra.join(' ')).toBeNull()
    }
  })

  test('no shape lets an unknown flag follow its words', () => {
    for (const shape of COMMAND_SHAPES.filter((one) => one.cli !== 'git')) {
      expect(shapeOf(shape.cli === 'gh' ? 'gh' : 'bkt', [...shape.words, '--unknown'])).toBeNull()
    }
  })

  test('a body is read from the standard input only, never from a local file', () => {
    expect(
      shapeOf('gh', [
        'pr',
        'edit',
        '7',
        '--repo',
        'github.com/acme/shop',
        '--body-file',
        'notes.md',
      ]),
    ).toBeNull()
  })

  test('a merge keeps the source branch on Bitbucket: --close-source=false is required', () => {
    expect(
      shapeOf('bkt', [
        'pr',
        'merge',
        '7',
        '--context',
        'oss',
        '--workspace',
        'acme-team',
        '--repo',
        'shop',
      ]),
    ).toBeNull()
  })

  test('a required flag is required', () => {
    expect(shapeOf('gh', ['pr', 'merge', '7', '--squash'])).toBeNull()
  })

  test('the approval path names one run, never a path walking out of the repository', () => {
    const approve = (path: string) =>
      shapeOf('gh', ['api', '--hostname', 'github.com', '--method', 'POST', path, '--input', '-'])
    expect(approve('repos/acme/../actions/runs/1/pending_deployments')).toBeNull()
    expect(approve('repos/../shop/actions/runs/1/pending_deployments')).toBeNull()
    expect(approve('repos/acme/shop/actions/runs/1/pending_deployments/x')).toBeNull()
    expect(approve('repos/acme/shop/actions/runs/1/pending_deployments')?.operation).toBe(
      'deployment.approve',
    )
  })
})

describe('A write names its forge: the bkt context, the gh host', () => {
  const BKT_CREATE = ['pr', 'create', '--source', 'feat/x', '--target', 'main', '--title', 'X']

  test('a bkt write without --context is refused: bkt would send it to its active context', () => {
    expect(shapeOf('bkt', [...BKT_CREATE, '--workspace', 'acme-team', '--repo', 'shop'])).toBeNull()
    expect(
      shapeOf('bkt', [
        'pipeline',
        'run',
        '--workspace',
        'acme-team',
        '--repo',
        'shop',
        '--ref',
        'main',
      ]),
    ).toBeNull()
  })

  test('a bkt write names its workspace or its project, one of the two', () => {
    const place = ['--context', 'oss', '--repo', 'shop']
    expect(shapeOf('bkt', [...BKT_CREATE, ...place])).toBeNull()
    expect(
      shapeOf('bkt', [...BKT_CREATE, ...place, '--workspace', 'acme-team', '--project', 'PROJ']),
    ).toBeNull()
    expect(shapeOf('bkt', [...BKT_CREATE, ...place, '--project', 'PROJ'])?.operation).toBe(
      'pr.create',
    )
    expect(
      shapeOf('bkt', ['pipeline', 'run', '--context', 'oss', '--repo', 'shop', '--ref', 'main']),
    ).toBeNull()
  })

  test('a gh write names its repository with its host: never a bare owner/repo', () => {
    expect(shapeOf('gh', ['pr', 'merge', '7', '--repo', 'acme/shop', '--squash'])).toBeNull()
    expect(
      shapeOf('gh', ['run', 'rerun', '1', '--repo', 'git.acme.test:8443/acme/shop'])?.operation,
    ).toBe('run.rerun')
  })

  test('a gh command aims at its target host only: an Enterprise repository never goes to github.com', () => {
    const merge = (repo: string) => ['pr', 'merge', '7', '--repo', repo, '--squash']
    expect(aimsAt('gh', merge('git.acme.test/acme/shop'), 'git.acme.test')).toBe(true)
    expect(aimsAt('gh', merge('github.com/acme/shop'), 'git.acme.test')).toBe(false)
    expect(aimsAt('gh', merge('git.acme.test/acme/shop'), 'github.com')).toBe(false)
    expect(aimsAt('gh', ['auth', 'status', '--hostname', 'github.com'], 'git.acme.test')).toBe(
      false,
    )
    expect(aimsAt('gh', ['auth', 'status', '--hostname', 'GitHub.com'], 'github.com')).toBe(true)
    expect(aimsAt('gh', ['--version'], 'git.acme.test')).toBe(true)
  })
})
