import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MENTIONABLES } from './mention-field-fixtures.ts'
import { MentionField } from './mention-field.tsx'

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
        onValueChange={(next) => {
          setValue(next)
          args.onValueChange(next)
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

export const Empty: Story = {}

/** `@` alone: the recent ones first, then the rest. */
export const Menu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(field(canvasElement), 'Look at @')
    const options = await menu().findAllByRole('option')
    await expect(options[0]).toHaveTextContent('server.ts')
    await expect(options[1]).toHaveTextContent('ACME-12')
    await expect(options[2]).toHaveTextContent('test')
  },
}

/** A fuzzy search: `srvts` finds `api/src/server.ts`. */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(field(canvasElement), '@srvts')
    const [first] = await menu().findAllByRole('option')
    await expect(first).toHaveTextContent('server.ts')
  },
}

/**
 * The keyboard path: Down and Enter put the mention in the text; Tab does the same; Escape puts
 * the menu away; the caret is in the field the whole time.
 */
export const Mentioning: Story = {
  play: async ({ args, canvasElement }) => {
    const box = field(canvasElement)
    await userEvent.type(box, 'See @inv')
    await menu().findAllByRole('option')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(args.onValueChange).toHaveBeenLastCalledWith(
      'See @web/src/pages/invoices/list.tsx ',
    )
    await expect(box).toHaveFocus()
    await userEvent.keyboard('and @lint')
    await menu().findByRole('option', { name: /lint/ })
    await userEvent.keyboard('{Tab}')
    await expect(args.onValueChange).toHaveBeenLastCalledWith(
      'See @web/src/pages/invoices/list.tsx and @lint ',
    )
    await expect(box).toHaveFocus()
    await userEvent.keyboard(' @ACME')
    await menu().findAllByRole('option')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(menu().queryByRole('listbox')).toBeNull())
    await expect(box).toHaveFocus()
  },
}

/** Missions and commands: each with its glyph and what it is in a quiet line. */
export const MissionsAndCommands: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(field(canvasElement), '@acme')
    await expect(await menu().findByRole('option', { name: /ACME-14/ })).toBeVisible()
  },
}

/** Nothing matches: said in the menu, which stays where it opened. */
export const NoMatch: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(field(canvasElement), '@zzzz')
    await expect(await menu().findByText('Nothing matches “zzzz”')).toBeVisible()
  },
}

/** A long path: its file name whole, its folder cut. */
export const LongPath: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(field(canvasElement), '@columns')
    await expect(
      await menu().findByRole('option', { name: /choose-columns-and-format\.tsx/ }),
    ).toBeVisible()
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
    const box = field(canvasElement)
    const height = box.getBoundingClientRect().height
    await userEvent.type(box, '{Enter}One more line')
    await expect(box.getBoundingClientRect().height).toBe(height)
  },
}
