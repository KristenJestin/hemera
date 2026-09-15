/**
 * Shared harness of the component tests.
 *
 * It mounts a component on the real GPU test renderer, inside the theme provider and a single
 * root box, and finds painted elements by their test id. It lives outside `src` so nothing
 * of it can reach the bundle.
 */

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { createTestRoot } from '@gpuix/react/testing'
import type { TestRoot } from '@gpuix/react/testing'

import { Stack } from './src/primitives/stack.tsx'
import { ThemeProvider } from './src/theme/provider.tsx'
import type { ThemeName } from './src/tokens/semantic.ts'

export interface TreeNode {
  id: number
  type: string
  style?: Record<string, unknown>
  text?: string | null
  testId?: string
  children?: TreeNode[]
}

function themed(children: ReactNode, theme: ThemeName) {
  return (
    <ThemeProvider name={theme} onThemeChange={() => {}}>
      <Stack direction="column" gap="md" align="start">
        {children}
      </Stack>
    </ThemeProvider>
  )
}

/** Mounts a component of the catalogue and paints one frame. */
export function mountedCatalogue(children: ReactNode, theme: ThemeName = 'dark'): TestRoot {
  const root = createTestRoot({ width: 1280, height: 800 })
  root.render(themed(children, theme))
  root.renderer.flush()
  return root
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

/** The painted element carrying `testId`. */
export function nodeOf(root: TestRoot, testId: string): TreeNode {
  const found = find(root.renderer.toJSON() as TreeNode, testId)
  if (found === null) throw new Error(`no element with testId ${testId}`)
  return found
}

/**
 * Gives the focus to an element and waits for the design system to observe it.
 *
 * The renderer delivers no usable focus event, so the focus state is sampled; a test has to
 * let one sample land before reading the painted focus ring.
 */
export async function focus(root: TestRoot, testId: string): Promise<TreeNode> {
  const target = nodeOf(root, testId)
  root.renderer.focusElement(target.id)
  await new Promise((resolve) => setTimeout(resolve, FOCUS_SAMPLE_WAIT_MS))
  root.renderer.flush()
  return nodeOf(root, testId)
}

/** Long enough for one focus sample of the design system to land. */
const FOCUS_SAMPLE_WAIT_MS = 150

/** Every painted text run under `node`, in paint order. */
export function textsOf(node: TreeNode): string[] {
  const texts: string[] = []
  if (node.type === 'text' && typeof node.text === 'string') texts.push(node.text)
  for (const child of node.children ?? []) texts.push(...textsOf(child))
  return texts
}

interface BoundaryProps {
  onError: (error: Error) => void
  children: ReactNode
}

class CaptureError extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error)
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/** The message of the error rendering `children` raised, or null when it rendered. */
export function renderError(children: ReactNode): string | null {
  const root = createTestRoot({ width: 1280, height: 800 })
  let captured: Error | null = null
  try {
    root.render(
      <CaptureError onError={(error) => (captured = error)}>
        {themed(children, 'dark')}
      </CaptureError>,
    )
    root.renderer.flush()
  } finally {
    root.unmount()
  }
  return captured === null ? null : (captured as Error).message
}
