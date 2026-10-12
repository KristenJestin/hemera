import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { tabTo } from '../review/play.ts'
import { LONG_REPOSITORY, LONG_TITLE } from './fixtures.ts'
import { ShippingScreen } from './screen.tsx'

/**
 * The Shipping page of #265, recommended: the same rail as Review — the stage card, the fix while
 * there is one, For you (the team's comments) — and in the middle the delivery: the waves in their
 * order, each repository that takes part one line with its current step, unfolding to its steps,
 * their outcomes, checks and links; a failure verbatim under its step with Retry and what else the
 * forge allows. What waits for the user — a click, a manual step, an approval, a forge's CLI —
 * stands above the page as the mission's needs. Stop delivery is the header's action.
 */
const meta = {
  title: 'Explorations/Shipping/Shipping',
  component: ShippingScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    stage: 'Shipping',
    moment: 'started',
    onStopDelivery: fn(),
    onResumeDelivery: fn(),
    onRetry: fn(),
    onForge: fn(),
    onOpenLink: fn(),
    onStartMission: fn(),
    onDismissComment: fn(),
    onAcceptFix: fn(),
    onRefuseFix: fn(),
    onKeep: fn(),
    onStopLeftover: fn(),
    onCleanUp: fn(),
    onNeed: fn(),
  },
} satisfies Meta<typeof ShippingScreen>

export default meta
type Story = StoryObj<typeof meta>

const waveOf = (canvasElement: HTMLElement, n: number): ReturnType<typeof within> =>
  within(within(canvasElement).getByRole('region', { name: `Wave ${String(n)}` }))

/** The line of a repository, by its name. */
const lineOf = (canvasElement: HTMLElement, name: string): HTMLElement =>
  within(canvasElement).getByRole('button', { name: new RegExp(`^${name}: `) })

const stateOf = (canvasElement: HTMLElement, name: string): HTMLElement =>
  within(within(canvasElement).getByRole('listitem', { name })).getAllByRole('img')[0]!

/**
 * Wave 1: shared's CI runs on the forge. The ball is someone else's, said in words; the
 * repositories of the later waves are not started; shared's steps unfold to the CI's checks, each
 * with its link, and Stop pipeline.
 */
export const WaveOne: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Waiting on shared #41’s CI')).toBeVisible()
    await expect(stateOf(canvasElement, 'shared')).toHaveAccessibleName('Waiting on someone')
    await expect(stateOf(canvasElement, 'api')).toHaveAccessibleName('Not started')
    await expect(canvas.getAllByRole('region', { name: /^Wave/ })).toHaveLength(3)
    await userEvent.click(lineOf(canvasElement, 'shared'))
    const checks = await waitFor(() => canvas.getByRole('list', { name: 'Checks of shared · CI' }))
    await expect(within(checks).getAllByRole('listitem')).toHaveLength(5)
    await userEvent.click(within(checks).getByRole('button', { name: /^Open Lint of shared/ }))
    await expect(args.onOpenLink).toHaveBeenCalledWith(
      'https://github.example/acme/shop/checks/lint',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Stop pipeline of shared · CI' }))
    await expect(args.onForge).toHaveBeenCalledWith('shared', 'shared-ci', 'stop-pipeline')
  },
}

/**
 * Wave 2: shared delivered as 2.4.0; lib-a's CI failed — its line stands open, the forge's
 * message verbatim with its token masked, Retry and Re-run failed jobs; lib-b waits for its manual
 * step on Bitbucket, which is a need above the page with its link.
 */
export const StepFailed: Story = {
  args: { moment: 'failed' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(lineOf(canvasElement, 'shared')).toHaveAccessibleName(/Delivered · 2\.4\.0/)
    const message = canvas.getByLabelText('What CI said')
    await expect(message).toHaveTextContent(/expected '¥1,200.00' to be '¥1,200'/)
    await expect(message).toHaveTextContent('token ***')
    await userEvent.click(canvas.getByRole('button', { name: 'Retry lib-a · CI' }))
    await expect(args.onRetry).toHaveBeenCalledWith('lib-a', 'lib-a-ci')
    await userEvent.click(canvas.getByRole('button', { name: 'Re-run failed jobs' }))
    await expect(args.onForge).toHaveBeenCalledWith('lib-a', 'lib-a-ci', 'rerun-failed')
    await expect(canvas.getByText(/waits for its manual step release/)).toBeVisible()
    await expect(stateOf(canvasElement, 'lib-b')).toHaveAccessibleName('Needs you')
  },
}

/** Wave 3: a click to merge web and an approval of api's deployment, as the mission's needs. */
export const NeedsYou: Story = {
  args: { moment: 'needs' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('web waits for your click to merge #413')).toBeVisible()
    await expect(
      canvas.getByText('api’s deployment to staging waits for your approval'),
    ).toBeVisible()
    await expect(canvas.getAllByRole('img', { name: 'Needs you' }).length).toBeGreaterThan(0)
    await expect(lineOf(canvasElement, 'web')).toHaveAccessibleName(/Waiting for your click/)
  },
}

/** Who has the ball (49): a teammate's approval and a CI hold the delivery, said in words. */
export const WaitingOnSomeone: Story = {
  args: { moment: 'waitingOnSomeone' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Waiting on ana.lopez’s approval of api’s deployment and web #413’s CI'),
    ).toBeVisible()
    await expect(canvas.getAllByRole('img', { name: 'Waiting on someone' }).length).toBeGreaterThan(
      1,
    )
  },
}

/** GitHub's CLI is signed out: api and web wait for it, lib-b on Bitbucket goes on. */
export const ForgeSignedOut: Story = {
  args: { moment: 'signedOut' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('GitHub’s CLI is signed out')).toBeVisible()
    await expect(lineOf(canvasElement, 'api')).toHaveAccessibleName(/Waits for GitHub’s CLI/)
  },
}

/** Bitbucket's CLI is not installed: lib-b waits for it. */
export const ForgeMissing: Story = {
  args: { moment: 'missingCli' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Bitbucket’s CLI is not installed')).toBeVisible()
    await expect(lineOf(canvasElement, 'lib-b')).toHaveAccessibleName(/Waits for Bitbucket’s CLI/)
  },
}

/** Stop delivery asks once what stops and what stays, then Resume delivery takes its place. */
export const StopDelivery: Story = {
  args: { moment: 'started' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const stop = canvas.getByRole('button', { name: 'Stop delivery' })
    await userEvent.click(stop)
    const dialog = await waitFor(() =>
      within(document.body).getByRole('dialog', { name: 'Stop the delivery of ACME-12?' }),
    )
    await expect(within(dialog).getByText(/What is delivered stays delivered/)).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop delivery' }))
    await expect(args.onStopDelivery).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Resume delivery' })).toBeVisible(),
    )
  },
}

/** A stopped delivery: shared stays delivered, lib-a and lib-b stopped, Resume in the header. */
export const DeliveryStopped: Story = {
  args: { moment: 'stopped' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(stateOf(canvasElement, 'lib-a')).toHaveAccessibleName('Stopped')
    await expect(stateOf(canvasElement, 'shared')).toHaveAccessibleName('Delivered')
    await userEvent.click(canvas.getByRole('button', { name: 'Resume delivery' }))
    await expect(args.onResumeDelivery).toHaveBeenCalledOnce()
  },
}

/** A partial delivery: four repositories delivered, api failed at its deployment. */
export const PartialDelivery: Story = {
  args: { moment: 'partial' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('4 of 5 delivered: api’s deployment to staging failed'),
    ).toBeVisible()
    await expect(waveOf(canvasElement, 3).getByText('1 of 2 delivered')).toBeVisible()
    await expect(canvas.getByLabelText('What Deploy to staging said')).toHaveTextContent(
      /locked by another deployment/,
    )
  },
}

/** web's CI is red on develop after its merge: an error need proposes the fix. */
export const CiBrokenAfterMerge: Story = {
  args: { moment: 'broken' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('web’s CI is red on develop after the merge')).toBeVisible()
    await expect(stateOf(canvasElement, 'web')).toHaveAccessibleName('Failed')
  },
}

/**
 * The fix runs, as a round: the mark `fixing` on the Shipping stage — never "Building · round N" —
 * and its steps in the rail; web waits for it.
 */
export const Fixing: Story = {
  args: { moment: 'fixing' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Fixing' })).toBeVisible()
    const stage = canvas.getByRole('list', { name: 'Stage' })
    await expect(within(stage).getByText('Shipping')).toBeVisible()
    await expect(canvas.queryByText(/Building · round/)).toBeNull()
    const fix = canvas.getByRole('region', { name: 'Fix · round 3 · web' })
    await expect(within(fix).getAllByRole('listitem')).toHaveLength(5)
    await expect(lineOf(canvasElement, 'web')).toHaveAccessibleName(/Waits for the fix/)
  },
}

/** The fix is proven: its diff, and the user's acceptance, before its pull request. */
export const FixToAccept: Story = {
  args: { moment: 'fixToAccept' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const fix = within(canvas.getByRole('region', { name: 'Fix · round 3 · web' }))
    await expect(fix.getByLabelText('The fix’s diff')).toHaveTextContent('"@acme/lib-a": "^1.3.0"')
    await userEvent.click(fix.getByRole('button', { name: 'Send it back' }))
    await userEvent.type(
      fix.getByLabelText('What is wrong with the fix'),
      'Pin it, do not widen it',
    )
    await userEvent.click(fix.getByRole('button', { name: 'Send back' }))
    await expect(args.onRefuseFix).toHaveBeenCalledWith('Pin it, do not widen it')
    await userEvent.click(fix.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(fix.getByRole('button', { name: 'Accept the fix' }))
    await expect(args.onAcceptFix).toHaveBeenCalledOnce()
  },
}

/** The fix accepted: its pull request is open and its CI runs; the ball is the CI's. */
export const FixPullRequest: Story = {
  args: { moment: 'fixPull' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('web #415')).toBeVisible()
    await expect(canvas.getByText('Waiting on web #415’s CI')).toBeVisible()
  },
}

/** The fix merged: the mark is gone, the fix one line, web's steps resumed where they stopped. */
export const StepsResumed: Story = {
  args: { moment: 'resumed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img', { name: 'Fixing' })).toBeNull()
    await expect(canvas.getByText('#415 merged at 11:09')).toBeVisible()
    await expect(lineOf(canvasElement, 'web')).toHaveAccessibleName(/CI on develop/)
  },
}

/** A team comment during Shipping: read in For you, and a mission of its own started from it. */
export const TeamComment: Story = {
  args: { moment: 'teamComment' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const forYou = within(canvas.getByRole('region', { name: 'For you' }))
    await userEvent.click(forYou.getByRole('button', { name: /chen\.wei/ }))
    await userEvent.click(
      await waitFor(() => forYou.getByRole('button', { name: 'Start a mission from C4' })),
    )
    await expect(args.onStartMission).toHaveBeenCalledWith('C4')
  },
}

/**
 * The delivery view (76, settled: a stack): a repository's steps with their Journal lines, a sheet
 * over the page; the trail says `ACME-12 › Shipping › shared`, Escape finds the page as it was.
 */
export const DeliveryView: Story = {
  args: { moment: 'failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open the delivery of shared' }))
    const view = await waitFor(() => canvas.getByRole('region', { name: 'shared' }))
    await expect(within(view).getByRole('list', { name: 'Journal of Merge' })).toHaveTextContent(
      'Merged #41 with squash as a1b2c3d',
    )
    await expect(canvas.getByRole('navigation', { name: 'Where you are' })).toHaveTextContent(
      /Shipping.*shared/,
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvas.queryByRole('region', { name: 'shared' })).toBeNull())
    await expect(canvas.getByLabelText('What CI said')).toBeVisible()
  },
}

/** The page on its way: the card's face loading, nothing else drawn yet. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Reading where the delivery stands')
    await expect(canvas.queryByRole('region', { name: 'Wave 1' })).toBeNull()
  },
}

/** Long text in every field: the title, a repository's name, a forge's error, a step's task. */
export const LongText: Story = {
  args: { moment: 'teamComment', long: true, title: LONG_TITLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(LONG_REPOSITORY)).toBeVisible()
    await expect(canvas.getByLabelText('What Deploy to staging said')).toHaveTextContent(
      /exit code 1/,
    )
  },
}

/**
 * The keyboard path: the header's actions, then the rail, then the waves. A repository's line
 * unfolds on Enter; its delivery opens on Enter and Escape brings the focus back to it.
 */
export const KeyboardPath: Story = {
  args: { moment: 'started' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = lineOf(canvasElement, 'shared')
    await tabTo(line)
    await userEvent.keyboard('{Enter}')
    await expect(line).toHaveAttribute('aria-expanded', 'true')
    const open = canvas.getByRole('button', { name: 'Open the delivery of shared' })
    await tabTo(open)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(canvas.getByRole('region', { name: 'shared' })).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(open).toHaveFocus())
  },
}

/** Asked for less movement: every fold is there at once, no mark turns. */
export const ReducedMotion: Story = {
  args: { moment: 'failed' },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <ShippingScreen {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(lineOf(canvasElement, 'shared'))
    await expect(within(canvasElement).getByRole('list', { name: 'Steps of shared' })).toBeVisible()
  },
}
