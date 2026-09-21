import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, waitFor, within } from 'storybook/test'

import { DiffBlock } from '../activity/diff-block.tsx'
import { TerminalOutput } from '../activity/terminal-output.tsx'
import { ThoughtBlock } from '../activity/thought-block.tsx'
import { ToolCallCard } from '../activity/tool-call-card.tsx'
import { DecisionSummary } from '../approval/decision-summary.tsx'
import { PermissionRequest } from '../approval/permission-request.tsx'
import { BlockedBanner } from '../composer/blocked-banner.tsx'
import { Composer } from '../composer/composer.tsx'
import { EffortSelector } from '../composer/effort-selector.tsx'
import { ModeSelector } from '../composer/mode-selector.tsx'
import { ModelSelector } from '../composer/model-selector.tsx'
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
 * foot where the agent's own controls stand. A block that reads well alone and badly here is a
 * block that reads badly.
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

const MODELS = [
  { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
  { id: 'claude-opus-4-1', name: 'Opus 4.1' },
]

const EFFORTS = [
  { id: 'low', name: 'Low' },
  { id: 'high', name: 'High' },
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

/**
 * The page, held together by the same state the renderer holds.
 *
 * The composer's words, the files it carries and the three things the agent is set on are this
 * story's own, because a control that cannot be moved in a story is a control nobody has read.
 */
function Page(): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [model, setModel] = useState('claude-sonnet-4-5')
  const [effort, setEffort] = useState('high')
  const [mode, setMode] = useState('acceptEdits')
  return (
    <TooltipProvider>
      <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
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
        <div className="flex min-h-0 flex-1">
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 px-6">
            <ResumeFallbackBanner
              agent="claude-code"
              session="CSV invoice export"
              kept="everything up to the last tool call"
              onDismiss={fn()}
            />
            <MessageScroller label="The thread of this Session" entries={THREAD} />
          </div>
          <div className="w-sidebar shrink-0 overflow-y-auto border-l border-border px-4 py-6">
            <SessionSideColumn plan={PLAN} files={TOUCHED} onSelectFile={fn()} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl px-6 pb-4">
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
            controls={
              <>
                <ModelSelector
                  agent="claude-code"
                  models={MODELS}
                  value={model}
                  onValueChange={setModel}
                />
                <EffortSelector efforts={EFFORTS} value={effort} onValueChange={setEffort} />
                <ModeSelector modes={MODES} value={mode} onValueChange={setMode} />
                <UsageMeter used={12400} size={200000} cost={{ amount: 0.42, currency: 'EUR' }} />
              </>
            }
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

const meta = {
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
 * foot with the agent's models, its effort, its mode and what the turn has cost.
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
    // The change is read in the language of its file, which is what the extension bought.
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('.tok-keyword').length).toBeGreaterThan(0)
    })
    // The agent is waiting for an answer, and the turn it is in can be stopped.
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toBeVisible()
    // One Stop on the box and one on the strip that says why the box is waiting.
    await expect(canvas.getAllByRole('button', { name: 'Stop' })).toHaveLength(2)
    await expect(canvas.getByText(/could not resume its own session/)).toBeVisible()
  },
}
