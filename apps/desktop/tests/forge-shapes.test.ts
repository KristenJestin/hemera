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

  test('a bkt context, workspace or project is one plain word, never empty nor a flag', () => {
    const place = (context: string, flag: string, value: string) => [
      ...BKT_CREATE,
      '--context',
      context,
      flag,
      value,
      '--repo',
      'shop',
    ]
    expect(shapeOf('bkt', place('oss', '--project', '~someone'))?.operation).toBe('pr.create')
    for (const bad of ['', '-x', '--workspace', 'a b', '$(sh)', 'a|b', 'a\nb']) {
      expect(shapeOf('bkt', place(bad, '--workspace', 'acme-team')), `context ${bad}`).toBeNull()
      expect(shapeOf('bkt', place('oss', '--workspace', bad)), `workspace ${bad}`).toBeNull()
      expect(shapeOf('bkt', place('oss', '--project', bad)), `project ${bad}`).toBeNull()
    }
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

describe('Every name a write carries is one its forge can hold', () => {
  const BKT_CREATE = ['pr', 'create', '--source', 'feat/x', '--target', 'main', '--title', 'X']
  const bktCreate = (context: string, workspace: string, repo: string) => [
    ...BKT_CREATE,
    '--context',
    context,
    '--workspace',
    workspace,
    '--repo',
    repo,
  ]

  test('a bkt repository is one name, never a path, a query or a flag', () => {
    expect(shapeOf('bkt', bktCreate('oss', 'acme-team', 'shop.js'))?.operation).toBe('pr.create')
    for (const bad of ['sh?op', 'sh#op', 'sh%3Fop', '..', '.', 'a b', 'a/b', '-x', '']) {
      expect(shapeOf('bkt', bktCreate('oss', 'acme-team', bad)), `repo ${bad}`).toBeNull()
    }
    expect(
      shapeOf('bkt', [
        'pipeline',
        'run',
        '--context',
        'oss',
        '--workspace',
        'acme-team',
        '--repo',
        '..',
        '--ref',
        'main',
      ]),
    ).toBeNull()
  })

  test('a bkt context, workspace or project is never . nor ..', () => {
    for (const bad of ['.', '..']) {
      expect(shapeOf('bkt', bktCreate(bad, 'acme-team', 'shop')), `context ${bad}`).toBeNull()
      expect(shapeOf('bkt', bktCreate('oss', bad, 'shop')), `workspace ${bad}`).toBeNull()
    }
  })

  test('a gh repository never walks out of its owner', () => {
    for (const bad of ['github.com/../shop', 'github.com/acme/..', 'github.com/./shop']) {
      expect(shapeOf('gh', ['pr', 'merge', '7', '--repo', bad, '--squash']), bad).toBeNull()
    }
  })
})

describe('The host a gh command aims at is read from its parsed flags', () => {
  test('a title that reads --hostname does not move the host', () => {
    const create = [
      'pr',
      'create',
      '--repo',
      'github.com/acme/shop',
      '--title',
      '--hostname',
      '--base',
      'main',
      '--head',
      'feat/x',
      '--body-file',
      '-',
    ]
    expect(shapeOf('gh', create)?.operation).toBe('pr.create')
    expect(aimsAt('gh', create, 'github.com')).toBe(true)
    expect(aimsAt('gh', create, 'git.acme.test')).toBe(false)
  })

  test('a command that matches no shape aims at no host', () => {
    expect(aimsAt('gh', ['pr', 'merge', '7', '--squash'], 'github.com')).toBe(false)
  })
})

describe('What a shape refuses stays refused', () => {
  const BKT_MERGE = ['pr', 'merge', '7', '--workspace', 'acme-team', '--repo', 'shop']
  const CLOSE = '--close-source=false'

  test('a repeated --context is refused: bkt would keep the last one', () => {
    expect(shapeOf('bkt', [...BKT_MERGE, '--context', 'oss', CLOSE])?.operation).toBe('pr.merge')
    expect(
      shapeOf('bkt', [...BKT_MERGE, '--context', 'oss', '--context', 'work', CLOSE]),
    ).toBeNull()
  })

  test('a word or a flag in another case is refused', () => {
    expect(shapeOf('gh', ['PR', 'merge', '7', '--repo', 'github.com/acme/shop'])).toBeNull()
    expect(shapeOf('gh', ['pr', 'merge', '7', '--Repo', 'github.com/acme/shop'])).toBeNull()
    expect(
      shapeOf('bkt', ['pr', 'MERGE', '7', '--context', 'oss', ...BKT_MERGE.slice(3), CLOSE]),
    ).toBeNull()
  })

  test('a gh --repo value starting with - is refused', () => {
    for (const bad of ['-R', '--hostname', '-github.com/acme/shop']) {
      expect(shapeOf('gh', ['pr', 'merge', '7', '--repo', bad, '--squash']), bad).toBeNull()
    }
  })
})
