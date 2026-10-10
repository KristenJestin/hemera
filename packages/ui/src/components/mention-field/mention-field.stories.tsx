import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { badgesOffBaseline, keepsItsLines } from './badge-baseline.ts'
import { FOUND_FILES, MENTIONABLES } from './mention-field-fixtures.ts'
import {
  loadMentionEditor,
  type Mentionable,
  MentionField,
  MentionFieldSkeleton,
} from './mention-field.tsx'

/**
 * The mention field: the Chat's composer, Discuss, an answer, a Review remark, the first field of
 * a mission. It never changes height; `@` opens a menu at the caret — files, missions, commands,
 * the recent ones first, a fuzzy search — walked with Up and Down, picked with Enter or Tab, put
 * away with Escape, and the caret never leaves the field.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/MentionField',
  component: MentionField,
  parameters: { layout: 'fullscreen' },
  // The editor arrives before the story draws, as a page that knows it shows a field asks for it.
  loaders: [async () => ({ editor: await loadMentionEditor() })],
  args: {
    label: 'Message',
    placeholder: 'Ask anything… @ a file, a mission, a command',
    mentionables: MENTIONABLES,
    value: '',
    onValueChange: fn(),
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return (
      <MentionField
        {...args}
        value={value}
        onValueChange={(next, mentions) => {
          setValue(next)
          args.onValueChange(next, mentions)
        }}
      />
    )
  },
  decorators: [
    (Story) => (
      <div className="mx-auto flex min-h-screen w-full max-w-measure flex-col justify-end p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MentionField>

export default meta
type Story = StoryObj<typeof meta>

const field = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('textbox', { name: 'Message' })
const menu = () => within(document.body)

/**
 * An element of the menu once the menu is drawn: the popup is in the document a frame before it
 * is visible, so being found is not being shown. It is asked for again at each try, as the menu
 * is drawn anew while the typing is read.
 */
const shown = (find: () => HTMLElement) => waitFor(() => expect(find()).toBeVisible(), LOADED)

/** The menu follows typing a key at a time: on a busy runner it is given the time that takes. */
const LOADED = { timeout: 5000 }

/**
 * Typing as a hand types, a key at a time: the editor reads each key's change before the next
 * one, which the simulated keyboard otherwise outruns in an editable area.
 */
const typeIn = async (box: HTMLElement | null, text: string) => {
  if (box !== null) await userEvent.click(box)
  // One key after the other, never at once: the order is the point.
  await [...text].reduce<Promise<void>>(
    (before, key) =>
      before.then(async () => {
        await userEvent.keyboard(key)
      }),
    Promise.resolve(),
  )
}

export const Empty: Story = {}

/** `@` alone: the recent ones first, then the rest. */
export const Menu: Story = {
  play: async ({ canvasElement }) => {
    const box = field(canvasElement).closest('[data-field-box]')
    const height = box?.getBoundingClientRect().height
    await typeIn(field(canvasElement), 'Look at @')
    const options = await menu().findAllByRole('option', {}, LOADED)
    await expect(options[0]).toHaveTextContent('server.ts')
    await expect(options[1]).toHaveTextContent('ACME-12')
    await expect(options[2]).toHaveTextContent('test')
    await expect(box?.getBoundingClientRect().height).toBe(height)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(menu().queryByRole('listbox')).toBeNull())
    await expect(box?.getBoundingClientRect().height).toBe(height)
  },
}

/** A fuzzy search: `srvts` finds `api/src/server.ts`. */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    await typeIn(field(canvasElement), '@srvts')
    const [first] = await menu().findAllByRole('option', {}, LOADED)
    await expect(first).toHaveTextContent('server.ts')
  },
}

const INVOICES = { kind: 'file', id: 'f3', label: 'web/src/pages/invoices/list.tsx' }

/**
 * The keyboard path: Down and Enter put the mention in the text; Tab does the same; Escape puts
 * the menu away; the caret is in the field the whole time.
 */
export const Mentioning: Story = {
  play: async ({ args, canvasElement }) => {
    const box = field(canvasElement)
    await typeIn(box, 'See @inv')
    await menu().findAllByRole('option', {}, LOADED)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(args.onValueChange).toHaveBeenLastCalledWith(
      'See @web/src/pages/invoices/list.tsx ',
      [INVOICES],
    )
    await expect(box).toHaveFocus()
    await typeIn(null, 'and @lint')
    await menu().findByRole('option', { name: /lint/ }, LOADED)
    await userEvent.keyboard('{Tab}')
    await expect(args.onValueChange).toHaveBeenLastCalledWith(
      'See @web/src/pages/invoices/list.tsx and @lint ',
      [INVOICES, { kind: 'command', id: 'c2', label: 'lint' }],
    )
    await expect(box).toHaveFocus()
    await typeIn(null, ' @ACME')
    await menu().findAllByRole('option', {}, LOADED)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(menu().queryByRole('listbox')).toBeNull())
    await expect(box).toHaveFocus()
  },
}

/** Missions and commands: each with its glyph and what it is in a quiet line. */
export const MissionsAndCommands: Story = {
  play: async ({ canvasElement }) => {
    await typeIn(field(canvasElement), '@acme')
    await shown(() => menu().getByRole('option', { name: /ACME-14/ }))
  },
}

/** Nothing matches: said in the menu, which stays where it opened. */
export const NoMatch: Story = {
  play: async ({ canvasElement }) => {
    await typeIn(field(canvasElement), '@zzzz')
    await shown(() => menu().getByText('Nothing matches “zzzz”'))
  },
}

/** A long path: its file name whole, its folder cut. */
export const LongPath: Story = {
  play: async ({ canvasElement }) => {
    await typeIn(field(canvasElement), '@columns')
    await shown(() => menu().getByRole('option', { name: /choose-columns-and-format\.tsx/ }))
  },
}

/** Mentions already written: badges, a file by its name, its path in the tooltip. */
export const Badges: Story = {
  args: { value: 'Compare @api/src/server.ts with @ACME-12 then run @test' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const file = canvas.getByRole('button', { name: 'api/src/server.ts' })
    await expect(file).toHaveTextContent('server.ts')
    await expect(file).not.toHaveTextContent('api/src')
    await expect(canvas.getByRole('button', { name: 'ACME-12' })).toBeVisible()
    const line = field(canvasElement).querySelector('p')
    if (line === null) throw new Error('no line')
    await expect(badgesOffBaseline(line)).toEqual([])
    await expect(keepsItsLines(line)).toBe(true)
  },
}

/**
 * Badges in a text of several lines, wrapped and broken: each name on its line's baseline, and
 * every line as tall as a line of words alone.
 */
export const BadgesOnSeveralLines: Story = {
  args: {
    value: [
      'Compare @api/src/server.ts with @ACME-12 then run @test and once @lint passes too read @web/src/pages/invoices/list.tsx before @ACME-14 lands on @shared/src/money.ts and @api/package.json',
      'A line of words alone.',
      'Then @dev',
    ].join('\n'),
  },
  play: async ({ canvasElement }) => {
    const lines = [...field(canvasElement).querySelectorAll('p')]
    await expect(lines).toHaveLength(3)
    await expect(lines.flatMap((line) => badgesOffBaseline(line))).toEqual([])
    await expect(lines.filter((line) => !keepsItsLines(line))).toEqual([])
  },
}

/** A long text: the field keeps its height and scrolls inside. */
export const LongText: Story = {
  args: {
    value: Array.from(
      { length: 12 },
      (_, at) =>
        `Line ${String(at + 1)} of a long message about @api/src/routes/invoices.ts and its tests.`,
    ).join('\n'),
  },
  play: async ({ canvasElement }) => {
    const box = field(canvasElement).parentElement
    const height = box?.getBoundingClientRect().height
    await userEvent.click(field(canvasElement))
    await userEvent.keyboard('{Enter}')
    await typeIn(null, 'One more line')
    await expect(box?.getBoundingClientRect().height).toBe(height)
  },
}

/**
 * A field that sends: Send in the box's corner, quiet while nothing is written, filled once
 * something is; Enter sends, Shift+Enter starts a new line.
 */
export const Sending: Story = {
  args: { onSubmit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const send = canvas.getByRole('button', { name: 'Send' })
    await expect(send).toBeDisabled()
    await typeIn(field(canvasElement), 'Hi')
    await waitFor(() => expect(send).toBeEnabled())
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await expect(args.onSubmit).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    await expect(args.onSubmit).toHaveBeenCalledTimes(1)
  },
}

/** While what was sent is worked on, Send is Stop, in the same place. */
export const Working: Story = {
  args: { value: 'And the PDF?', onSubmit: fn(), working: true, onStop: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalled()
  },
}

/**
 * The field while its editor arrives: its box and its foot as they will be, a skeleton where the
 * words go, Send quiet. The editor takes this room exactly.
 */
export const Loading: Story = {
  args: { onSubmit: fn() },
  render: (args) => <MentionFieldSkeleton {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled()
  },
}

/** Backspace after a mention takes it away whole: no `@` left behind, no menu reopened. */
export const DeletingAMention: Story = {
  play: async ({ args, canvasElement }) => {
    await typeIn(field(canvasElement), 'Look at @ACME-12')
    await menu().findByRole('option', { name: /ACME-12/ }, LOADED)
    await userEvent.keyboard('{Enter}')
    await expect(args.onValueChange).toHaveBeenLastCalledWith('Look at @ACME-12 ', [
      { kind: 'mission', id: 'm1', label: 'ACME-12' },
    ])
    await userEvent.keyboard('{Backspace}{Backspace}')
    await expect(args.onValueChange).toHaveBeenLastCalledWith('Look at ', [])
    await expect(menu().queryByRole('listbox')).toBeNull()
  },
}

/**
 * The mentions a value holds, handed in beside it: a mention no source lists any longer is still
 * drawn as its badge.
 */
export const KnownMentions: Story = {
  args: {
    value: 'Compare @api/src/legacy/billing.ts with @ACME-12',
    mentions: [{ kind: 'file', id: 'f9', label: 'api/src/legacy/billing.ts' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'api/src/legacy/billing.ts' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'ACME-12' })).toBeVisible()
  },
}

/** What a source finds once asked, a moment later. */
const searchFiles = (query: string): Promise<readonly Mentionable[]> =>
  new Promise((resolve) =>
    setTimeout(
      () => resolve(FOUND_FILES.filter((one) => one.label.includes(query.toLowerCase()))),
      400,
    ),
  )

/**
 * A source searched as one types: skeleton rows of a mention's shape while it answers, then what
 * it found among the rest, ranked together; the field does not move.
 */
export const SearchingASource: Story = {
  args: { search: searchFiles },
  play: async ({ canvasElement }) => {
    const box = field(canvasElement).closest('[data-field-box]')
    const height = box?.getBoundingClientRect().height
    await typeIn(field(canvasElement), '@report')
    await menu().findByRole('listbox', { name: 'Mentions', busy: true }, LOADED)
    await shown(() => menu().getByRole('option', { name: /monthly-report\.ts/ }))
    await expect(box?.getBoundingClientRect().height).toBe(height)
  },
}

/** A source that fails: said in words in the menu. */
export const SearchFailed: Story = {
  args: {
    search: () => Promise.reject(new Error('The file list could not be read.')),
  },
  play: async ({ canvasElement }) => {
    await typeIn(field(canvasElement), '@zzzz')
    await shown(() => menu().getByText('The file list could not be read.'))
  },
}
