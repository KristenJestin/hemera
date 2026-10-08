import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Input } from '../field/field.tsx'
import { MarkPicker } from './mark-picker.tsx'
import { ACME_LOGO } from './project-mark-fixtures.ts'
import type { Identity } from './project-mark.tsx'

/**
 * The Project's mark, chosen where its name is typed: the mark itself is the control, at the head
 * of the name's box, and it opens one small panel — the symbol, drawn in the colour, then the
 * colour, then an image of the user's own.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/MarkPicker',
  component: MarkPicker,
  args: {
    name: 'Acme',
    identity: {},
    onChange: () => {},
    onChooseImage: () => {},
  },
  render: (args) => <InTheNameField name={args.name} first={args.identity} />,
} satisfies Meta<typeof MarkPicker>

export default meta

type Story = StoryObj<typeof meta>

/** The picker where it is met: before the Project's name, holding what is chosen. */
function InTheNameField({ name: firstName, first }: { name: string; first: Identity }) {
  const [name, setName] = useState(firstName)
  const [identity, setIdentity] = useState(first)
  return (
    <div className="max-w-measure">
      <Input
        label="Name"
        value={name}
        onValueChange={setName}
        lead={
          <MarkPicker
            name={name}
            identity={identity}
            onChange={setIdentity}
            onChooseImage={() => setIdentity((before) => ({ ...before, image: ACME_LOGO }))}
          />
        }
      />
    </div>
  )
}

const trigger = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: /^Mark of / })

const panel = () => within(document.body).findByRole('dialog', { name: /^Mark of / })

/** Nothing chosen: the name's letter, in the tone read from the name. */
export const Letter: Story = {
  play: async ({ canvasElement }) => {
    const mark = trigger(canvasElement)
    expect(mark).toHaveAccessibleName('Mark of Acme')
    expect(mark.querySelector('[data-avatar]')).toHaveTextContent('A')
  },
}

/** Opened: the symbols drawn in the colour, the letter chosen; the colours, the name's ticked. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    const opened = await panel()
    const symbols = within(opened).getByRole('radiogroup', { name: 'Symbol' })
    expect(within(symbols).getAllByRole('radio')).toHaveLength(9)
    expect(within(symbols).getByRole('radio', { name: 'Letter' })).toBeChecked()
    const colours = within(opened).getByRole('radiogroup', { name: 'Colour' })
    expect(within(colours).getAllByRole('radio')).toHaveLength(5)
    expect(
      within(colours)
        .getAllByRole('radio')
        .filter((one) => one.ariaChecked === 'true'),
    ).toHaveLength(1)
    // The panel comes down from its trigger: visible once its entrance has played.
    await waitFor(() => {
      expect(within(opened).getByRole('button', { name: 'Upload an image…' })).toBeVisible()
    })
  },
}

/** A symbol and a colour chosen: the mark at the head of the name follows at once. */
export const Chosen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    const opened = await panel()
    await userEvent.click(within(opened).getByRole('radio', { name: 'Rocket' }))
    await userEvent.click(within(opened).getByRole('radio', { name: 'Cyan' }))
    expect(within(opened).getByRole('radio', { name: 'Rocket' })).toBeChecked()
    expect(within(opened).getByRole('radio', { name: 'Cyan' })).toBeChecked()
    const mark = trigger(canvasElement)
    expect(mark.querySelector('[data-mark-icon="rocket"]')).not.toBeNull()
    // Each symbol is drawn in the colour chosen, so the panel shows the marks it gives.
    expect(within(opened).getByRole('radio', { name: 'Server' })).toHaveAttribute(
      'data-tone',
      'build',
    )
  },
}

/** The arrows walk a group, and the one reached is chosen; one tab stop per group. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    const opened = await panel()
    await waitFor(() => {
      expect(within(opened).getByRole('radio', { name: 'Letter' })).toHaveFocus()
    })
    await userEvent.keyboard('{ArrowRight}')
    expect(within(opened).getByRole('radio', { name: 'Server' })).toHaveFocus()
    expect(within(opened).getByRole('radio', { name: 'Server' })).toBeChecked()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(trigger(canvasElement)).toHaveFocus()
    })
    expect(trigger(canvasElement).querySelector('[data-mark-icon="server"]')).not.toBeNull()
  },
}

/** An image of the user's own: it joins the symbols, chosen; removed, the letter comes back. */
export const Image: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    const opened = await panel()
    await userEvent.click(within(opened).getByRole('button', { name: 'Upload an image…' }))
    expect(within(opened).getByRole('radio', { name: 'Image' })).toBeChecked()
    expect(trigger(canvasElement).querySelector('[data-mark-image]')).not.toBeNull()
    await userEvent.click(within(opened).getByRole('button', { name: 'Remove the image' }))
    expect(within(opened).queryByRole('radio', { name: 'Image' })).toBeNull()
    expect(within(opened).getByRole('radio', { name: 'Letter' })).toBeChecked()
    expect(trigger(canvasElement).querySelector('[data-mark-image]')).toBeNull()
  },
}

/** A symbol chosen over the image: one mark at a time, so the image goes. */
export const ImageReplaced: Story = {
  args: { identity: { image: ACME_LOGO } },
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    const opened = await panel()
    await userEvent.click(within(opened).getByRole('radio', { name: 'Rocket' }))
    expect(within(opened).queryByRole('radio', { name: 'Image' })).toBeNull()
    expect(trigger(canvasElement).querySelector('[data-mark-icon="rocket"]')).not.toBeNull()
  },
}

/** Before a name is typed: the mark of a Project still to be named. */
export const NoName: Story = {
  args: { name: '' },
  play: async ({ canvasElement }) => {
    const mark = trigger(canvasElement)
    expect(mark).toHaveAccessibleName('Mark of the Project')
    expect(mark.querySelector('[data-avatar]')).toHaveTextContent('P')
  },
}
