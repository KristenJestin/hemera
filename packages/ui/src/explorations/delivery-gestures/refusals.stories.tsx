import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { REFUSALS, REFUSED_RULES } from './fixtures.ts'
import { RefusalsPlaced } from './refusals.tsx'

/**
 * Gesture 3 of #467, where a refusal of a template or of a cleanup step is said. At their lines is
 * recommended: the rule the section keeps everywhere else (a step's refusal, the approval's),
 * under what to mend, so the eye goes from the words to the line at once. Under the frame's band
 * names the moment but leaves the line to find; under the section's head is what the app does
 * today, the farthest from the line.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Delivery gestures/3 Where a refusal is said',
  component: RefusalsPlaced,
  parameters: { layout: 'fullscreen' },
  args: { rules: REFUSED_RULES, refusals: REFUSALS, place: 'line' },
  argTypes: { rules: { table: { disable: true } }, refusals: { table: { disable: true } } },
} satisfies Meta<typeof RefusalsPlaced>

export default meta
type Story = StoryObj<typeof meta>

/** Recommended: each refusal under the line it refuses, the commit message and Notify the release. */
export const AtTheirLines: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pr = canvas.getByRole('list', { name: 'Pull requests' })
    expect(within(pr).getByRole('alert')).toHaveTextContent(/^\{titel\} is not a name/)
    const cleanup = canvas.getByRole('list', { name: 'Cleanup' })
    expect(within(cleanup).getByRole('alert')).toHaveTextContent(/“Notify the release”/)
  },
}

/** Under the band of the frame that holds what is refused. */
export const UnderTheFrameBands: Story = {
  args: { place: 'band' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      within(canvas.getByRole('list', { name: 'Pull requests' })).queryByRole('alert'),
    ).toBeNull()
    expect(canvas.getAllByRole('alert')).toHaveLength(2)
  },
}

/** As the app says it today: both under the section's head. */
export const UnderTheSectionHead: Story = {
  args: { place: 'head' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [head] = canvas.getAllByRole('alert')
    expect(head).toHaveTextContent(/titel.*Notify the release/)
  },
}
