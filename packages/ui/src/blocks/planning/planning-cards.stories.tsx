import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { DEPENDENCIES, outdated, triaged } from '../../surfaces/planning/planning-fixtures.ts'
import type { PlanningData } from './planning-types.ts'
import { DependenciesCard, TicketCard, TriageCard, VisionCard } from './planning-cards.tsx'
import { EDITOR_LOADED, settled, writeAndSend } from './planning-play.ts'

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
  onKeepPlanning: () => Promise<void>
  onOpenMission: (key: string) => void
  onSeenTicketChange: (id: string) => Promise<void>
  onDecideDependency: (id: string, accept: boolean) => Promise<void>
  onGiveVision: (text: string) => Promise<void>
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
    onKeepPlanning: fn(() => Promise.resolve()),
    onOpenMission: fn(),
    onSeenTicketChange: fn(() => Promise.resolve()),
    onDecideDependency: fn(() => Promise.resolve()),
    onGiveVision: fn(() => Promise.resolve()),
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

/** A vision sent: the field empties once the engine has taken it, not before. */
export const VisionSent: Story = {
  loaders: EDITOR_LOADED,
  args: { onGiveVision: fn(() => Promise.resolve()) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const field = await canvas.findByRole('textbox', { name: 'Your vision' })
    await writeAndSend(field, 'One file per note')
    await expect(args.onGiveVision).toHaveBeenCalledWith('One file per note')
    await waitFor(() => expect(field).toHaveTextContent(''))
    await expect(canvas.queryByRole('alert')).toBeNull()
  },
}

/** A vision the engine refuses: what was written stays, and why is said under the field. */
export const VisionRefused: Story = {
  loaders: EDITOR_LOADED,
  args: { onGiveVision: fn(() => Promise.reject(new Error('The mission is frozen.'))) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const field = await canvas.findByRole('textbox', { name: 'Your vision' })
    await writeAndSend(field, 'One file per note')
    const why = await canvas.findByRole('alert')
    await expect(why).toHaveTextContent('Not sent: The mission is frozen.')
    await expect(field).toHaveTextContent('One file per note')
  },
}

/** A dependency accepted twice before the engine has it: sent once, Accept busy meanwhile. */
export const DecidingTwice: Story = {
  args: {
    dependencies: DEPENDENCIES,
    onDecideDependency: fn(() => new Promise<void>(() => undefined)),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const accept = canvas.getByRole('button', { name: 'Accept the dependency on ACME-20' })
    await userEvent.click(accept)
    await userEvent.click(accept)
    await expect(args.onDecideDependency).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(accept).toHaveAttribute('aria-disabled', 'true'))
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
    const keep = within(card).getByRole('button', { name: 'Keep planning' })
    await userEvent.click(keep)
    await expect(args.onKeepPlanning).toHaveBeenCalled()
    await settled(keep)
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
    const pressed = within(card).getByRole('button', { name: 'Seen' })
    await userEvent.click(pressed)
    await expect(args.onSeenTicketChange).toHaveBeenCalledWith('e1')
    await settled(pressed)
  },
}

/** A dependency proposed: Accept or Reject; an accepted one wears its check. */
export const Dependencies: Story = {
  args: { dependencies: DEPENDENCIES },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const accept = canvas.getByRole('button', { name: 'Accept the dependency on ACME-20' })
    await userEvent.click(accept)
    await expect(args.onDecideDependency).toHaveBeenCalledWith('dep1', true)
    const reject = canvas.getByRole('button', { name: 'Reject the dependency on ACME-20' })
    await userEvent.click(reject)
    await expect(args.onDecideDependency).toHaveBeenCalledWith('dep1', false)
    await settled(accept)
    await settled(reject)
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
