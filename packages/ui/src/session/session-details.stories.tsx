import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconButton } from '../components/button/button.tsx'
import { Tooltip, TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { IconLayoutSidebarRight } from '../icons.ts'
import { CommandsPanel } from './commands-panel.tsx'
import { ContextView } from './context-view.tsx'
import { SessionDetails, type SessionDetailsProps } from './session-details.tsx'

/**
 * The three things a reader checks on while an agent works, one press away from the thread.
 *
 * The plan and the files are what the turn is doing; the commands are what the Session runs, with
 * the address of a server the moment it has one; the context is what the agent is working from:
 * its instructions and the tools it is lent. A centred dialog the reader opens from the Session's
 * head, never a column beside the thread: nothing the agent does opens it by itself.
 *
 * Each story draws the button the head draws, because what opens the dialog is also what the
 * focus goes back to when it closes.
 */

/** The head's button and the dialog it opens, holding whether it is open as the page does. */
function Harness(props: Omit<SessionDetailsProps, 'open' | 'onOpenChange'>): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <TooltipProvider>
      <Tooltip label="Session details">
        <IconButton
          variant="ghost"
          size="sm"
          icon={<IconLayoutSidebarRight size="sm" />}
          aria-label="Session details"
          onClick={() => {
            setOpen(true)
          }}
        />
      </Tooltip>
      <SessionDetails {...props} open={open} onOpenChange={setOpen} />
    </TooltipProvider>
  )
}

const meta = {
  title: 'Blocks/Session/SessionDetails',
  component: Harness,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'padded' },
  args: {
    plan: [
      { content: 'Read the session page and the scroller', priority: 'high', status: 'completed' },
      { content: 'Draw the stopped turn line', priority: 'medium', status: 'in_progress' },
    ],
    files: [
      { path: 'packages/ui/src/session/plan-panel.tsx', added: 42, removed: 3 },
      { path: 'packages/ui/src/session/session-details.tsx', added: 61, removed: 0 },
    ],
    onSelectFile: fn(),
    commands: (
      <CommandsPanel
        runs={[
          {
            id: 'run-dev',
            name: 'dev',
            command: 'pnpm dev',
            kind: 'app',
            state: 'running',
            folder: './sources/front',
            output: 'vite v7.1.4\n\n  Local:   http://localhost:5173/',
            url: 'http://localhost:5173/',
          },
          {
            id: 'run-check',
            name: 'check',
            command: 'pnpm check',
            kind: 'check',
            state: 'finished',
            folder: '.',
            output: 'Test Files  155 passed (155)',
            exitCode: 0,
          },
        ]}
        onStop={fn()}
        onOpenUrl={fn()}
        onRun={fn()}
      />
    ),
    context: (
      <ContextView
        instructions={[
          { label: 'AGENTS.md', detail: 'given at the start of the Session' },
          { label: 'Last change', detail: 'delivered between two turns', at: '21 Sep 23:02' },
          { label: 'The base', detail: 'as a resource of the first prompt' },
        ]}
        tools={[{ name: 'fs_read', bound: '256 KiB a page, inside the Workspace root' }]}
        commands={[{ name: 'check', command: 'pnpm check' }]}
      />
    ),
  },
  argTypes: {
    plan: { control: 'object', description: 'The plan as the agent last sent it.' },
    files: { control: 'object', description: 'The files the turn has touched.' },
    commands: { control: false, description: 'The Commands panel of this Session, already drawn.' },
    context: { control: false, description: 'The Context view of this Session, already drawn.' },
    defaultTab: {
      control: 'inline-radio',
      options: ['activity', 'commands', 'context'],
      description: 'The tab the dialog opens on.',
    },
    onSelectFile: { description: 'Opens a file, when the reader presses its path.' },
  },
} satisfies Meta<typeof Harness>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Presses the head's button and answers the dialog it opened, once it has risen into place: it
 * arrives from transparent, and what is read inside it is read once it can be seen.
 */
async function opened(canvasElement: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Session details' }))
  const dialog = await waitFor(() =>
    within(document.body).getByRole('dialog', { name: 'Session details' }),
  )
  await waitFor(() => {
    expect(getComputedStyle(dialog).opacity).toBe('1')
  })
  return dialog
}

/**
 * A Session with nothing to show yet: the dialog opens all the same, and each tab says it has
 * nothing rather than showing an empty box.
 */
export const Empty: Story = {
  args: { plan: [], files: [], commands: undefined, context: undefined, defaultTab: 'context' },
  play: async ({ canvasElement }) => {
    // Nothing is drawn until the reader asks: no dialog, no tab.
    expect(within(document.body).queryByRole('dialog')).toBeNull()
    expect(within(document.body).queryByRole('tab')).toBeNull()
    const dialog = within(await opened(canvasElement))
    await expect(dialog.getByRole('tab', { name: 'Context' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(dialog.getByText('Hemera has nothing to say about it yet.')).toBeVisible()
    await userEvent.click(dialog.getByRole('tab', { name: 'Activity' }))
    await expect(dialog.getByText('No plan and no file touched in this Session yet.')).toBeVisible()
    await userEvent.click(dialog.getByRole('tab', { name: 'Commands' }))
    await expect(dialog.getByText('No command has run in this Session.')).toBeVisible()
  },
}

/**
 * What the turn has done: the plan it works to, and each file a call named with what the change
 * added up to. Pressing a path opens that file; a path longer than the dialog is cut at its end
 * and never scrolls it sideways.
 */
export const Activity: Story = {
  args: {
    defaultTab: 'activity',
    files: [
      { path: 'packages/ui/src/session/plan-panel.tsx', added: 42, removed: 3 },
      {
        path: 'packages/ui/src/session/a-module-whose-path-is-longer-than-the-dialog-it-is-listed-in-and-then-some.tsx',
        added: 1204,
        removed: 318,
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const dialog = await opened(canvasElement)
    const inside = within(dialog)
    await expect(inside.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(inside.getByText('Draw the stopped turn line')).toBeVisible()
    await userEvent.click(inside.getByRole('button', { name: /Files/ }))
    await expect(inside.getByText('+42')).toBeVisible()
    await expect(inside.getByText('-3')).toBeVisible()
    await expect(dialog.scrollWidth, 'a long path pushes the dialog sideways').toBe(
      dialog.clientWidth,
    )
    await userEvent.click(
      inside.getByRole('button', { name: 'packages/ui/src/session/plan-panel.tsx' }),
    )
    await expect(args.onSelectFile).toHaveBeenCalledWith('packages/ui/src/session/plan-panel.tsx')
  },
}

/** Scenario « Commande en cours »: what the Session is running, with its address. */
export const Commands: Story = {
  args: { defaultTab: 'commands' },
  play: async ({ canvasElement }) => {
    const inside = within(await opened(canvasElement))
    await expect(inside.getByRole('tab', { name: 'Commands' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(inside.getByText('pnpm dev')).toBeVisible()
    await expect(inside.getByText('1 running')).toBeVisible()
    await expect(inside.getByRole('button', { name: 'http://localhost:5173/' })).toBeVisible()
  },
}

/** Scenario « Contexte fourni »: what the agent works from, its instructions and its tools. */
export const Context: Story = {
  args: { defaultTab: 'context' },
  play: async ({ canvasElement }) => {
    const inside = within(await opened(canvasElement))
    await expect(inside.getByRole('tab', { name: 'Context' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(inside.getByText('Instructions')).toBeVisible()
    await expect(inside.getByText('· 21 Sep 23:02')).toBeVisible()
    await expect(inside.getByRole('button', { name: 'Tools · 1' })).toBeVisible()
  },
}

/**
 * The keyboard: Enter on the head's button opens the dialog, Tab walks its own controls and never
 * leaves it for the page behind, the arrows walk the tabs, and Escape closes it and gives the focus
 * back to the button that opened it. A click outside closes it the same way.
 */
export const Keyboard: Story = {
  args: { defaultTab: 'activity' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Session details' })
    await userEvent.tab()
    expect(document.activeElement).toBe(button)
    await userEvent.keyboard('{Enter}')
    const dialog = await waitFor(() =>
      within(document.body).getByRole('dialog', { name: 'Session details' }),
    )
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
    // Tab cycles inside the dialog: a dozen presses never reach the page behind it.
    for (let press = 0; press < 12; press += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one key after the other, as a hand presses them
      await userEvent.tab()
      // oxlint-disable-next-line no-await-in-loop -- the trap hands the focus back on its own beat
      await waitFor(() => {
        expect(dialog.contains(document.activeElement), 'Tab left the dialog').toBe(true)
      })
    }
    // The arrows walk the strip of tabs.
    within(dialog).getByRole('tab', { name: 'Activity' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(within(dialog).getByRole('tab', { name: 'Commands' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Escape closes it and hands the focus back to what opened it.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(button)
    })
    // And a click outside closes it too.
    await userEvent.click(button)
    await waitFor(() => within(document.body).getByRole('dialog'))
    await userEvent.click(document.body)
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}
