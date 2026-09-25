import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { BuildChecks, type BuildChecksProps } from './build-checks.tsx'
import { CHECKS, COMMANDS, PROPOSED, REPOSITORIES } from './check-fixtures.ts'
import type { CheckLine } from './model.ts'

/**
 * The checks of a Project's build, the Build section of its settings (D10-06): what Hemera runs
 * to judge the agent's work, where and when. Empty, a build's every task is done, not verified;
 * a Project with typed commands and no check is proposed some from their types, and nothing is
 * saved until the user uses them (scenario "Defaults come from the catalogue"). The story holds
 * what is saved, as the engine would.
 */
function Held({ checks, onAdd, onUpdate, onRemove, onAcceptProposed, ...rest }: BuildChecksProps) {
  const [saved, setSaved] = useState<readonly CheckLine[]>(checks)
  return (
    <div className="mx-auto flex max-w-4xl flex-col p-6">
      <BuildChecks
        {...rest}
        checks={saved}
        onAdd={async (check) => {
          await onAdd(check)
          setSaved((now) => [...now, check])
          return null
        }}
        onUpdate={async (check) => {
          await onUpdate(check)
          setSaved((now) => now.map((one) => (one.id === check.id ? check : one)))
          return null
        }}
        onRemove={(id) => {
          onRemove(id)
          setSaved((now) => now.filter((one) => one.id !== id))
        }}
        onAcceptProposed={async (proposals) => {
          await onAcceptProposed(proposals)
          setSaved(proposals)
          return null
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Build/BuildChecks',
  component: BuildChecks,
  render: (args) => <Held {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    checks: CHECKS,
    proposed: [],
    commands: COMMANDS,
    repositories: REPOSITORIES,
    onAdd: fn(async () => await Promise.resolve(null)),
    onUpdate: fn(async () => await Promise.resolve(null)),
    onRemove: fn(),
    onAcceptProposed: fn(async () => await Promise.resolve(null)),
    onDiscardProposed: fn(),
  },
  argTypes: {
    checks: { control: 'object', description: 'The checks the Project saved.' },
    proposed: { control: 'object', description: 'The checks the catalogue’s types propose.' },
    commands: { control: 'object', description: 'The catalogue a check runs a command of.' },
    repositories: { control: 'object', description: 'The repositories a check may run in.' },
    onAdd: { action: 'added' },
    onUpdate: { action: 'updated' },
    onRemove: { action: 'removed' },
    onAcceptProposed: { action: 'proposals used' },
    onDiscardProposed: { action: 'proposals discarded' },
  },
} satisfies Meta<typeof BuildChecks>

export default meta

type Story = StoryObj<typeof meta>

/** The row of the check of the name given, found by its pencil. */
function rowOf(canvasElement: HTMLElement, name: string) {
  const pencil = within(canvasElement).getByRole('button', { name: `Edit ${name}` })
  return within(pencil.closest('li')!)
}

/**
 * The checks of Atlas: a type check and a lint after each task in each repository the task
 * changed, a coverage minimum on the front after each story, the e2e the task wrote, the build at
 * the end.
 */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      within(canvas.getByRole('list', { name: 'Checks' })).getAllByRole('listitem'),
    ).toHaveLength(5)
    const coverage = rowOf(canvasElement, 'coverage')
    await expect(coverage.getByText('front')).toBeVisible()
    await expect(coverage.getByText('After each story')).toBeVisible()
    await expect(coverage.getByText('at least 70')).toBeVisible()
    const written = rowOf(canvasElement, 'e2e written')
    await expect(written.getByText('Workspace root')).toBeVisible()
    await expect(written.getByText('{files} · e2e/**/*.e2e.ts')).toBeVisible()
    await expect(rowOf(canvasElement, 'build').getByText('Where the command runs')).toBeVisible()
  },
}

/** No check, nothing proposed: every task of a build is done, not verified, and the card says so. */
export const Empty: Story = {
  args: { checks: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/every task of a build is done, not verified/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add check' })).toBeVisible()
  },
}

/**
 * Proposed from the catalogue's types: shown as proposals, nothing saved, "Use these checks" and
 * "Discard" under them.
 */
export const Proposed: Story = {
  args: { checks: [], proposed: PROPOSED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const proposals = within(canvas.getByRole('region', { name: 'Proposed checks' }))
    await expect(
      proposals.getByText('Nothing is saved until you use them.', { exact: false }),
    ).toBeVisible()
    await expect(proposals.getAllByRole('listitem')).toHaveLength(5)
    await expect(args.onAdd).not.toHaveBeenCalled()
    await expect(args.onAcceptProposed).not.toHaveBeenCalled()
  },
}

/**
 * A proposal edited and one left out, then used: what is saved is the proposals as they stand,
 * and the list shows them saved.
 */
export const ProposalsUsed: Story = {
  args: { checks: [], proposed: PROPOSED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Leave out e2e' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Edit test' }))
    const inside = within(await waitFor(() => within(document.body).getByRole('dialog')))
    await waitFor(() => expect(inside.getByRole('heading', { name: 'Edit check' })).toBeVisible())
    await userEvent.click(inside.getByLabelText('When'))
    await userEvent.click(await within(document.body).findByRole('option', { name: 'At the end' }))
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await expect(args.onUpdate).not.toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Use these checks' }))
    await expect(args.onAcceptProposed).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'test', when: 'end' })]),
    )
    const saved = within(await canvas.findByRole('list', { name: 'Checks' }))
    await expect(saved.getAllByRole('listitem')).toHaveLength(4)
  },
}

/** Discarded: nothing saved, and the card says no check is set. */
export const ProposalsDiscarded: Story = {
  args: { checks: [], proposed: PROPOSED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Discard' }))
    await expect(args.onDiscardProposed).toHaveBeenCalled()
    await expect(canvas.getByText(/every task of a build is done, not verified/)).toBeVisible()
  },
}

/** A check added in its dialog: a line of the user's, and the list shows it at the root. */
export const Adding: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add check' }))
    const inside = within(await waitFor(() => within(document.body).getByRole('dialog')))
    await waitFor(() => expect(inside.getByRole('heading', { name: 'Add check' })).toBeVisible())
    await userEvent.type(inside.getByRole('textbox', { name: 'Name' }), 'smoke')
    await userEvent.click(inside.getByLabelText('Runs'))
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'A line of yours' }),
    )
    await userEvent.type(inside.getByRole('textbox', { name: 'Line' }), 'pnpm smoke')
    await userEvent.click(inside.getByRole('button', { name: 'Add check' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await expect(args.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'smoke', line: 'pnpm smoke', commandId: null }),
    )
    await expect(rowOf(canvasElement, 'smoke').getByText('Workspace root')).toBeVisible()
  },
}

/** The keyboard: a row's pencil opens its dialog, and Escape gives the focus back to it. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pencil = canvas.getByRole('button', { name: 'Edit coverage' })
    pencil.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(within(document.body).getByRole('dialog')).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await expect(pencil).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Remove coverage' })).toHaveFocus()
  },
}
