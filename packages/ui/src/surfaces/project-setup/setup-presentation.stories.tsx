import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { SETUP_KINDS, type SetupKind } from '../../blocks/setup/proposal.tsx'
import { ACME_FOLDER, PROPOSALS } from '../../blocks/setup/setup-fixtures.ts'
import { Dialog } from '../../components/dialog/dialog.tsx'
import { Face } from '../../components/face/face.tsx'
import { AppFixture } from '../../shell/shell-fixtures.tsx'
import { SettingsFixture } from '../project-settings/settings-fixtures.tsx'
import { AgentMark, SetupBody, type SetupCardEntry } from './project-setup.tsx'
import {
  SetupFoot,
  SetupProgress,
  SetupTakeover,
  type SetupTakeoverProps,
  SetupWaiting,
  setupFace,
} from './setup-takeover.tsx'

/**
 * How a new Project's setup is presented, so it reads as what it is: a one-time step of
 * onboarding, not a page of the Project the user will see every day. Two ways, the same content:
 *
 * - A, the takeover (recommended): the window is taken over, the sidebar and the Project dimmed
 *   behind a narrower column that names the step, Hemera's face beside the setup agent's state,
 *   how many proposals are answered, the cards, then Finish later and, all answered, Done.
 * - B, a large dialog over the Project's page, with the same head, progress and foot.
 *
 * Either way, Finish later leaves a line at the top of the Project's settings to come back. The
 * variant not chosen is deleted with this exploration.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Setup presentation',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

type View = 'takeover' | 'dialog'

const noop = fn()

/** B: the same content in the design system's large dialog, over the Project's page. */
function SetupDialog(props: SetupTakeoverProps): ReactNode {
  const { project, folder, agent, startedAt, endedAt, glance, cards, open, onFinishLater } = props
  return (
    <Dialog
      title={`Setting up ${project}`}
      lead={
        <Face state={setupFace(agent, cards)} size="md" label={`Hemera, setting up ${project}`} />
      }
      description={folder}
      size="wide"
      open={open}
      onOpenChange={(next) => {
        if (!next) onFinishLater()
      }}
      actions={<SetupFoot {...props} />}
    >
      <div className="flex flex-col gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="min-w-0 flex-1">
            <SetupProgress cards={cards} />
          </span>
          <AgentMark agent={agent} startedAt={startedAt} endedAt={endedAt} glance={glance} />
        </div>
        <SetupBody {...props} narrow />
      </div>
    </Dialog>
  )
}

/** Acme's Project page with its setup over it, holding the answers as the window would. */
function Presentation({
  view,
  answered,
}: {
  view: View
  answered: readonly SetupKind[]
}): ReactNode {
  const [startedAt] = useState(() => Date.now() - 42_000)
  const [endedAt] = useState(() => Date.now() - 3_000)
  const [open, setOpen] = useState(true)
  const [cards, setCards] = useState<SetupCardEntry[]>(() =>
    SETUP_KINDS.map((kind) => ({
      kind,
      status: answered.includes(kind) ? { state: 'accepted' } : { state: 'proposed' },
      proposal: PROPOSALS[kind],
    })),
  )
  const answer = (kind: SetupKind, state: 'accepted' | 'declined'): void =>
    setCards((before) =>
      before.map((card) => (card.kind === kind ? { ...card, status: { state } } : card)),
    )
  const props: SetupTakeoverProps = {
    project: 'Acme',
    folder: ACME_FOLDER,
    agent: 'done',
    startedAt,
    endedAt,
    cards,
    open,
    onAcceptAll: () =>
      setCards((before) =>
        before.map((card) =>
          card.status.state === 'proposed' ? { ...card, status: { state: 'accepted' } } : card,
        ),
      ),
    onRetry: noop,
    onAccept: (kind) => answer(kind, 'accepted'),
    onDecline: (kind) => answer(kind, 'declined'),
    onDraft: noop,
    onSave: noop,
    onCancel: noop,
    onSend: noop,
    onFinishLater: () => setOpen(false),
    onDone: () => setOpen(false),
  }
  return (
    <>
      <AppFixture page={{ kind: 'project', id: 'acme' }} withMissions />
      {view === 'takeover' ? <SetupTakeover {...props} /> : <SetupDialog {...props} />}
    </>
  )
}

const THREE_ANSWERED: readonly SetupKind[] = ['repositories', 'commands', 'preparation']

const setup = () => within(document.body).findByRole('dialog', { name: 'Setting up Acme' })

/** A: the takeover, three of five proposals answered. */
export const Takeover: Story = {
  render: () => <Presentation view="takeover" answered={THREE_ANSWERED} />,
  play: async () => {
    const dialog = within(await setup())
    await expect(dialog.getByText('3 of 5 proposals answered')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Finish later' })).toBeVisible()
    await expect(dialog.queryByRole('button', { name: 'Done' })).toBeNull()
  },
}

/** A, left for later: Finish later closes it and the Project is there again. */
export const TakeoverLeft: Story = {
  render: () => <Presentation view="takeover" answered={THREE_ANSWERED} />,
  play: async () => {
    const dialog = within(await setup())
    await userEvent.click(dialog.getByRole('button', { name: 'Finish later' }))
    await waitFor(() =>
      expect(within(document.body).queryByRole('dialog', { name: 'Setting up Acme' })).toBeNull(),
    )
  },
}

/** A, every proposal answered: Done leads to the Project. */
export const TakeoverAnswered: Story = {
  render: () => <Presentation view="takeover" answered={SETUP_KINDS} />,
  play: async () => {
    const dialog = within(await setup())
    await expect(dialog.getByText('5 of 5 proposals answered')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible()
  },
}

/** B: a large dialog over the Project's page, three of five proposals answered. */
export const LargeDialog: Story = {
  render: () => <Presentation view="dialog" answered={THREE_ANSWERED} />,
  play: async () => {
    const dialog = within(await setup())
    await expect(dialog.getByText('3 of 5 proposals answered')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Finish later' })).toBeVisible()
  },
}

/** B, every proposal answered: Done leads to the Project. */
export const LargeDialogAnswered: Story = {
  render: () => <Presentation view="dialog" answered={SETUP_KINDS} />,
  play: async () => {
    const dialog = within(await setup())
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible()
  },
}

const review = fn()

/** Either way, left for later: the Project's settings keep a line to come back. */
export const FinishedLater: Story = {
  render: () => <SettingsFixture banner={<SetupWaiting proposals={2} onReview={review} />} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('The agent proposes 2 changes')
    await userEvent.click(canvas.getByRole('button', { name: 'Review' }))
    await expect(review).toHaveBeenCalledOnce()
  },
}
