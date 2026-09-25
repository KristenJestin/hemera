import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { TooltipProvider } from '../../components/tooltip/tooltip.tsx'
import { SESSIONS, SESSIONS_V6, type SessionName } from './fixtures.tsx'
import { Variant } from './layouts.tsx'
import { V6Layout } from './v6.tsx'

/**
 * Where the chat stands in a Session, and how it gives a build its room (design exploration of
 * 25 September 2026). Storybook only: nothing here is wired, and the engine is untouched.
 *
 * Every variant is shown on the same six Sessions, in order: a `free` one, a `define` one, and a
 * build — building, blocked on the Spec, done and waiting for the user's review, and the review
 * restated by the agent point by point.
 *
 * - V1 · the chat always on the left, the mission panel on the right at a width the hand drags;
 *   a build opens it at two thirds.
 * - V2 · the chat at the centre, the panel on the right; the chat minimises to a bar docked in a
 *   strip at the bottom of the page, and the panel takes the page. Open in define, minimised in
 *   build.
 * - V3 · V2 with the minimised chat as a bubble floating at the bottom right.
 * - V4 · no chat in build: the build full width, the thread in a Conversation tab, the replies
 *   written in place.
 * - V5 · V2 whose bar holds the answer: what the agent asks — a blocker, points to confirm — is
 *   answered from the bar, without opening the chat.
 * - V6 (second round) · V2's layout without the strip: the chat minimised to a bubble at the
 *   bottom left, the side it opens from; V1's display of the build at full page; decisions in the
 *   panel (Accept and the review restated, the answer to a blocker), words in the chat; the
 *   Workspace a label in define and build; the Spec's fold moving both ways.
 *
 * Common to all: the build panel is the Spec annotated with its progress, the tasks a detail
 * under each story, one Stop build in its head, and "0 of 2 stories done" instead of the chips.
 */

type Variants = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6'

function Page({ variant, session }: { variant: Variants; session: SessionName }): ReactNode {
  return (
    <TooltipProvider>
      <div className="h-screen">
        {variant === 'v6' ? (
          <V6Layout session={SESSIONS_V6[session]} />
        ) : (
          <Variant variant={variant} session={SESSIONS[session]} />
        )}
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Explorations/Session layout',
  component: Page,
  tags: ['new'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Page>

export default meta

type Story = StoryObj<typeof meta>

/** Confirms every restated point in a scope, one after the other, as a hand would. */
async function confirmAll(scope: ReturnType<typeof within>): Promise<void> {
  const next = scope.queryAllByRole('button', { name: 'OK' })[0]
  if (next === undefined) return
  await userEvent.click(next)
  await confirmAll(scope)
}

/** The one Stop build of a build page, in the build's head, and nowhere else. */
async function oneStop(canvas: ReturnType<typeof within>): Promise<void> {
  await expect(canvas.getAllByRole('button', { name: 'Stop build' })).toHaveLength(1)
  await expect(canvas.queryByText(/S1 · open/)).toBeNull()
}

// ---------------------------------------------------------------------------------------------
// V1 · split, chat left

export const V1Free: Story = {
  name: 'V1 · 1 Free',
  args: { variant: 'v1', session: 'free' },
}

export const V1Define: Story = {
  name: 'V1 · 2 Define',
  args: { variant: 'v1', session: 'define' },
}

export const V1Building: Story = {
  name: 'V1 · 3 Build, building',
  args: { variant: 'v1', session: 'building' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    const handle = canvas.getByRole('separator', { name: 'Width of the mission panel' })
    await expect(handle).toHaveAttribute('aria-valuenow', '67')
    handle.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(handle).toHaveAttribute('aria-valuenow', '62')
  },
}

export const V1Blocked: Story = {
  name: 'V1 · 4 Build, blocked',
  args: { variant: 'v1', session: 'blocked' },
}

export const V1Review: Story = {
  name: 'V1 · 5 Build, waiting for review',
  args: { variant: 'v1', session: 'review' },
}

export const V1Restated: Story = {
  name: 'V1 · 6 Build, review restated',
  args: { variant: 'v1', session: 'restated' },
}

// ---------------------------------------------------------------------------------------------
// V2 · chat centre, minimised to a docked bar

export const V2Free: Story = {
  name: 'V2 · 1 Free',
  args: { variant: 'v2', session: 'free' },
}

export const V2Define: Story = {
  name: 'V2 · 2 Define',
  args: { variant: 'v2', session: 'define' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Minimise the chat' }))
    const bar = await canvas.findByRole('region', { name: 'Chat, minimised' })
    await waitFor(() => expect(within(bar).getByRole('button', { name: /Open/ })).toHaveFocus())
    await userEvent.click(within(bar).getByRole('button', { name: /Open/ }))
    await waitFor(() =>
      expect(canvas.queryByRole('region', { name: 'Chat, minimised' })).toBeNull(),
    )
  },
}

export const V2Building: Story = {
  name: 'V2 · 3 Build, building',
  args: { variant: 'v2', session: 'building' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    await expect(canvas.getByText('0 of 2 stories done')).toBeVisible()
    // Minimised by default in build: the chat is out of reach, the bar says what the agent does.
    await expect(canvas.queryByRole('region', { name: 'Chat' })).toBeNull()
    const bar = canvas.getByRole('region', { name: 'Chat, minimised' })
    await expect(bar).toHaveTextContent('Working on S1 · the column order')
  },
}

export const V2Blocked: Story = {
  name: 'V2 · 4 Build, blocked',
  args: { variant: 'v2', session: 'blocked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    const bar = canvas.getByRole('region', { name: 'Chat, minimised' })
    await expect(bar).toHaveTextContent('Blocker on S2')
    // It previews and waits: nothing unfolds until the hand opens it.
    await expect(canvas.queryByRole('region', { name: 'Chat' })).toBeNull()
  },
}

export const V2Review: Story = {
  name: 'V2 · 5 Build, waiting for review',
  args: { variant: 'v2', session: 'review' },
}

export const V2Restated: Story = {
  name: 'V2 · 6 Build, review restated',
  args: { variant: 'v2', session: 'restated' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Open/ }))
    const restated = await canvas.findByRole('region', { name: 'Your review, restated' })
    await confirmAll(within(restated))
    await expect(within(restated).getByRole('status')).toHaveTextContent('All confirmed')
  },
}

// ---------------------------------------------------------------------------------------------
// V3 · chat centre, minimised to a floating bubble

export const V3Free: Story = {
  name: 'V3 · 1 Free',
  args: { variant: 'v3', session: 'free' },
}

export const V3Define: Story = {
  name: 'V3 · 2 Define',
  args: { variant: 'v3', session: 'define' },
}

export const V3Building: Story = {
  name: 'V3 · 3 Build, building',
  args: { variant: 'v3', session: 'building' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    await userEvent.click(canvas.getByRole('button', { name: /Open the chat/ }))
    await expect(await canvas.findByRole('region', { name: 'Chat' })).toBeVisible()
  },
}

export const V3Blocked: Story = {
  name: 'V3 · 4 Build, blocked',
  args: { variant: 'v3', session: 'blocked' },
}

export const V3Review: Story = {
  name: 'V3 · 5 Build, waiting for review',
  args: { variant: 'v3', session: 'review' },
}

export const V3Restated: Story = {
  name: 'V3 · 6 Build, review restated',
  args: { variant: 'v3', session: 'restated' },
}

// ---------------------------------------------------------------------------------------------
// V4 · no chat in build, a Conversation tab

export const V4Free: Story = {
  name: 'V4 · 1 Free',
  args: { variant: 'v4', session: 'free' },
}

export const V4Define: Story = {
  name: 'V4 · 2 Define',
  args: { variant: 'v4', session: 'define' },
}

export const V4Building: Story = {
  name: 'V4 · 3 Build, building',
  args: { variant: 'v4', session: 'building' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    await expect(canvas.getByRole('textbox', { name: 'Tell the agent' })).toBeVisible()
  },
}

export const V4Blocked: Story = {
  name: 'V4 · 4 Build, blocked',
  args: { variant: 'v4', session: 'blocked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: 'Reply' })).toBeVisible()
  },
}

export const V4Review: Story = {
  name: 'V4 · 5 Build, waiting for review',
  args: { variant: 'v4', session: 'review' },
}

export const V4Restated: Story = {
  name: 'V4 · 6 Build, review restated',
  args: { variant: 'v4', session: 'restated' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: /Conversation/ }))
    await expect(await canvas.findByRole('region', { name: 'Your review, restated' })).toBeVisible()
  },
}

// ---------------------------------------------------------------------------------------------
// V5 · V2, answered from the bar

export const V5Free: Story = {
  name: 'V5 · 1 Free',
  args: { variant: 'v5', session: 'free' },
}

export const V5Define: Story = {
  name: 'V5 · 2 Define',
  args: { variant: 'v5', session: 'define' },
}

export const V5Building: Story = {
  name: 'V5 · 3 Build, building',
  args: { variant: 'v5', session: 'building' },
}

export const V5Blocked: Story = {
  name: 'V5 · 4 Build, blocked',
  args: { variant: 'v5', session: 'blocked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bar = canvas.getByRole('region', { name: 'Chat, minimised' })
    await expect(within(bar).getByRole('textbox', { name: 'Reply to the agent' })).toBeVisible()
  },
}

export const V5Review: Story = {
  name: 'V5 · 5 Build, waiting for review',
  args: { variant: 'v5', session: 'review' },
}

export const V5Restated: Story = {
  name: 'V5 · 6 Build, review restated',
  args: { variant: 'v5', session: 'restated' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bar = canvas.getByRole('region', { name: 'Chat, minimised' })
    await confirmAll(within(bar))
    await expect(within(bar).getByRole('status')).toHaveTextContent('All confirmed')
    // Answered from the bar: the chat never opened.
    await expect(canvas.queryByRole('region', { name: 'Chat' })).toBeNull()
  },
}

// ---------------------------------------------------------------------------------------------
// V6 · V2 without the strip, a bubble on the left, decisions in the panel

/** Whether two boxes share any point. */
function overlap(one: DOMRect, other: DOMRect): boolean {
  return (
    one.left < other.right &&
    other.left < one.right &&
    one.top < other.bottom &&
    other.top < one.bottom
  )
}

/** The controls of the panel the minimised chat stands over, by name: none, or it hides them. */
function covered(canvasElement: HTMLElement): string[] {
  const bubble = canvasElement.querySelector<HTMLElement>('[data-bubble]')
  const panel = canvasElement.querySelector<HTMLElement>('[data-panel]')
  if (bubble === null || panel === null) throw new Error('no bubble or no panel on the page')
  const zones = [...bubble.children].map((part) => part.getBoundingClientRect())
  const controls = [
    ...panel.querySelectorAll<HTMLElement>('button, input, textarea, a[href], [role="combobox"]'),
  ]
  return controls
    .filter((control) => zones.some((zone) => overlap(zone, control.getBoundingClientRect())))
    .map((control) => control.getAttribute('aria-label') ?? control.textContent ?? '')
}

/**
 * The bubble and its preview hide nothing of the build: not at the top of the panel, and not
 * once it is scrolled to its end, where the last controls of a long build stand.
 */
async function hidesNothing(canvasElement: HTMLElement): Promise<void> {
  await expect(covered(canvasElement)).toEqual([])
  for (const region of canvasElement.querySelectorAll<HTMLElement>(
    '[data-panel] [role="region"]',
  )) {
    region.scrollTop = region.scrollHeight
  }
  await expect(covered(canvasElement)).toEqual([])
}

/** No footer strip: the page is the head and the row, and nothing under them. */
async function noStrip(canvas: ReturnType<typeof within>): Promise<void> {
  await expect(canvas.queryByRole('region', { name: 'Chat, minimised' })).toBeNull()
}

export const V6Free: Story = {
  name: 'V6 · 1 Free',
  args: { variant: 'v6', session: 'free' },
  play: async ({ canvasElement }) => {
    // Free: the Workspace is still a choice.
    await expect(within(canvasElement).getByLabelText('Workspace')).toBeEnabled()
  },
}

export const V6Define: Story = {
  name: 'V6 · 2 Define',
  args: { variant: 'v6', session: 'define' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Bound to its Spec: the Workspace is said, not offered.
    await expect(canvas.queryByLabelText('Workspace')).toBeNull()
    await expect(canvas.getByText('main')).toBeVisible()
    // The Spec folds and unfolds, the same way both ways.
    await userEvent.click(canvas.getByRole('button', { name: 'Fold the Spec' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Unfold the Spec' }))
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: 'Unfold the Spec' })).toBeNull(),
    )
    // Minimised, the chat is a bubble on the left, and the Spec at full page keeps clear of it.
    await userEvent.click(canvas.getByRole('button', { name: 'Minimise the chat' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: /Open the chat/ })).toHaveFocus())
    await noStrip(canvas)
    await hidesNothing(canvasElement)
  },
}

export const V6Building: Story = {
  name: 'V6 · 3 Build, building',
  args: { variant: 'v6', session: 'building' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    await noStrip(canvas)
    await expect(canvas.queryByRole('region', { name: 'Chat' })).toBeNull()
    await hidesNothing(canvasElement)
    // Opened, the chat is at the centre and the composer says the Workspace, bound.
    await userEvent.click(canvas.getByRole('button', { name: /Open the chat/ }))
    await expect(await canvas.findByRole('region', { name: 'Chat' })).toBeVisible()
    await expect(canvas.getByText('atl-7-csv-export')).toBeVisible()
    await expect(canvas.queryByLabelText('Workspace')).toBeNull()
  },
}

export const V6Blocked: Story = {
  name: 'V6 · 4 Build, blocked',
  args: { variant: 'v6', session: 'blocked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    // The preview beside the bubble says it and waits: nothing unfolds by itself.
    const preview = canvas.getByRole('region', { name: 'The agent needs you' })
    await expect(preview).toHaveTextContent('Answer it in the panel')
    await expect(canvas.queryByRole('region', { name: 'Chat' })).toBeNull()
    await hidesNothing(canvasElement)
    // The answer is a decision of the panel.
    const blocker = canvas.getByRole('group', { name: 'Blocker' })
    await userEvent.click(within(blocker).getByRole('button', { name: /file of their own/ }))
    await expect(within(blocker).getByRole('status')).toHaveTextContent('The agent goes on')
  },
}

export const V6Review: Story = {
  name: 'V6 · 5 Build, waiting for review',
  args: { variant: 'v6', session: 'review' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    await expect(canvas.getByRole('button', { name: 'Accept' })).toBeVisible()
    await hidesNothing(canvasElement)
  },
}

export const V6Restated: Story = {
  name: 'V6 · 6 Build, review restated',
  args: { variant: 'v6', session: 'restated' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneStop(canvas)
    await hidesNothing(canvasElement)
    // The restated review is in the panel, beside Accept, one row per point.
    const review = canvas.getByRole('list', { name: 'Your review, restated' })
    await expect(within(review).getAllByRole('listitem')).toHaveLength(3)
    await expect(within(review).getByText('This changes the Spec: rework?')).toBeVisible()
    await confirmAll(within(review))
    await expect(canvas.getByRole('status')).toHaveTextContent('All confirmed')
    await expect(canvas.queryByRole('button', { name: 'Accept' })).toBeNull()
  },
}
