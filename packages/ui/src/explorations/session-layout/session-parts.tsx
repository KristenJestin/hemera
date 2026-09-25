import { type ReactNode, useState } from 'react'

import { Composer } from '../../composer/composer.tsx'
import { IconButton } from '../../components/button/button.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconChevronDown, IconChevronLeft, IconFileDescription, IconHammer } from '../../icons.ts'
import { MessageScroller, type ScrollerEntry } from '../../message/scroller/scroller.tsx'
import type { PhaseName, SpecTarget, SpecView } from '../../spec/model.ts'
import { SpecHead } from '../../spec/spec-head.tsx'
import { SpecStage } from '../../spec/spec-panel.tsx'
import { SpecRail, type StageChoice, railOf } from '../../spec/spec-rail.tsx'
import { SessionHeader } from '../../session/session.tsx'
import { BuildProgress } from './build-progress.tsx'
import type { SessionFixture } from './fixtures.tsx'

/**
 * The parts every variant of the exploration lays out: the head of the Session, the chat, and the
 * mission panel — the Spec in `define`, the build annotated on the Spec in `build`. The panels
 * here take whatever width their variant gives them, from a third of the page to all of it, which
 * is why they are composed from the Spec's own parts rather than drawn in the lot-19 mission
 * panel, whose width is one of two shares of the row.
 */

/** Nothing to hand back: the exploration keeps no Spec and no build. */
function nothing(): void {}

/** The head of the Session, across the top of the page whatever the variant. */
export function PageHead({ session }: { session: SessionFixture }): ReactNode {
  return (
    <div className="shrink-0 border-b border-border px-6 pt-4 pb-3">
      <SessionHeader
        title={session.title}
        projectName="Atlas"
        meta={session.meta}
        onRename={nothing}
        onStartEditing={nothing}
        onArchive={nothing}
      />
    </div>
  )
}

export interface ChatPaneProps {
  thread: ScrollerEntry[]
  /** Whether the agent's turn runs, which makes the send a Stop — of the turn, not the build. */
  running: boolean
  /** Minimises the chat; the control is drawn only when this is given. */
  onMinimise?: (() => void) | undefined
}

/** The chat: its thread and its composer, and the control that minimises it when it can be. */
export function ChatPane({ thread, running, onMinimise }: ChatPaneProps): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  return (
    <section aria-label="Chat" className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {onMinimise !== undefined && (
        <div className="flex shrink-0 justify-end px-3 pt-2">
          <Tooltip label="Minimise the chat">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconChevronDown size="sm" />}
              aria-label="Minimise the chat"
              data-minimise
              onClick={onMinimise}
            />
          </Tooltip>
        </div>
      )}
      <MessageScroller className="flex-1" label="The thread of this Session" entries={thread} />
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pb-4">
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
          running={running}
          onStop={nothing}
        />
      </div>
    </section>
  )
}

/** The Spec of a `define` Session, at whatever width the variant gives it. */
function DefinePanel({
  spec,
  onFold,
}: {
  spec: SpecView
  /** Folds the panel to its band; drawn only when the variant can. */
  onFold?: (() => void) | undefined
}): ReactNode {
  const [pinned, setPinned] = useState<StageChoice | null>(null)
  const shown: StageChoice = pinned ?? { part: spec.focus ?? 'problem' }
  const groups = railOf(spec)
  return (
    <section
      aria-label={`Spec ${spec.key}`}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface-content"
    >
      <header className="flex flex-col gap-1.5 border-b border-border px-5 pt-4 pb-3">
        <SpecHead
          specKey={spec.key}
          title={spec.title}
          type={spec.type}
          status={spec.status}
          revision={spec.revision}
          revisions={spec.revisions}
          onPickRevision={nothing}
          onRework={nothing}
          onFold={onFold}
        />
        <p className="text-sm text-muted-foreground">{spec.now}</p>
      </header>
      <div className="flex min-h-0 flex-1">
        <SpecRail
          label={`Parts of ${spec.key}`}
          groups={groups}
          current={shown}
          following={spec.focus}
          onSelect={(target: SpecTarget) => setPinned({ part: target })}
          onSelectGroup={(phase: PhaseName) => setPinned({ group: phase })}
          readiness={spec.readiness}
          frozenOn={spec.frozenOn}
          onMarkReady={nothing}
        />
        <SpecStage
          spec={spec}
          shown={shown}
          groups={groups}
          reading={false}
          onSaveSection={nothing}
          onApplyMine={nothing}
          onDiscardMine={nothing}
          onSaveStory={nothing}
          onGoToQuestion={nothing}
        />
      </div>
    </section>
  )
}

/** The mission panel of a Session: its Spec, or its build; nothing for a `free` one. */
export function MissionContent({
  session,
  onFold,
  inPlace = false,
  reviewIn,
}: {
  session: SessionFixture
  onFold?: (() => void) | undefined
  inPlace?: boolean | undefined
  reviewIn?: string | undefined
}): ReactNode {
  if (session.spec !== undefined) return <DefinePanel spec={session.spec} onFold={onFold} />
  if (session.build === undefined) return null
  return (
    <BuildProgress
      build={session.build}
      inPlace={inPlace}
      reviewIn={reviewIn}
      onPause={nothing}
      onStop={nothing}
      onAccept={nothing}
      onDismissBlocker={nothing}
      onReply={nothing}
    />
  )
}

/** The band a folded mission panel leaves at the edge of the row: what it is, and the unfold. */
export function PanelBand({
  session,
  onUnfold,
}: {
  session: SessionFixture
  onUnfold: () => void
}): ReactNode {
  const noun = session.mission === 'build' ? 'build' : 'Spec'
  return (
    <div className="flex h-full w-mission-band flex-col items-center gap-3 border-l border-border bg-surface-content pt-2 text-muted-foreground">
      <Tooltip label={`Unfold the ${noun}`} side="left">
        <IconButton
          variant="ghost"
          size="sm"
          icon={<IconChevronLeft size="sm" />}
          aria-label={`Unfold the ${noun}`}
          data-unfold
          onClick={onUnfold}
        />
      </Tooltip>
      {session.mission === 'build' ? (
        <IconHammer size="md" aria-hidden="true" />
      ) : (
        <IconFileDescription size="md" aria-hidden="true" />
      )}
    </div>
  )
}
