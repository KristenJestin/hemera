import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { DEPENDENCIES, outdated, triaged } from '../../surfaces/planning/planning-fixtures.ts'
import type { PlanningData } from './planning-types.ts'
import { DependenciesCard, TicketCard, TriageCard, VisionCard } from './planning-cards.tsx'

/**
 * What else the rail of the Planning page asks of the user, beside the questions: the Planner's
 * triage answer when the request belongs elsewhere, what changed on the ticket, the dependencies
 * the Planner proposes, and the vision, a field always there. Each card is drawn only when it has
 * something to say.
 */
function Cards(props: CardsProps): ReactNode {
  return (
    <>
      {props.triage !== null && (
        <TriageCard
          triage={props.triage}
          onKeepPlanning={props.onKeepPlanning}
          onOpenMission={props.onOpenMission}
        />
      )}
      {props.ticket !== null && (
        <TicketCard ticket={props.ticket} onSeen={props.onSeenTicketChange} />
      )}
      <DependenciesCard
        dependencies={props.dependencies}
        frozen={props.frozen}
        onDecide={props.onDecideDependency}
      />
      {!props.frozen && (
        <VisionCard
          visions={props.visions}
          mentionables={props.mentionables}
          onGive={props.onGiveVision}
        />
      )}
    </>
  )
}

interface CardsProps {
  triage: PlanningData['triage']
  ticket: PlanningData['ticket']
  dependencies: PlanningData['dependencies']
  visions: PlanningData['visions']
  frozen: boolean
  mentionables: readonly Mentionable[]
  onKeepPlanning: () => void
  onOpenMission: (key: string) => void
  onSeenTicketChange: (id: string) => void
  onDecideDependency: (id: string, accept: boolean) => void
  onGiveVision: (text: string) => void
}

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/PlanningCards',
  component: Cards,
  args: {
    triage: null,
    ticket: null,
    dependencies: [],
    visions: [],
    frozen: false,
    mentionables: MENTIONABLES,
    onKeepPlanning: fn(),
    onOpenMission: fn(),
    onSeenTicketChange: fn(),
    onDecideDependency: fn(),
    onGiveVision: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex w-view-narrow flex-col gap-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Cards>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing but the vision, which is always there while the Spec is written. */
export const VisionOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('region')).toHaveLength(1)
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Your vision' })).toBeVisible())
  },
}

/** The vision given: each one with its dot. */
export const VisionGiven: Story = {
  args: {
    visions: [
      {
        id: 'v1',
        text: 'Keep it boring: one file per note.',
        at: '09:05',
        inputState: 'integrated',
      },
      { id: 'v2', text: 'A notebook export can wait.', at: '11:40', inputState: 'received' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const given = canvas.getByRole('list', { name: 'Your vision so far' })
    await expect(within(given).getByRole('img', { name: 'Received' })).toBeVisible()
    await expect(within(given).getByRole('img', { name: 'Integrated in the Spec' })).toBeVisible()
  },
}

/** The triage answer: where it belongs, Keep planning, or open the other mission. */
export const Triage: Story = {
  args: { triage: triaged().data.triage },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByRole('region', { name: 'Belongs elsewhere' })
    await expect(card).toHaveTextContent('ACME-20 already moves the attachments')
    await userEvent.click(within(card).getByRole('button', { name: 'Open ACME-20' }))
    await expect(args.onOpenMission).toHaveBeenCalledWith('ACME-20')
    await userEvent.click(within(card).getByRole('button', { name: 'Keep planning' }))
    await expect(args.onKeepPlanning).toHaveBeenCalled()
  },
}

/** The ticket changed: its difference, its state as a dot, Seen. */
export const TicketChanged: Story = {
  args: { ticket: outdated().data.ticket },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByRole('region', { name: 'acme/shop#41 changed' })
    await expect(card).toHaveTextContent('a whole notebook as one archive')
    await expect(within(card).getByRole('img', { name: 'Delivered to the Planner' })).toBeVisible()
    await userEvent.click(within(card).getByRole('button', { name: 'Seen' }))
    await expect(args.onSeenTicketChange).toHaveBeenCalledWith('e1')
  },
}

/** A dependency proposed: Accept or Reject; an accepted one wears its check. */
export const Dependencies: Story = {
  args: { dependencies: DEPENDENCIES },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept the dependency on ACME-20' }))
    await expect(args.onDecideDependency).toHaveBeenCalledWith('dep1', true)
    await userEvent.click(canvas.getByRole('button', { name: 'Reject the dependency on ACME-20' }))
    await expect(args.onDecideDependency).toHaveBeenCalledWith('dep1', false)
    await expect(canvas.getByRole('img', { name: 'Accepted' })).toBeVisible()
  },
}

/** Frozen: nothing left to give or decide; the accepted dependencies stay readable. */
export const Frozen: Story = {
  args: { frozen: true, dependencies: [{ ...DEPENDENCIES[0]!, state: 'accepted' }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox', { name: 'Your vision' })).toBeNull()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}
