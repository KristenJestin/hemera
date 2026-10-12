/**
 * The write shapes of the forge runner are closed (#253, round 2): each CT-50 write is registered
 * with its exact flags, and anything else, a flag that writes more (`--delete-branch`, `--admin`),
 * a body read from a local file, a flag written `--name=value`, is refused.
 */

import { describe, expect, test } from 'vite-plus/test'

import { COMMAND_SHAPES, shapeOf } from '../src/engine/forges/shapes.ts'

/** One allowed command per CT-50 write the runner runs, as its operation names it. */
const ALLOWED: ReadonlyArray<readonly ['gh' | 'bkt', string, ReadonlyArray<string>]> = [
  [
    'gh',
    'pr.create',
    [
      'pr',
      'create',
      '--repo',
      'acme/shop',
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
    ['pr', 'edit', '7', '--repo', 'acme/shop', '--title', 'Export', '--body-file', '-'],
  ],
  ['gh', 'pr.attach', ['pr', 'edit', '7', '--repo', 'acme/shop', '--attach', 'shot.png#The list']],
  ['gh', 'pr.merge', ['pr', 'merge', '7', '--repo', 'acme/shop', '--squash']],
  [
    'gh',
    'workflow.run',
    ['workflow', 'run', 'release.yml', '--repo', 'acme/shop', '--ref', 'main'],
  ],
  ['gh', 'run.rerun', ['run', 'rerun', '123', '--repo', 'acme/shop']],
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
  ['bkt', 'pr.edit', ['pr', 'edit', '7', '--repo', 'shop', '--title', 'Export']],
  ['bkt', 'pr.merge', ['pr', 'merge', '7', '--repo', 'shop', '--close-source=false']],
  ['bkt', 'pipeline.run', ['pipeline', 'run', '--repo', 'shop', '--ref', 'main']],
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
      shapeOf('gh', ['pr', 'edit', '7', '--repo', 'acme/shop', '--body-file', 'notes.md']),
    ).toBeNull()
  })

  test('a merge keeps the source branch on Bitbucket: --close-source=false is required', () => {
    expect(shapeOf('bkt', ['pr', 'merge', '7', '--repo', 'shop'])).toBeNull()
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
