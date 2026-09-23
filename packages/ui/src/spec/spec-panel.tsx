import { cn } from 'cn'
import { motion } from 'motion/react'
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
import { SpecRail, railOf } from './spec-rail.tsx'
import { StoriesPart } from './stories-part.tsx'
import { TasksPart } from './tasks-part.tsx'

/**
 * The Spec panel: the working surface of a `define` Session, beside the chat (lot 19, brief
 * revision 3; core.md, "Session view").
 *
 * A head that stays on top — the key, the title, the status, one sentence saying what is
 * happening, and the readiness — and under it the rail beside the stage. The stage shows one
 * part at a time: the long document of revision 2 brought back the scrolling it was meant to
 * spare, so the rail is how the reader goes from part to part, and `Show all` puts the whole
 * document back on the stage for whoever wants to read it through.
 *
 * Which part is on the stage follows one rule. While the reader has chosen nothing, it follows
 * the agent: the part it writes. A row of the rail or a link of the readiness pins the choice,
 * and from then on the agent's part only breathes in the rail.
 *
 * Everything it shows is handed to it, and everything it does is reported: the panel holds only
 * what is on the stage, whether the whole document is, and whether the rework dialog is open.
 * What a save becomes — a version, a conflict, a line in the Journal — is the engine's.
 */

const PANEL = 'flex h-full min-h-0 flex-col bg-surface-content'

const HEAD = 'flex flex-col gap-2.5 border-b border-border px-5 pt-4 pb-3'

const NOW = 'text-sm text-muted-foreground'

const SCROLL = 'min-h-0 min-w-0 flex-1 overflow-y-auto outline-none focus-ring'

/** The rail and the stage side by side, and the box whose width folds the rail. */
const BODY = '@container flex min-h-0 flex-1'

const STAGE = 'px-10 pt-5 pb-10'

/** What a part does with the reader's hand, handed down from the panel. */
export interface SpecPartHandlers {
  onSaveSection: (name: SectionName, body: string) => void
  onApplyMine: (name: SectionName, body: string) => void
  onDiscardMine: (name: SectionName) => void
  onSaveStory: (story: StoryView) => void
  /** Takes the thread to where an open question is asked. */
  onGoToQuestion: (id: string) => void
}

export interface SpecPanelProps extends SpecPartHandlers {
  spec: SpecView
  /** Present when this Session reads a draft another Session writes. */
  reader?: ReaderView | undefined
  /** Whether the rework dialog starts open, for the story that shows it. */
  defaultReworkOpen?: boolean | undefined
  /** Whether the stage starts on the whole document; held by the panel afterwards. */
  defaultShowAll?: boolean | undefined
  onMarkReady: () => void
  onRework: (reason: string) => void
  onPickRevision: (revision: number) => void
  onTakeOver: () => void
}

export function SpecPanel({
  spec,
  reader,
  defaultReworkOpen = false,
  defaultShowAll = false,
  onMarkReady,
  onRework,
  onPickRevision,
  onTakeOver,
  ...handlers
}: SpecPanelProps): ReactNode {
  // What the reader chose, which pins the stage; `null` while they have chosen nothing.
  const [pinned, setPinned] = useState<SpecTarget | null>(null)
  // Counts the choices: choosing again the part already shown still scrolls back to it in the
  // whole document, which is what the reader who scrolled away meant.
  const [asked, setAsked] = useState(0)
  const [showAll, setShowAll] = useState(defaultShowAll)
  const [reworking, setReworking] = useState(defaultReworkOpen)
  const shown: SpecTarget = pinned ?? spec.focus ?? 'problem'
  const reading = reader !== undefined

  function choose(target: SpecTarget): void {
    setPinned(target)
    setAsked(asked + 1)
  }

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
          onGoTo={choose}
          onMarkReady={onMarkReady}
        />
      </header>
      {reader !== undefined && <ReaderBar writer={reader.writer} onTakeOver={onTakeOver} />}
      <div className={BODY}>
        <SpecRail
          label={`Parts of ${spec.key}`}
          groups={railOf(spec)}
          current={shown}
          following={spec.focus}
          onSelect={choose}
          showAll={showAll}
          onShowAllChange={setShowAll}
        />
        {showAll ? (
          <SpecDocument spec={spec} focused={shown} asked={asked} reading={reading} {...handlers} />
        ) : (
          <SpecStage spec={spec} shown={shown} reading={reading} {...handlers} />
        )}
      </div>
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

export interface SpecPartProps extends SpecPartHandlers {
  spec: SpecView
  target: SpecTarget
  /** Whether this Session reads a draft another one writes. */
  reading: boolean
}

/** One part of the Spec, drawn by the part of its kind: a section, or one of the three lists. */
export function SpecPart({
  spec,
  target,
  reading,
  onSaveSection,
  onApplyMine,
  onDiscardMine,
  onSaveStory,
  onGoToQuestion,
}: SpecPartProps): ReactNode {
  const editable = spec.status === 'draft'
  if (target === 'stories') {
    return (
      <StoriesPart
        stories={spec.stories}
        mark={spec.storiesMark}
        editable={editable}
        note={reading && editable ? 'you can edit; the agent of the writer is told' : undefined}
        onSaveStory={onSaveStory}
      />
    )
  }
  if (target === 'tasks') return <TasksPart tasks={spec.tasks} mark={spec.tasksMark} />
  if (target === 'questions') {
    return (
      <QuestionsPart
        questions={spec.questions}
        mark={spec.questionsMark}
        onGoToQuestion={onGoToQuestion}
      />
    )
  }
  const name = target
  return (
    <SectionPart
      // A section is its own editor: another one is another text, never the same area handed a
      // second text while it may hold the caret.
      key={name}
      section={sectionOf(spec, name)}
      editable={editable}
      revision={spec.revision}
      onSave={(body) => onSaveSection(name, body)}
      onApplyMine={(body) => onApplyMine(name, body)}
      onDiscardMine={() => onDiscardMine(name)}
    />
  )
}

export interface SpecStageProps extends SpecPartHandlers {
  spec: SpecView
  /** The part on the stage. */
  shown: SpecTarget
  reading: boolean
}

/**
 * The stage: one part, and a cross-fade when it changes (brief revision 3).
 *
 * Nothing travels: the new part is drawn where the old one was and fades in on the `crossfade`
 * kind — short enough that walking the rail with the arrows never waits on it. The fade is a
 * filter, for the reason the foot of a message gives: the accessibility check measures a text's
 * contrast through an opacity and refuses what it reads mid-flight. A new part starts at its top.
 */
export function SpecStage({ spec, shown, reading, ...handlers }: SpecStageProps): ReactNode {
  const transition = useTransition(crossfade)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [shown])
  return (
    // The scroll of a long part, and so a stop of the keyboard: a region that scrolls and cannot
    // be reached is a region the arrows cannot read.
    <div
      ref={scroller}
      role="region"
      aria-label={`Stage of ${spec.key}`}
      tabIndex={0}
      className={SCROLL}
    >
      <motion.div
        key={shown}
        data-part={shown}
        className={STAGE}
        initial={{ filter: 'opacity(0)' }}
        animate={{ filter: 'opacity(1)' }}
        transition={transition}
      >
        <SpecPart spec={spec} target={shown} reading={reading} {...handlers} />
      </motion.div>
    </div>
  )
}

const DOCUMENT = 'flex flex-col gap-6 px-10 pt-5 pb-10'

const GROUP = 'flex flex-col gap-1'

const GROUP_HEAD =
  'relative flex items-center gap-2 pb-1 text-xs font-medium tracking-wide uppercase'

/**
 * A part, and the soft highlight of the focus: the one accent, at its softest — the neutral
 * accent surface took the amber of a stale part under the contrast the catalogue holds every
 * text to — faded in and out by the theme's `highlight-motion`, still under reduced motion. The
 * padding is given back outside it, so the text of a highlighted part stays exactly where it was.
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

export interface SpecDocumentProps extends SpecPartHandlers {
  spec: SpecView
  /** The part the focus is on, highlighted and scrolled to. */
  focused?: SpecTarget | undefined
  /** Counts up each time the focus is asked for again, which scrolls back to it. */
  asked?: number | undefined
  /** Whether this Session reads a draft another one writes. */
  reading: boolean
}

/**
 * The Spec as one document, grouped under `Shape`, `Plan` and `Decompose` (brief revision 2):
 * what `Show all` puts on the stage. `Prototype` is not drawn at all in this version.
 */
export function SpecDocument({
  spec,
  focused,
  asked = 0,
  reading,
  ...handlers
}: SpecDocumentProps): ReactNode {
  const scroller = useRef<HTMLDivElement>(null)
  const still = useTransition(crossfade) === instant
  const arrived = useRef(false)
  // The focused part is scrolled to: smoothly when it moves, at once when the document opens on
  // it and whenever less movement is asked for.
  useEffect(() => {
    if (focused === undefined) return
    const part = scroller.current?.querySelector(`[data-part="${focused}"]`)
    part?.scrollIntoView({
      block: 'start',
      behavior: still || !arrived.current ? 'auto' : 'smooth',
    })
    arrived.current = true
  }, [focused, asked, still])

  function state(phase: PhaseName): PhaseState {
    return spec.phases.find((one) => one.name === phase)?.state ?? 'pending'
  }

  function inPart(target: SpecTarget): ReactNode {
    return (
      <div
        key={target}
        data-part={target}
        aria-current={focused === target ? 'location' : undefined}
        className={cn(PART, focused === target && FOCUSED)}
      >
        <SpecPart spec={spec} target={target} reading={reading} {...handlers} />
      </div>
    )
  }

  // Stories are optional and mostly a `feature` matter (core.md, "Spec"): a Spec of another type
  // shows them only once it has one.
  const stories = spec.type === 'feature' || spec.stories.length > 0
  return (
    // The scroll of the whole document, and so a stop of the keyboard.
    <div
      ref={scroller}
      role="region"
      aria-label={`Document of ${spec.key}`}
      tabIndex={0}
      className={SCROLL}
    >
      <div className={DOCUMENT}>
        <Group phase="shape" state={state('shape')}>
          {shapedSectionsOf(spec.type).map(inPart)}
        </Group>
        <Group phase="plan" state={state('plan')}>
          {inPart('plan')}
        </Group>
        <Group phase="decompose" state={state('decompose')}>
          {stories && inPart('stories')}
          {inPart('tasks')}
          {inPart('questions')}
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
