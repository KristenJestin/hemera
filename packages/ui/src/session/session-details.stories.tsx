import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { movesLess } from '../../.storybook/reduced-motion.ts'
import { IconButton } from '../components/button/button.tsx'
import { Tooltip, TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { IconInfoCircle } from '../icons.ts'
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
          icon={<IconInfoCircle size="sm" />}
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
            type: 'serve',
            state: 'running',
            folder: './sources/front',
            output: 'vite v7.1.4\n\n  Local:   http://localhost:5173/',
            url: 'http://localhost:5173/',
            readiness: 'ready',
          },
          {
            id: 'run-check',
            name: 'check',
            command: 'pnpm check',
            type: 'test',
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
    onOpenTrace: { description: 'Opens the ACP trace of this Session, when there is one.' },
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
  await risen(dialog)
  return dialog
}

/** One frame of the browser, which is how long anything drawn has to have moved in. */
function frame(): Promise<void> {
  return new Promise((done) => {
    requestAnimationFrame(() => done())
  })
}

/**
 * Waits for the dialog to be in place: opaque, and no longer growing from the smaller scale it
 * rises from — two frames in a row at the same height.
 * A loaded runner plays the rise slowly: the second it gives can end while it is in flight.
 */
async function risen(dialog: HTMLElement): Promise<void> {
  await waitFor(
    async () => {
      expect(getComputedStyle(dialog).opacity).toBe('1')
      const before = dialog.getBoundingClientRect().height
      await frame()
      expect(dialog.getBoundingClientRect().height).toBe(before)
    },
    { timeout: 10_000 },
  )
}

/** How far a tab's panel has faded in, from 0 to 1, read off the filter the crossfade plays. */
function fadeOf(dialog: HTMLElement, tab: string): number | null {
  const id = within(dialog).getByRole('tab', { name: tab }).id
  const faded = dialog.querySelector(`[role="tabpanel"][aria-labelledby="${id}"] > div`)
  if (faded === null) return null
  const written = /opacity\(([\d.e-]+)\)/.exec(getComputedStyle(faded).filter)
  return written === null ? 1 : Number(written[1])
}

/**
 * The most room the dialog may leave under what it shows, in pixels: its own border and padding
 * under its last part, and the hair the body pulls back out of them.
 */
const SPARE = 24

/** How much room the dialog leaves under the last thing it shows. */
function spare(dialog: HTMLElement): number {
  const box = dialog.getBoundingClientRect()
  return box.bottom - dialog.lastElementChild!.getBoundingClientRect().bottom
}

/**
 * Walks the three tabs the way `choose` picks one, and checks the dialog on every one of them: it
 * is as tall as the tab it shows, with nothing left to spare under it. A tab that holds more makes
 * a taller dialog — the size decides the width, and never the height.
 */
async function hugsTheTab(
  dialog: HTMLElement,
  choose: (tab: string) => Promise<void>,
): Promise<void> {
  for (const tab of ['Activity', 'Commands', 'Context']) {
    // oxlint-disable-next-line no-await-in-loop -- one tab after the other, as a reader walks them
    await choose(tab)
    // oxlint-disable-next-line no-await-in-loop -- the panel is measured once it has landed
    await waitFor(() => {
      expect(fadeOf(dialog, tab)).toBe(1)
    })
    // oxlint-disable-next-line no-await-in-loop -- the dialog is read once the tab has landed
    expect(spare(dialog), `the dialog has room to spare under the ${tab} tab`).toBeLessThan(SPARE)
  }
}

/** Picks a tab with the pointer. */
function clicking(dialog: HTMLElement): (tab: string) => Promise<void> {
  return async (tab) => {
    await userEvent.click(within(dialog).getByRole('tab', { name: tab }))
  }
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
    // Whatever a tab holds — an open list of files included — the dialog is as tall as it is.
    await hugsTheTab(dialog, clicking(dialog))
  },
}

/** Scenario « Commande en cours »: what the Session is running, with its address. */
export const Commands: Story = {
  args: { defaultTab: 'commands' },
  play: async ({ canvasElement }) => {
    const dialog = await opened(canvasElement)
    const inside = within(dialog)
    await expect(inside.getByRole('tab', { name: 'Commands' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(inside.getByText('pnpm dev')).toBeVisible()
    await expect(inside.getByText('1 running')).toBeVisible()
    await expect(inside.getByRole('button', { name: 'http://localhost:5173/' })).toBeVisible()
    // A list of runs and their output makes a taller dialog, with nothing to spare under it.
    await hugsTheTab(dialog, clicking(dialog))
  },
}

/** Scenario « Contexte fourni »: what the agent works from, its instructions and its tools. */
export const Context: Story = {
  args: { defaultTab: 'context' },
  play: async ({ canvasElement }) => {
    const dialog = await opened(canvasElement)
    const inside = within(dialog)
    await expect(inside.getByRole('tab', { name: 'Context' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(inside.getByText('Instructions')).toBeVisible()
    await expect(inside.getByText('· 21 Sep 23:02')).toBeVisible()
    await expect(inside.getByRole('button', { name: 'Tools · 1' })).toBeVisible()
    // A short one makes a shorter dialog, with nothing to spare under it either.
    await hugsTheTab(dialog, clicking(dialog))
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
    // The arrows walk the strip of tabs, and the dialog is as tall as each one it lands on.
    await risen(dialog)
    within(dialog).getByRole('tab', { name: 'Activity' }).focus()
    await hugsTheTab(dialog, async (tab) => {
      if (tab !== 'Activity') await userEvent.keyboard('{ArrowRight}')
    })
    await expect(within(dialog).getByRole('tab', { name: 'Context' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Escape closes it and hands the focus back to what opened it.
    // The leave is a journey too: a second of window can end while it is still playing.
    await userEvent.keyboard('{Escape}')
    await waitFor(
      () => {
        expect(within(document.body).queryByRole('dialog')).toBeNull()
      },
      { timeout: 10_000 },
    )
    await waitFor(() => {
      expect(document.activeElement).toBe(button)
    })
    // And a click outside closes it too, with the same room for the leave to be played out.
    await userEvent.click(button)
    const arrived = await waitFor(() => within(document.body).getByRole('dialog'))
    // The press is honoured once the popup has arrived: Base UI ignores a hand outside while it is
    // still entering, which is the state a loaded runner catches it in.
    await waitFor(() => {
      expect(arrived).not.toHaveAttribute('data-starting-style')
    })
    await userEvent.click(document.body)
    await waitFor(
      () => {
        expect(within(document.body).queryByRole('dialog')).toBeNull()
      },
      { timeout: 10_000 },
    )
  },
}

/**
 * Changing tab: the panel that was left goes, the one that was chosen comes up from transparent
 * on the `crossfade` kind, and the dialog is never taller than the tab it shows — not at a frame
 * of it.
 */
export const TabChange: Story = {
  args: { defaultTab: 'activity' },
  play: async ({ canvasElement }) => {
    const dialog = await opened(canvasElement)
    const room: number[] = []
    // Every value the crossfade writes, watched from before the press: a fade of `fast` is drawn
    // in two or three frames on a busy runner, so what is read is what was written, not how many
    // frames the runner took to write it.
    const drawn: number[] = []
    const writes = new MutationObserver(() => {
      const fade = fadeOf(dialog, 'Commands')
      if (fade !== null) drawn.push(fade)
    })
    writes.observe(dialog, { attributes: true, subtree: true, attributeFilter: ['style'] })
    const watched = (async () => {
      for (let seen = 0; seen < 40; seen += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one frame after the other, as they are drawn
        await frame()
        room.push(spare(dialog))
      }
    })()
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Commands' }))
    // The journey is waited out, not counted in frames: the last write is the landing.
    await waitFor(() => expect(fadeOf(dialog, 'Commands')).toBe(1))
    writes.disconnect()
    await watched

    await expect(within(dialog).getByText('pnpm dev')).toBeVisible()
    if (!movesLess()) {
      // Drawn from transparent: the crossfade wrote a value below opaque on its way up. Where
      // less movement was asked for there is no journey, and the opacity above is the claim.
      expect(
        drawn.some((fade) => fade < 1),
        'the new panel never showed transparent',
      ).toBe(true)
    }
    expect(drawn.at(-1), 'the new panel did not land opaque').toBe(1)
    expect(Math.max(...room), 'the dialog grew away from the tab it shows').toBeLessThan(SPARE)
  },
}

/**
 * A Session whose conversation with its agent was written down, because the settings asked for it
 * (issue #131): the trace is one press away, under what the Session is doing.
 */
export const WithATrace: Story = {
  args: { onOpenTrace: fn() },
  play: async ({ args, canvasElement }) => {
    const dialog = await opened(canvasElement)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the trace' }))
    await expect(args.onOpenTrace).toHaveBeenCalledOnce()
  },
}

/** A Session with no trace offers none: there is nothing to open. */
export const WithoutATrace: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await opened(canvasElement)
    await expect(within(dialog).queryByRole('button', { name: 'Open the trace' })).toBeNull()
  },
}
