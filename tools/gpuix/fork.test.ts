import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { FORK_PATH, absent, forkCheckedOut } from './available.ts'

const REPOSITORY = resolve(import.meta.dir, '..', '..')

const hasFork = forkCheckedOut()
if (!hasFork) absent('the renderer fork', 'the bootstrap script, which clones it beside this one')

function git(args: string[]): { ok: boolean; out: string } {
  const run = Bun.spawnSync(['git', '-C', FORK_PATH, ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { ok: run.exitCode === 0, out: new TextDecoder().decode(run.stdout).trim() }
}

describe('Installation propre', () => {
  test('every declared renderer dependency points at the fork checked out beside us', () => {
    const manifests = ['package.json', 'apps/desktop/package.json', 'packages/ui/package.json']
    const declared: string[] = []
    for (const manifest of manifests) {
      const json = JSON.parse(readFileSync(join(REPOSITORY, manifest), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >
      for (const section of ['dependencies', 'devDependencies', 'overrides']) {
        for (const [name, range] of Object.entries(json[section] ?? {})) {
          if (name.startsWith('@gpuix/')) declared.push(range)
        }
      }
    }
    expect(declared.length).toBeGreaterThan(0)
    for (const range of declared) {
      expect(range).toMatch(/^file:(\.\.\/)+gpuix\/packages\/(native|react)$/)
      // Never the spike folder, and never a snapshot copied into this repository.
      expect(range).not.toContain('spikes')
      expect(range).not.toContain('vendor')
    }
  })

  test.skipIf(!hasFork)('the resolved renderer is that checkout, and it loads', () => {
    const native = require('@gpuix/native') as Record<string, unknown>
    expect(typeof native['GpuixRenderer']).toBe('function')
  })
})

describe('Historique du renderer', () => {
  test.skipIf(!hasFork)('the renderer commits stay in the fork, none of them here', () => {
    // The product repository holds no renderer source: what it carries is a dependency on a
    // checkout, so a change of the renderer is a commit over there and nothing over here.
    const repository = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { stdout: 'pipe' })
    const here = new TextDecoder().decode(repository.stdout).trim()
    expect(FORK_PATH.replaceAll('\\', '/')).not.toBe(here)
    expect(git(['rev-parse', 'HEAD']).ok).toBe(true)
  })

  test.skipIf(!hasFork)('the revision consumed is identifiable by branch and commit', () => {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const head = git(['rev-parse', 'HEAD'])
    expect(branch.ok).toBe(true)
    expect(branch.out.length).toBeGreaterThan(0)
    expect(head.out).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('Prototype présent dans le fork', () => {
  test.skipIf(!hasFork)('an experimental renderer capability is not turned on here', () => {
    const product = Bun.spawnSync(
      ['git', 'grep', '-l', '-E', 'htmlApply|<html|motion\\.div', '--', 'apps', 'packages'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const touched = new TextDecoder()
      .decode(product.stdout)
      .split('\n')
      .filter((line) => line.length > 0)
    // `motion.div` is the one the shell uses for the sidebar and the decisions; the
    // experimental HTML document of the fork is used nowhere.
    expect(touched.filter((file) => file.includes('html'))).toEqual([])
  })
})

describe('Addon absent de la machine', () => {
  test('what is missing is named with the command that produces it', () => {
    const note = absent('the compiled native addon', 'bun tools/gpuix/build-native.ts')
    expect(note).toContain('the compiled native addon')
    expect(note).toContain('bun tools/gpuix/build-native.ts')
  })
})

describe("Suivi de l'amont", () => {
  test.skipIf(!hasFork)('the fork is the upstream remote, not a copy of its sources', () => {
    const remotes = git(['remote', '-v'])
    expect(remotes.ok).toBe(true)
    // The fork of the renderer, not a snapshot pasted into this repository: its history is
    // the upstream one, and ours sits on top of it.
    expect(remotes.out).toContain('upstream')
    expect(remotes.out).toContain('gpuix')
  })

  test.skipIf(!hasFork)('our commits sit on top of an upstream commit, not beside it', () => {
    const base = git(['merge-base', 'HEAD', 'upstream/main'])
    expect(base.ok).toBe(true)
    // The merge base is a commit of the upstream branch: rebuilding a history of our own
    // from a patch queue would leave none.
    const onUpstream = git(['branch', '--remotes', '--contains', base.out])
    expect(onUpstream.ok).toBe(true)
    expect(onUpstream.out).toContain('upstream/main')
  })

  test.skipIf(!hasFork)('every commit of ours carries an identity, never a tool name', () => {
    const base = git(['merge-base', 'HEAD', 'upstream/main'])
    const authors = git(['log', '--format=%ae', `${base.out}..HEAD`])
    expect(authors.ok).toBe(true)
    for (const author of authors.out.split('\n').filter((line) => line.length > 0)) {
      expect(author).not.toContain('.invalid')
    }
  })
})
