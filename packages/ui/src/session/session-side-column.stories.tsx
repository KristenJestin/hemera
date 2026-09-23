import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CommandsPanel } from './commands-panel.tsx'
import { ContextView } from './context-view.tsx'
import { SessionSideColumn } from './session-side-column.tsx'

/**
 * The three things a reader checks on while an agent works, beside the thread rather than in it.
 *
 * The plan and the files are what the turn is doing; the commands are what the Session runs, with
 * the address of a server the moment it has one; the context is what the agent is working from,
 * and the part of it Hemera cannot read. Three tabs and not one long column: a reader who comes
 * back to a Session where a command is running wants that tab, not a scroll.
 */
const meta = {
  title: 'Blocks/Session/SessionSideColumn',
  component: SessionSideColumn,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'padded' },
  args: {
    plan: [
      { content: 'Read the session page and the scroller', priority: 'high', status: 'completed' },
      { content: 'Draw the stopped turn line', priority: 'medium', status: 'in_progress' },
    ],
    files: [
      { path: 'packages/ui/src/session/plan-panel.tsx', added: 42, removed: 3 },
      { path: 'packages/ui/src/session/session-side-column.tsx', added: 61, removed: 0 },
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
        provided={[
          { kind: 'base', label: 'The base', detail: 'hemera/context/v1' },
          {
            kind: 'file',
            label: 'AGENTS.md',
            detail: 'a41f8c2e, 9 128 bytes',
            at: '21 Sep 22:14',
          },
          {
            kind: 'delivery',
            label: 'The check that failed',
            detail: 'session: the failing suite',
            at: '21 Sep 23:02',
          },
        ]}
        tools={[{ name: 'fs_read', bound: '256 KiB, 2 000 lines' }]}
        commands={[{ name: 'check', command: 'pnpm check' }]}
        agents={[{ name: 'opencode', sentence: 'its own plugins are read by it, not by Hemera' }]}
      />
    ),
  },
  argTypes: {
    plan: { control: 'object', description: 'The plan as the agent last sent it.' },
    files: { control: 'object', description: 'The files the turn has touched.' },
    commands: { control: false, description: 'The Commands panel of this Session, already drawn.' },
    context: { control: false, description: 'The Context view of this Session, already drawn.' },
    defaultTab: { control: 'text', description: 'The tab the column opens on.' },
    onSelectFile: { description: 'Opens a file, when the reader presses its path.' },
  },
} satisfies Meta<typeof SessionSideColumn>

export default meta

type Story = StoryObj<typeof meta>

/** A file is listed because a call named it, with what the change added up to. */
export const WhatTheTurnHasDone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const files = canvas.getByRole('button', { name: /Files/ })
    await userEvent.click(files)
    await expect(canvas.getByText('packages/ui/src/session/plan-panel.tsx')).toBeVisible()
    await expect(canvas.getByText('+42')).toBeVisible()
    await expect(canvas.getByText('-3')).toBeVisible()
  },
}

/**
 * A turn that has touched nothing yet draws no Files section (review of #40, defect 3).
 *
 * A section with nothing to show is not drawn: what is left is the plan, and the files are not a
 * section until one of them is named.
 */
export const NothingTouched: Story = {
  args: { files: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /Files/ })).toBeNull()
    // What is left is the plan, folded: its count and the step it is on are what a folded plan
    // still says.
    await expect(canvas.getByText('Plan')).toBeVisible()
    await expect(canvas.getByText('1 of 2')).toBeVisible()
    await expect(canvas.getByText('Draw the stopped turn line')).toBeVisible()
  },
}

/**
 * A Session with neither a plan nor a file nor a command to read draws no column at all (review
 * of #40, defect 3).
 *
 * An empty `Plan 0 of 0` and an empty Files section take the width of the thread beside them to
 * say nothing, so the column is not there and the width is the thread's — and a Commands panel
 * or a Context view is handed over only by a caller that has one, so nothing handed over is the
 * same nothing.
 */
export const NothingToStandBeside: Story = {
  args: { plan: [], files: [], commands: null, context: null },
  play: async ({ canvasElement }) => {
    expect(canvasElement).toBeEmptyDOMElement()
  },
}

/**
 * Names longer than the column: a path, a command line, a folder and an address that do not fit.
 *
 * The column never scrolls sideways (trial of 23 September 2026): a one-line row is cut at its end
 * and a sentence wraps, on every tab and with every fold open.
 */
export const LongNames: Story = {
  args: {
    files: [
      {
        path: 'packages/ui/src/session/a-module-whose-path-is-longer-than-the-column.tsx',
        added: 1204,
        removed: 318,
      },
    ],
    commands: (
      <CommandsPanel
        runs={[
          {
            id: 'run-long',
            name: 'storybook-with-a-long-name',
            command: 'pnpm --filter @hemera/ui exec storybook dev --port 6006 --no-open --ci',
            kind: 'app',
            state: 'running',
            folder: './packages/ui/and/a/folder/deeper/than/the/column',
            output:
              'Storybook ready\n  Local: http://localhost:6006/?path=/story/surfaces-session--complete',
            url: 'http://localhost:6006/?path=/story/surfaces-session--complete',
          },
        ]}
        onStop={fn()}
        onOpenUrl={fn()}
        onRun={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const column = canvas.getByRole('complementary')
    await userEvent.click(canvas.getByRole('button', { name: /Files/ }))
    await expect(canvas.getByText(/a-module-whose-path/)).toBeVisible()
    for (const tab of ['Activity', 'Commands', 'Context']) {
      // oxlint-disable-next-line no-await-in-loop -- one tab after the other, as a reader walks them
      await userEvent.click(canvas.getByRole('tab', { name: tab }))
      for (const fold of canvas.queryAllByRole('button', { expanded: false })) {
        // oxlint-disable-next-line no-await-in-loop -- each fold opens under the one before it
        await userEvent.click(fold)
      }
      // oxlint-disable-next-line no-await-in-loop -- the width is read once the tab is drawn
      await expect(column.scrollWidth, `the ${tab} tab pushes the column sideways`).toBe(
        column.clientWidth,
      )
    }
  },
}

/** Pressing a path opens that file, which is the only thing this column does. */
export const OpeningAFile: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Files/ }))
    await userEvent.click(
      canvas.getByRole('button', { name: 'packages/ui/src/session/plan-panel.tsx' }),
    )
    await expect(args.onSelectFile).toHaveBeenCalledWith('packages/ui/src/session/plan-panel.tsx')
  },
}

/** Scenario « Commande en cours » of `specs/agent-tools/spec.md`: what the Session is running. */
export const CommandsOfTheSession: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Commands' }))
    await expect(canvas.getByText('pnpm dev')).toBeVisible()
    await expect(canvas.getByText('1 running')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'http://localhost:5173/' })).toBeVisible()
    // The thread keeps its own state: what is behind another tab is not lost by looking.
    await userEvent.click(canvas.getByRole('tab', { name: 'Activity' }))
    // The plan keeps the tab it had, and the step being worked on is read on the folded line.
    await expect(canvas.getByText('Draw the stopped turn line')).toBeVisible()
  },
}

/** Scenario « Contexte fourni » of `specs/agent-tools/spec.md`: what the agent works from. */
export const ContextOfTheSession: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Context' }))
    await expect(canvas.getByText('Hemera provides')).toBeVisible()
    await expect(canvas.getByText('21 Sep 23:02')).toBeVisible()
    await expect(canvas.getByText('Hemera does not control')).toBeVisible()
  },
}

/**
 * A column nobody has handed a command or a context to: each of the two tabs says so rather
 * than showing an empty box, and the plan is what keeps the column standing beside the thread.
 */
export const NothingHandedOver: Story = {
  args: { commands: undefined, context: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Commands' }))
    await expect(canvas.getByText('No command has run in this Session.')).toBeVisible()
    await userEvent.click(canvas.getByRole('tab', { name: 'Context' }))
    await expect(canvas.getByText('Hemera has nothing to say about it yet.')).toBeVisible()
  },
}
