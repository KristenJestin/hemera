import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { emulateReducedMotion } from '../../.storybook/reduced-motion.ts'
import { Composer, type ComposerProps } from './composer.tsx'

/**
 * The composer, complete and live (design D4-07, D4-08).
 *
 * Three bands in one frame: the files attached above, the box the caret lives in, and what
 * sending does below. The files are the Project's, read by the main process in the application
 * and by the story here. Sending used to be refused, and the refusal named the ticket that
 * would carry it; that ticket is this lot, so `Start chat` hands the text over and the page
 * decides what to do with it.
 */
/**
 * A Project's folder as it really looks, so the list is answered the way the application will
 * answer it (design D4-09).
 *
 * Four files was enough to draw the menu and not enough to use it: everything matched
 * everything, so nothing the story typed ever narrowed anything. This is a tree deep enough
 * that a query has to do some work — several `index.ts`, several `AGENTS.md`, names that share
 * a prefix — which is the only way the filtering, the ordering and the bound on the list are
 * exercised at all.
 */
const TREE = [
  'AGENTS.md',
  'README.md',
  'package.json',
  'docs/decisions/2026-09-15.md',
  'docs/decisions/2026-09-16.md',
  'docs/product/core.md',
  'sources/api/AGENTS.md',
  'sources/api/package.json',
  'sources/api/src/index.ts',
  'sources/api/src/invoices/export.service.ts',
  'sources/api/src/invoices/export.service.spec.ts',
  'sources/api/src/invoices/invoice.entity.ts',
  'sources/api/src/invoices/index.ts',
  'sources/api/src/billing/billing.service.ts',
  'sources/front/AGENTS.md',
  'sources/front/src/index.ts',
  'sources/front/src/pages/billing.tsx',
  'sources/front/src/pages/invoices.tsx',
  'sources/front/src/components/invoice-row.tsx',
]

/** How many the menu will show at once, which is the main process's own bound (design D4-09). */
const SHOWN = 20

/**
 * What the main process does, done here: match the query anywhere in the path, case-blind, and
 * hand back no more than the menu will read.
 */
function lookUp(query: string): string[] {
  const asked = query.trim().toLowerCase()
  if (asked === '') return TREE.slice(0, SHOWN)
  return TREE.filter((file) => file.toLowerCase().includes(asked)).slice(0, SHOWN)
}

/**
 * What the page answers a send with: nothing to say.
 *
 * `onSend` answers the words a refusal would be shown in, and `null` when there are none. A
 * Session takes the message and keeps it, so there are none.
 */
const ACCEPTED = null

/**
 * The composer holds nothing: what is written and what is attached belong to the page. The
 * story plays that page, so every control of the panel is a real prop of the component.
 */
function Controlled({ value, files, onValueChange, onFilesChange, ...rest }: ComposerProps) {
  const [text, setText] = useState(value)
  const [attached, setAttached] = useState(files)
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Composer
        {...rest}
        value={text}
        onValueChange={(next) => {
          setText(next)
          onValueChange(next)
        }}
        files={attached}
        onFilesChange={(next) => {
          setAttached(next)
          onFilesChange(next)
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Composer',
  component: Composer,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    value: '',
    files: [],
    workspaces: ['main'],
    action: 'Start chat',
    placeholder: 'Ask anything, think out loud, or describe what you want to do…',
    onValueChange: fn(),
    onFilesChange: fn(),
    onWorkspaceChange: fn(),
    onSearchFiles: fn(async (query: string) => await Promise.resolve(lookUp(query))),
    onSend: fn(async (_text: string) => await Promise.resolve(ACCEPTED)),
  },
  argTypes: {
    value: { control: 'text', description: 'What is written; the page holds it.' },
    files: { control: 'object', description: 'The files attached, as paths of the Workspace.' },
    workspaces: { control: 'object', description: 'The Workspaces on offer; lot 4 has one.' },
    action: {
      control: 'text',
      description: 'The word on the button that sends.',
      table: { defaultValue: { summary: 'Start chat' } },
    },
    placeholder: { control: 'text' },
    onValueChange: { action: 'value changed' },
    onFilesChange: { action: 'files changed' },
    onWorkspaceChange: { action: 'workspace changed' },
    onSend: { action: 'sent' },
    onSearchFiles: { control: false, description: 'Asks the Project for the files that match.' },
  },
} satisfies Meta<typeof Composer>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Empty: the send waits for something to send, and `New Spec` says which lot brings it. */
export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /Start chat/ })).toBeDisabled()
    expect(canvas.getByRole('button', { name: /New Spec/ })).toBeDisabled()
    // The Workspace is a real choice, drawn as one.
    expect(canvas.getByRole('combobox', { name: 'Workspace' })).toHaveTextContent('main')
    // Nothing is attached, so the header is not there at all.
    expect(canvas.queryByText('Attached')).toBeNull()
  },
}

/** Typed into: the send comes alive, and what is written stays what was written. */
export const States: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'Export the invoices with HT and TTC')
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Start chat/ })).toBeEnabled()
    })
    expect(box).toHaveTextContent('Export the invoices with HT and TTC')
  },
}

/**
 * Waits for the menu to be gone, not merely told to go.
 *
 * A popup on its way out still has Base UI's focus guards in the page, and a guard is a
 * focusable node inside something marked hidden — which is a violation the accessibility pass
 * is right to report. Every story that chooses from the menu waits it out before it ends.
 */
async function menuGone() {
  await waitFor(() => {
    expect(
      within(document.body).queryByRole('listbox', { name: 'Files of the Project' }),
    ).toBeNull()
  })
}

/** Scenario « Mention d'un fichier » of `specs/shell-navigation/spec.md`. */
export const MentionAFile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'Look at @pages/billing')
    const menu = await within(document.body).findByRole('listbox', {
      name: 'Files of the Project',
    })
    // Only what matches is offered, and the typing that opened the menu never stopped. Waited
    // for: every character asks the folder again, so the menu is open with the answer to an
    // earlier one for as long as the last answer is still coming.
    await waitFor(() => {
      expect(within(menu).getAllByRole('option')).toHaveLength(1)
    })
    expect(document.activeElement).toBe(box)

    await userEvent.click(within(menu).getByRole('option', { name: /billing/ }))

    // The mention is written into the sentence, in place of the `@…` that asked for it, and
    // the header stays empty: a file named in a question is not a file sent with it.
    // The chip stands where the `@…` was, carrying the path it stands for, and the header
    // stays empty: a file named in a question is not a file sent with it.
    await waitFor(() => {
      expect(box.querySelector('[data-file]')).toHaveAttribute(
        'data-file',
        'sources/front/src/pages/billing.tsx',
      )
    })
    // Each chip carries the mark of what it is, so the two are told apart without anyone
    // having to compare two shades of the same shape.
    expect(box).toHaveTextContent('Look at billing.tsx')
    const mention = box.querySelector('[data-file]')
    expect(mention).toHaveAttribute('data-kind', 'mention')
    expect(mention?.querySelector('svg')).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: 'Clear' })).toBeNull()

    await menuGone()
  },
}

/** The mention lands where the caret is, and not at the end of whatever is already written. */
export const MentionAtTheCaret: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'Compare with the spec')
    // Walked back to just after "with" with the keys rather than by handing the box a
    // selection: a selection set alongside typing races the caret the component itself moves.
    await userEvent.keyboard('{ArrowLeft>9/}')
    await userEvent.type(box, '@invoice-row', { skipClick: true })
    const menu = await within(document.body).findByRole('listbox', {
      name: 'Files of the Project',
    })
    await userEvent.click(within(menu).getByRole('option', { name: /invoice-row/ }))

    await waitFor(() => {
      expect(box.querySelector('[data-file]')).toBeInTheDocument()
    })
    // In the middle of the sentence, where the caret was, and not after "spec". Asked of the
    // nodes on either side of the chip rather than of the text: the space around a chip is
    // drawn, not written, so the sentence reads as one and serialises without it.
    const chip = box.querySelector('[data-file]')
    expect(chip?.previousSibling?.textContent).toBe('Compare with')
    expect(box.textContent).toMatch(/the spec$/)

    await menuGone()
  },
}

/** The paperclip reaches the same files and sends them along, which is what the header holds. */
export const AttachAFile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Attach a file of the Project' }))
    const menu = await within(document.body).findByRole('listbox', {
      name: 'Files of the Project',
    })
    await userEvent.click(within(menu).getByRole('option', { name: /invoice.entity/ }))

    const attached = 'sources/api/src/invoices/invoice.entity.ts'

    // In the header, which is what is sent along with the message. The band and the chip rise
    // separately and the story waits for both: a colour read while either is still fading is
    // two colours mixed with what is behind them, and a contrast the accessibility pass is
    // right to refuse.
    await waitFor(() => {
      const chip = canvas.getByTitle(attached)
      expect(chip).toHaveStyle({ opacity: '1' })
      expect(chip.parentElement).toHaveStyle({ opacity: '1' })
    })
    // And in the sentence, as the same chip a mention leaves: one gesture, read as one.
    const chip = canvas.getByRole('textbox').querySelector('[data-file]')
    expect(chip).toHaveAttribute('data-file', attached)
    // Written as its name alone and in the header's own colour: one file, one look, wherever
    // it appears.
    expect(chip).toHaveAttribute('data-kind', 'file')
    expect(chip).toHaveTextContent('invoice.entity.ts')
    expect(chip?.querySelector('svg')).toBeInTheDocument()

    // The send comes out of the quiet it was in while there was nothing to send, and the story
    // waits for it: a colour read halfway through a fade is a contrast axe refuses.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Start chat/ })).toHaveStyle({ opacity: '1' })
    })

    await menuGone()
  },
}

/** The menu answers the arrows and Enter without ever taking the caret out of the box. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'See @sources')
    const menu = await within(document.body).findByRole('listbox', {
      name: 'Files of the Project',
    })
    await waitFor(() => {
      expect(within(menu).getAllByRole('option').length).toBeGreaterThan(1)
    })

    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(within(menu).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    })

    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(box.querySelector('[data-file]')).toHaveAttribute(
        'data-file',
        'sources/api/package.json',
      )
    })
    expect(document.activeElement).toBe(box)

    await menuGone()
  },
}

/** Shift+Enter breaks the line, which is what the hand expects of a box this shape. */
export const ShiftEnterBreaksTheLine: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'First line{Shift>}{Enter}{/Shift}second line')
    expect(box.textContent).toBe('First line\nsecond line')
    // Nothing was sent by the break itself.
    expect(args.onSend).not.toHaveBeenCalled()
  },
}

/** A chip taken back: the header goes with the last of them, and nothing is left behind. */
export const Attachments: Story = {
  args: { files: ['sources/api/AGENTS.md'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('AGENTS.md')).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Clear' })).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Remove sources/api/AGENTS.md' }))
    // The band goes with the last chip, and the frame closes over it rather than jumping.
    await waitFor(() => {
      expect(canvas.queryByText('AGENTS.md')).toBeNull()
    })
    expect(canvas.queryByRole('button', { name: 'Clear' })).toBeNull()
  },
}

/** Scenario « Message enregistré » of the Spec · sessions: `Start chat` writes, and refuses nothing. */
export const StartChatSends: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'Start something')
    await userEvent.click(canvas.getByRole('button', { name: /Start chat/ }))

    await waitFor(() => {
      expect(args.onSend).toHaveBeenCalledWith('Start something')
    })
    // Nothing is refused any more: the panel says nothing at all when the send went through.
    expect(canvas.queryByRole('alert')).toBeNull()
    // And the text is the page's to clear, once it knows the message was kept.
    expect(box).toHaveTextContent('Start something')

    // The button comes back from the quiet it went into while the send was in flight, and the
    // story waits for it: a colour read halfway through a fade is a contrast axe refuses.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Start chat/ })).toHaveStyle({ opacity: '1' })
    })
  },
}

/** Scenario « Mouvement réduit » of `specs/shell-navigation/spec.md`. */
export const ReducedMotion: Story = {
  play: async ({ canvasElement }) => {
    const restore = await emulateReducedMotion()
    try {
      const canvas = within(canvasElement)

      await userEvent.click(canvas.getByRole('button', { name: 'Attach a file of the Project' }))
      const menu = await within(document.body).findByRole('listbox', {
        name: 'Files of the Project',
      })
      await userEvent.click(within(menu).getAllByRole('option')[0]!)

      // In their end state, with nothing in between: the chip is opaque and in place the
      // moment it exists.
      await waitFor(() => {
        const chip = canvas.getByTitle('AGENTS.md')
        expect(chip).toHaveStyle({ opacity: '1', transform: 'none' })
        expect(chip.parentElement).toHaveStyle({ opacity: '1', transform: 'none' })
      })
      // The send leaves the quiet it was in the same way, which is to say at once.
      await waitFor(() => {
        expect(canvas.getByRole('button', { name: /Start chat/ })).toHaveStyle({ opacity: '1' })
      })

      await menuGone()
    } finally {
      await restore?.()
    }
  },
}
