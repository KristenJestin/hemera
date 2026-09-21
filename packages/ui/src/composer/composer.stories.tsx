import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { emulateReducedMotion } from '../../.storybook/reduced-motion.ts'
import { Composer, type ComposerProps } from './composer.tsx'

/**
 * The composer, complete (design D4b-02, D4-07).
 *
 * Three bands in one frame: the files attached above, the prompt input the caret lives in, and
 * what sending does below. The files are the Project's, read by the main process in the
 * application and by the story here; sending is the page's, and the page is what this story
 * plays — a sentence handed over, written, and the box let go of, or a write that failed and
 * the sentence still there.
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

/** Why a write can fail, in the words the profile is refused with. */
const NOT_SAVED = 'Nothing was written: the profile is read-only.'

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
  title: 'Blocks/Composer/Composer',
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
    onSend: fn(async (): Promise<string | null> => await Promise.resolve(null)),
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
    variant: {
      control: 'inline-radio',
      options: ['hero', 'inline'],
      description: 'The shape of the box: the Home greets with a hero, a Session sends inline.',
      table: { defaultValue: { summary: 'hero' } },
    },
    placeholder: { control: 'text' },
    onValueChange: { action: 'value changed' },
    onFilesChange: { action: 'files changed' },
    onWorkspaceChange: { action: 'workspace changed' },
    onSend: {
      action: 'sent',
      description: 'Writes the sentence; answers why it could not, or nothing when it did.',
    },
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

/** The other shape: the foot of a Session, where the box gives itself its own two lines. */
export const InASession: Story = {
  args: { variant: 'inline', action: 'Send', value: 'Ask Marie before turning this into a Spec' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox')).toHaveTextContent('Ask Marie')
    expect(canvas.getByRole('button', { name: /Send/ })).toBeEnabled()
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

/**
 * The clip where the application is behind it: one press, one window, and no list.
 *
 * The window is the system's, it opens over the whole machine, and what comes back from outside
 * the Workspace is the absolute path it has — the only name such a file has. A list opening
 * under the same press as the window was one gesture answering twice, and a file chosen from the
 * wrong folder used to be dropped in silence.
 */
export const AttachAnywhere: Story = {
  args: {
    onPickFiles: fn(
      async (): Promise<string[]> =>
        await Promise.resolve(['D:\\Perso\\serveur\\notes.md', 'sources/api/AGENTS.md']),
    ),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Attach a file' }))

    expect(args.onPickFiles).toHaveBeenCalledTimes(1)
    // No menu: the press opened the system's window and nothing else.
    expect(within(document.body).queryByRole('listbox')).toBeNull()

    // Both are attached, each named the way it can be named: the one outside the Workspace by
    // its own path, the one inside by the name the Project gives it. Waited for as they rise:
    // a colour read while a chip is still fading is two colours mixed with what is behind them,
    // and a contrast the accessibility pass is right to refuse.
    await waitFor(() => {
      const outside = canvas.getByTitle('D:\\Perso\\serveur\\notes.md')
      expect(outside).toHaveStyle({ opacity: '1' })
      expect(outside.parentElement).toHaveStyle({ opacity: '1' })
      expect(canvas.getByTitle('sources/api/AGENTS.md')).toBeInTheDocument()
    })
    // And the send leaves the quiet it was in while there was nothing to send.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Start chat/ })).toHaveStyle({ opacity: '1' })
    })

    // In the sentence, as the same chips, saying the file's name rather than the folders above
    // it — for a path of the Workspace and for one from anywhere else alike.
    const box = canvas.getByRole('textbox')
    const chips = box.querySelectorAll('[data-file]')
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveAttribute('data-kind', 'file')
    expect(chips[0]).toHaveTextContent('notes.md')
    expect(chips[1]).toHaveTextContent('AGENTS.md')
    expect(box).toHaveTextContent('notes.md')
  },
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

    await userEvent.click(canvas.getByRole('button', { name: 'Attach a file' }))
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

/**
 * Scenario « Message enregistré » of `specs/sessions/spec.md`.
 *
 * The send is the whole gesture: what is written is handed over, and once it has been written
 * the box lets it go — the sentence, and the files that went with it. A box that kept what it
 * had just sent would have to be cleared by every page that uses it, and one of them would
 * forget.
 */
export const Sends: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'Export the invoices with HT and TTC')
    await userEvent.click(canvas.getByRole('button', { name: /Start chat/ }))

    await waitFor(() => {
      expect(args.onSend).toHaveBeenCalledWith('Export the invoices with HT and TTC')
    })
    await waitFor(() => {
      expect(box.textContent).toBe('')
    })
    // Empty again, so the send is back to waiting for something to send, and nothing is said
    // under the frame: a write that went through has nothing to report.
    expect(canvas.getByRole('button', { name: /Start chat/ })).toBeDisabled()
    expect(canvas.queryByRole('alert')).toBeNull()
  },
}

/**
 * Scenario « Échec d'enregistrement » of `specs/sessions/spec.md`.
 *
 * A write that failed says so, and nothing is thrown away: the sentence stays exactly where it
 * was, because the one thing a hand must not have to do is type it again. A message is never
 * shown as kept when it was not.
 */
export const WriteRefused: Story = {
  args: {
    onSend: fn(async (): Promise<string | null> => await Promise.resolve(NOT_SAVED)),
  },
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    await userEvent.type(box, 'Start something')
    await userEvent.click(canvas.getByRole('button', { name: /Start chat/ }))

    await waitFor(() => {
      expect(canvas.getByRole('alert')).toHaveTextContent('read-only')
    })
    expect(box).toHaveTextContent('Start something')
    expect(args.onSend).toHaveBeenCalledWith('Start something')

    // The button comes back from the quiet it went into while the write was in flight, and the
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

      await userEvent.click(canvas.getByRole('button', { name: 'Attach a file' }))
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

/**
 * What the sentence says once the files are in it, which is what the message will carry.
 *
 * Two gestures, two words: the `@` menu writes a mention, `@path`, and the paperclip writes a file
 * handed over, `@"path"`. The double quote is not decoration — it is what the thread reads to draw
 * a file given to the Session as the file it is, and what keeps a path with a space in it in one
 * piece instead of ending it at the first space.
 */
export const WhatTheSentenceSays: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSend.mockClear()
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')

    // A file named in the question, written by the menu that names files.
    await userEvent.type(box, 'Look at @billing')
    const menu = await within(document.body).findByRole('listbox', {
      name: 'Files of the Project',
    })
    const options = await within(menu).findAllByRole('option')
    await userEvent.click(options[0]!)
    await waitFor(() => {
      expect(box.querySelector('[data-file]')).toBeInTheDocument()
    })
    const named = box.querySelector('[data-file]')?.getAttribute('data-file') ?? ''
    expect(named).not.toBe('')

    // A file picked with the paperclip: given to the Session, not named in it.
    await userEvent.click(canvas.getByRole('button', { name: 'Attach a file' }))
    const files = await within(document.body).findByRole('listbox', {
      name: 'Files of the Project',
    })
    await userEvent.click(await within(files).findByRole('option', { name: /invoice.entity/ }))
    await waitFor(() => {
      expect(box.querySelectorAll('[data-file]')).toHaveLength(2)
    })

    await userEvent.click(canvas.getByRole('button', { name: /Start chat/ }))
    await waitFor(() => {
      // The mention is written as the mention it is: the `@` menu's file carries no quote.
      expect(args.onSend).toHaveBeenCalledWith(expect.stringContaining(`@${named}`))
    })

    // The file the paperclip gave is written with one, which is what the thread reads to draw it
    // as a file handed over rather than as one more thing pointed at.
    expect(args.onSend).toHaveBeenCalledWith(
      expect.stringContaining('@"sources/api/src/invoices/invoice.entity.ts"'),
    )

    await menuGone()
  },
}
