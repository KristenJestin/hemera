import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CLAUDE_MODES, MODE_ARG_TYPES, SetMode } from './agent-model-menu-fixtures.tsx'
import type { ModeVariant } from './agent-model-menu-shared.tsx'
import { ModeControl } from './mode.tsx'

/**
 * The three ways of asking one question, on one canvas and on the same five modes.
 *
 * 1 — **the list**: one line per mode, every sentence read whole without anything being opened.
 * 2 — **the column**: the same list with a word over it and a column of the panel to stand in,
 * which is the one that changes the panel around it. 3 — **the select**: one line whatever the
 * agent announced, and the other four behind a press.
 *
 * They take the same props and are handed the same modes, so what is being compared is the
 * shape and nothing else. Each keeps its own answer. The question is what a panel is willing to
 * spend on a question it asks once a session, against what a reader is willing to press for.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/Mode/Compare',
  component: ModeControl,
  parameters: { layout: 'padded' },
  args: {
    modes: CLAUDE_MODES,
    mode: 'plan-only',
    onModeChange: fn(),
  },
  argTypes: {
    ...MODE_ARG_TYPES,
    variant: {
      control: 'inline-radio',
      options: ['list', 'column', 'select'],
      description: 'Which of the three is drawn; the panels take the same word.',
    },
  },
} satisfies Meta<typeof ModeControl>

export default meta
type Story = StoryObj<typeof meta>

/** One control, in whichever of the three shapes you ask for. */
export const Playground: Story = {
  render: (args) => <SetMode {...args} render={(props) => <ModeControl {...props} />} />,
}

const CANDIDATE = 'flex w-menu-agents shrink-0 flex-col items-stretch gap-2'

const NAME = 'text-sm font-medium'

const SAID = 'text-xs text-muted-foreground'

function Candidate({
  name,
  said,
  variant,
}: {
  name: string
  said: string
  variant: ModeVariant
}): ReactNode {
  return (
    <div className={CANDIDATE}>
      <span className={NAME}>{name}</span>
      <span className={SAID}>{said}</span>
      <SetMode
        modes={CLAUDE_MODES}
        mode="plan-only"
        onModeChange={fn()}
        render={(props) => <ModeControl {...props} variant={variant} />}
      />
    </div>
  )
}

/** The three, side by side, each with its own answer and the same five sentences to give it in. */
export const SideBySide: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-6">
      <Candidate name="1 · List" said="Every mode read whole." variant="list" />
      <Candidate name="2 · Column" said="The same list, in a column of its own." variant="column" />
      <Candidate name="3 · Select" said="One line, and a press for the rest." variant="select" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const lists = canvas.getAllByRole('listbox', { name: 'Mode' })
    // Two of the three put the five modes on the page; the third puts one line there.
    await expect(lists).toHaveLength(2)
    const trigger = canvas.getByRole('combobox', { name: 'Mode' })
    await expect(trigger).toHaveTextContent('Plan only')

    // Which is the whole of the trade, measured: the select is one row tall, the lists are five.
    await expect(trigger.getBoundingClientRect().height).toBeLessThan(
      lists[0]!.getBoundingClientRect().height,
    )
    // And the column is the list with a word over it, which is what makes it a section: the
    // one header on the canvas stands over the second of the two lists.
    const head = canvas.getByText('Mode')
    await expect(head.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      lists[1]!.getBoundingClientRect().top + 1,
    )

    // Each keeps its own answer: setting one leaves the other two where they were.
    await userEvent.click(within(lists[0]!).getByRole('option', { name: /Auto/ }))
    await waitFor(() => {
      expect(within(lists[0]!).getByRole('option', { name: /Auto/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
    await expect(within(lists[1]!).getByRole('option', { name: /Plan only/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(trigger).toHaveTextContent('Plan only')
  },
}
