import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { PROJECT_TONES, type ProjectTone } from '../../shell/model.ts'
import { ToneSwatches } from './tone-swatches.tsx'

/** The five dots a Project is told apart by, and nothing else (design D4-07). */
function Harness({ tone: chosen = 'primary' }: { tone?: ProjectTone }) {
  const [tone, setTone] = useState<ProjectTone>(chosen)
  return (
    <div className="flex flex-col gap-3 p-6">
      <ToneSwatches value={tone} onValueChange={setTone} />
      <p className="text-sm text-muted-foreground">Chosen: {tone}</p>
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Components/ToneSwatches',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { tone: 'primary' },
  argTypes: {
    tone: {
      control: 'inline-radio',
      options: PROJECT_TONES,
      description: 'The tone the group opens on.',
      table: { defaultValue: { summary: 'primary' } },
    },
  },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** The five of them, which is the whole list and never a colour of the caller's. */
export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('radio')).toHaveLength(PROJECT_TONES.length)
  },
}

/** Choosing one: the group says which, and only one at a time. */
export const States: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Green' }))
    await waitFor(() => {
      expect(canvas.getByRole('radio', { name: 'Green' })).toBeChecked()
    })
    expect(canvas.getByRole('radio', { name: 'Pink' })).not.toBeChecked()
    expect(canvas.getByText('Chosen: success')).toBeInTheDocument()
  },
}

/** One stop of the tab order, and the arrows move inside it. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('radio', { name: 'Pink' })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(canvas.getByRole('radio', { name: 'Blue' })).toBeChecked()
    })
  },
}
