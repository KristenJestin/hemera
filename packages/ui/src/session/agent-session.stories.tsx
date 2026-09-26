import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, userEvent, fn, waitFor, within } from 'storybook/test'

import { onOneLine } from '../../.storybook/one-line.ts'
import { DiffBlock } from '../activity/diff-block.tsx'
import { TerminalOutput } from '../activity/terminal-output.tsx'
import { ThoughtBlock } from '../activity/thought-block.tsx'
import { ToolCallCard } from '../activity/tool-call-card.tsx'
import { DecisionSummary } from '../approval/decision-summary.tsx'
import { PermissionRequest } from '../approval/permission-request.tsx'
import { BlockedBanner } from '../composer/blocked-banner.tsx'
import {
  AgentModelMenu,
  type EffortChoice,
  type ModeChoice,
  type ModelChoice,
  type OfferedAgent,
} from '../composer/agent-model-menu.tsx'
import { Composer } from '../composer/composer.tsx'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { AgentText } from '../message/agent-text.tsx'
import { MessageDaySeparator, MessageGroup } from '../message/message.tsx'
import { MessageScroller, type ScrollerEntry } from '../message/scroller/scroller.tsx'
import type { PlanEntry } from './plan-panel.tsx'
import { ResumeFallbackBanner } from './resume-fallback-banner.tsx'
import { SessionEmpty, SessionHeader } from './session.tsx'
import { CommandRun } from '../activity/command-run.tsx'
import { HemeraToolCall } from '../activity/hemera-tool-call.tsx'
import { CommandsPanel } from './commands-panel.tsx'
import { ContextView } from './context-view.tsx'
import { SessionDetails, type SessionDetailsTab, type TouchedFile } from './session-details.tsx'
import { StoppedTurn } from './stopped-turn.tsx'
import { TurnLine } from './turn-line.tsx'

/**
 * A Session with an agent in it, at once (design D17-11, D17-13).
 *
 * Every other story here shows one surface at a time; this one is the surface the reader
 * actually has, and it is the one the lot is judged on: the head, a thread carrying each kind of
 * block an agent reports, the details that hold what is a state rather than an event, and the
 * box the next turn is written in, with what the Session runs on at the end of its own row. A
 * block that reads well alone and badly here is a block that reads badly.
 *
 * The thread is drawn the way the renderer draws it — the user's runs grouped, the agent's
 * entries standing between them — so what this story proves about the page is what the page
 * does. Nothing here reaches an engine: the fixtures are what an agent would have reported.
 */

const PLAN: PlanEntry[] = [
  { content: 'Read the export path and find the join', priority: 'high', status: 'completed' },
  {
    content: 'Stream the rows instead of building the file',
    priority: 'high',
    status: 'completed',
  },
  { content: 'Cover the streaming path with a test', priority: 'medium', status: 'in_progress' },
  { content: 'Measure the export on 40 000 rows', priority: 'low', status: 'pending' },
]

const TOUCHED: TouchedFile[] = [
  { path: 'src/billing/export.ts', added: 24, removed: 11 },
  { path: 'src/billing/export.test.ts', added: 38, removed: 0 },
]

const BEFORE = `export function exportInvoices(rows: Invoice[]): string {
  const lines = rows.map((row) => format(row))
  return lines.join('\\n')
}
`

const AFTER = `export async function exportInvoices(rows: Invoice[], out: Writable): Promise<void> {
  // One row at a time: forty thousand of them do not fit in memory twice.
  for (const row of rows) {
    await out.write(format(row))
  }
}
`

/** The agent of this Session, and the two others this machine has. */
const AGENTS: OfferedAgent[] = [
  { id: 'claude-code', name: 'Claude Code', available: true, signedIn: true },
  { id: 'codex', name: 'Codex', available: true, signedIn: true },
  { id: 'opencode', name: 'OpenCode', available: true, signedIn: true },
]

/** What Claude Code announced: one provider, so the list carries no group header. */
const MODELS: ModelChoice[] = [
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { id: 'claude-opus-4-1', label: 'Opus 4.1' },
]

const EFFORTS: EffortChoice[] = [
  { id: 'low', label: 'Low' },
  { id: 'high', label: 'High' },
]

const MODES: ModeChoice[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'acceptEdits', label: 'Accept edits' },
]

/**
 * The thread, in the order it was written.
 *
 * Only the user's own messages carry a `mark`: the rail is how a reader finds their way back to
 * something *they* asked, and a tick for every block an agent reported was forty ticks for one
 * question. Everything else is read by scrolling through it, which is how it arrived.
 */
const THREAD: ScrollerEntry[] = [
  { id: 'day', day: true as const, content: <MessageDaySeparator day="Today" /> },
  {
    id: 'ask',
    mark: 'The invoice export is slow on forty thousand rows',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="14:02"
        atLabel="Today at 14:02"
        state="saved"
        lines={[
          {
            id: 'ask-1',
            body: 'The invoice export is slow on forty thousand rows — a customer is waiting. Look at it and fix it.',
          },
        ]}
      />
    ),
  },
  {
    id: 'answer',
    content: (
      <AgentText text="The export reads every row and builds the whole file in memory before writing a byte. I will stream it instead: one row read, one row written." />
    ),
  },
  {
    id: 'thought',
    content: (
      <ThoughtBlock seconds={12}>
        <AgentText text="The formatting is not the cost — the join on `invoice_lines` is. Streaming will not fix it on its own, so I will look at the query before I touch the loop." />
      </ThoughtBlock>
    ),
  },
  {
    id: 'read',
    content: (
      <ToolCallCard
        title="Read src/billing/export.ts"
        kind="read"
        status="completed"
        locations={[{ path: 'src/billing/export.ts', line: 42 }]}
        input={'path: src/billing/export.ts\noffset: 20\nlimit: 40'}
        output={BEFORE}
      />
    ),
  },
  {
    id: 'hemera-read',
    content: (
      <HemeraToolCall
        tool="fs_read"
        label="Read file"
        mark="read-file"
        subject={{ text: 'src/billing/export.ts', path: 'src/billing/export.ts' }}
        status="completed"
        summary="1 842 lines, 61 KiB"
        arguments={[
          { label: 'path', value: 'src/billing/export.ts' },
          { label: 'limit', value: '2 000 lines' },
        ]}
        ms={38}
        onOpenPath={fn()}
      />
    ),
  },
  {
    id: 'change',
    content: (
      <DiffBlock path="src/billing/export.ts" oldText={BEFORE} newText={AFTER} defaultOpen />
    ),
  },
  {
    id: 'run',
    content: (
      <TerminalOutput
        terminalId="build"
        output={
          'exporting 40000 rows…\n' +
          '  40000 rows written in 1.8s\n' +
          '  peak heap 41 MB, was 312 MB\n'
        }
      />
    ),
  },
  {
    id: 'failed',
    content: (
      <ToolCallCard
        title="pnpm test --project=repository"
        kind="execute"
        subject={{ text: 'pnpm test --project=repository' }}
        status="failed"
        output={'FAIL src/billing/export.test.ts\n  streams a large export\n'}
        error={
          'src/billing/export.test.ts > streams a large export\n  expected 2 writes, received 1'
        }
      />
    ),
  },
  {
    id: 'cancelled',
    content: (
      <ToolCallCard
        title="pnpm build"
        kind="execute"
        subject={{ text: 'pnpm build' }}
        status="cancelled"
        input="cwd: ."
      />
    ),
  },
  {
    id: 'command',
    content: (
      <CommandRun
        name="dev"
        command="pnpm dev"
        type="serve"
        state="running"
        folder="./sources/front"
        url="http://localhost:5173/"
        readiness="ready"
        output={'vite v7.1.4  ready in 412 ms\n\n  Local:   http://localhost:5173/\n'}
        onOpenUrl={fn()}
        onStop={fn()}
      />
    ),
  },
  {
    id: 'permission',
    content: (
      <PermissionRequest
        toolName="Bash"
        intent="Run the billing suite to prove the streaming path."
        parameters={[{ label: 'Project', value: 'repository' }]}
        command="pnpm test --project=repository"
        scope="this Project, until the window is closed"
        options={[
          { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'allow-always', kind: 'allow_always', name: 'Always allow' },
          { optionId: 'reject-once', kind: 'reject_once', name: 'Reject once' },
          { optionId: 'reject-always', kind: 'reject_always', name: 'Never allow' },
        ]}
        onDecide={fn()}
      />
    ),
  },
  {
    id: 'decision',
    content: <DecisionSummary answer="Allowed once" at="14:07" />,
  },
  {
    id: 'stopped',
    content: <StoppedTurn doing="Running the billing suite" at="14:09" />,
  },
]

/** What the details of this Session hold: the runs it has made, and what it works from. */
const COMMANDS = (
  <CommandsPanel
    runs={[
      {
        id: 'run-dev',
        name: 'dev',
        command: 'pnpm dev',
        type: 'serve',
        state: 'running',
        folder: './sources/front',
        url: 'http://localhost:5173/',
        readiness: 'ready',
        output: 'vite v7.1.4  ready in 412 ms',
      },
      {
        id: 'run-check',
        name: 'check',
        command: 'pnpm check',
        type: 'test',
        state: 'failed',
        folder: '.',
        exitCode: 1,
        output: 'Test Files  154 passed | 1 failed (155)',
      },
    ]}
    onStop={fn()}
    onOpenUrl={fn()}
    onRun={fn()}
  />
)

const CONTEXT = (
  <ContextView
    workspace={{ name: 'main', path: '/home/kris/projects/atlas' }}
    instructions={[
      {
        label: 'AGENTS.md',
        file: true,
        detail: 'given at the start of the Session',
        at: '23 Sep 13:40',
        changed: '23 Sep 14:05',
      },
      { label: 'Last change', detail: 'delivered between two turns', at: '23 Sep 14:05' },
      { label: 'The base', detail: 'as a resource of the first prompt', at: '23 Sep 13:40' },
    ]}
    tools={[
      { name: 'fs_read', bound: '256 KiB a page, inside the Workspace root' },
      { name: 'commands_run', bound: 'the catalogue, or a one-off line the user allows' },
    ]}
    lentAt="23 Sep 13:40"
    commands={[{ name: 'check', command: 'pnpm check' }]}
  />
)

/**
 * The Context view of a Session nothing has gone into yet, which is what the details open on
 * before the first message: the tools are lent already.
 */
const FRESH_CONTEXT = (
  <ContextView
    workspace={{ name: 'main', path: '/home/kris/projects/atlas' }}
    instructions={[]}
    tools={[
      { name: 'fs_read', bound: '256 KiB a page, inside the Workspace root' },
      { name: 'commands_run', bound: 'the catalogue, or a one-off line the user allows' },
    ]}
    commands={[]}
  />
)

interface PageProps {
  /** The plan the agent works to, and the files the turn has touched. */
  plan?: PlanEntry[] | undefined
  touched?: TouchedFile[] | undefined
  /** What the details hold beside them, handed over already drawn. */
  commands?: ReactNode
  context?: ReactNode
  /** The tab the details open on, which the renderer reads from what is happening. */
  openOn?: SessionDetailsTab | undefined
  /** Whether nothing has been written yet: no thread, no turn running, nothing spent. */
  fresh?: boolean | undefined
}

/**
 * The page, held together by the same state the renderer holds.
 *
 * The composer's words, the files it carries and the three things the agent is set on are this
 * story's own, because a control that cannot be moved in a story is a control nobody has read.
 * The plan and the files are props, because a Session whose agent has published neither is a
 * state of this page and not a second page (review of #40, defect 3).
 */
function Page({
  plan = PLAN,
  touched = TOUCHED,
  commands = COMMANDS,
  context = CONTEXT,
  openOn = 'commands',
  fresh = false,
}: PageProps): ReactNode {
  // Whether the reader has the details open: the same state the renderer's page holds, and only
  // the head's button sets it.
  const [details, setDetails] = useState(false)
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [agent, setAgent] = useState<string | null>('claude-code')
  const [model, setModel] = useState<string | null>('claude-sonnet-4-5')
  const [effort, setEffort] = useState<string | null>('high')
  const [mode, setMode] = useState<string | null>('acceptEdits')
  return (
    <TooltipProvider>
      {/*
        One column (review of #40, defect 2): the head, the thread and the composer share one width
        and one left edge, and nothing stands beside them — the details are a dialog the reader
        opens from the head (second review of #18).
      */}
      <div className="flex h-screen min-h-0 bg-background text-foreground">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6 pb-4">
            <SessionHeader
              title={fresh ? 'Untitled' : 'CSV invoice export'}
              projectName="Atlas"
              meta={fresh ? 'created just now · 0 entries' : 'started 12 minutes ago · 9 entries'}
              onRename={fn()}
              onStartEditing={fn()}
              onCancelEditing={fn()}
              onArchive={fn()}
              archiveDisabled={fresh}
              // What the turn has done, what the Session runs and what the agent works from.
              onOpenDetails={() => setDetails(true)}
            />
          </div>
          {fresh ? (
            <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6">
              <SessionEmpty />
            </div>
          ) : (
            <>
              {/* The thread takes the whole width under the head and lays its own column on the
                  head's and the composer's, so a wheel beside it scrolls it; the banner is not
                  scrolled, and stands in the column above it. */}
              <div className="mx-auto w-full max-w-3xl px-6">
                <ResumeFallbackBanner
                  agent="claude-code"
                  session="CSV invoice export"
                  kept="everything up to the last tool call"
                  onDismiss={fn()}
                />
              </div>
              <MessageScroller
                className="flex-1"
                label="The thread of this Session"
                entries={THREAD}
              />
            </>
          )}
          {/* What the turn has spent stands above the box rather than in its foot: the foot is
              the Workspace and the send alone since the trial of 22 September 2026, and a figure
              read at a glance is a figure that must not be what makes a row wrap. What the turn
              is *doing* shares that row, at its other end: one reading of one turn, what it is
              doing on the left where the agent writes, what it has cost on the right. */}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 pb-4">
            {!fresh && (
              <TurnLine
                activity={{ state: 'waiting' }}
                usage={{ used: 12400, size: 200000, cost: { amount: 0.42, currency: 'EUR' } }}
              />
            )}
            <Composer
              value={value}
              onValueChange={setValue}
              files={files}
              onFilesChange={setFiles}
              onSearchFiles={() => Promise.resolve([])}
              variant="inline"
              action="Send"
              placeholder="Say something to claude-code…"
              onSend={() => Promise.resolve(null)}
              running={!fresh}
              onStop={fn()}
              blocked={
                fresh ? undefined : (
                  <BlockedBanner waiting="The agent is asking to go on." onStop={fn()} />
                )
              }
              agentMenu={
                // A Session runs the agent it was made with, so the panel opens on that agent's
                // models and offers no way back to a list of agents. No `spec` either: a Spec
                // is made from the question that starts a Session, on the Home.
                <AgentModelMenu
                  fixed
                  agents={AGENTS}
                  agent={agent}
                  onAgentChange={(id) => {
                    setAgent(id)
                    setModel(null)
                    setEffort(null)
                    setMode(null)
                  }}
                  models={MODELS}
                  model={model}
                  onModelChange={setModel}
                  efforts={EFFORTS}
                  effort={effort}
                  onEffortChange={setEffort}
                  modes={MODES}
                  mode={mode}
                  onModeChange={setMode}
                />
              }
            />
          </div>
        </div>
        <SessionDetails
          open={details}
          onOpenChange={setDetails}
          plan={plan}
          files={touched}
          onSelectFile={fn()}
          commands={commands}
          context={context}
          defaultTab={openOn}
        />
      </div>
    </TooltipProvider>
  )
}

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Surfaces/Session',
  component: Page,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Page>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Everything the lot draws, in one page: the reader's turn, the agent's answer, what it thought,
 * what it read and ran with what came back of it, the change it made, the console it opened, the
 * plan it is working to, the permission it is waiting on and the answer it was given, a call the
 * reader stopped, a turn that was stopped, the row that says what the turn is doing now, and the
 * box with the agent, its model, its effort and its mode behind one control, with what the turn
 * has cost said above the whole thing.
 *
 * As the trial of 22 September 2026 settled it: the rail marks the reader's own messages and
 * nothing else, the states of a call are dots rather than badges, a time appears under the hand,
 * the mode is a row of the agent panel, and the Session's foot offers no Spec.
 *
 * The first story of the entry, and the one the UI gate reads on `Surfaces/Session`.
 */
export const Complete: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A Session with a plan, files, runs and a delivery draws nothing beside its thread: no
    // column, no tab strip, and no dialog until the reader asks for one.
    expect(canvas.queryByRole('complementary')).toBeNull()
    expect(canvas.queryByRole('tab')).toBeNull()
    expect(within(document.body).queryByRole('dialog')).toBeNull()
    // The plan is the details', and the thread does not repeat it.
    expect(canvas.queryByText('2 of 4')).toBeNull()
    // The change is read in the language of its file, which is what the extension bought. The
    // grammar of that language is a module loaded on demand, so the first diff of a session is
    // drawn plain and coloured once the grammar has arrived. On a machine busy with the rest of
    // the run that import outlasts the default patience of a wait, so it is given ten seconds;
    // a draw kept plain would never be coloured, and would fail the wait however long it is.
    await waitFor(
      () => {
        expect(canvasElement.querySelectorAll('.tok-keyword').length).toBeGreaterThan(0)
      },
      { timeout: 10_000 },
    )
    // A call to one of Hemera's own tools wears the mark of its kind, as a native call does, and
    // is announced as Hemera's, so it is not read as a native call.
    await expect(canvas.getByRole('button', { name: /^Hemera Read file/ })).toBeVisible()
    // Folded, it reads its label and its file; the code name waits in the body (recette 5).
    await expect(canvas.queryByText('fs_read')).toBeNull()
    // The command the agent started is a block of the thread, with the address one press away.
    await expect(canvas.getByText('pnpm dev')).toBeVisible()
    await expect(
      canvas.getAllByRole('button', { name: 'http://localhost:5173/' }).length,
    ).toBeGreaterThan(0)
    // The head's button opens the details, on the Commands tab since a command is running.
    const button = canvas.getByRole('button', { name: 'Session details' })
    await userEvent.click(button)
    const dialog = await waitFor(() =>
      within(document.body).getByRole('dialog', { name: 'Session details' }),
    )
    // It rises into place from transparent: what is read inside is read once it can be seen.
    await waitFor(() => {
      expect(getComputedStyle(dialog).opacity).toBe('1')
    })
    const details = within(dialog)
    await expect(details.getByRole('tab', { name: 'Commands' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(details.getByText('1 running')).toBeVisible()
    // What the agent works from, on its own tab.
    await userEvent.click(details.getByRole('tab', { name: 'Context' }))
    await expect(details.getByText('Instructions')).toBeVisible()
    await expect(details.getByText('Last change')).toBeVisible()
    // The plan the agent works to, and the files the turn touched.
    await userEvent.click(details.getByRole('tab', { name: 'Activity' }))
    await expect(details.getByText('2 of 4')).toBeVisible()
    await expect(details.getByText('Files')).toBeVisible()
    // Whatever the tab, the details never scroll sideways (trial of 23 September 2026).
    await expect(dialog.scrollWidth, 'the details scroll sideways').toBe(dialog.clientWidth)
    // Escape closes them, and the focus is back on the button that opened them.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(button)
    })
    // The agent is waiting for an answer, and the turn it is in can be stopped.
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toBeVisible()
    // One Stop on the command run, one on the box, and one on the strip that says why the box
    // is waiting.
    const stops = canvas.getAllByRole('button', { name: 'Stop' })
    await expect(stops).toHaveLength(3)

    /*
     * What the turn is doing shares the meter's row, at its left end: it is not an entry of the
     * thread any more (trial of 22 September 2026), it stands where the agent's own content
     * stands, and the loader alone says the turn is alive — no dot beside it.
     */
    const doing = canvas.getByText('Waiting for your permission')
    await expect(doing).toBeVisible()
    const meter = canvas.getByLabelText(/12,400 of 200,000 tokens used/)
    await expect(onOneLine(doing, meter), 'what the turn is doing left the meter’s row').toBe(true)
    await expect(doing.getBoundingClientRect().left).toBeLessThan(
      meter.getBoundingClientRect().left,
    )
    // The states of a call are dots and not badges: the word is announced, never drawn.
    await expect(canvas.getByRole('img', { name: 'Cancelled' })).toBeInTheDocument()
    await expect(canvas.queryByText('Failed')).toBeNull()
    // And the rail marks the reader's own message and nothing else: one question asked, one
    // mark to come back to. The rail is drawn once the thread has been measured, in an effect:
    // counted where it is still on its way, the count is zero. So the mark is found first, with
    // ten seconds of patience: a thread this long, measured on a machine busy with the rest of
    // the run, takes longer than the default patience of a wait.
    const patience = { timeout: 10_000 }
    const marked = await canvas.findAllByRole('button', { name: /forty thousand rows/ }, patience)
    await expect(marked).toHaveLength(1)

    /*
     * The foot of the page, as the trial of 22 September 2026 settled it: the agent, its model,
     * its effort and its mode are one control at the end of the box's own row, and the frame's
     * foot is the Workspace and the send alone — no Spec in a Session. Nothing wraps, which is
     * the whole point, and the only way to ask it is of the boxes the browser laid out.
     */
    const menu = canvas.getByRole('button', { name: /Sonnet 4\.5 · High · Accept edits/ })
    const at = canvas.getByRole('button', { name: 'Mention a file of the Project' })
    await expect(onOneLine(at, menu), 'the agent menu left the box’s own row').toBe(true)
    await expect(canvas.queryByRole('combobox', { name: 'Mode' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /New Spec/ })).toBeNull()
    const pill = canvas.getByRole('combobox', { name: 'Workspace' })
    await expect(onOneLine(pill, stops[2]!), 'the foot of the composer wrapped').toBe(true)

    /*
     * The thread is the column the composer is written in, to the pixel, on both edges (trial of
     * 22 September 2026, evening): what was said ends where the frame ends, what was answered
     * starts where it starts, and the rail stands in the gutter beside the column rather than
     * taking its width out of it. The row above the box, the meter and what the turn is doing,
     * starts there too. Asked of the boxes the browser laid out, because an inset of a few pixels
     * is invisible in the markup and unmissable on the screen.
     */
    const thread = canvas.getByRole('log', { name: 'The thread of this Session' })
    const frame = canvas.getByRole('textbox').closest('.rounded-xl')!.getBoundingClientRect()
    const edge = frame.left
    const asked = canvas.getByRole('group', { name: 'Messages from You' }).getBoundingClientRect()
    await expect(asked.left, 'the reader’s run left the frame’s left edge').toBe(frame.left)
    await expect(asked.right, 'the reader’s run left the frame’s right edge').toBe(frame.right)
    const answered = [...thread.firstElementChild!.children]
      .find((entry) => entry.textContent?.includes('builds the whole file'))!
      .getBoundingClientRect()
    await expect(answered.left, 'the agent’s block left the frame’s left edge').toBe(frame.left)
    await expect(answered.right, 'the agent’s block left the frame’s right edge').toBe(frame.right)
    const rail = canvas.getByRole('navigation', { name: /^Marks of/ }).getBoundingClientRect()
    await expect(rail.left, 'the rail is inside the thread’s column').toBeGreaterThanOrEqual(
      frame.right,
    )
    /*
     * And the thread is what a wheel turns anywhere under the head, not only over the column:
     * the far left of the content area is the scroller's own box, so a wheel there scrolls it.
     * A synthetic wheel event does not scroll a page — only the browser's own input does — so
     * what is asked is where a wheel at that point goes: the element under it is inside the
     * thread, and the event dispatched there reaches the thread's scroll container.
     */
    const box = thread.getBoundingClientRect()
    const area = thread.parentElement!.parentElement!.getBoundingClientRect()
    await expect([box.left, box.right], 'the thread scrolls in its column only').toEqual([
      area.left,
      area.right,
    ])
    const farLeft = document.elementFromPoint(box.left + 1, box.top + box.height / 2)!
    await expect(thread.contains(farLeft), 'a wheel beside the thread misses it').toBe(true)
    const wheel = new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true })
    let reached: Element | null = null
    thread.addEventListener('wheel', (event) => {
      reached = event.currentTarget instanceof Element ? event.currentTarget : null
    })
    farLeft.dispatchEvent(wheel)
    await expect(reached, 'the wheel at the far left did not reach the thread').toBe(thread)
    await expect(thread.scrollHeight, 'the thread has nothing to scroll').toBeGreaterThan(
      thread.clientHeight,
    )
    const loader = canvas.getByRole('status', { name: 'Waiting for your permission' })
    await expect(loader.getBoundingClientRect().left, 'the row above the box is inset').toBe(edge)
    // And what the turn has spent is said above the box, not in the row that would have wrapped.
    await expect(canvas.getByLabelText(/12,400 of 200,000 tokens used/)).toBeVisible()
    await expect(canvas.getByText(/could not resume its own session/)).toBeVisible()
    /*
     * The meter stays at the foot, above the box, whatever unfolds in the thread above it
     * (recette of 26 September 2026, issue #134): a call opened is room taken in the thread, not
     * in the row the meter stands on.
     */
    const spent = canvas.getByLabelText(/12,400 of 200,000 tokens used/)
    const foot = spent.getBoundingClientRect().bottom
    const call = canvas.getByRole('button', { name: /^Hemera Read file/ })
    // Pressed on the row itself: the middle of the line is the file, which is a press of its own.
    call.click()
    await expect(await canvas.findByText('fs_read')).toBeVisible()
    await expect(spent.getBoundingClientRect().bottom, 'the meter moved').toBe(foot)
    call.click()
  },
}

/**
 * A fresh Session: nothing written, no plan, no file touched, no command run, nothing delivered.
 *
 * Nothing stands beside the thread, and the thread keeps its width. The details are one press
 * away at the end of the head's line all the same, and with no tab holding anything they open on
 * the Context: the tools are lent already, and the base goes in with the first message.
 */
export const Empty: Story = {
  render: () => (
    <Page
      fresh
      plan={[]}
      touched={[]}
      commands={<CommandsPanel runs={[]} onStop={fn()} onOpenUrl={fn()} onRun={fn()} />}
      context={FRESH_CONTEXT}
      openOn="context"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // No column at all: not an empty box, not three tabs with nothing under them.
    expect(canvas.queryByRole('complementary')).toBeNull()
    expect(canvas.queryByRole('tab')).toBeNull()
    await expect(canvas.getByText('Nothing written yet')).toBeVisible()
    // The details are reached from the head, and open on the Context.
    await userEvent.click(canvas.getByRole('button', { name: 'Session details' }))
    const dialog = await waitFor(() =>
      within(document.body).getByRole('dialog', { name: 'Session details' }),
    )
    // It rises into place from transparent: what is read inside is read once it can be seen.
    await waitFor(() => {
      expect(getComputedStyle(dialog).opacity).toBe('1')
    })
    const details = within(dialog)
    await expect(details.getByRole('tab', { name: 'Context' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(details.getByText('Nothing has gone to the agent yet.')).toBeVisible()
    await expect(details.getByRole('button', { name: 'Tools · 2' })).toBeVisible()
    // The two other tabs say they have nothing yet, rather than showing an empty panel.
    await userEvent.click(details.getByRole('tab', { name: 'Activity' }))
    await expect(
      details.getByText('No plan and no file touched in this Session yet.'),
    ).toBeVisible()
    await userEvent.click(details.getByRole('tab', { name: 'Commands' }))
    await expect(details.getByText('No command has run in this Session.')).toBeVisible()
    // The close button closes them, and the head's button is still there.
    await userEvent.click(details.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    await expect(canvas.getByRole('button', { name: 'Session details' })).toBeVisible()
  },
}
