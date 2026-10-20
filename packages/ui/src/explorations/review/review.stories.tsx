import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LONG_TITLE } from './fixtures.ts'
import { cardOf, tabTo, unfold } from './play.ts'
import { ReviewScreen } from './screen.tsx'

/**
 * The Review page of #254, recommended: the same rail as Planning and Building — the stage card,
 * For you (what waits for the user: the proofs to verify by hand, the team's comments, the round's
 * questions), then the rest one quiet line each, folded: services, pull requests, proofs, checks,
 * the automatic review, the documentation, the changes. The middle holds the user's own work here:
 * their feedback, by round — the next round being written on top, with Fix, then each round with
 * what the agent answered, the older ones folded. The needs stand above the page.
 */
const meta = {
  title: 'Explorations/Review/Review',
  component: ReviewScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'feedback',
    onShip: fn(),
    onService: fn(),
    onRemark: fn(),
    onFix: fn(),
    onVerify: fn(),
    onTeam: fn(),
    onPull: fn(),
    onOpenDiff: fn(),
    onOpenLink: fn(),
    onCopy: fn(),
    onPoint: fn(),
    onOpenBuilding: fn(),
  },
} satisfies Meta<typeof ReviewScreen>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Review entered: the card says everything is proven; the proofs fold says each scenario red then
 * green, the two verified by hand to verify; the checks are in full; the automatic review says
 * what it saw, what changed after it, covered by the checks only, and each finding's fate.
 */
export const EnteringReview: Story = {
  args: { moment: 'entering' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(within(cardOf(canvasElement)).getByRole('status')).toHaveTextContent(
      /every test proof is green/,
    )
    const proofs = await unfold(canvasElement, 'Proofs')
    await expect(within(proofs).getAllByRole('img', { name: /^Red at/ }).length).toBe(12)
    await expect(within(proofs).getAllByRole('img', { name: 'To verify by hand' })).toHaveLength(2)
    const checks = canvas.getByRole('list', { name: 'Checks' })
    await expect(within(checks).getAllByRole('listitem')).toHaveLength(7)
    const review = await unfold(canvasElement, 'Automatic review')
    await expect(within(review).getByText(/every proof and check green/)).toBeVisible()
    await expect(
      within(review).getAllByRole('img', { name: 'Covered by the checks only' }),
    ).toHaveLength(2)
    await expect(within(review).getByText('fixed by RV1')).toBeVisible()
    await expect(within(review).getByText(/dismissed: S7 ends/)).toBeVisible()
  },
}

/** The documenter changed nothing, and says why, in its fold. */
export const NoDocumentationChange: Story = {
  args: { moment: 'entering' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = canvas.getByRole('button', { name: /^Documentation/ })
    await expect(line).toHaveTextContent('No change')
    await userEvent.click(line)
    await waitFor(() => {
      expect(canvas.getByText(/No user documentation mentions/)).toBeVisible()
    })
  },
}

/** The proofs verified by hand wait in For you: validated in one press, refused with a reason. */
export const ManualProofs: Story = {
  args: { moment: 'entering' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const forYou = within(canvas.getByRole('region', { name: 'For you' }))
    await userEvent.click(forYou.getByRole('button', { name: /S12/ }))
    await userEvent.click(await waitFor(() => forYou.getByRole('button', { name: 'Validate S12' })))
    await expect(args.onVerify).toHaveBeenCalledWith('S12', { validated: true })
    await userEvent.click(forYou.getByRole('button', { name: /S13/ }))
    await userEvent.click(await waitFor(() => forYou.getByRole('button', { name: 'Refuse S13' })))
    const why = await waitFor(() => forYou.getByRole('textbox', { name: 'Why S13 is refused' }))
    await userEvent.type(why, 'The label wraps.')
    await userEvent.click(forYou.getByRole('button', { name: 'Refuse' }))
    await expect(args.onVerify).toHaveBeenCalledWith('S13', {
      validated: false,
      reason: 'The label wraps.',
    })
  },
}

/** After verifying: one validated, one refused with its reason, in the proofs fold. */
export const ManualProofsSettled: Story = {
  args: { moment: 'verified' },
  play: async ({ canvasElement }) => {
    const proofs = await unfold(canvasElement, 'Proofs')
    await expect(within(proofs).getByRole('img', { name: 'Validated by you' })).toBeVisible()
    await expect(within(proofs).getByRole('img', { name: 'Refused by you' })).toBeVisible()
    await expect(within(proofs).getByText(/still wraps under its icon/)).toBeVisible()
  },
}

/**
 * Live testing: the services' fold, one row each — its mark, its address to open or copy while
 * it runs, Restart, and its ×, which stops a running one and removes a stopped one; a failed one
 * says why, with Start.
 */
export const LiveTesting: Story = {
  args: { moment: 'services' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^Services/ })).toHaveTextContent(
      'api, web running · mailpit failed',
    )
    const rows = await unfold(canvasElement, 'Services')
    const services = within(rows)
    await userEvent.click(services.getByRole('link', { name: 'http://localhost:3012' }))
    await expect(args.onOpenLink).toHaveBeenCalledWith('http://localhost:3012')
    await userEvent.click(services.getByRole('button', { name: 'Copy the address of api' }))
    await expect(args.onCopy).toHaveBeenCalledWith('http://localhost:3012')
    await userEvent.click(services.getByRole('button', { name: 'Restart web' }))
    await expect(args.onService).toHaveBeenCalledWith('web', 'restart')
    // A running service is not removed: its × stops it.
    await expect(services.queryByRole('button', { name: 'Remove api' })).toBeNull()
    await userEvent.click(services.getByRole('button', { name: 'Stop api' }))
    await expect(args.onService).toHaveBeenCalledWith('api', 'stop')
    await userEvent.click(services.getByRole('button', { name: 'Start worker' }))
    await expect(args.onService).toHaveBeenCalledWith('worker', 'start')
    await userEvent.click(services.getByRole('button', { name: 'Remove worker' }))
    await expect(args.onService).toHaveBeenCalledWith('worker', 'remove')
    await expect(services.getByText(/Port 1025 is already in use/)).toBeVisible()
  },
}

const png = (name: string, bytes: number): File =>
  new File([new Uint8Array(bytes)], name, {
    type: name.endsWith('.gif') ? 'image/gif' : 'image/png',
  })

/**
 * Writing a remark: a remark or a question, images attached, pasted or dropped — kept, or refused
 * with the reason. Adding it sends nothing: it waits in the next round, and Fix appears.
 */
export const WritingARemark: Story = {
  args: { moment: 'writing' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /^Fix/ })).toBeNull()
    const field = canvas.getByRole('textbox', { name: 'A remark from your live test' })
    await userEvent.type(field, 'The header says UTC.')
    await userEvent.upload(canvas.getByLabelText('Attach images'), [
      png('header.png', 2048),
      png('loop.gif', 1024),
    ])
    const images = await waitFor(() => canvas.getByRole('list', { name: 'Images of the remark' }))
    await expect(within(images).getByText('header.png')).toBeVisible()
    await expect(within(images).getByText(/GIF is not kept: png, jpeg or webp/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Add the remark' }))
    await expect(args.onRemark).toHaveBeenCalledWith('add', {
      kind: 'remark',
      text: 'The header says UTC.',
      images: ['header.png'],
    })
    const next = await waitFor(() => canvas.getByRole('list', { name: 'Next round' }))
    await expect(within(next).getByText('The header says UTC.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Fix · round 2' })).toBeVisible()
  },
}

/** A question rather than a remark: it gets an answer and never becomes a task. */
export const AskingAQuestion: Story = {
  args: { moment: 'writing' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Question' }))
    await expect(canvas.getByRole('button', { name: 'Question' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const field = canvas.getByRole('textbox', { name: 'A question for the agent' })
    await userEvent.type(field, 'Why a stream?{Enter}')
    await expect(args.onRemark).toHaveBeenCalledWith('add', {
      kind: 'question',
      text: 'Why a stream?',
      images: [],
    })
  },
}

/**
 * The next round being written: four remarks wait, one written in the diff with its place, one
 * with two images. Each opens to its whole text, Edit and Withdraw; Fix sends them all.
 */
export const RemarksWaiting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const next = within(canvas.getByRole('list', { name: 'Next round' }))
    await expect(next.getAllByRole('listitem')).toHaveLength(4)
    await expect(next.getByText('api/src/billing/export.query.ts:57')).toBeVisible()
    await userEvent.click(next.getByRole('button', { name: /F6/ }))
    await userEvent.click(await waitFor(() => next.getByRole('button', { name: 'Edit F6' })))
    const edit = await waitFor(() => next.getByRole('textbox', { name: 'F6' }))
    await userEvent.clear(edit)
    await userEvent.type(edit, 'The export keeps the previous customer.')
    await userEvent.click(next.getByRole('button', { name: 'Save F6' }))
    await expect(args.onRemark).toHaveBeenCalledWith('edit', {
      id: 'F6',
      text: 'The export keeps the previous customer.',
    })
    await userEvent.click(next.getByRole('button', { name: 'Withdraw F6' }))
    await expect(args.onRemark).toHaveBeenCalledWith('withdraw', { id: 'F6' })
    await userEvent.click(canvas.getByRole('button', { name: 'Fix · round 2' }))
    await expect(args.onFix).toHaveBeenCalled()
  },
}

/** A remark written in the diff opens the diff where it was written. */
export const RemarkFromTheDiff: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /F8/ }))
    await userEvent.click(
      await waitFor(() =>
        canvas.getByRole('button', { name: 'api/src/billing/export.query.ts:57' }),
      ),
    )
    await expect(args.onOpenDiff).toHaveBeenCalledWith('api/src/billing/export.query.ts:57')
    await waitFor(() => {
      expect(canvas.getByRole('region', { name: 'Diff' })).toBeVisible()
    })
  },
}

/**
 * Fix pressed: the round's questions are in For you, one wave after the other, the answered one
 * folded; the remarks sent read "in round 2"; Ship waits, and says why.
 */
export const Grilling: Story = {
  args: { moment: 'grilling' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const forYou = within(canvas.getByRole('region', { name: 'For you' }))
    await expect(forYou.getByRole('button', { name: /^Round 2 · questions/ })).toHaveTextContent(
      '2 to answer',
    )
    await expect(forYou.getByText(/Should the progress stay hidden/)).toBeVisible()
    await expect(canvas.getAllByRole('img', { name: 'In round 2' }).length).toBe(4)
    await expect(canvas.queryByRole('button', { name: /^Fix/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Ship' })).toBeNull()
    await expect(canvas.getByText(/Ship waits: round 2 is open/)).toBeVisible()
  },
}

/**
 * Round 2 back: each remark with what the agent did. Resolve settles one; Follow up writes a new
 * remark tied to it, which waits for the next round.
 */
export const RoundBack: Story = {
  args: { moment: 'back' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const round = within(canvas.getByRole('list', { name: 'Round 2' }))
    await expect(
      round.getAllByRole('img', { name: 'Addressed: resolve it or follow up' }),
    ).toHaveLength(4)
    await userEvent.click(round.getByRole('button', { name: /F6/ }))
    await waitFor(() => {
      expect(round.getByText(/S17 changes the filter twice/)).toBeVisible()
    })
    await userEvent.click(round.getByRole('button', { name: 'Resolve F6' }))
    await expect(args.onRemark).toHaveBeenCalledWith('resolve', { id: 'F6' })
    await userEvent.click(round.getByRole('button', { name: /F7/ }))
    await userEvent.click(
      await waitFor(() => round.getByRole('button', { name: 'Follow up on F7' })),
    )
    const field = await waitFor(() => canvas.getByRole('textbox', { name: 'A follow-up on F7' }))
    await userEvent.type(field, 'Still visible at 900 ms.{Enter}')
    await expect(args.onRemark).toHaveBeenCalledWith('add', {
      kind: 'remark',
      text: 'Still visible at 900 ms.',
      images: [],
      follows: 'F7',
    })
    // The round before is one line, folded, and opens to its own remarks.
    const before = canvas.getByRole('button', { name: /^Round 1/ })
    await expect(before).toHaveAttribute('aria-expanded', 'false')
  },
}

/** A closed round stays readable: its remarks resolved or withdrawn, its view a press away. */
export const ClosedRoundInHistory: Story = {
  args: { moment: 'back' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Round 1/ }))
    const round = await waitFor(() => canvas.getByRole('list', { name: 'Round 1' }))
    await expect(within(round).getAllByRole('img', { name: 'Resolved' }).length).toBeGreaterThan(0)
    await expect(within(round).getByRole('img', { name: 'Withdrawn' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Open round 1' }))
    await waitFor(() => {
      expect(canvas.getByRole('region', { name: 'Round 1' })).toBeVisible()
    })
  },
}

/**
 * The pull requests, one row per repository: billing waits for a click (its need on top), shared
 * is being pushed, api's is open with its link, CI and approvals, web's CI runs, ui-kit's push
 * failed with the remote's message and Retry; GitHub's CLI signed out is a need on top.
 */
export const PullRequests: Story = {
  args: { moment: 'pulls' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const rows = within(await unfold(canvasElement, 'Pull requests'))
    await expect(rows.getByText('Waits for your click')).toBeVisible()
    await expect(rows.getByText('pushing the branch')).toBeVisible()
    await userEvent.click(rows.getByRole('link', { name: 'api #412' }))
    await expect(args.onOpenLink).toHaveBeenCalledWith('https://github.com/acme/api/pull/412')
    await expect(rows.getByText(/protected branch hook declined/)).toBeVisible()
    await userEvent.click(rows.getByRole('button', { name: 'Retry ui-kit' }))
    await expect(args.onPull).toHaveBeenCalledWith('ui-kit', 'retry')
    await expect(rows.getAllByText('2 images published').length).toBeGreaterThan(0)
    await expect(canvas.getByText('GitHub’s CLI is signed out')).toBeVisible()
    await expect(
      canvas.getByText('billing waits for your click to push and open its pull request'),
    ).toBeVisible()
  },
}

/** On Bitbucket, which hosts no image: the images are listed by name in the description. */
export const ImagesListedByName: Story = {
  args: { moment: 'pulls', forge: 'Bitbucket' },
  play: async ({ canvasElement }) => {
    const rows = within(await unfold(canvasElement, 'Pull requests'))
    await expect(rows.getAllByText('2 images listed by name').length).toBeGreaterThan(0)
  },
}

/**
 * The team's comments in For you: the comment, the agent's reading, the reply it drafted (which
 * stays here: Copy, then answer on the forge), My take, Add to the round, Dismiss, Open on GitHub;
 * the one resolved on the forge is in the rest, resolved.
 */
export const TeamComments: Story = {
  args: { moment: 'team' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const forYou = within(canvas.getByRole('region', { name: 'For you' }))
    await userEvent.click(forYou.getByRole('button', { name: /ana\.lopez/ }))
    await waitFor(() => {
      expect(forYou.getByText(/Asks for a limit on concurrent exports/)).toBeVisible()
    })
    await userEvent.click(forYou.getByRole('button', { name: 'Copy the reply to C1' }))
    await expect(args.onCopy).toHaveBeenCalledWith(expect.stringMatching(/^Good catch/))
    await userEvent.click(forYou.getByRole('button', { name: 'Open C1 on GitHub' }))
    await expect(args.onOpenLink).toHaveBeenCalledWith(
      'https://github.com/acme/shop/pull/412#discussion_r1',
    )
    await userEvent.type(forYou.getByRole('textbox', { name: 'My take on C1' }), 'One per user.')
    await userEvent.click(forYou.getByRole('button', { name: 'Add C1 to the round' }))
    await expect(args.onTeam).toHaveBeenCalledWith('C1', 'round', 'One per user.')
    await userEvent.click(forYou.getByRole('button', { name: /bram\.de-vries/ }))
    await userEvent.click(await waitFor(() => forYou.getByRole('button', { name: 'Dismiss C2' })))
    await expect(args.onTeam).toHaveBeenCalledWith('C2', 'dismiss', '')
    const resolved = canvas.getByRole('button', { name: /^Team comments/ })
    await expect(resolved).toHaveTextContent('1 resolved on GitHub')
  },
}

/** A repository changed outside Hemera: the mark in the header, the changes open and calling. */
export const ChangedOutsideHemera: Story = {
  args: { moment: 'outside' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getAllByRole('img', { name: 'web changed outside Hemera' }).length,
    ).toBeGreaterThan(0)
    const changes = canvas.getByRole('button', { name: /^Changes/ })
    await expect(changes).toHaveAttribute('aria-expanded', 'true')
    await expect(changes).toHaveTextContent('web changed outside Hemera')
    await expect(canvas.getByText('web/src/billing/format.ts')).toBeVisible()
    // It does not hold Ship back: the confirmation says what it re-runs.
    await expect(canvas.getByRole('button', { name: 'Ship' })).toBeVisible()
  },
}

/** Ship cannot be pressed: it is not there, and the line under its place says every reason. */
export const ShipRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Ship' })).toBeNull()
    await expect(
      canvas.getByText('Ship waits: 4 remarks are not sent · 3 addressed remarks wait for you'),
    ).toBeVisible()
  },
}

/** Ship pressed when nothing needs saying: a short confirmation, what leaves, and the CI green. */
export const ShipConfirmation: Story = {
  args: { moment: 'ready' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(within(cardOf(canvasElement)).getByRole('status')).toHaveTextContent(
      'Nothing waits',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Ship' }))
    const dialog = within(await waitFor(() => within(document.body).getByRole('dialog')))
    await waitFor(() =>
      expect(dialog.getByRole('heading', { name: 'Ship ACME-12?' })).toBeVisible(),
    )
    await expect(
      dialog.getAllByRole('listitem', { name: /^(api|web|shared|ui-kit|billing)$/ }),
    ).toHaveLength(5)
    await expect(dialog.queryByRole('region', { name: 'Changed outside Hemera' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Ship now' }))
    await expect(args.onShip).toHaveBeenCalled()
  },
}

/**
 * The confirmation with everything to say: the changes made outside Hemera that leave and what
 * they make to redo, a proof verified by hand not validated (open question 78: listed, Ship stays
 * possible), a rule of the Project changed since the mission copied it, a CI still running.
 */
export const ShipConfirmationInFull: Story = {
  args: { moment: 'outside', preview: 'full' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Ship' }))
    const dialog = within(await waitFor(() => within(document.body).getByRole('dialog')))
    const outside = within(dialog.getByRole('region', { name: 'Changed outside Hemera' }))
    await waitFor(() => expect(outside.getByText('web/src/billing/export-row.tsx')).toBeVisible())
    await expect(outside.getByText(/web · unit tests/)).toBeVisible()
    const hand = within(dialog.getByRole('region', { name: 'Not validated by you' }))
    await expect(hand.getByText(/S13/)).toBeVisible()
    const rules = within(dialog.getByRole('region', { name: 'Rules changed since this mission' }))
    await expect(rules.getByText(/squash/)).toBeVisible()
    const ci = within(dialog.getByRole('region', { name: 'Pull requests’ CI' }))
    await expect(ci.getByRole('img', { name: 'Running' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Ship now' })).toBeEnabled()
  },
}

/** Ship under way: what the changes outside Hemera touch, re-run one after the other before the push. */
export const ShipInProgress: Story = {
  args: { moment: 'shipping' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(within(cardOf(canvasElement)).getByText('1 of 3 re-run')).toBeVisible()
    const reruns = within(canvas.getByRole('list', { name: 'Re-run before pushing' }))
    await expect(reruns.getByRole('img', { name: 'Running' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Ship' })).toBeNull()
  },
}

/** A red re-run stops Ship: the card says so, the need on top shows the output, nothing left. */
export const RedRerunStopsShip: Story = {
  args: { moment: 'stopped' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(within(cardOf(canvasElement)).getByRole('status')).toHaveTextContent(
      /Nothing was pushed/,
    )
    const reruns = within(canvas.getByRole('list', { name: 'Re-run before pushing' }))
    await expect(reruns.getByText(/expected '¥1,200'/)).toBeVisible()
    await expect(
      canvas.getByText('Ship stopped: web · unit tests are red after the re-run'),
    ).toBeVisible()
    await expect(canvas.getByText(/Ship waits: web · unit tests are red/)).toBeVisible()
  },
}

/**
 * The Local preset: no forge, so no pull request; the action is Mark as delivered, a dated
 * stamp. Open question 80, recommended: it merges the mission's branch into the local base, fast
 * forward when it can, and says so before it goes.
 */
export const LocalMarkAsDelivered: Story = {
  args: { moment: 'local', preview: 'local' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /^Pull requests/ })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Mark as delivered' }))
    const dialog = within(await waitFor(() => within(document.body).getByRole('dialog')))
    await waitFor(() =>
      expect(dialog.getByRole('heading', { name: 'Mark ACME-12 as delivered?' })).toBeVisible(),
    )
    await expect(dialog.getAllByText(/into develop, here/).length).toBe(5)
    await userEvent.click(dialog.getByRole('button', { name: 'Mark as delivered' }))
    await expect(args.onShip).toHaveBeenCalled()
  },
}

/**
 * Open question 49, recommended: once only the team holds Ship — an approval, a CI — the ball is
 * someone else's: the dotted ring of what Hemera does not run, its tooltip "Waiting on someone",
 * and beside it, in words, who.
 */
export const WaitingOnTheTeam: Story = {
  args: { moment: 'waitingOnTeam' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Waiting on someone' })).toBeVisible()
    await expect(
      canvas.getByText('Waiting on ana.lopez’s approval of api #412 and web #413’s CI'),
    ).toBeVisible()
    await expect(canvas.getByText(/Ship waits: api #412 needs 1 approval/)).toBeVisible()
  },
}

/** The first read on its way: the card's face loading, the feedback's rows as skeletons. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Feedback' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await expect(within(cardOf(canvasElement)).getByRole('status')).toHaveTextContent(
      'Reading where Review stands',
    )
  },
}

/**
 * Long text everywhere: a 2,000-character remark, a long path, a long list of reviewers, a long
 * title. Each stays on its line until opened; nothing pushes the rail.
 */
export const LongText: Story = {
  args: { moment: 'feedback', long: true, title: LONG_TITLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const next = within(canvas.getByRole('list', { name: 'Next round' }))
    const long = next.getByRole('button', { name: /F10/ })
    await userEvent.click(long)
    await waitFor(() => {
      expect(
        next.getByText(/Again, the first point matters most/, { selector: 'span' }),
      ).toBeVisible()
    })
    await expect(
      next.getAllByText(
        'web/src/features/billing/invoices/export/components/export-button/export-progress-indicator.tsx:142',
      ).length,
    ).toBe(1)
    const rows = within(await unfold(canvasElement, 'Pull requests'))
    await expect(rows.getByText(/lea\.dubois/)).toBeVisible()
  },
}

/**
 * The keyboard path: the rail first (the card, For you, the folds), then the feedback; each line
 * opens on Enter with a visible ring; a round's view opens from its line and gives the focus back.
 */
export const KeyboardPath: Story = {
  args: { moment: 'back' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const services = canvas.getByRole('button', { name: /^Services/ })
    await tabTo(services)
    await expect(services.matches(':focus-visible')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect(services).toHaveAttribute('aria-expanded', 'true')
    const field = canvas.getByRole('textbox', { name: 'A remark from your live test' })
    await tabTo(field)
    const open = canvas.getByRole('button', { name: 'Open round 2' })
    await tabTo(open)
    await expect(open.matches(':focus-visible')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(canvas.getByRole('heading', { name: 'Round 2', level: 2 })).toHaveFocus()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(open).toHaveFocus()
    })
  },
}
