import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../test-setup.ts'
import { useState } from 'react'

import { SIDEBAR_BOUNDS, WindowShell } from '../src/shell/window-shell.tsx'
import { decideTitleBar, decorationsOf } from '../src/shell/title-bar.ts'
import { Tab } from '../src/components/tab/tab.tsx'
import { NavItem } from '../src/components/nav-item/nav-item.tsx'
import { Text } from '../src/primitives/text.tsx'
import { shell } from '../src/tokens/components.ts'
import { mountedCatalogue, nodeOf } from '../test-harness.tsx'

function Shell({ width = shell.sidebar.width }: { width?: number }) {
  const [sidebarWidth, setSidebarWidth] = useState(width)
  const [collapsed, setCollapsed] = useState(false)
  return (
    <WindowShell
      testId="shell"
      collapseLabel="Collapse the sidebar"
      resizeLabel="Sidebar width"
      sidebarWidth={sidebarWidth}
      onSidebarWidthChange={setSidebarWidth}
      sidebarCollapsed={collapsed}
      onSidebarCollapsedChange={setCollapsed}
      projects={<Tab label="Hemera" dotColor="primary" active onSelect={() => {}} />}
      sidebar={<NavItem label="A session" iconName="message-square" selected onSelect={() => {}} />}
    >
      <Text color="text">Session view</Text>
    </WindowShell>
  )
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Coquille de fenêtre', () => {
  test('the projects bar, the sidebar, the gutter and the content are painted', () => {
    const root = mountedCatalogue(<Shell />)
    try {
      expect(nodeOf(root, 'shell-projects').style?.height).toBe(shell.topbar.height)
      expect(nodeOf(root, 'shell-sidebar').style?.width).toBe(shell.sidebar.width)
      expect(nodeOf(root, 'shell-gutter').style?.width).toBe(shell.gutter.size)
      expect(() => nodeOf(root, 'shell-content')).not.toThrow()
    } finally {
      root.unmount()
    }
  })

  test('one scroll level in the sidebar panel', () => {
    const root = mountedCatalogue(<Shell />)
    try {
      const sidebar = nodeOf(root, 'shell-sidebar')
      const scrollers = JSON.stringify(sidebar).split('"overflowY":"scroll"').length - 1
      expect(scrollers).toBe(1)
    } finally {
      root.unmount()
    }
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Sidebar repliée et largeur persistée', () => {
  test('collapsing narrows the sidebar and removes its gutter', () => {
    const root = mountedCatalogue(<Shell />)
    try {
      root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'shell-collapse').id, 'enter')
      root.renderer.flush()
      expect(nodeOf(root, 'shell-sidebar').style?.width).toBe(shell.sidebar.collapsedWidth)
      expect(() => nodeOf(root, 'shell-gutter')).toThrow()
    } finally {
      root.unmount()
    }
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Largeur hors bornes', () => {
  test('a stored width outside the bounds falls back to the default without failing', () => {
    for (const stored of [10, 9000, Number.NaN]) {
      const root = mountedCatalogue(<Shell width={stored} />)
      try {
        expect(nodeOf(root, 'shell-sidebar').style?.width).toBe(SIDEBAR_BOUNDS.defaultSize)
      } finally {
        root.unmount()
      }
    }
  })

  test('a stored width within the bounds is applied', () => {
    const root = mountedCatalogue(<Shell width={320} />)
    try {
      expect(nodeOf(root, 'shell-sidebar').style?.width).toBe(320)
    } finally {
      root.unmount()
    }
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Décorations client indisponibles', () => {
  test('a renderer exposing none of it falls back and names what is missing', () => {
    const decision = decideTitleBar(decorationsOf({}, true))
    expect(decision.mode).toBe('native')
    expect(decision.missing).toEqual(['dragRegion', 'windowButtons'])
  })

  test('a window that cannot be frameless falls back even with the commands', () => {
    const decision = decideTitleBar(
      decorationsOf(
        {
          startWindowMove: () => {},
          minimizeWindow: () => {},
          zoomWindow: () => {},
          closeWindow: () => {},
        },
        false,
      ),
    )
    expect(decision.mode).toBe('native')
    expect(decision.missing).toEqual(['framelessWindow'])
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Décorations client disponibles', () => {
  test('the renderer installed here exposes the three of them', () => {
    // Read from the addon itself: the fork carries the commands, and a checkout that does
    // not would be told apart here instead of painting a window nobody can move or close.
    const renderer = require('@gpuix/native') as { GpuixRenderer: { prototype: object } }
    const commands = renderer.GpuixRenderer.prototype as Record<string, unknown>
    expect(typeof commands['startWindowMove']).toBe('function')
    expect(typeof commands['minimizeWindow']).toBe('function')
    expect(typeof commands['zoomWindow']).toBe('function')
    expect(typeof commands['closeWindow']).toBe('function')
  })

  test('the projects bar becomes the title bar once every capability is exposed', () => {
    const decision = decideTitleBar(
      decorationsOf(
        {
          startWindowMove: () => {},
          minimizeWindow: () => {},
          zoomWindow: () => {},
          closeWindow: () => {},
        },
        true,
      ),
    )
    expect(decision.mode).toBe('projects-bar')
    expect(decision.missing).toEqual([])
  })
})
