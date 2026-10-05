import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ComponentType, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import {
  type Effort,
  type EffortControlProps,
  EffortSegments,
} from '../../components/model-picker/model-picker.tsx'
import { EffortChips, EffortStepper } from './effort-variants.tsx'

/**
 * The model picker's effort, three ways, side by side under a model's name as the picker draws
 * it: A, segments (what the picker carries now); B, chips; C, a stepper. Each is a keyboard
 * control on its own, marks the model's default, and keeps to one row. The two not chosen leave
 * with this page.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Effort',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const VARIANTS: readonly {
  key: string
  name: string
  Control: ComponentType<EffortControlProps>
}[] = [
  { key: 'a', name: 'A · Segments (recommended)', Control: EffortSegments },
  { key: 'b', name: 'B · Chips', Control: EffortChips },
  { key: 'c', name: 'C · Stepper', Control: EffortStepper },
]

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'max']

function Card({
  name,
  Control,
  defaultEffort,
}: {
  name: string
  Control: ComponentType<EffortControlProps>
  defaultEffort: Effort | undefined
}) {
  const [effort, setEffort] = useState<Effort | undefined>(undefined)
  return (
    <section aria-label={name} className="flex w-picker flex-col gap-2">
      <h2 className="text-xs text-muted-foreground">{name}</h2>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-lg">
        <div className="flex min-h-control-md items-center rounded-md px-2 text-sm tinted">
          Opus
        </div>
        <Control
          efforts={EFFORTS}
          defaultEffort={defaultEffort}
          effort={effort}
          onEffort={setEffort}
        />
      </div>
    </section>
  )
}

function Board({ defaultEffort }: { defaultEffort: Effort | undefined }) {
  return (
    <div className="flex min-h-screen flex-wrap items-start justify-center gap-8 p-8">
      {VARIANTS.map(({ key, name, Control }) => (
        <Card key={key} name={name} Control={Control} defaultEffort={defaultEffort} />
      ))}
    </div>
  )
}

/** The model says its default (High): that level wears the dot, and choosing it chooses none. */
export const SideBySide: Story = {
  render: () => <Board defaultEffort="high" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const segments = within(canvas.getByRole('region', { name: /Segments/ }))
    const fallback = segments.getByRole('radio', { name: "High, the model's default" })
    await expect(fallback).toBeChecked()
    fallback.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(segments.getByRole('radio', { name: 'Max' })).toBeChecked()
    const stepper = within(canvas.getByRole('region', { name: /Stepper/ }))
    stepper.getByRole('slider', { name: 'Effort' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(stepper.getByRole('slider', { name: 'Effort' })).toHaveAttribute(
      'aria-valuetext',
      'Medium',
    )
  },
}

/** The agent does not say the model's default: "Default" comes first, in each. */
export const NoKnownDefault: Story = {
  render: () => <Board defaultEffort={undefined} />,
}
