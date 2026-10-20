import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { RULES } from '../../blocks/project-settings/delivery-fixtures.ts'
import { findOpen } from '../../overlay-play.ts'
import { MoveInTheDialog, MoveWithArrows } from './reorder.tsx'

const body = () => within(document.body)

/** The steps of a moment's list, by what each says to a screen reader. */
function namesIn(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole('listitem')
    .map((one) => one.getAttribute('data-step') ?? '')
    .filter((one) => one !== '')
}

/**
 * Gesture 2 of #467, reordering a step already placed. In the dialog is recommended: a step's
 * dialog says where it stands, When and After, as a new step's does, so a move across moments is
 * one Save and the keyboard path is the dialog's. Arrows put the move on the line, one place per
 * click. Dragging is not drawn: the lines are never slid into place (no position projection on
 * list rows), and a drop across three moments' lists is the hardest thing to do by keyboard.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Delivery gestures/2 Reorder a step',
  component: MoveInTheDialog,
  parameters: { layout: 'fullscreen' },
  args: { rules: RULES, repository: 'web', id: 'staging' },
  argTypes: { rules: { table: { disable: true } } },
} satisfies Meta<typeof MoveInTheDialog>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Recommended: web's check on staging opened, its place said by When and After; choosing After
 * Merge and saving moves it there, before CI.
 */
export const InTheDialog: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await findOpen(body(), 'dialog')
    expect(within(dialog).getByRole('combobox', { name: 'When' })).toHaveTextContent('After Ship')
    expect(within(dialog).getByRole('combobox', { name: 'After' })).toHaveTextContent('CI')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'After' }))
    await userEvent.click(await body().findByRole('option', { name: 'Merge' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const steps = within(canvasElement).getByRole('list', { name: 'Steps of web' })
    await waitFor(() => expect(namesIn(steps)).toEqual(['bump', 'merge', 'staging', 'ci']))
  },
}

/**
 * The alternative: arrows on each line. Move up twice takes the check on staging above Merge; at
 * the top of After Ship, Bump moves up into When Review starts.
 */
export const WithArrows: Story = {
  render: (args) => <MoveWithArrows rules={args.rules} repository={args.repository} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: 'Steps of web' })
    await userEvent.click(within(steps).getByRole('button', { name: 'Move Confirm up' }))
    await userEvent.click(within(steps).getByRole('button', { name: 'Move Confirm up' }))
    expect(namesIn(steps)).toEqual(['bump', 'staging', 'merge', 'ci'])
    await userEvent.click(within(steps).getByRole('button', { name: 'Move Bump up' }))
    const review = canvas.getByRole('list', { name: 'Steps of web in Review' })
    expect(namesIn(review).at(-1)).toBe('bump')
  },
}
