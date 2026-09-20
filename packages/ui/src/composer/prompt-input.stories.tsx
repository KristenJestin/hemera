import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, within } from 'storybook/test'
import { useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { IconAt, IconPaperclip } from '../icons.ts'
import { ComposerBox, type ComposerBoxHandle } from './composer-box.tsx'
import { PromptInput, type PromptInputProps } from './prompt-input.tsx'

/**
 * The prompt input (design D4b-08).
 *
 * The shape of the box and the keys that end a sentence, and nothing else: the editable, what is
 * written, and what the send does all belong to the caller. These stories play the caller the
 * way the composer plays it, and assert the two things the surface owns — where the box starts
 * and where it stops, and what a key does.
 */
/** The floor of the hero shape and of the inline one, in pixels of the base size. */
const HERO_FLOOR = 96
const INLINE_FLOOR = 48

/** Where the box stops growing: eight lines of the base size, and past them it scrolls. */
const EIGHT_LINES = 160

/** Ten lines, each one broken by Shift+Enter, for the story that goes past the cap. */
const TEN_LINES = Array.from({ length: 10 }, (_, line) => `line ${line + 1}`).join(
  '{Shift>}{Enter}{/Shift}',
)

/**
 * Nothing is taken here: the mention menu is the composer's, and these stories have no menu to
 * open. What the box is handed reaches the surface one band up, which is what the keyboard story
 * is about.
 */
const nothingToTake = (): void => undefined

/**
 * The prompt input played the way the composer plays it.
 *
 * What is written belongs to the page, and the editable handed to the surface is the composer's
 * own `ComposerBox` — the surface neither knows nor cares what it was handed, and using the real
 * box is what makes the growth these stories assert the growth the application will get. The row
 * of controls is a slot, and it holds the two controls the composer puts there.
 */
function Played({ variant, onSend }: PromptInputProps) {
  const [value, setValue] = useState('')
  const handle = useRef<ComposerBoxHandle>(null)
  return (
    <PromptInput
      variant={variant}
      ready={value.trim() !== ''}
      onSend={() => {
        onSend()
        setValue('')
      }}
      tools={
        <>
          <IconButton
            variant="ghost"
            size="sm"
            icon={<IconAt size="sm" />}
            aria-label="Mention a file of the Project"
          />
          <IconButton
            variant="ghost"
            size="sm"
            icon={<IconPaperclip size="sm" />}
            aria-label="Attach a file"
          />
        </>
      }
    >
      <ComposerBox
        handle={handle}
        value={value}
        placeholder="Ask anything, think out loud, or describe what you want to do…"
        onValueChange={setValue}
        onKeyDown={nothingToTake}
      />
    </PromptInput>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/PromptInput',
  component: PromptInput,
  render: (args) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col p-6">
      <Played {...args} />
    </div>
  ),
  parameters: { layout: 'fullscreen' },
  args: {
    variant: 'hero',
    // Handed in by the story and not by the panel: the box is the composer's own, and whether
    // there is anything to send is read off what is in it.
    ready: true,
    children: null,
    onSend: fn(),
  },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['hero', 'inline'],
      description: 'The floor the box is given: the Home greets with a hero, a Session inline.',
      table: { defaultValue: { summary: 'hero' } },
    },
    onSend: {
      action: 'sent',
      description: 'What Enter does. The composer owns it; this surface only starts it.',
    },
    ready: {
      control: false,
      description: 'Whether there is anything to send: the story reads it off the box.',
      table: { disable: true },
    },
    tools: { control: false, description: 'The row of controls under the box.' },
    children: {
      control: false,
      description: 'The editable, which the story hands in.',
      table: { disable: true },
    },
  },
} satisfies Meta<typeof PromptInput>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** The two shapes side by side: the Home's greeting, and the foot of a Session. */
export const Variants: Story = {
  // The controls belong to the playground: this story decides this prop itself, and a panel
  // offering to change it would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <Played {...args} variant="hero" />
      <Played {...args} variant="inline" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [hero, inline] = within(canvasElement).getAllByRole('textbox')
    // A shape is a floor and not a height, which is the whole point: a box that only grew to its
    // greeting once something was written would make the page jump under the hand.
    expect(Math.round(hero!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(HERO_FLOOR)
    expect(Math.round(inline!.getBoundingClientRect().height)).toBeLessThan(HERO_FLOOR)
    expect(Math.round(inline!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(INLINE_FLOOR)
  },
}

/**
 * Empty, written into, and at the cap: what is written is a prompt and not a message yet, and
 * the box follows it from its floor to eight lines of the base size and stops there.
 *
 * The cap is the browser's own. A height measured and written from JavaScript would be a height
 * fighting the typing it was following, and past eight lines the sentence scrolls inside the box
 * rather than pushing the page down.
 */
export const States: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    expect(box).toHaveAttribute('data-empty', 'true')
    await userEvent.type(box, 'Export the invoices with HT and TTC')
    expect(box).toHaveAttribute('data-empty', 'false')
    expect(box).toHaveTextContent('Export the invoices with HT and TTC')

    await userEvent.type(box, `{Shift>}{Enter}{/Shift}${TEN_LINES}`)
    expect(Math.round(box.getBoundingClientRect().height)).toBeLessThanOrEqual(EIGHT_LINES)
    const row = box.parentElement
    expect(row?.scrollHeight ?? 0).toBeGreaterThan(row?.clientHeight ?? 0)
    // Nine breaks, and not one of them sent anything.
    expect(args.onSend).not.toHaveBeenCalled()
  },
}

/**
 * The keys of the box: Enter sends, Shift+Enter breaks the line, an IME mid-word is never
 * interrupted, and a control under the box is not a send.
 *
 * The Enter that commits a composition is a keystroke of the composition — the browser says so
 * on the event — and a box that sent on it would send half a word and leave the other half in a
 * box that no longer has it.
 */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'First line{Shift>}{Enter}{/Shift}second line')
    expect(box.textContent).toBe('First line\nsecond line')
    expect(args.onSend).not.toHaveBeenCalled()

    await userEvent.type(box, 'こんにちは')
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(args.onSend).not.toHaveBeenCalled()
    expect(box).toHaveTextContent('こんにちは')

    // The row under the box is a sibling of it, and Enter on one of its controls stays on it.
    canvas.getByRole('button', { name: 'Attach a file' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(args.onSend).not.toHaveBeenCalled()
    expect(box).toHaveTextContent('こんにちは')

    // And the plain Enter is the send it always was, once and once only.
    await userEvent.click(box)
    await userEvent.keyboard('{Enter}')
    expect(args.onSend).toHaveBeenCalledTimes(1)

    // There is nothing to send any more, so Enter is left to the browser.
    await userEvent.keyboard('{Enter}')
    expect(args.onSend).toHaveBeenCalledTimes(1)
  },
}

/**
 * What is pasted is the text, and nothing else.
 *
 * A copy taken inside the application carries the surfaces it was copied from, and a sentence
 * pasted from the thread arrived in the box wearing their chips, their colours and their boxes —
 * a message written about the application is a message, not a picture of one. The plain half of
 * the clipboard is what a sentence is, and it is the half every other application writes too.
 */
export const Pasted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    const clipboard = new DataTransfer()
    clipboard.setData('text/plain', 'Export the invoices @context/invoices.md')
    clipboard.setData(
      'text/html',
      '<span class="bg-primary-muted rounded-sm border border-current/20">@context/invoices.md</span>',
    )
    // Dispatched as the browser dispatches it: a real clipboard, and the event carrying it.
    // `fireEvent.paste` builds an event whose `clipboardData` the browser refuses to overwrite,
    // and a paste that arrives empty tests nothing at all.
    box.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }),
    )

    expect(box.textContent).toBe('Export the invoices @context/invoices.md')
    // Nothing of what it was drawn with came along with it.
    expect(box.querySelector('span, b, i, a')).toBeNull()
  },
}
