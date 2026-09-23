import { useState } from 'react'
import type { ReactNode } from 'react'

import type {
  CommandRun,
  ConfigOption,
  ContextView as Provided,
  Session,
  SessionEntry,
} from '@hemera/ipc'
import {
  ActivityRow,
  AgentModelMenu,
  BlockedBanner,
  CommandsPanel,
  Composer,
  ContextView,
  MessageDaySeparator,
  MessageGroup,
  MessageScroller,
  MessageText,
  SessionEmpty,
  SessionHeader,
  SessionSideColumn,
  UsageMeter,
  type MessageLine,
  type MessageState,
  type OfferedAgent,
  type PermissionOption,
  type ScrollerEntry,
} from '@hemera/ui'

import { activityOf, hasEnded, type Activity, type AgentSessionState } from '../agent-store.ts'
import { effortDefaultOf, effortStage, modeStage, modelStage } from '../agent-options.ts'
import { drawEntry, planOf, touchedOf, usageOf, waitingOf } from '../agent-blocks.tsx'
import { foldedCallsOf } from '../agent-tool-payloads.ts'
import { whenOf } from '../journal-lines.ts'
import {
  contextListsOf,
  hasSideColumn,
  openingTabOf,
  panelRunsOf,
  sideTabsOf,
} from '../side-column.ts'

/**
 * The page of a Session: what it is called, what was said in it, and the way to say more
 * (design D4b-02, D4b-08, D5-12, D5-14, D5-17).
 *
 * It is an adapter and nothing else: the engine holds the Session, its thread and its agent, and
 * every surface here comes from `@hemera/ui`, where it was drawn and accepted on fixtures before
 * a database existed. Nothing is decided here — not what a title may be, not which block draws an
 * entry, not whether a message landed.
 *
 * The thread is what the engine read back when the Session was opened, and what has arrived since:
 * an entry the agent is still writing comes again with more of it rather than as a second entry,
 * so the two are one list, read in the order it was written. A Session with no agent is one the
 * user writes into and nothing answers — which is a Session, not an empty one, and the foot is
 * where the difference is drawn.
 */

/** A run of messages written on the same day, which is how the thread is separated. */
interface Run {
  day: string
  lines: MessageLine[]
  /** When its first line was written, which is the time the head shows under the hand. */
  at: number
  /** Its first line as plain text, which is what the scroller remembers the run by. */
  mark: string
  /** Whether the agent said something in the middle of it, which starts a new run after it. */
  broken: boolean
}

/**
 * The thread as one list: what was read back, with what has arrived since in its place.
 *
 * An entry written again — the same identifier, with more of it — takes the place of the one the
 * read-back held, and an entry nobody had seen yet goes at the end, where it was written.
 */
function together(read: readonly SessionEntry[], live: readonly SessionEntry[]): SessionEntry[] {
  const since = new Map(live.map((entry) => [entry.id, entry]))
  const known = new Set(read.map((entry) => entry.id))
  return [
    ...read.map((entry) => since.get(entry.id) ?? entry),
    ...live.filter((entry) => !known.has(entry.id)),
  ]
}

/** What a turn that has just been asked for is doing, before anything of it has arrived. */
const THINKING: Activity = { state: 'thinking' }

/** When a run was written, `HH:MM`, in the one reading the whole window uses. */
function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** The whole date behind that time, for the reader who asks a time three days old which day it is. */
function dateOf(at: number): string {
  return new Date(at).toLocaleString('en-GB')
}

/** `4 messages`, and the singular for the one that has just been written. */
function countOf(entries: number): string {
  return entries === 1 ? '1 message' : `${String(entries)} messages`
}

/** The line under a Session's title: when it was made, what runs it, and how much is in it. */
function metaOf(session: Session, entries: number, now: number): string {
  const agent = session.provider === null ? 'no agent' : session.provider
  return `created ${whenOf(session.createdAt, now)} · ${agent} · ${countOf(entries)}`
}

/** What the last act of a thread was refused with, when the engine refused it. */
export interface SessionPageProps {
  projectName: string
  session: Session
  /** The thread, oldest first, as the engine read it back. */
  entries: SessionEntry[]
  /** Whether the thread has come back, so an empty thread is drawn only once it is known. */
  loaded: boolean
  /** What "today" means for this render, so the separators are read once. */
  now: number
  /** Whether the title is being typed into, which the page that called this one decides. */
  editing: boolean
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
  /** What the engine has pushed for this Session since it was opened. */
  agent: AgentSessionState
  /**
   * The agent this Session runs, as the menu lists it: one, and never another.
   *
   * A Session keeps the agent it was made with (D5-06), so the first stage of the menu is a
   * list of one that is already chosen — it is there because the model and the effort below it
   * belong to that agent, and reading which agent answers is half of reading them.
   */
  agents: OfferedAgent[]
  /** What the agent of this Session offers, as its own handshake answered. */
  options: readonly ConfigOption[]
  onWrite: (body: string) => Promise<string | null>
  /**
   * Says something to the agent, which writes the user's own message itself.
   *
   * A Session with an agent does not go through `onWrite`: the engine writes the message as part
   * of the prompt, and writing it here as well would put the same sentence in the thread twice.
   * Nothing is awaited — a turn lasts as long as it lasts, and what the composer's own state
   * tracks is the write rather than the answer (D5-12).
   */
  onSay: (text: string) => void
  /** Cancels the running turn, when there is one. */
  onStop: () => void
  /** Answers the question the block of `toolCallId` was drawn for. */
  onDecide: (toolCallId: string, option: PermissionOption) => void
  /** Sets one of the agent's own options for the turn to come. */
  onChooseOption: (optionId: string, value: string) => void
  onRename: (title: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onArchive: () => void
  onSearchFiles: (query: string) => Promise<string[]>
  onPickFiles: () => Promise<string[]>
  /** Opens one of the files the turn touched, when the page around this one can open one. */
  onOpenFile?: ((path: string) => void) | undefined
  /** The runs of this Session, as the engine last pushed them (D6-12). */
  commandRuns: readonly CommandRun[]
  /** Opens the address a run published, in the browser. */
  onOpenUrl: (url: string) => void
  /** Stops a run and everything it started. */
  onStopRun: (runId: string) => void
  /** The Workspace root, which is what a run's folder is said relative to. */
  root: string
  /** Runs a line from the Commands panel: a command of the catalogue by name, or a one-off. */
  onRunCommand: (line: string) => void
  /** What this Session was provided, may consult, and keeps to its agent; null until read. */
  context: Provided | null
}

export function SessionPage({
  projectName,
  session,
  entries,
  loaded,
  now,
  editing,
  refusal,
  agent,
  agents,
  options,
  onWrite,
  onSay,
  onStop,
  onDecide,
  onChooseOption,
  onRename,
  onStartEditing,
  onCancelEditing,
  onArchive,
  onSearchFiles,
  onPickFiles,
  onOpenFile,
  commandRuns,
  onOpenUrl,
  onStopRun,
  root,
  onRunCommand,
  context,
}: SessionPageProps): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [writes, setWrites] = useState<MessageState>('saved')
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /** What was last handed to the engine, so `Retry` has something to send again. */
  const [attempted, setAttempted] = useState<string | null>(null)

  const write = async (body: string): Promise<string | null> => {
    setAttempted(body)
    setFailure(undefined)
    setWrites('saving')
    if (session.provider !== null) {
      onSay(body)
      setWrites('saved')
      return null
    }
    const said = await onWrite(body)
    setWrites(said === null ? 'saved' : 'failed')
    setFailure(said ?? undefined)
    return said
  }

  const thread = together(entries, agent.entries)
  const waiting = waitingOf(thread)

  /**
   * The user's messages cut into the days they were written on.
   *
   * A day is named once, over the first message of that day: two messages written in the same
   * sitting are one run, and a day the user came back to later is another.
   */
  const runs: Run[] = []
  for (const entry of thread) {
    if (entry.role !== 'user' || entry.kind !== 'message') {
      // Anything the agent reported ends the run of what the user wrote.
      const open = runs.at(-1)
      if (open !== undefined) open.broken = true
      continue
    }
    const day = whenOf(entry.createdAt, now)
    const line: MessageLine = { id: entry.id, body: <MessageText body={entry.body} /> }
    const last = runs.at(-1)
    if (last === undefined || last.day !== day || last.broken) {
      runs.push({ day, lines: [line], at: entry.createdAt, mark: entry.body, broken: false })
      continue
    }
    last.lines.push(line)
  }

  /**
   * The thread in order, which is the user's runs and the agent's blocks in one list.
   *
   * Walking the entries a second time rather than the runs alone: a run belongs where its first
   * line was written, and what the agent reported stands between two of them.
   */
  const byLine = new Map(runs.map((run, index) => [run.lines[0]?.id ?? '', index]))
  const byEntry = new Map<string, ScrollerEntry>()
  // A call to one of Hemera's tools is drawn once, as Hemera's block, where the agent reported
  // it: the agent's own report of it stays in the thread and is not drawn a second time (D6-06).
  const folded = foldedCallsOf(thread)
  for (let at = 0; at < thread.length; at += 1) {
    const entry = thread[at]
    if (entry === undefined || folded.hidden.has(entry.id)) continue
    const next = thread[at + 1]
    const block = drawEntry(folded.inPlaceOf.get(entry.id) ?? entry, {
      now,
      nextAt: next === undefined ? null : next.createdAt,
      onDecide,
      runs: commandRuns,
      onOpenUrl,
      onStopRun,
    })
    // No mark: the rail is navigated by what the reader wrote, and a tick for every block of a
    // turn was forty ticks for one question (trial of 22 September 2026).
    if (block !== null) byEntry.set(entry.id, { id: entry.id, content: block })
  }

  const scroller: ScrollerEntry[] = []
  /** The day last named over the thread, so a run that follows the agent's words repeats nothing. */
  let named: string | null = null
  for (const entry of thread) {
    const run = byLine.get(entry.id)
    if (run !== undefined) {
      const held = runs[run]
      const last = run === runs.length - 1
      const day = held?.day ?? ''
      if (day !== named) {
        named = day
        scroller.push({
          id: `day-${day}`,
          day: true as const,
          content: <MessageDaySeparator day={day} />,
        })
      }
      scroller.push({
        id: `run-${String(run)}`,
        mark: held?.mark ?? '',
        content: (
          <MessageGroup
            author="user"
            name="You"
            lines={held?.lines ?? []}
            // The time of the run, which the head shows under the hand and hides again with it:
            // a thread read downwards is dated by its separators, and a reader who wonders about
            // one run wonders about that one (D4b-08).
            at={held === undefined ? undefined : timeOf(held.at)}
            atLabel={held === undefined ? undefined : dateOf(held.at)}
            state={last ? writes : undefined}
            error={last ? failure : undefined}
            onRetry={
              attempted === null
                ? undefined
                : () => {
                    void write(attempted)
                  }
            }
          />
        ),
      })
      continue
    }
    // The agent said something: what the user writes next opens a run of its own, and the day
    // is named again over it rather than over a message that has moved down the thread.
    const held = runs.at(-1)
    if (held !== undefined) held.broken = true
    const block = byEntry.get(entry.id)
    if (block !== undefined) scroller.push(block)
  }

  /**
   * What the turn is doing, for as long as it runs (design D17-04, trial of 22 September 2026).
   *
   * It is drawn on the row the meter is on and no longer as the last entry of the thread: a
   * block at the end of the scroller grew the thread every time the turn changed its mind, and
   * it stood right-aligned, on the reader's own side of the column. The row below the thread is
   * the one place a running turn is said — on the left of it, where the agent's content is.
   *
   * Once the turn is over the row stays, quiet, and says how it ended — "Done in 12 s",
   * "Stopped", "Failed" — for as long as that end is the last thing that happened: the next
   * message sets a turn running again, and the row goes back to saying what that one is doing.
   * Until the engine has echoed that message the thread still ends on the previous turn's end,
   * which is not what a turn just asked for is doing: it is thinking. The end is believed while
   * running only when it is the very entry the engine pushed last, the few instants between the
   * `turn` entry and the `turn` event that follows it.
   */
  const read = activityOf(thread, agent.latest)
  const endedNow = thread.find((entry) => entry.id === agent.latest)?.kind === 'turn'
  const activity = agent.running
    ? hasEnded(read) && !endedNow
      ? THINKING
      : read
    : hasEnded(read)
      ? read
      : null

  // What the agent is on is the agent's own answer, read back after every change: this page
  // draws what it was told and never a value it remembers (D5-13).
  const model = modelStage(options)
  const effort = effortStage(options)
  const mode = modeStage(options)

  // What the column beside the thread would hold: the plan the agent last published and the files
  // the turn has touched. Both are states rather than events, and they are read here because the
  // meter above the box and the column are two readings of the same turn.
  const plan = planOf(thread)
  const touched = touchedOf(thread)
  const usage = usageOf(thread)
  // Which tabs have something to show, and whether the column is drawn at all (#40's decision:
  // no empty side column). Once it is drawn, the Commands panel and the Context view go with it
  // whatever they hold: the panel is also where a one-off line is run from.
  const tabs = sideTabsOf(plan.length, touched.length, commandRuns, context)
  const drawn = hasSideColumn(tabs)

  return (
    /*
      One column, with the side column beside it (review of #40, defect 2). The header, the thread
      and the composer share one width and one left edge: a composer centred in the whole window
      while the thread was centred in what the column left over is what put them visibly out of
      line. The screen runs under the frame all the same, and the page's own scroll is the thread's.
    */
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6 pb-4">
          <SessionHeader
            title={session.title}
            projectName={projectName}
            meta={metaOf(session, thread.length, now)}
            onRename={onRename}
            editing={editing}
            onStartEditing={onStartEditing}
            onCancelEditing={onCancelEditing}
            onArchive={onArchive}
            // A Session nothing was ever written in is one the user made by mistake far more often
            // than one they are done with, and putting it away is a press they would come to
            // regret: the archive is where threads go.
            archiveDisabled={thread.length === 0}
          />
        </div>
        {/*
          The thread is given the whole width under the head, and lays its own column on the one
          the head and the composer are laid on: a wheel anywhere beside the thread scrolls it
          (trial of 22 September 2026, evening). An empty Session has nothing to scroll, and its
          sentence stands in the column like everything else.
        */}
        {thread.length === 0 ? (
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6">
            {loaded ? <SessionEmpty /> : null}
          </div>
        ) : (
          <MessageScroller
            className="flex-1"
            label="The thread of this Session"
            entries={scroller}
          />
        )}
        {/*
          What the turn has spent stands above the box rather than in its foot: the foot is the
          Workspace and the send alone, and a figure read at a glance is a figure that must not be
          what makes a row wrap. A Session no agent has accounted for yet shows no meter at all —
          a meter drawn at zero is a figure that says nothing (D5-20).

          What the turn is doing shares that row, at its other end: the two are one reading of
          one turn — what it is doing, and what it has cost — and a row drawn for one of them is
          a row the other would have asked for anyway. The row is drawn as soon as either has
          something to say, and the meter keeps its end of it whether or not a turn is running.
        */}
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 pb-4">
          {(activity !== null || usage !== null) && (
            <div className="flex items-center justify-between gap-3">
              {activity !== null ? (
                <ActivityRow
                  state={activity.state}
                  detail={activity.detail}
                  thought={activity.thought}
                  elapsedMs={activity.elapsedMs}
                />
              ) : (
                <span />
              )}
              {usage !== null && (
                <UsageMeter used={usage.used} size={usage.size} cost={usage.cost} />
              )}
            </div>
          )}
          {/*
            What the page's last act was refused with — a rename, an archive, a thread that could
            not be read — said here and not on the send: those are refusals of the header and of
            the opening, and a Session whose archive was refused is one that can still be written
            in. It stands in the same stack as the meter rather than over the thread, so what it
            moves is itself and nothing above it (D4b-02).
          */}
          {refusal !== null && (
            <p role="alert" className="text-sm text-muted-foreground">
              {refusal}
            </p>
          )}
          <Composer
            value={value}
            onValueChange={setValue}
            files={files}
            onFilesChange={setFiles}
            onSearchFiles={onSearchFiles}
            onPickFiles={onPickFiles}
            variant="inline"
            action={session.provider === null ? 'Write' : 'Send'}
            placeholder={
              session.provider === null
                ? 'Write to this Session…'
                : `Say something to ${session.provider}…`
            }
            onSend={write}
            // Nothing is handed over here: a refusal of this page is not a reason not to write,
            // and a write that is refused answers `write` itself — which is what the composer
            // shows under the box, on the sentence that was not written (D4b-02).
            agentMenu={
              <AgentModelMenu
                agents={agents}
                agent={session.provider}
                // The agent of a Session is the one it was made with and cannot be changed:
                // `fixed` takes the agent stage out of the panel altogether, and the panel opens
                // on the models of the agent that is answering (D17-11).
                fixed
                onAgentChange={() => undefined}
                models={model?.choices ?? []}
                model={model?.current ?? null}
                onModelChange={(chosen) => {
                  if (model !== null) onChooseOption(model.optionId, chosen)
                }}
                efforts={effort?.choices ?? []}
                effort={effort?.current ?? null}
                onEffortChange={(chosen) => {
                  if (effort !== null) onChooseOption(effort.optionId, chosen)
                }}
                // The level the agent recommends, which the scale marks.
                effortDefault={effortDefaultOf(options)}
                // The mode is a row of that same panel since the trial of 22 September 2026: it
                // is one of the four things the agent is set on, and a control of its own beside
                // the menu was a second control asking about one agent.
                modes={mode?.choices ?? []}
                mode={mode?.current ?? null}
                onModeChange={(chosen) => {
                  if (mode !== null) onChooseOption(mode.optionId, chosen)
                }}
              />
            }
            running={agent.running}
            onStop={onStop}
            blocked={
              waiting === null ? undefined : (
                <BlockedBanner waiting="The agent is asking to go on." onStop={onStop} />
              )
            }
          />
        </div>
      </div>
      {/*
        The column stands beside the thread and not under it, and it is the width the thread gave
        up for it. A Session none of whose tabs has anything — no plan, no file, no run, no
        catalogue, nothing provided beyond the base — draws no column at all (review of #40,
        defect 3): empty tabs take that width and say nothing with it. The box is the page's and the emptiness is the column's — there is no wrapper here, so
        a column that draws nothing leaves the width where it was.
      */}
      <SessionSideColumn
        plan={plan}
        files={touched}
        onSelectFile={onOpenFile}
        // The commands of a Session with an agent, whoever started them (D6-12): the same runs
        // the thread's blocks read, and the line a one-off is run from. A Session nothing
        // answers has no agent to lend a command to, and no tab for one.
        commands={
          !drawn || session.provider === null ? undefined : (
            <CommandsPanel
              runs={panelRunsOf(commandRuns, root)}
              onStop={onStopRun}
              onOpenUrl={onOpenUrl}
              onRun={onRunCommand}
            />
          )
        }
        // What the agent is working from, its instructions and its tools (D6-10), once the engine
        // has said it.
        context={
          !drawn || context === null ? undefined : <ContextView {...contextListsOf(context)} />
        }
        // The tab it opens on follows what is happening: a command running opens on Commands,
        // then the tab that has something. Keyed on it, so a command that starts while the
        // Session is open brings the column to its commands, as opening the Session with one
        // running would have (D6-12).
        key={openingTabOf(commandRuns, tabs)}
        defaultTab={openingTabOf(commandRuns, tabs)}
      />
    </div>
  )
}
