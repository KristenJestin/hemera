import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { ContextView } from './context-view.tsx'

/**
 * What the agent is working from, and what Hemera has no say over (design D6-10).
 *
 * The stories are the three lists: a Session that has been given its file and two deliveries, a
 * Session nothing has gone into yet, and the sentence each agent gets about the sources Hemera
 * cannot read. The split between the lists is the honest part, so it is visible in every story.
 */
const PROVIDED = [
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
  {
    kind: 'delivery',
    label: 'docs/product/core.md',
    detail: 'read at the reader\u2019s request',
    at: '21 Sep 23:09',
  },
] as const

const TOOLS = [
  { name: 'fs_read', bound: '256 KiB, 2 000 lines' },
  { name: 'fs_write', bound: 'inside the Workspace root, 1 MiB' },
  { name: 'fs_edit', bound: 'unique match, 1 000 lines' },
  { name: 'search', bound: '200 matches, 1 MiB' },
  { name: 'commands_run', bound: 'catalogue only, 30 s to first output' },
]

const COMMANDS = [
  { name: 'check', command: 'pnpm check' },
  { name: 'dev', command: 'pnpm dev' },
]

const AGENTS = [
  { name: 'opencode', sentence: 'its own instructions and plugins are read by it, not by Hemera' },
  { name: 'claude-code', sentence: 'CLAUDE.md and its memories are outside what Hemera reads' },
  { name: 'codex', sentence: 'its configuration and skills are its own' },
]

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Session/ContextView',
  component: ContextView,
  parameters: { layout: 'padded' },
  args: { provided: PROVIDED, tools: TOOLS, commands: COMMANDS, agents: AGENTS },
  argTypes: {
    provided: { control: 'object', description: 'What Hemera puts in front of the agent.' },
    tools: { control: 'object', description: 'The tools it lends, with the bound of each.' },
    commands: { control: 'object', description: 'The commands the catalogue holds.' },
    agents: { control: 'object', description: 'The agents, and what Hemera cannot see of them.' },
  },
} satisfies Meta<typeof ContextView>

export default meta

type Story = StoryObj<typeof meta>

/** A Session that has been given its file and two deliveries, each with its date. */
export const ProvidedWithDeliveries: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Hemera provides')).toBeVisible()
    await expect(canvas.getByText('AGENTS.md')).toBeVisible()
    await expect(canvas.getByText('a41f8c2e, 9 128 bytes')).toBeVisible()
    // A delivery carries the moment it arrived: a context that came at a time is not a truth.
    await expect(canvas.getByText('21 Sep 23:02')).toBeVisible()
    await expect(canvas.getByText('Hemera consults')).toBeVisible()
    await expect(canvas.getByText('200 matches, 1 MiB')).toBeVisible()
  },
}

/** A Session nothing has gone into yet: the tools are there, and the first list is honest. */
export const Empty: Story = {
  args: { provided: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Nothing has gone in yet.')).toBeVisible()
    await expect(canvas.getByText('fs_read')).toBeVisible()
  },
}

/** A Session with no command in its catalogue: the tools are lent, and nothing else is. */
export const NoCommand: Story = {
  args: { commands: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The tools are lent whatever the catalogue holds; the catalogue itself shows no command
    // rather than inventing one to fill the gap.
    await expect(canvas.getByText('fs_read')).toBeVisible()
    await expect(canvas.queryByText('pnpm check')).toBeNull()
    await expect(canvas.queryByText('pnpm dev')).toBeNull()
  },
}

/** What Hemera does not control, said per agent and without pretending to read it. */
export const PersonalSourcesNotControlled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Hemera does not control')).toBeVisible()
    await expect(canvas.getByText(/its own instructions and plugins/)).toBeVisible()
    await userEvent.click(canvas.getByText('Hemera does not control'))
    await expect(canvas.getByText(/its configuration and skills are its own/)).toBeVisible()
  },
}
