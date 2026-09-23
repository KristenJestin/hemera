import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { DiffBlock } from '../activity/diff-block.tsx'
import { PermissionRequest } from './permission-request.tsx'

/**
 * The gate at the size of a thread.
 *
 * The card is drawn where it will be read: in a column, with the change it is guarding under it.
 */
const meta = {
  title: 'Blocks/Session/PermissionRequest',
  component: PermissionRequest,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    toolName: 'Edit',
    intent: 'Change the two lines that decide whether a stopped turn is written to the log.',
    options: [
      { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'always', kind: 'allow_always', name: 'Always allow edits' },
      { optionId: 'no', kind: 'reject_once', name: 'Reject once' },
    ],
    scope: 'this session',
    onDecide: fn(),
  },
  argTypes: {
    toolName: { control: 'text', description: 'The tool the agent wants to use.' },
    intent: { control: 'text', description: 'What the call would do, in one sentence.' },
    options: { control: 'object', description: 'What the agent offers; never invented here.' },
    scope: { control: 'text', description: 'How long an “always” answer is remembered.' },
    onDecide: { description: 'Called with the option the reader pressed, and with nothing else.' },
  },
} satisfies Meta<typeof PermissionRequest>

export default meta

type Story = StoryObj<typeof meta>

/** A change about to be made, with the parameters that decide the answer. */
export const AskForAnEdit: Story = {
  args: {
    parameters: [
      { label: 'file', value: 'packages/ui/src/session/stopped-turn.tsx' },
      { label: 'replace', value: 'one line' },
    ],
  },
}

/** The card carries the change of the file it is guarding, so the answer is given on the
 * evidence rather than on the agent's word. */
export const WithTheChange: Story = {
  args: {
    parameters: [{ label: 'file', value: 'packages/ui/src/session/plan-panel.tsx' }],
    diff: (
      <DiffBlock
        defaultOpen
        path="packages/ui/src/session/plan-panel.tsx"
        oldText={'if (turn.stopped) {\n  return null\n}\n'}
        newText={'if (turn.stopped) {\n  return <StoppedTurn reason={turn.reason} />\n}\n'}
      />
    ),
  },
}

/** Nothing is offered that the agent did not offer: two options, two buttons. */
export const NothingButACommand: Story = {
  args: {
    toolName: 'Bash',
    intent: 'Run the test suite of the design system once, without watching it.',
    command: 'pnpm --filter @hemera/ui test --run',
    options: [
      { optionId: '', kind: 'allow_once', name: '' },
      { optionId: 'no', kind: 'reject_once', name: '' },
    ],
    scope: undefined,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    // The agent sent no name, so the kind's own word is used rather than an empty button.
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reject once' })).toBeVisible()
    // No standing answer was offered, so nothing promises to remember one.
    await expect(canvas.queryByText(/remembered for/)).toBeNull()
    canvas.getByRole('button', { name: 'Allow once' }).click()
    await expect(args.onDecide).toHaveBeenCalledWith({
      optionId: '',
      kind: 'allow_once',
      name: '',
    })
  },
}

/** The options are ordered by the risk they carry, whatever order the agent sent them in. */
export const OrderedByRisk: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const buttons = canvas.getAllByRole('button')
    await expect(buttons[0]).toHaveTextContent('Reject once')
    await expect(buttons[1]).toHaveTextContent('Allow once')
    await expect(buttons[2]).toHaveTextContent('Always allow edits')
  },
}

/** The arrows walk the options and Enter presses the focused one — the whole decision, no mouse. */
export const AnsweredByKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const refusal = canvas.getByRole('button', { name: 'Reject once' })
    refusal.focus()
    await expect(refusal).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    const standing = canvas.getByRole('button', { name: 'Always allow edits' })
    await expect(standing).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    await expect(args.onDecide).toHaveBeenCalledWith({
      optionId: 'always',
      kind: 'allow_always',
      name: 'Always allow edits',
    })
  },
}

/** Escape takes the refusal, and the refusal only: it never answers with a permission. */
export const EscapeRefuses: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Allow once' }).focus()

    await userEvent.keyboard('{Escape}')
    await expect(args.onDecide).toHaveBeenCalledWith({
      optionId: 'no',
      kind: 'reject_once',
      name: 'Reject once',
    })
  },
}

/** An agent that never sent a refusal cannot be refused from here. */
export const NothingToRefuseWith: Story = {
  args: {
    options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow once' }],
    scope: undefined,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Allow once' }).focus()

    await userEvent.keyboard('{Escape}')
    await expect(args.onDecide).not.toHaveBeenCalled()
  },
}
