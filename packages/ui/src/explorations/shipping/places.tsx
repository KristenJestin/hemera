import type { ReactNode } from 'react'

import { type Ball, BallMark } from '../../blocks/ball/ball-mark.tsx'
import type { MissionStage } from '../../blocks/mission/vocabulary.ts'
import { Button } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { IconPlus } from '../../icons.ts'
import { ContentHeader } from '../../shell/content-header.tsx'
import { Sidebar, SidebarRow, SidebarStageGroup } from '../../shell/sidebar.tsx'
import { KEY, TEAM, TITLE } from './fixtures.ts'

/**
 * Where a mission that is over is found again. In the sidebar (open question 52, recommended):
 * Done and Cancelled each fold apart under the Project, Cancelled last, since a cancelled mission
 * is rarer and may still hold kept work; the cleanup that waits for the user is its dot. The
 * alternative folds both into Done, a cancelled row saying so by its event.
 *
 * And Since you left on Home, where a team comment written while a mission ships is one event of
 * its card, with "Start a mission from this" as in the mission's own rail.
 */

interface Entry {
  key: string
  title: string
  stage: MissionStage
  event: string
  needsYou: boolean
  ball: Ball
}

const MISSIONS: readonly Entry[] = [
  {
    key: KEY,
    title: TITLE,
    stage: 'Shipping',
    event: 'Wave 3 of 3 · web’s CI runs',
    needsYou: false,
    ball: 'someone',
  },
  {
    key: 'ACME-15',
    title: 'Retry a failed webhook from its row',
    stage: 'Building',
    event: 'T3 done in api',
    needsYou: false,
    ball: 'agent',
  },
  {
    key: 'ACME-9',
    title: 'Export the movements',
    stage: 'Done',
    event: 'Delivered',
    needsYou: false,
    ball: 'idle',
  },
  {
    key: 'ACME-8',
    title: 'Sort invoices by due date',
    stage: 'Done',
    event: 'Delivered · the guard kept 1 item',
    needsYou: false,
    ball: 'idle',
  },
  {
    key: 'ACME-6',
    title: 'Dark mode for the invoices',
    stage: 'Cancelled',
    event: 'Cancelled · the cleanup waits for you',
    needsYou: true,
    ball: 'idle',
  },
]

const ORDER: readonly MissionStage[] = ['Shipping', 'Building', 'Done', 'Cancelled']

function Groups({ cancelled }: { cancelled: 'apart' | 'withDone' }): ReactNode {
  const stageOf = (entry: Entry): MissionStage =>
    cancelled === 'withDone' && entry.stage === 'Cancelled' ? 'Done' : entry.stage
  return ORDER.map((stage) => {
    const rows = MISSIONS.filter((entry) => stageOf(entry) === stage)
    if (rows.length === 0) return null
    return (
      <SidebarStageGroup
        key={stage}
        stage={stage}
        count={rows.length}
        folded={stage === 'Done' || stage === 'Cancelled'}
      >
        {rows.map((entry) => (
          <SidebarRow
            key={entry.key}
            missionKey={entry.key}
            title={entry.title}
            ball={entry.ball}
            event={entry.event}
            needsYou={entry.needsYou}
            onPress={() => {}}
          />
        ))}
      </SidebarStageGroup>
    )
  })
}

export function SidebarProposal({ cancelled }: { cancelled: 'apart' | 'withDone' }): ReactNode {
  return (
    <div className="flex h-screen bg-surface-page">
      <Sidebar
        folded={false}
        waiting={1}
        projects={[{ id: 'acme', name: 'Acme', under: <Groups cancelled={cancelled} /> }]}
        opened={new Set(['acme'])}
        onOpen={() => {}}
        current={{ kind: 'mission', key: KEY }}
        onHome={() => {}}
        onProject={() => {}}
        onAddProject={() => {}}
        onSettings={() => {}}
      />
      <div className="mt-2 flex flex-1 flex-col rounded-tl-lg border-t border-l border-border bg-surface-content">
        <ContentHeader folded={false} onFold={() => {}} crumbs={[{ id: 'acme', label: 'Acme' }]} />
      </div>
    </div>
  )
}

/** A card of Since you left for ACME-12, a team comment among its events. */
export function SinceYouLeftCard({
  onStartMission,
}: {
  onStartMission: (comment: string) => void
}): ReactNode {
  const comment = TEAM[0]
  return (
    <div className="max-w-page p-8">
      <section aria-label="Since you left" className="flex flex-col gap-1.5">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">Since you left</h2>
        <Frame>
          <div className="flex flex-col py-2">
            <p className="flex min-w-0 items-center gap-2 px-4 pb-1 text-sm">
              <BallMark ball="someone" legend />
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{KEY}</span>
              <span className="min-w-0 truncate font-medium">{TITLE}</span>
            </p>
            <ul className="flex flex-col">
              <li className="flex min-h-control-md min-w-0 items-center gap-2 px-4 text-sm">
                <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">
                  10:44
                </span>
                <span className="min-w-0 flex-1 truncate">lib-b delivered: released 0.9.0</span>
              </li>
              {comment !== undefined && (
                <li className="flex min-h-control-md min-w-0 items-center gap-2 px-4 text-sm">
                  <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {comment.when}
                  </span>
                  <LetterAvatar name={comment.author} />
                  <span className="min-w-0 flex-1 truncate">
                    {`${comment.author} on ${comment.anchor}: ${comment.text}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Start a mission from ${comment.id}`}
                    onClick={() => onStartMission(comment.id)}
                  >
                    <IconPlus size="sm" />
                    Start a mission from this
                  </Button>
                </li>
              )}
              <li className="flex min-h-control-md min-w-0 items-center gap-2 px-4 text-sm">
                <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">
                  10:16
                </span>
                <span className="min-w-0 flex-1 truncate">shared delivered: 2.4.0 published</span>
              </li>
            </ul>
          </div>
        </Frame>
      </section>
    </div>
  )
}
