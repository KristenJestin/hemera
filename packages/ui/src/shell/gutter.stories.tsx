import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { Gutter } from './gutter.tsx'
import { SIDEBAR_COLLAPSE, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_RAIL } from './model.ts'

interface HarnessProps {
  collapsed?: boolean
}

/**
 * The separator with a panel to move: the width it reports is the width the panel is drawn at,
 * so a drag is verifiable without the rest of the shell being in the way.
 */
function Harness({ collapsed: folded = false }: HarnessProps) {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT)
  const [collapsed, setCollapsed] = useState(folded)
  const [dragging, setDragging] = useState(false)
  return (
    <div className="flex h-24">
      <div
        data-testid="panel"
        className="shrink-0 border-r border-border bg-card"
        // A panel of the exact width the separator reports, so the story moves something real.
        // The shell animates this width; here it is set, because what is under test is the
        // separator and not the fold.
        ref={(node) => {
          node?.style.setProperty('width', `${collapsed ? SIDEBAR_RAIL : width}px`)
        }}
      />
      <Gutter
        width={width}
        collapsed={collapsed}
        onWidthChange={setWidth}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onDraggingChange={setDragging}
      />
      <p className="p-4 text-muted-foreground">
        {collapsed ? 'folded' : `${Math.round(width)}px`}
        {dragging ? ', under the hand' : ''}
      </p>
    </div>
  )
}

const meta = {
  title: 'Shell/Gutter',
  component: Harness,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { collapsed: true },
}

/** Scenario « Redimensionnement au séparateur » of `specs/window-shell/spec.md`. */
export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const separator = canvas.getByRole('separator', { name: 'Sidebar width' })

    const drag = (x: number): void => {
      separator.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: x }),
      )
      separator.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: x }),
      )
      separator.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: x }),
      )
    }

    // Past the maximum, the width stops at the maximum instead of following the hand.
    drag(SIDEBAR_MAX * 3)
    await waitFor(() => {
      expect(separator).toHaveAttribute('aria-valuenow', String(SIDEBAR_MAX))
    })

    // Under the fold threshold, it folds rather than becoming uselessly narrow — and the
    // separator is still there to bring it back.
    drag(SIDEBAR_COLLAPSE - 1)
    await waitFor(() => {
      expect(canvas.getByText('folded')).toBeInTheDocument()
    })
    expect(canvas.getByRole('separator', { name: 'Sidebar width' })).toBeInTheDocument()
  },
}
