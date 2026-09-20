import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'
import { type ReactNode, useState } from 'react'

import { PROMPT_MAX_LINES } from './lines.ts'
import { PromptInput, type PromptInputProps } from './prompt-input.tsx'

/**
 * The box a message is written in inside a Session (design D4b-08).
 *
 * Two lines empty, eight at the most, and the browser doing the growing. Enter sends,
 * Shift+Enter breaks the line, and the Enter that accepts a candidate from an input method
 * does neither: that decision lives in `keystroke.ts` and the Home's composer reads the same
 * one, so there is one keyboard to learn and not two.
 *
 * The send morphs into a square while a message is being written to the engine. The square
 * stops nothing — nothing runs in this lot — and is disabled, which is what says so.
 */
const PAGE = 'mx-auto flex w-full max-w-2xl flex-col gap-4 p-6'

/** What the box says it holds is the page's; the story plays the page. */
function Controlled({ value, onValueChange, ...rest }: PromptInputProps): ReactNode {
  const [text, setText] = useState(value)
  return (
    <PromptInput
      {...rest}
      value={text}
      onValueChange={(next) => {
        setText(next)
        onValueChange(next)
      }}
    />
  )
}

/** Eight lines of something, which is where the box stops growing. */
const EIGHT = Array.from(
  { length: PROMPT_MAX_LINES },
  (_, line) => `Line ${String(line + 1)}`,
).join('\n')

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Prompt input',
  component: PromptInput,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className={PAGE}>
        <Story />
      </div>
    ),
  ],
  args: {
    value: '',
    sending: false,
    placeholder: 'Write in this Session…',
    onValueChange: fn(),
    onSend: fn(),
  },
  argTypes: {
    value: { control: 'text', description: 'What is written; the page holds it.' },
    sending: {
      control: 'boolean',
      description: 'Whether a send is in flight, which is what the arrow morphs into.',
    },
    placeholder: { control: 'text' },
    onValueChange: { action: 'value changed' },
    onSend: { action: 'sent' },
  },
} satisfies Meta<typeof PromptInput>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Empty, one line, and the eight it stops at. */
export const Variants: Story = {
  render: (args) => (
    <>
      <Controlled {...args} value="" />
      <Controlled {...args} value="Export the invoices with HT and TTC amounts per line." />
      <Controlled {...args} value={EIGHT} />
    </>
  ),
}

/** Empty: nothing to send, so the send says nothing and does nothing. */
export const States: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled()
  },
}

/** Eight lines: the box stands at its tallest and scrolls what is above rather than growing. */
export const EightLines: Story = {
  args: { value: EIGHT },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox')).toHaveAttribute('rows', String(PROMPT_MAX_LINES))
  },
}

/** In flight: the arrow is a square, and the square waits for lot 5 to give it something to stop. */
export const Sending: Story = {
  args: { value: 'Answer from Marie: every line.', sending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Sending' })).toBeDisabled()
  },
}

/** Scenario « Message enregistré » of the Spec · sessions: Enter is what sends. */
export const EnterSends: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'Ask Marie about the header block')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(args.onSend).toHaveBeenCalledWith('Ask Marie about the header block')
    })
  },
}

/** Shift+Enter breaks the line, which is what the hand expects of a box this shape. */
export const ShiftEnterBreaksTheLine: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'First line{Shift>}{Enter}{/Shift}second line')

    expect(box).toHaveValue('First line\nsecond line')
    // The break itself sent nothing, and the box grew by the one line it gained.
    expect(args.onSend).not.toHaveBeenCalled()
    expect(box).toHaveAttribute('rows', '2')
  },
}

/**
 * An Enter an input method owns sends nothing.
 *
 * Fired rather than typed: a keyboard driven from a test composes nothing, so the two things
 * that say an input method is holding the key — the standard's `isComposing` and the `229` a
 * browser sent before it existed — are put on the event by hand. That is the whole point: both
 * have to be answered, and only one of them is ever seen on any given machine.
 */
export const ComposingDoesNotSend: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'にほんご')
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })

    expect(args.onSend).not.toHaveBeenCalled()
    // And the word is still there to accept: nothing was thrown into the thread half-written.
    expect(box).toHaveValue('にほんご')
  },
}

/** Scenario « Brouillon non envoyé » of the Spec · sessions. */
export const DraftIsNotSent: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'Something I have not decided to say yet')

    // Written, and nowhere else: what is in the box is not a message until Enter says so.
    expect(args.onSend).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Send' })).toBeEnabled()
    })
  },
}
