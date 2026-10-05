import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { NeedCard } from './need-card.tsx'

/**
 * A need, the same card wherever it is met: Home's Needs you unfolded, the top of a mission, behind
 * a notification. One story per kind and per state; what cannot be chosen is not drawn.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Needs you/Need card',
  component: NeedCard,
  args: {
    title: 'Read the deploy host from the SSH configuration',
    text: 'I need the staging host to write the deploy step of the api.',
    missionKey: 'ACME-12',
    when: '4 min',
    role: 'builder',
    ask: {
      kind: 'permission',
      command: 'cat ~/.ssh/config',
      agentReason: 'The deploy step needs the staging host and its user.',
      hemeraReason: 'Outside the Workspace: ~/.ssh/config',
      choices: ['allow-once', 'allow-for-mission', 'deny'],
    },
    onOpenMission: fn(),
    onPermission: fn(),
    onChoose: fn(),
    onWrite: fn(),
    onApply: fn(),
    onLook: fn(),
    onRetry: fn(),
    onSettings: fn(),
    onDiscuss: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NeedCard>

export default meta
type Story = StoryObj<typeof meta>

/** A call outside the Workspace: Allow once, Allow for this mission, Deny. */
export const Permission: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Allow once' }))
    await expect(args.onPermission).toHaveBeenCalledWith('allow-once')
    await expect(canvas.getByRole('button', { name: 'Allow for this mission' })).toBeVisible()
  },
}

/** A sensitive place: Allow for this mission is not offered. */
export const PermissionSensitive: Story = {
  args: {
    ask: {
      kind: 'permission',
      command: 'cat .env',
      agentReason: 'The api reads its database URL from it.',
      hemeraReason: 'Sensitive place: .env',
      choices: ['allow-once', 'deny'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Allow for this mission' })).toBeNull()
  },
}

/** A Chat's call, which no mission owns: Allow once and Deny only, no mission key. */
export const PermissionOutsideMission: Story = {
  args: {
    missionKey: undefined,
    role: 'chat',
    title: 'Run the api’s migrations against the shared database',
    text: 'The Chat asked me to check the schema after the migration.',
    ask: {
      kind: 'permission',
      command: 'pnpm --filter api db:migrate',
      agentReason: 'To see the schema the migration leaves.',
      hemeraReason: 'Risk 2.9',
      choices: ['allow-once', 'deny'],
    },
  },
}

/** A decision: the options as buttons, the recommended one primary and marked. */
export const Decision: Story = {
  args: {
    title: 'Which table holds the invoices?',
    text: 'Both tables exist in the api and in shared; the Spec names neither.',
    ask: {
      kind: 'decision',
      options: [
        { label: 'invoices', recommended: 'the api already reads it' },
        { label: 'billing_invoices' },
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Your own answer' }), 'both, by date')
    await userEvent.click(canvas.getByRole('button', { name: 'Answer' }))
    await expect(args.onWrite).toHaveBeenCalledWith('both, by date')
  },
}

/** While the mission is in Planning, a need can be discussed too. */
export const DecisionInPlanning: Story = {
  args: { ...Decision.args, planning: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Discuss' })).toBeVisible()
  },
}

/** An error after three red attempts: what was tried, what is proposed. */
export const Error: Story = {
  args: {
    title: 'The shared package does not build',
    text: undefined,
    role: 'builder',
    ask: {
      kind: 'error',
      attempts: [
        { what: 'Built shared', output: 'error TS2307: Cannot find module "./money"' },
        {
          what: 'Restored money.ts from the base',
          output: 'error TS2307: Cannot find module "./money"',
        },
        {
          what: 'Rebuilt with a clean cache',
          output: 'error TS2307: Cannot find module "./money"',
        },
      ],
      proposed: 'Move the money helpers back into shared/src and point the api at them.',
    },
  },
}

/** Something missing outside Hemera: its action first. */
export const Environment: Story = {
  args: {
    title: 'Docker is not running',
    text: 'The api’s tests start their database in a container.',
    role: undefined,
    ask: { kind: 'environment' },
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}

/** What is missing is a setting: the need opens its section. */
export const EnvironmentInSettings: Story = {
  args: {
    title: 'The model of the builder is no longer offered',
    text: undefined,
    role: undefined,
    ask: { kind: 'environment', settings: 'Models' },
  },
}

/** On the mission's own page the card does not name the mission again. */
export const OnItsMission: Story = {
  args: { missionKey: undefined },
}

/** Answered: one faint line. */
export const Applied: Story = {
  args: { status: { state: 'applied', answer: 'Allowed once' } },
}

/** Expired, with its reason. */
export const Expired: Story = {
  args: { status: { state: 'expired', reason: 'the situation changed since you allowed it' } },
}

/** Long text in every field. */
export const LongText: Story = {
  args: {
    title:
      'Read the deploy host from the SSH configuration of the machine that runs the staging deployment of the api and the web',
    text: 'I need the staging host to write the deploy step of the api. The Spec says the deploy goes through the same host as the web, and the only place that names it is the SSH configuration, which lives outside the Workspace. Nothing else in the repositories names it.',
    role: 'builder',
    ask: {
      kind: 'permission',
      command:
        'ssh -G staging-acme-api-and-web.internal | grep -E "^(hostname|user|port|identityfile) " --color=never',
      agentReason:
        'The deploy step needs the staging host, its user, its port and the key it is reached with.',
      hemeraReason: 'Outside the Workspace: ~/.ssh/config',
      choices: ['allow-once', 'allow-for-mission', 'deny'],
    },
  },
}

/** The keyboard path: the glyph's legend, the mission, then the actions in order. */
export const KeyboardPath: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await expect(canvas.getByRole('img', { name: 'Permission' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'ACME-12' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Allow for this mission' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Deny' })).toHaveFocus()
  },
}
