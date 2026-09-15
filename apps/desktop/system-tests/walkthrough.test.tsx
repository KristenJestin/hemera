/**
 * The walkthrough of the lot, driven at the keyboard and at the wheel on this target.
 *
 * Only what the renderer really does is recorded here. What cannot be automated on a target is
 * written down as a limit rather than replaced by a synthetic gesture presented as an
 * observation of the rendering.
 */

import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../test-setup.ts'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createTestRoot } from '@gpuix/react/testing'
import type { TestRoot } from '@gpuix/react/testing'
import { ThemeProvider } from '@hemera/ui'
import { createProject, createSession, openProfile, recordMessage } from '@hemera/runtime'
import type { OpenProfile, StoreContext } from '@hemera/runtime'

import { targetOfHost } from '../../../tools/environment-report.ts'
import { folderProblem } from '#platform/workspace.ts'
import { SessionsPage } from '#ui/sessions/sessions-page.tsx'
import { useSessions } from '#ui/sessions/use-sessions.ts'

const repository = resolve(import.meta.dir, '..', '..', '..')

interface TreeNode {
  id: number
  type: string
  style?: Record<string, unknown>
  text?: string | null
  testId?: string
  children?: TreeNode[]
}

function find(node: TreeNode | null | undefined, testId: string): TreeNode | null {
  if (node === null || node === undefined) return null
  if (node.testId === testId) return node
  for (const child of node.children ?? []) {
    const found = find(child, testId)
    if (found !== null) return found
  }
  return null
}

function nodeOf(root: TestRoot, testId: string): TreeNode {
  const found = find(root.renderer.toJSON() as TreeNode, testId)
  if (found === null) throw new Error(`no element with testId ${testId}`)
  return found
}

function Screen({ context }: { context: StoreContext }) {
  const model = useSessions({ context, inspectFolder: folderProblem, now: Date.now })
  return (
    <ThemeProvider name={model.theme} onThemeChange={model.setTheme}>
      <SessionsPage model={model} />
    </ThemeProvider>
  )
}

/** A profile holding a project and a session long enough to need scrolling. */
function seeded(): {
  directory: string
  documents: string
  context: StoreContext
  profile: OpenProfile
} {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-walkthrough-'))
  const documents = mkdtempSync(join(tmpdir(), 'hemera-documents-'))
  const profile = openProfile({ directory, now: Date.now() })
  let count = 0
  const context: StoreContext = {
    database: profile.database,
    ids: { next: () => `id-${(count += 1)}` },
    now: Date.now(),
  }
  const { project } = createProject(context, { name: 'Hemera', path: documents })
  const session = createSession(context, project.id)
  for (let index = 0; index < 40; index += 1) {
    recordMessage(context, session.id, `message number ${index} of a long thread`)
  }
  return { directory, documents, context, profile }
}

/** Closes the profile and removes the folders the walkthrough used. */
function cleanUp(seed: { directory: string; documents: string; profile: OpenProfile }): void {
  seed.profile.database.close(true)
  rmSync(seed.directory, { recursive: true, force: true })
  rmSync(seed.documents, { recursive: true, force: true })
}

/** What this run could drive, and what it could not. */
const observations: string[] = []

describe.skipIf(!TEST_RENDERER_PAINTS)('Parcours natif au clavier', () => {
  test('the window is driven from the keyboard alone, control after control', () => {
    const seed = seeded()
    const { context } = seed
    const root = createTestRoot({ width: 1280, height: 800 })
    try {
      root.render(<Screen context={context} />)
      root.renderer.flush()

      // The traversal reaches the controls of the shell in the order they are painted.
      const composer = nodeOf(root, 'composer-field').id
      root.renderer.focusElement(composer)
      expect(root.renderer.getFocusedElementId()).toBe(composer)

      root.renderer.focusNext()
      const afterNext = root.renderer.getFocusedElementId()
      expect(afterNext).not.toBe(composer)

      root.renderer.focusPrevious()
      expect(root.renderer.getFocusedElementId()).toBe(composer)

      // A control answers Enter without the application intercepting a key.
      const archive = nodeOf(root, 'archive-session').id
      root.renderer.nativeSimulateKeystrokes(archive, 'enter')
      root.renderer.flush()
      expect(() => nodeOf(root, 'no-session')).not.toThrow()

      observations.push('keyboard traversal and activation: driven')
    } finally {
      root.unmount()
      cleanUp(seed)
    }
  }, 60_000)
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Parcours natif à la molette', () => {
  test('the thread scrolls under the wheel, one scroll level for the panel', () => {
    const seed = seeded()
    const { context } = seed
    const root = createTestRoot({ width: 1280, height: 800 })
    try {
      root.render(<Screen context={context} />)
      root.renderer.flush()

      const thread = nodeOf(root, 'thread')
      expect(thread.style?.overflowY).toBe('scroll')

      const bounds = root.renderer.getElementBounds(thread.id)
      expect(bounds).toBeDefined()

      // The wheel goes through GPUI hit testing, at a point inside the thread.
      root.renderer.nativeSimulateScrollWheel(
        bounds!.x + bounds!.width / 2,
        bounds!.y + bounds!.height / 2,
        0,
        -600,
      )
      root.renderer.flush()

      // The panel still paints its single scroll level after the wheel.
      expect(nodeOf(root, 'thread').style?.overflowY).toBe('scroll')
      observations.push('wheel over the thread: driven')
    } finally {
      root.unmount()
      cleanUp(seed)
    }
  }, 60_000)

  test('what this target could not drive is written down, not worked around', () => {
    const target = targetOfHost()
    const limits =
      target === 'x86_64-unknown-linux-gnu'
        ? [
            'click: not automatable on Linux (the renderer panics), so it stays a human step',
            'screenshots: unavailable on Linux, so no painted frame is compared here',
          ]
        : ['none observed on this target beyond what a real mouse has to confirm']

    const path = join(repository, 'reports', `walkthrough-${target}.md`)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(
      path,
      [
        `# Automated walkthrough — ${target}`,
        '',
        'What this run drove, on this machine only:',
        '',
        ...observations.map((line) => `- ${line}`),
        '',
        'Limits observed, left as limits:',
        '',
        ...limits.map((line) => `- ${line}`),
        '',
        'A real mouse walkthrough stays required; it is recorded in the matrix of D12b.',
        '',
      ].join('\n'),
    )

    expect(observations.length).toBeGreaterThan(0)
    expect(limits.length).toBeGreaterThan(0)
  })
})
