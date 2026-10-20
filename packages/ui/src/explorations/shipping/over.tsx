import type { ReactNode } from 'react'

import { StageCard } from '../../blocks/mission/stage-card.tsx'
import { Button } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import type { MarkState } from '../../components/status-mark/mark-legends.ts'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconBook2,
  IconChecklist,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconGitBranch,
  IconHistory,
  IconMessages,
  IconPlayerStop,
  IconServer,
  IconShieldCheck,
  IconTestPipe,
} from '../../icons.ts'
import { Fold, ID, MONO, PROSE, QUIET, ROW, plural } from '../review/parts.tsx'
import type {
  CancelledMoment,
  CleanupItem,
  ClosingConflict,
  Delivered,
  DoneMoment,
  Leftover,
  MissionRecord,
} from './types.ts'

/**
 * The pages of a mission that is over.
 *
 * **Done** (open question 84, recommended: the history has its place here): the page is the
 * mission's record, readable in full. The rail says what Done still does — the closing (a conflict
 * with the living spec waits there, both versions side by side), the cleanup (each item running,
 * removed, or kept by the guard with its reason), and what still runs after Done, each with its
 * reason and Stop. The middle reads what was delivered per repository, the living spec's
 * requirements the mission merged with their origin, then the history one quiet line each, folded:
 * rounds, feedback, proofs, evidence, the Memory. The Spec opens from the header, as on every stage.
 *
 * **Cancelled**: what the cancel stopped, a partial delivery kept as delivered, the work kept, and
 * the cleanup — which waits for the user's confirmation, listing what the guard would keep.
 */

export interface OverHandlers {
  onOpenLink: (url: string) => void
  onKeep: (requirement: string, version: 'mission' | 'living') => void
  onStop: (leftover: string) => void
  onOpenRound: (n: number) => void
  onOpenMemory: () => void
}

const COLUMNS = 'flex min-w-0 flex-col gap-8 px-8 pt-2 pb-10 lg:flex-row-reverse lg:items-start'

const MAIN = 'flex min-w-0 flex-1 flex-col gap-6'

const RAIL = 'flex w-full min-w-0 shrink-0 flex-col gap-6 lg:w-view-narrow'

const HEAD = 'px-1 text-xs font-medium text-muted-foreground'

function Section({ name, children }: { name: string; children: ReactNode }): ReactNode {
  return (
    <section aria-label={name} className="flex flex-col gap-1.5">
      <h2 className={HEAD}>{name}</h2>
      <Frame>{children}</Frame>
    </section>
  )
}

/** What was delivered, one repository a line: each outcome with its link. */
export function DeliveredList({
  delivered,
  onOpenLink,
}: {
  delivered: readonly Delivered[]
  onOpenLink: (url: string) => void
}): ReactNode {
  return (
    <ul aria-label="Delivered" className="flex flex-col py-1">
      {delivered.map((one) => (
        <li key={one.repository} aria-label={one.repository} className={ROW}>
          <StatusMark state="done" size="sm" legend />
          <span className="w-24 shrink-0 truncate font-mono text-xs">{one.repository}</span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
            {one.outcomes.map((outcome) =>
              outcome.url === undefined ? (
                <span key={outcome.what} className="text-muted-foreground">
                  {`${outcome.what} ${outcome.outcome}`}
                </span>
              ) : (
                <button
                  key={outcome.what}
                  type="button"
                  className="flex items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-ring hover-motion"
                  onClick={() => onOpenLink(outcome.url ?? '')}
                >
                  {`${outcome.what} ${outcome.outcome}`}
                  <IconExternalLink size="sm" />
                </button>
              ),
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

const CLEANUP_MARK: Record<Exclude<CleanupItem['state'], 'kept'>, MarkState> = {
  todo: 'todo',
  running: 'running',
  removed: 'done',
}

const CLEANUP_WORDS: Record<CleanupItem['state'], string> = {
  todo: 'To remove',
  running: 'Removing',
  removed: 'Removed',
  kept: 'Kept by the guard',
}

function kindGlyph(kind: CleanupItem['kind']): ReactNode {
  switch (kind) {
    case 'workspace':
      return <IconFolder size="sm" />
    case 'branch':
      return <IconGitBranch size="sm" />
    case 'service':
      return <IconServer size="sm" />
    case 'file':
      return <IconFileText size="sm" />
  }
}

/** The cleanup's items: each with its state, and the guard's reason for one it keeps. */
export function CleanupList({ items }: { items: readonly CleanupItem[] }): ReactNode {
  return (
    <ul aria-label="Cleanup" className="flex flex-col py-1">
      {items.map((item) => (
        <li key={item.what} aria-label={item.what} className="flex flex-col">
          <div className={ROW}>
            {item.state === 'kept' ? (
              <Legend label={CLEANUP_WORDS.kept}>
                <span className="flex shrink-0 text-info" data-kept="">
                  <IconShieldCheck size="sm" />
                </span>
              </Legend>
            ) : (
              <Legend label={CLEANUP_WORDS[item.state]}>
                <span className="flex">
                  <StatusMark state={CLEANUP_MARK[item.state]} size="sm" />
                </span>
              </Legend>
            )}
            <span aria-hidden="true" className="flex shrink-0 text-muted-foreground">
              {kindGlyph(item.kind)}
            </span>
            <span className="min-w-0 flex-1 truncate" title={item.what}>
              {item.what}
            </span>
          </div>
          {item.reason !== undefined && (
            <p className="pr-4 pb-1.5 pl-16 text-xs break-words text-muted-foreground">
              {item.reason}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

/** A closing conflict: the requirement, its two versions side by side, one to keep. */
function Conflict({
  conflict,
  onKeep,
}: {
  conflict: ClosingConflict
  onKeep: OverHandlers['onKeep']
}): ReactNode {
  return (
    <section aria-label="Closing waits for you" className="flex flex-col gap-1.5">
      <h2 className={HEAD}>Closing waits for you</h2>
      <Frame>
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="flex min-w-0 items-center gap-2 text-sm">
            <StatusMark state="waiting" size="sm" legend />
            <span className={ID}>{conflict.requirement}</span>
            <span className="min-w-0 font-medium break-words">{conflict.title}</span>
          </p>
          <div className="grid grid-cols-1 gap-3">
            <div className="flex flex-col gap-1 border-l-2 border-primary pl-3">
              <span className="text-xs font-medium text-muted-foreground">This mission’s</span>
              <p className={PROSE}>{conflict.mission}</p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onKeep(conflict.requirement, 'mission')}
              >
                Keep this mission’s
              </Button>
            </div>
            <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
              <span className="text-xs font-medium text-muted-foreground">
                {`The living spec’s, from ${conflict.livingFrom}`}
              </span>
              <p className={PROSE}>{conflict.living}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onKeep(conflict.requirement, 'living')}
              >
                Keep the living spec’s
              </Button>
            </div>
          </div>
        </div>
      </Frame>
    </section>
  )
}

/** What still runs after Done: each with why, and Stop. */
function Leftovers({
  leftovers,
  onStop,
}: {
  leftovers: readonly Leftover[]
  onStop: OverHandlers['onStop']
}): ReactNode {
  if (leftovers.length === 0) return null
  return (
    <Section name="Still running">
      <ul aria-label="Still running" className="flex flex-col py-1">
        {leftovers.map((one) => (
          <li key={one.id} aria-label={one.what} className="flex flex-col px-4 py-1.5">
            <div className="flex min-h-control-md min-w-0 items-center gap-2 text-sm">
              <StatusMark state="running" size="sm" legend />
              <span className="min-w-0 flex-1 truncate">{one.what}</span>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Stop ${one.what}`}
                onClick={() => onStop(one.id)}
              >
                <IconPlayerStop size="sm" />
                Stop
              </Button>
            </div>
            <p className="pl-6 text-xs break-words text-muted-foreground">{one.reason}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** The mission's history, one quiet line each, folded. */
export function History({
  record,
  handlers,
}: {
  record: MissionRecord
  handlers: OverHandlers
}): ReactNode {
  return (
    <section aria-label="History" className="flex flex-col gap-1.5">
      <h2 className={HEAD}>History</h2>
      <Frame>
        <div className="flex flex-col py-1">
          <Fold
            glyph={<IconHistory size="sm" />}
            title="Rounds"
            detail={plural(record.rounds.length, 'round', 'rounds')}
          >
            <ul aria-label="Rounds" className="flex flex-col pb-1 pl-6">
              {record.rounds.map((round) => (
                <li key={round.n}>
                  <button
                    type="button"
                    className="flex min-h-control-md w-full min-w-0 items-center gap-2 px-4 text-left text-sm outline-none hover:tinted focus-ring hover-motion"
                    onClick={() => handlers.onOpenRound(round.n)}
                  >
                    <span className="shrink-0 font-medium">{`Round ${String(round.n)}`}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {round.words}
                    </span>
                    <span className={QUIET}>{plural(round.points, 'point', 'points')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Fold>
          <div className={ROW}>
            <span aria-hidden="true" className="flex shrink-0 pl-6 text-muted-foreground">
              <IconMessages size="sm" />
            </span>
            <span className="shrink-0 font-medium">Feedback</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {`${plural(record.feedback, 'remark', 'remarks')}, each in its round`}
            </span>
          </div>
          <Fold
            glyph={<IconTestPipe size="sm" />}
            title="Proofs"
            detail={`${plural(record.proofs.length, 'scenario', 'scenarios')}, red then green`}
          >
            <ul aria-label="Proofs" className="flex flex-col pb-1 pl-6">
              {record.proofs.map((proof) => (
                <li key={proof.id} className={ROW}>
                  <StatusMark state="done" size="sm" legend />
                  <span className={ID}>{proof.id}</span>
                  <span className="min-w-0 flex-1 truncate">{proof.title}</span>
                  {proof.byHand === true && <span className={QUIET}>by hand</span>}
                </li>
              ))}
            </ul>
          </Fold>
          <Fold
            glyph={<IconChecklist size="sm" />}
            title="Evidence"
            detail={plural(record.evidence.length, 'item', 'items')}
          >
            <ul aria-label="Evidence" className="flex flex-col pb-1 pl-6">
              {record.evidence.map((one) => (
                <li key={one.what} className={ROW}>
                  <span className="shrink-0 font-medium">{one.what}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {one.detail}
                  </span>
                </li>
              ))}
            </ul>
          </Fold>
          <button
            type="button"
            className="flex min-h-control-md w-full min-w-0 items-center gap-2 px-4 py-1.5 text-left text-sm outline-none hover:tinted focus-ring hover-motion"
            onClick={handlers.onOpenMemory}
          >
            <span aria-hidden="true" className="flex shrink-0 pl-6 text-muted-foreground">
              <IconBook2 size="sm" />
            </span>
            <span className="shrink-0 font-medium">Memory</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {`${plural(record.memory.journal, 'Journal line', 'Journal lines')} · ${plural(record.memory.notes, 'note', 'notes')}`}
            </span>
          </button>
        </div>
      </Frame>
    </section>
  )
}

/** The living spec's requirements the mission merged, each with where it came from. */
function Merged({ merged }: { merged: DoneMoment['merged'] }): ReactNode {
  return (
    <Section name="Merged into the living spec">
      <ul aria-label="Merged into the living spec" className="flex flex-col py-1">
        {merged.map((one) => (
          <li key={one.id} className={ROW}>
            <span className={ID}>{one.id}</span>
            <span className="min-w-0 flex-1 truncate" title={one.title}>
              {one.title}
            </span>
            <span className={QUIET}>{one.origin}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export interface DonePageProps {
  moment: DoneMoment
  loading: boolean
  /** Open question 84: the history on this page (recommended), or in a view of its own. */
  history: 'page' | 'view'
  handlers: OverHandlers
}

export function DonePage({ moment, loading, history, handlers }: DonePageProps): ReactNode {
  const removed = moment.cleanup.filter((one) => one.state === 'removed').length
  const kept = moment.cleanup.filter((one) => one.state === 'kept').length
  const running = moment.cleanup.some((one) => one.state === 'running')
  const line =
    moment.conflict !== undefined
      ? 'Closing waits for you: one requirement changed under the mission'
      : running
        ? 'Cleaning up'
        : kept > 0
          ? `Done. The guard kept ${plural(kept, 'item', 'items')}`
          : moment.leftovers.length > 0
            ? `Done. ${plural(moment.leftovers.length, 'thing still runs', 'things still run')}`
            : 'Done: delivered, merged into the living spec, cleaned up'
  return (
    <div className={COLUMNS} data-stage="done">
      <aside aria-label="What happens" className={RAIL}>
        <StageCard
          stage="Done"
          face={loading ? 'loading' : moment.conflict !== undefined ? 'question' : 'done'}
          line={loading ? 'Reading the mission' : line}
          progress={
            loading
              ? { step: 'Done', detail: 'reading the record' }
              : {
                  step: moment.conflict !== undefined ? 'Closing' : running ? 'Cleanup' : 'Done',
                  detail: `${plural(removed, 'item', 'items')} removed of ${String(moment.cleanup.length)}`,
                }
          }
        />
        {!loading && (
          <>
            {moment.conflict !== undefined && (
              <Conflict conflict={moment.conflict} onKeep={handlers.onKeep} />
            )}
            <Leftovers leftovers={moment.leftovers} onStop={handlers.onStop} />
            <Section name="Cleanup">
              <CleanupList items={moment.cleanup} />
            </Section>
          </>
        )}
      </aside>
      {!loading && (
        <div className={MAIN}>
          <Section name="Delivered">
            <DeliveredList delivered={moment.delivered} onOpenLink={handlers.onOpenLink} />
          </Section>
          <Merged merged={moment.merged} />
          {history === 'page' && <History record={moment.record} handlers={handlers} />}
        </div>
      )}
    </div>
  )
}

export interface CancelledPageProps {
  moment: CancelledMoment
  handlers: Pick<OverHandlers, 'onOpenLink'>
}

export function CancelledPage({ moment, handlers }: CancelledPageProps): ReactNode {
  const kept = moment.cleanup.filter((one) => one.state === 'kept').length
  return (
    <div className={COLUMNS} data-stage="cancelled">
      <aside aria-label="What happens" className={RAIL}>
        <StageCard
          stage="Cancelled"
          face={moment.cleaned ? 'asleep' : 'question'}
          line={
            moment.cleaned
              ? `Cancelled and cleaned up. The guard kept ${plural(kept, 'item', 'items')}`
              : 'Cancelled by you at 10:27. The cleanup waits for you'
          }
          progress={{
            step: 'Cancelled',
            detail:
              moment.delivered.length > 0
                ? `${plural(moment.delivered.length, 'repository', 'repositories')} delivered before`
                : 'nothing delivered',
          }}
        />
        <Section name="Stopped">
          <ul aria-label="Stopped" className="flex flex-col py-1">
            {moment.stopped.map((one) => (
              <li key={one.what} className={ROW}>
                <StatusMark state="skipped" size="sm" legend />
                <span className="shrink-0">{one.what}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{one.detail}</span>
              </li>
            ))}
          </ul>
        </Section>
        {moment.cleaned && (
          <Section name="Cleanup">
            <CleanupList items={moment.cleanup} />
          </Section>
        )}
      </aside>
      <div className={MAIN}>
        {moment.delivered.length > 0 && (
          <Section name="Delivered before the cancel">
            <DeliveredList delivered={moment.delivered} onOpenLink={handlers.onOpenLink} />
          </Section>
        )}
        <Section name="Work kept">
          <ul aria-label="Work kept" className="flex flex-col py-1">
            {moment.kept.map((one) => (
              <li key={one.repository} aria-label={one.repository} className={ROW}>
                <span aria-hidden="true" className="flex shrink-0 text-muted-foreground">
                  <IconGitBranch size="sm" />
                </span>
                <span className="w-24 shrink-0 truncate font-mono text-xs">{one.repository}</span>
                <span className={MONO}>{one.branch}</span>
                <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                  {one.detail}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}
