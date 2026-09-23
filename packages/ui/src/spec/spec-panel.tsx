import { cn } from 'cn'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { crossfade, instant, useTransition } from '../motion.ts'
import {
  PHASE_TITLES,
  type PhaseName,
  type PhaseState,
  type ReaderView,
  type SectionName,
  type SectionView,
  type SpecTarget,
  type SpecView,
  type StoryView,
  shapedSectionsOf,
} from './model.ts'
import { QuestionsPart } from './questions-part.tsx'
import { ReadinessBar } from './readiness-bar.tsx'
import { ReaderBar } from './reader-bar.tsx'
import { ReworkDialog } from './rework-dialog.tsx'
import { SectionPart } from './section-part.tsx'
import { SpecHead } from './spec-head.tsx'
import { StoriesPart } from './stories-part.tsx'
import { TasksPart } from './tasks-part.tsx'

/**
 * The Spec panel: the working surface of a `define` Session, beside the chat (lot 19, brief
 * revision 2; core.md, "Session view").
 *
 * A head that stays on top — the key, the title, the status, one sentence saying what is
 * happening, and the readiness — and under it the Spec as one document, the only thing that
 * scrolls. The document is grouped the way the work is: what `shape` wrote, what `plan` wrote,
 * what `decompose` wrote, each group heading wearing the state of its phase. There is no phase
 * rail and no outline: the structure of the document is the phase, and the part the agent is
 * writing is highlighted and scrolled to, so the reader's eye is taken where the work is.
 *
 * Everything it shows is handed to it, and everything it does is reported: the panel holds only
 * which part has the focus and whether the rework dialog is open. What a save becomes — a
 * version, a conflict, a line in the Journal — is the engine's to decide.
 */

const PANEL = 'flex h-full min-h-0 flex-col bg-surface-content'

const HEAD = 'flex flex-col gap-2.5 border-b border-border px-5 pt-4 pb-3'

const NOW = 'text-sm text-muted-foreground'

const SCROLL = 'min-h-0 flex-1 overflow-y-auto outline-none focus-ring'

export interface SpecPanelProps {
  spec: SpecView
  /** Present when this Session reads a draft another Session writes. */
  reader?: ReaderView | undefined
  /** Whether the rework dialog starts open, for the story that shows it. */
  defaultReworkOpen?: boolean | undefined
  onSaveSection: (name: SectionName, body: string) => void
  onApplyMine: (name: SectionName, body: string) => void
  onDiscardMine: (name: SectionName) => void
  onSaveStory: (story: StoryView) => void
  /** Takes the thread to where an open question is asked. */
  onGoToQuestion: (id: string) => void
  onMarkReady: () => void
  onRework: (reason: string) => void
  onPickRevision: (revision: number) => void
  onTakeOver: () => void
}

export function SpecPanel({
  spec,
  reader,
  defaultReworkOpen = false,
  onSaveSection,
  onApplyMine,
  onDiscardMine,
  onSaveStory,
  onGoToQuestion,
  onMarkReady,
  onRework,
  onPickRevision,
  onTakeOver,
}: SpecPanelProps): ReactNode {
  const [focused, setFocused] = useState<SpecTarget | undefined>(spec.focus)
  // Counts the times a link asked for the focus: asking again for the part already focused
  // still scrolls back to it, which is what the reader who scrolled away meant.
  const [asked, setAsked] = useState(0)
  const [reworking, setReworking] = useState(defaultReworkOpen)
  // Where the agent writes is where the focus goes, each time it moves.
  useEffect(() => {
    if (spec.focus !== undefined) setFocused(spec.focus)
  }, [spec.focus])
  return (
    <section aria-label={`Spec ${spec.key}`} className={PANEL}>
      <header className={HEAD}>
        <SpecHead
          specKey={spec.key}
          title={spec.title}
          type={spec.type}
          status={spec.status}
          revision={spec.revision}
          revisions={spec.revisions}
          onPickRevision={onPickRevision}
          onRework={() => setReworking(true)}
        />
        <p className={NOW}>{spec.now}</p>
        <ReadinessBar
          readiness={spec.readiness}
          frozenOn={spec.frozenOn}
          onGoTo={(target) => {
            setFocused(target)
            setAsked(asked + 1)
          }}
          onMarkReady={onMarkReady}
        />
      </header>
      {reader !== undefined && <ReaderBar writer={reader.writer} onTakeOver={onTakeOver} />}
      <SpecDocument
        spec={spec}
        focused={focused}
        asked={asked}
        reading={reader !== undefined}
        onSaveSection={onSaveSection}
        onApplyMine={onApplyMine}
        onDiscardMine={onDiscardMine}
        onSaveStory={onSaveStory}
        onGoToQuestion={onGoToQuestion}
      />
      <ReworkDialog
        open={reworking}
        onOpenChange={setReworking}
        specKey={spec.key}
        revision={spec.revision}
        onRework={(reason) => {
          setReworking(false)
          onRework(reason)
        }}
      />
    </section>
  )
}

/** A section of the revision, or the empty one its name stands for while nothing is written. */
function sectionOf(spec: SpecView, name: SectionName): SectionView {
  return (
    spec.sections.find((section) => section.name === name) ?? {
      name,
      body: '',
      version: 0,
      author: null,
      mark: 'empty',
    }
  )
}

const DOCUMENT = 'flex flex-col gap-6 px-10 pt-5 pb-10'

const GROUP = 'flex flex-col gap-1'

const GROUP_HEAD =
  'relative flex items-center gap-2 pb-1 text-xs font-medium tracking-wide uppercase'

/**
 * A part, and the soft highlight of the focus: the one accent, at its softest —
 * the neutral accent surface took the amber of a stale part under the contrast the catalogue
 * holds every text to — faded in and out by the
 * theme's `highlight-motion`, still under reduced motion. The padding is given back outside it, so
 * the text of a highlighted part stays exactly where it was.
 */
const PART = '-mx-4 scroll-mt-10 rounded-lg px-4 py-3 highlight-motion'

const FOCUSED = 'bg-primary-muted'

/** The dot of a group heading, the state of its phase; the open one breathes. */
const PHASE_DOT: Record<PhaseState, string> = {
  finished: 'size-1.5 rounded-full bg-muted-foreground',
  open: 'size-1.5 rounded-full bg-primary motion-safe:animate-breathe',
  pending: 'size-1.5 rounded-full border border-input',
  stale: 'size-1.5 rounded-full bg-warning',
  unavailable: 'size-1.5 rounded-full border border-dashed border-input',
}

const PHASE_WORD: Record<PhaseState, string> = {
  finished: 'text-muted-foreground',
  open: 'text-foreground',
  pending: 'text-muted-foreground',
  stale: 'text-warning-muted-foreground',
  unavailable: 'text-muted-foreground',
}

const PHASE_STATE_WORDS: Record<PhaseState, string> = {
  finished: 'finished',
  open: 'open',
  pending: 'pending',
  stale: 'stale after the rework',
  unavailable: 'unavailable',
}

export interface SpecDocumentProps {
  spec: SpecView
  /** The part the focus is on, highlighted and scrolled to. */
  focused?: SpecTarget | undefined
  /** Counts up each time the focus is asked for again, which scrolls back to it. */
  asked?: number | undefined
  /** Whether this Session reads a draft another one writes. */
  reading: boolean
  onSaveSection: (name: SectionName, body: string) => void
  onApplyMine: (name: SectionName, body: string) => void
  onDiscardMine: (name: SectionName) => void
  onSaveStory: (story: StoryView) => void
  onGoToQuestion: (id: string) => void
}

/**
 * The Spec as one document, grouped under `Shape`, `Plan` and `Decompose` (brief revision 2).
 * `Prototype` is not drawn at all in this version.
 */
export function SpecDocument({
  spec,
  focused,
  asked = 0,
  reading,
  onSaveSection,
  onApplyMine,
  onDiscardMine,
  onSaveStory,
  onGoToQuestion,
}: SpecDocumentProps): ReactNode {
  const scroller = useRef<HTMLDivElement>(null)
  const still = useTransition(crossfade) === instant
  const arrived = useRef(false)
  // The focused part is scrolled to: smoothly when it moves, at once when the panel opens on it
  // and whenever less movement is asked for.
  useEffect(() => {
    if (focused === undefined) return
    const part = scroller.current?.querySelector(`[data-part="${focused}"]`)
    part?.scrollIntoView({
      block: 'start',
      behavior: still || !arrived.current ? 'auto' : 'smooth',
    })
    arrived.current = true
  }, [focused, asked, still])
  const editable = spec.status === 'draft'

  function state(phase: PhaseName): PhaseState {
    return spec.phases.find((one) => one.name === phase)?.state ?? 'pending'
  }

  function inPart(target: SpecTarget, content: ReactNode): ReactNode {
    return (
      <div
        key={target}
        data-part={target}
        aria-current={focused === target ? 'location' : undefined}
        className={cn(PART, focused === target && FOCUSED)}
      >
        {content}
      </div>
    )
  }

  function section(name: SectionName): ReactNode {
    return inPart(
      name,
      <SectionPart
        // A section is its own editor: another one is another text, never the same area
        // handed a second text while it may hold the caret.
        key={name}
        section={sectionOf(spec, name)}
        editable={editable}
        revision={spec.revision}
        onSave={(body) => onSaveSection(name, body)}
        onApplyMine={(body) => onApplyMine(name, body)}
        onDiscardMine={() => onDiscardMine(name)}
      />,
    )
  }

  // Stories are optional and mostly a `feature` matter (core.md, "Spec"): a Spec of another type
  // shows them only once it has one.
  const stories = spec.type === 'feature' || spec.stories.length > 0
  return (
    // The one scroll of the panel, and so a stop of the keyboard: a region that scrolls and
    // cannot be reached is a region the arrows cannot read.
    <div
      ref={scroller}
      role="region"
      aria-label={`Document of ${spec.key}`}
      tabIndex={0}
      className={SCROLL}
    >
      <div className={DOCUMENT}>
        <Group phase="shape" state={state('shape')}>
          {shapedSectionsOf(spec.type).map(section)}
        </Group>
        <Group phase="plan" state={state('plan')}>
          {section('plan')}
        </Group>
        <Group phase="decompose" state={state('decompose')}>
          {stories &&
            inPart(
              'stories',
              <StoriesPart
                stories={spec.stories}
                mark={spec.storiesMark}
                editable={editable}
                note={
                  reading && editable ? 'you can edit; the agent of the writer is told' : undefined
                }
                onSaveStory={onSaveStory}
              />,
            )}
          {inPart('tasks', <TasksPart tasks={spec.tasks} mark={spec.tasksMark} />)}
          {inPart(
            'questions',
            <QuestionsPart
              questions={spec.questions}
              mark={spec.questionsMark}
              onGoToQuestion={onGoToQuestion}
            />,
          )}
        </Group>
      </div>
    </div>
  )
}

/** A group of the document, under the quiet heading of the phase that writes it. */
function Group({
  phase,
  state,
  children,
}: {
  phase: PhaseName
  state: PhaseState
  children: ReactNode
}): ReactNode {
  return (
    <section aria-label={PHASE_TITLES[phase]} className={GROUP}>
      <h3 className={cn(GROUP_HEAD, PHASE_WORD[state])}>
        <span
          aria-hidden="true"
          className="absolute -left-4 flex size-2 items-center justify-center"
        >
          <span className={PHASE_DOT[state]} />
        </span>
        {PHASE_TITLES[phase]}
        <span className="sr-only">{`, ${PHASE_STATE_WORDS[state]}`}</span>
      </h3>
      {children}
    </section>
  )
}
