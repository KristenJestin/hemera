import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, waitFor, within } from 'storybook/test'

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
  type ModelChoice,
  type OfferedAgent,
} from '../composer/agent-model-menu.tsx'
import { Composer } from '../composer/composer.tsx'
import { ModeSelector } from '../composer/mode-selector.tsx'
import { UsageMeter } from '../composer/usage-meter.tsx'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { AgentText } from '../message/agent-text.tsx'
import { MessageDaySeparator, MessageGroup } from '../message/message.tsx'
import { MessageScroller, type ScrollerEntry } from '../message/scroller/scroller.tsx'
import type { PlanEntry } from './plan-panel.tsx'
import { ResumeFallbackBanner } from './resume-fallback-banner.tsx'
import { SessionHeader } from './session.tsx'
import { SessionSideColumn, type TouchedFile } from './session-side-column.tsx'
import { StoppedTurn } from './stopped-turn.tsx'

/**
 * A Session with an agent in it, at once (design D17-11, D17-13).
 *
 * Every other story here shows one surface at a time; this one is the surface the reader
 * actually has, and it is the one the lot is judged on: the head, a thread carrying each kind of
 * block an agent reports, the column that holds what is a state rather than an event, and the
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

const MODES = [
  { id: 'plan', name: 'Plan' },
  { id: 'acceptEdits', name: 'Accept edits' },
]

/** The thread, in the order it was written. */
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
    mark: 'The export builds the whole file in memory',
    content: (
      <AgentText text="The export reads every row and builds the whole file in memory before writing a byte. I will stream it instead: one row read, one row written." />
    ),
  },
  {
    id: 'thought',
    mark: 'Where the time goes',
    content: (
      <ThoughtBlock seconds={12}>
        <AgentText text="The formatting is not the cost — the join on `invoice_lines` is. Streaming will not fix it on its own, so I will look at the query before I touch the loop." />
      </ThoughtBlock>
    ),
  },
  {
    id: 'read',
    mark: 'Read src/billing/export.ts',
    content: (
      <ToolCallCard
        title="Read src/billing/export.ts"
        kind="read"
        status="completed"
        locations={[{ path: 'src/billing/export.ts', line: 42 }]}
      />
    ),
  },
  {
    id: 'change',
    mark: 'Edited src/billing/export.ts',
    content: (
      <DiffBlock path="src/billing/export.ts" oldText={BEFORE} newText={AFTER} defaultOpen />
    ),
  },
  {
    id: 'run',
    mark: 'Run the export on a fixture',
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
    mark: 'Run pnpm test --project=repository',
    content: (
      <ToolCallCard
        title="Run pnpm test --project=repository"
        kind="execute"
        status="failed"
        defaultOpen
        error={
          'src/billing/export.test.ts > streams a large export\n  expected 2 writes, received 1'
        }
      />
    ),
  },
  {
    id: 'permission',
    mark: 'The agent is asking to run the suite',
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
    mark: 'Allowed once',
    content: <DecisionSummary answer="Allowed once" at="14:07" />,
  },
  {
    id: 'stopped',
    mark: 'The turn was stopped',
    content: <StoppedTurn doing="Running the billing suite" at="14:09" />,
  },
]

interface PageProps {
  /** The plan the column stands beside the thread with, and the files the turn has touched. */
  plan?: PlanEntry[] | undefined
  touched?: TouchedFile[] | undefined
}

/**
 * The page, held together by the same state the renderer holds.
 *
 * The composer's words, the files it carries and the three things the agent is set on are this
 * story's own, because a control that cannot be moved in a story is a control nobody has read.
 * The plan and the files are props, because a Session whose agent has published neither is a
 * state of this page and not a second page (review of #40, defect 3).
 */
function Page({ plan = PLAN, touched = TOUCHED }: PageProps): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [agent, setAgent] = useState<string | null>('claude-code')
  const [model, setModel] = useState<string | null>('claude-sonnet-4-5')
  const [effort, setEffort] = useState<string | null>('high')
  const [mode, setMode] = useState('acceptEdits')
  return (
    <TooltipProvider>
      {/*
        One column, and the side column beside it (review of #40, defect 2). The head, the thread
        and the composer share one width and one left edge: a composer centred in the whole window
        while the thread was centred in what the column left over is exactly what put them out of
        line. The column stands beside all three, and it is not opened at all when it holds
        nothing — the thread keeps its width and its line (defect 3).
      */}
      <div className="flex h-screen min-h-0 bg-background text-foreground">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6 pb-4">
            <SessionHeader
              title="CSV invoice export"
              projectName="Atlas"
              meta="started 12 minutes ago · 9 entries"
              onRename={fn()}
              onStartEditing={fn()}
              onCancelEditing={fn()}
              onArchive={fn()}
            />
          </div>
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 px-6">
            <ResumeFallbackBanner
              agent="claude-code"
              session="CSV invoice export"
              kept="everything up to the last tool call"
              onDismiss={fn()}
            />
            <MessageScroller label="The thread of this Session" entries={THREAD} />
          </div>
          {/* What the turn has spent stands above the box rather than in its foot: the foot is
              the Workspace and the send alone since the trial of 22 September 2026, and a figure
              read at a glance is a figure that must not be what makes a row wrap. */}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 pb-4">
            <div className="flex justify-end">
              <UsageMeter used={12400} size={200000} cost={{ amount: 0.42, currency: 'EUR' }} />
            </div>
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
              running
              onStop={fn()}
              blocked={<BlockedBanner waiting="The agent is asking to go on." onStop={fn()} />}
              mode={<ModeSelector modes={MODES} value={mode} onValueChange={setMode} />}
              agentMenu={
                <AgentModelMenu
                  agents={AGENTS}
                  agent={agent}
                  onAgentChange={(id) => {
                    setAgent(id)
                    setModel(null)
                    setEffort(null)
                  }}
                  models={MODELS}
                  model={model}
                  onModelChange={setModel}
                  efforts={EFFORTS}
                  effort={effort}
                  onEffortChange={setEffort}
                />
              }
            />
          </div>
        </div>
        <SessionSideColumn plan={plan} files={touched} onSelectFile={fn()} />
      </div>
    </TooltipProvider>
  )
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Surfaces/Session',
  component: Page,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Page>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Everything the lot draws, in one page: the reader's turn, the agent's answer, what it thought,
 * what it read and ran, the change it made, the console it opened, the plan it is working to,
 * the permission it is waiting on and the answer it was given, a turn that was stopped, and the
 * box with the agent, its model and its effort behind one control, the mode beside it, and what
 * the turn has cost said above the whole thing.
 *
 * The first story of the entry, and the one the UI gate reads on `Surfaces/Session`.
 */
export const Complete: Story = {
  render: () => <Page />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The plan is the column's, and the thread does not repeat it.
    await expect(canvas.getByText('2 of 4')).toBeVisible()
    // The column is the state: the plan the agent works to, and the files the turn touched.
    await expect(canvas.getByText('Files')).toBeVisible()
    await expect(canvas.getByText('src/billing/export.ts')).toBeVisible()
    // The change is read in the language of its file, which is what the extension bought. The
    // grammar of that language is a module loaded on demand, so the first diff of a session waits
    // for it: on a cold machine that load is slower than the default patience of a wait.
    await waitFor(
      () => {
        expect(canvasElement.querySelectorAll('.tok-keyword').length).toBeGreaterThan(0)
      },
      { timeout: 10_000 },
    )
    // The agent is waiting for an answer, and the turn it is in can be stopped.
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toBeVisible()
    // One Stop on the box and one on the strip that says why the box is waiting.
    const stops = canvas.getAllByRole('button', { name: 'Stop' })
    await expect(stops).toHaveLength(2)

    /*
     * The foot of the page, as the trial of 22 September 2026 settled it: the agent, its model
     * and its effort are one control at the end of the box's own row, the mode is beside it, and
     * the frame's foot is the Workspace and the two buttons alone. Nothing wraps — which is the
     * whole point, and the only way to ask it is of the boxes the browser laid out.
     */
    const menu = canvas.getByRole('button', { name: /Sonnet 4\.5 · High/ })
    const at = canvas.getByRole('button', { name: 'Mention a file of the Project' })
    await expect(onOneLine(at, menu), 'the agent menu left the box’s own row').toBe(true)
    await expect(onOneLine(at, canvas.getByRole('combobox', { name: 'Mode' }))).toBe(true)
    const pill = canvas.getByRole('combobox', { name: 'Workspace' })
    await expect(onOneLine(pill, stops[1]!), 'the foot of the composer wrapped').toBe(true)
    // And what the turn has spent is said above the box, not in the row that would have wrapped.
    await expect(canvas.getByLabelText(/12,400 of 200,000 tokens used/)).toBeVisible()
    await expect(canvas.getByText(/could not resume its own session/)).toBeVisible()
  },
}

/**
 * The same page before the agent has published a plan or touched a file: no column at all.
 *
 * A column with no section is not drawn (review of #40, defect 3), and the thread keeps the width
 * it had — which is the state a Session is in for its first turns, and the one the empty column
 * used to take a third of a window to say.
 */
export const NoColumn: Story = {
  render: () => <Page plan={[]} touched={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('2 of 4')).toBeNull()
    expect(canvas.queryByText('Files')).toBeNull()
    // The thread and its foot are still the page, and the head is still its head: the thread is
    // drawn the width the column used to take.
    await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('CSV invoice export')
    await expect(canvas.getByText(/could not resume its own session/)).toBeVisible()
    // One Stop on the box and one on the strip that says why the box is waiting.
    await expect(canvas.getAllByRole('button', { name: 'Stop' })).toHaveLength(2)
  },
}
