import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { HemeraToolCall } from '../activity/hemera-tool-call.tsx'
import { PermissionRequest } from '../approval/permission-request.tsx'
import { BlockedBanner } from '../composer/blocked-banner.tsx'
import { Composer } from '../composer/composer.tsx'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { AgentText } from '../message/agent-text.tsx'
import { MessageScroller, type ScrollerEntry } from '../message/scroller/scroller.tsx'
import { SessionHeader } from '../session/session.tsx'
import { MissionBrief } from '../spec/mission-brief.tsx'
import { READY } from '../spec/spec-fixtures.ts'
import {
  ACCEPTED,
  BLOCKED,
  BUILDING,
  FINAL_CHECKS_RED,
  GETTING_READY,
  NOW,
  PAUSED,
  YOURS,
} from './build-fixtures.ts'
import { BuildSession } from './build-session.tsx'
import type { BuildViewData } from './model.ts'

/**
 * A `build` Session (lot 22, D10-12): the define layout turned over. The build view at the centre
 * with the larger part of the row; the chat narrow on the right, foldable to its band; "Spec"
 * opening the frozen Spec beside the view, read only, the chat folding to give it the room. What
 * waits for the user in the build is said in the view and as a banner above the composer, and a
 * permission the agent asks stands in the thread, the composer saying the turn waits.
 *
 * Every screen is the build of `ATL-7` at one moment, left as it opens: its play asserts and
 * changes nothing. The paths through it — the Spec and the chat taking turns, a banner opening
 * its task, the keyboard — are stories of their own.
 */

/** A Hemera line of the thread. */
function hemera(id: string, title: string, detail: string, brief?: string): ScrollerEntry {
  return { id, content: <MissionBrief title={title} detail={detail} brief={brief} /> }
}

/** What the agent said. */
function agents(id: string, text: string): ScrollerEntry {
  return { id, content: <AgentText text={text} /> }
}

const BRIEF =
  '**Building** · work through the ready tasks of `ATL-7`: **T2** · A CSV in the column order of the ledger (try 2 of 3: the header order was red), **T3** · Credit notes as negative rows.'

/** The thread of the build, from the brief to the calls of the build's own tools. */
const THREAD: ScrollerEntry[] = [
  hemera('brief', 'What the agent was told · Building', '10:28', BRIEF),
  {
    id: 'read',
    content: (
      <HemeraToolCall
        tool="build_read"
        label="Read build"
        mark="read-build"
        status="completed"
        summary="Reading the build of ATL-7"
      />
    ),
  },
  agents(
    'answer',
    'T2 was red on the header order: the ledger wants the number before the client. I am fixing the writer, then T3 from the same query.',
  ),
  {
    id: 'finished',
    content: (
      <HemeraToolCall
        tool="task_finished"
        label="Task finished"
        mark="finish-task"
        subject={{ text: 'T3' }}
        status="completed"
        summary="T3 handed to its checks"
      />
    ),
  },
]

/** A permission the agent asks, in the thread, which the composer says it waits on. */
const PERMISSION: ScrollerEntry = {
  id: 'permission',
  content: (
    <PermissionRequest
      toolName="commands_run"
      label="Run command"
      subject="pnpm vitest run src/billing/export-csv.test.ts"
      intent="asks to run the test it wrote for the header order"
      options={[
        { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'reject-once', kind: 'reject_once', name: 'Reject once' },
      ]}
      onDecide={fn()}
    />
  ),
}

/** The chat of the Session: its thread and its composer, the banner of the build above it. */
function Chat({
  thread,
  banner,
  asking,
}: {
  thread: ScrollerEntry[]
  banner: ReactNode
  asking: boolean
}): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  return (
    <>
      <MessageScroller className="flex-1" label="The thread of this Session" entries={thread} />
      <div className="flex w-full flex-col px-4 pb-4">
        <Composer
          value={value}
          onValueChange={setValue}
          files={files}
          onFilesChange={setFiles}
          onSearchFiles={() => Promise.resolve([])}
          variant="inline"
          action="Send"
          placeholder="Say something to the agent…"
          onSend={() => Promise.resolve(null)}
          running
          onStop={fn()}
          blocked={
            banner ??
            (asking ? (
              <BlockedBanner waiting="The agent is asking to go on." onStop={fn()} />
            ) : undefined)
          }
        />
      </div>
    </>
  )
}

/** The screens of the build, by name. */
const SCREENS = {
  gettingReady: GETTING_READY,
  building: BUILDING,
  yours: YOURS,
  blocked: BLOCKED,
  paused: PAUSED,
  finalChecks: FINAL_CHECKS_RED,
  accepted: ACCEPTED,
} satisfies Record<string, BuildViewData>

function Screen({
  screen,
  asking = false,
  chatFolded = false,
  specOpen = false,
  onPause,
  onResume,
  onAccept,
  onStop,
  onTaskDone,
  onTaskSkip,
  onDismissBlocker,
}: {
  screen: keyof typeof SCREENS
  /** Whether a permission of the agent waits in the thread. */
  asking?: boolean
  /** Whether the chat opens folded to its band. */
  chatFolded?: boolean
  /** Whether the frozen Spec opens beside the view. */
  specOpen?: boolean
  onPause: () => void
  onResume: () => void
  onAccept: () => void
  onStop: () => void
  onTaskDone: (taskId: string) => void
  onTaskSkip: (taskId: string, reason: string, unblock: boolean) => void
  onDismissBlocker: (blockerId: string) => void
}): ReactNode {
  const thread = asking ? [...THREAD, PERMISSION] : THREAD
  return (
    <TooltipProvider>
      <div className="h-screen bg-background text-foreground">
        <BuildSession
          build={SCREENS[screen]}
          now={NOW}
          spec={READY}
          header={
            <div className="border-b border-border px-6 pt-4 pb-3">
              <SessionHeader
                title="Build CSV export"
                projectName="Atlas"
                meta="BUILD · Claude Code · Opus 5 · ATL-7"
                onRename={fn()}
                onStartEditing={fn()}
                onArchive={fn()}
                onOpenDetails={fn()}
              />
            </div>
          }
          chat={(banner) => <Chat thread={thread} banner={banner} asking={asking} />}
          chatWaiting={asking ? 'The agent is asking to go on' : undefined}
          defaultChatFolded={chatFolded}
          defaultSpecOpen={specOpen}
          onPause={onPause}
          onResume={onResume}
          onAccept={onAccept}
          onStop={onStop}
          onTaskDone={onTaskDone}
          onTaskSkip={onTaskSkip}
          onDismissBlocker={onDismissBlocker}
        />
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Surfaces/Session/Build',
  component: Screen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    screen: 'building',
    asking: false,
    chatFolded: false,
    specOpen: false,
    onPause: fn(),
    onResume: fn(),
    onAccept: fn(),
    onStop: fn(),
    onTaskDone: fn(),
    onTaskSkip: fn(),
    onDismissBlocker: fn(),
  },
  argTypes: {
    screen: {
      control: 'select',
      options: Object.keys(SCREENS),
      description: 'Which moment of the build.',
    },
    asking: { control: 'boolean', description: 'Whether a permission waits in the thread.' },
    chatFolded: { control: 'boolean', description: 'Whether the chat opens folded to its band.' },
    specOpen: { control: 'boolean', description: 'Whether the frozen Spec opens beside it.' },
    onPause: { action: 'paused' },
    onResume: { action: 'resumed' },
    onAccept: { action: 'accepted' },
    onStop: { action: 'stopped' },
    onTaskDone: { action: 'task done' },
    onTaskSkip: { action: 'task skipped' },
    onDismissBlocker: { action: 'blocker dismissed' },
  },
} satisfies Meta<typeof Screen>

export default meta

type Story = StoryObj<typeof meta>

/** The width of a region of the page, in pixels. */
function widthOf(canvasElement: HTMLElement, name: string): number {
  return within(canvasElement).getByRole('region', { name }).getBoundingClientRect().width
}

/** The band's own width, read from the theme's rem: three of them. */
const BAND = 48

/**
 * Everything in place: the Session's head across the top, the build at the centre with the
 * larger part of the row — T2 on its second try on the stage — and the chat narrow on the
 * right, the agent's calls to the build's tools in its thread and a permission it asks, which
 * the composer says it waits on.
 */
export const Complete: Story = {
  args: { asking: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Build CSV export' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Stage of T2' })).toBeVisible()
    const chat = widthOf(canvasElement, 'Chat')
    const view = canvas.getByRole('navigation', { name: 'Tasks' }).parentElement!.parentElement!
    await expect(view.getBoundingClientRect().width).toBeGreaterThan(chat * 2)
    const thread = within(canvas.getByRole('region', { name: 'Chat' }))
    await expect(thread.getByRole('button', { name: /Task finished T3/ })).toBeVisible()
    await expect(thread.getByRole('button', { name: 'Allow once' })).toBeVisible()
    await expect(thread.getByText(/The agent is asking to go on/)).toBeVisible()
  },
}

/** Getting ready: the rows are there, and the view waits for the agent's approach. */
export const GettingReady: Story = {
  args: { screen: 'gettingReady' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Waiting for the agent's approach/)).toBeVisible()
  },
}

/** Building: the tasks by state, T2 on the stage, the chat beside it, nothing waiting. */
export const Building: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Building')).toBeVisible()
    await expect(canvas.queryByRole('group', { name: /^Yours:/ })).toBeNull()
  },
}

/**
 * The human task is ready: Yours in the view, on the stage with Done and Skip, and the banner
 * above the composer.
 */
export const Yours: Story = {
  args: { screen: 'yours' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Stage of T4' })).toBeVisible()
    await expect(
      canvas.getByRole('group', { name: 'Yours: T4 · The file imports into the ledger' }),
    ).toBeVisible()
  },
}

/** The agent says T3 contradicts the Spec: the blocker in the view, and its banner in the chat. */
export const Blocked: Story = {
  args: { screen: 'blocked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Stage of T3' })).toBeVisible()
    await expect(
      canvas.getByRole('group', { name: 'T3: the agent says this task contradicts the Spec' }),
    ).toBeVisible()
  },
}

/** Paused: the band under the view's head, Resume where Pause was. */
export const Paused: Story = {
  args: { screen: 'paused' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Resume' })).toBeVisible()
    await expect(canvas.getByText(/nothing new starts until you resume/)).toBeVisible()
  },
}

/** Final checks: every task done, the first final try red, the agent on the second. */
export const FinalChecks: Story = {
  args: { screen: 'finalChecks' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Stage of the final checks' })).toBeVisible()
    await expect(canvas.getByText('final checks on try 2 of 3')).toBeVisible()
  },
}

/** Accepted: over and readable, the branch and the files left in the Workspace. */
export const Accepted: Story = {
  args: { screen: 'accepted' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/delivering them comes next/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Stop build' })).toBeNull()
  },
}

/**
 * The chat folded to its band: the build takes the whole row but the band, which says a
 * permission waits in the chat.
 */
export const ChatFolded: Story = {
  args: { chatFolded: true, asking: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(widthOf(canvasElement, 'Chat')).toBe(BAND)
    await expect(canvas.getByRole('button', { name: 'Unfold the chat' })).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'The agent is asking to go on' })).toBeVisible()
  },
}

/**
 * The frozen Spec open beside the view, read only, the chat folded to its band: the two are
 * never open together.
 */
export const SpecOpen: Story = {
  args: { specOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Spec ATL-7' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Spec' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(widthOf(canvasElement, 'Chat')).toBe(BAND)
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
  },
}

/**
 * The Spec and the chat take turns: "Spec" folds the chat to its band, the band unfolds the chat
 * and closes the Spec, and "Spec" pressed again opens it once more.
 */
export const SpecAndChatTakeTurns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Spec' }))
    await expect(await canvas.findByRole('region', { name: 'Spec ATL-7' })).toBeVisible()
    await waitFor(() => expect(widthOf(canvasElement, 'Chat')).toBe(BAND))
    await userEvent.click(canvas.getByRole('button', { name: 'Unfold the chat' }))
    await waitFor(() => expect(canvas.queryByRole('region', { name: 'Spec ATL-7' })).toBeNull())
    await waitFor(() => expect(widthOf(canvasElement, 'Chat')).toBeGreaterThan(BAND))
    await expect(canvas.getByRole('button', { name: 'Spec' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  },
}

/** The banner's Open puts its task on the view's stage, wherever the view was. */
export const BannerOpensTheTask: Story = {
  args: { screen: 'blocked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^T2 / }))
    await expect(canvas.getByRole('region', { name: 'Stage of T2' })).toBeVisible()
    const banner = within(
      canvas.getByRole('group', { name: 'T3: the agent says this task contradicts the Spec' }),
    )
    await userEvent.click(banner.getByRole('button', { name: 'Open' }))
    await expect(canvas.getByRole('region', { name: 'Stage of T3' })).toBeVisible()
  },
}

/**
 * The keyboard: "Spec" opens the Spec and the keyboard stays on it; the Spec's Close gives the
 * keyboard back to "Spec", and the chat comes back as it was.
 */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const spec = canvas.getByRole('button', { name: 'Spec' })
    spec.focus()
    await userEvent.keyboard('{Enter}')
    await expect(await canvas.findByRole('region', { name: 'Spec ATL-7' })).toBeVisible()
    await expect(spec).toHaveFocus()
    canvas.getByRole('button', { name: 'Close the Spec' }).focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(canvas.queryByRole('region', { name: 'Spec ATL-7' })).toBeNull())
    await expect(spec).toHaveFocus()
    await waitFor(() => expect(widthOf(canvasElement, 'Chat')).toBeGreaterThan(BAND))
  },
}
