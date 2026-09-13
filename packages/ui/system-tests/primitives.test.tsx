import { describe, expect, test } from 'bun:test'
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { createTestRoot } from '@gpuix/react/testing'
import type { TestRoot } from '@gpuix/react/testing'

import { Anchored, Pressable, Scroll, Stack, Text, ThemeProvider } from '../src/index.ts'

interface TreeNode {
  id: number
  type: string
  style?: Record<string, unknown>
  testId?: string
  children?: TreeNode[]
}

function themed(children: ReactNode) {
  return (
    <ThemeProvider name="dark" onThemeChange={() => {}}>
      {children}
    </ThemeProvider>
  )
}

function mounted(children: ReactNode): TestRoot {
  const root = createTestRoot({ width: 800, height: 600 })
  root.render(themed(children))
  root.renderer.flush()
  return root
}

interface BoundaryProps {
  onError: (error: Error) => void
  children: ReactNode
}

/** React reports a render error to the nearest boundary instead of rethrowing. */
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
function renderError(children: ReactNode): string | null {
  const root = createTestRoot({ width: 800, height: 600 })
  let captured: Error | null = null
  try {
    root.render(
      <CaptureError onError={(error) => (captured = error)}>{themed(children)}</CaptureError>,
    )
    root.renderer.flush()
  } finally {
    root.unmount()
  }
  return captured === null ? null : (captured as Error).message
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

describe('Activation au clavier', () => {
  test('enter and space each trigger the action exactly once', () => {
    let pressed = 0
    const root = mounted(
      <Pressable testId="target" onPress={() => (pressed += 1)}>
        <Text color="text">Create</Text>
      </Pressable>,
    )
    try {
      const target = nodeOf(root, 'target').id
      root.renderer.nativeSimulateKeystrokes(target, 'enter')
      expect(pressed).toBe(1)
      root.renderer.nativeSimulateKeystrokes(target, 'space')
      expect(pressed).toBe(2)
      root.renderer.nativeSimulateKeystrokes(target, 'a')
      expect(pressed).toBe(2)
    } finally {
      root.unmount()
    }
  })
})

describe('État désactivé figé', () => {
  test('a disabled pressable leaves the tab order and ignores activation', () => {
    let pressed = 0
    const root = mounted(
      <Pressable
        testId="target"
        disabled
        onPress={() => (pressed += 1)}
        style={{ backgroundColor: '#101010', hover: { backgroundColor: '#202020' } }}
      >
        <Text color="text">Create</Text>
      </Pressable>,
    )
    try {
      const target = nodeOf(root, 'target')
      // The renderer paints hover and active without React, so a disabled control must not
      // declare them at all.
      expect(target.style?.hover).toBeUndefined()
      expect(target.style?.active).toBeUndefined()
      root.renderer.nativeSimulateKeystrokes(target.id, 'enter')
      root.renderer.nativeSimulateKeystrokes(target.id, 'space')
      expect(pressed).toBe(0)
    } finally {
      root.unmount()
    }
  })

  test('focus traversal skips a disabled control', () => {
    const root = mounted(
      <Stack direction="column">
        <Pressable testId="first" onPress={() => {}}>
          <Text color="text">First</Text>
        </Pressable>
        <Pressable testId="skipped" disabled onPress={() => {}}>
          <Text color="text">Skipped</Text>
        </Pressable>
        <Pressable testId="last" onPress={() => {}}>
          <Text color="text">Last</Text>
        </Pressable>
      </Stack>,
    )
    try {
      const first = nodeOf(root, 'first').id
      const skipped = nodeOf(root, 'skipped').id
      const last = nodeOf(root, 'last').id

      root.renderer.focusElement(first)
      expect(root.renderer.getFocusedElementId()).toBe(first)

      root.renderer.focusNext()
      expect(root.renderer.getFocusedElementId()).not.toBe(skipped)
      expect(root.renderer.getFocusedElementId()).toBe(last)
    } finally {
      root.unmount()
    }
  })
})

describe('Texte peint par le renderer', () => {
  test('a text run carries the colour of its role', () => {
    const root = mounted(
      <Text testId="label" color="muted">
        Session
      </Text>,
    )
    try {
      const label = nodeOf(root, 'label')
      expect(label.type).toBe('text')
      expect(typeof label.style?.color).toBe('string')
      expect(label.style?.color).not.toBe('')
    } finally {
      root.unmount()
    }
  })

  test('a text run nested in another is refused', () => {
    const message = renderError(
      <Text color="text">
        {/* @ts-expect-error a Text only takes a string, which is the rule under test */}
        <Text color="muted">inner</Text>
      </Text>,
    )
    expect(message).toMatch(/cannot nest/)
  })
})

describe('Un seul niveau de défilement par panneau', () => {
  test('a panel declares one scroll level', () => {
    const root = mounted(
      <Scroll testId="panel">
        <Text color="text">One</Text>
      </Scroll>,
    )
    try {
      expect(nodeOf(root, 'panel').style?.overflowY).toBe('scroll')
    } finally {
      root.unmount()
    }
  })

  test('nesting a second scroll level is refused', () => {
    const message = renderError(
      <Scroll>
        <Scroll>
          <Text color="text">Two</Text>
        </Scroll>
      </Scroll>,
    )
    expect(message).toMatch(/cannot nest/)
  })
})

describe("Overlay ancré au-dessus d'une liste", () => {
  test('an anchored overlay is deferred and takes its own pointer events', () => {
    const root = mounted(
      <Anchored testId="overlay">
        <Text color="text">Choice</Text>
      </Anchored>,
    )
    try {
      const overlay = nodeOf(root, 'overlay')
      expect(overlay.type).toBe('anchored')
      expect(overlay.style?.pointerEvents).toBe('auto')
    } finally {
      root.unmount()
    }
  })
})
