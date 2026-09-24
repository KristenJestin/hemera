import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconChevronLeft } from '../icons.ts'
import { CROSSFADE, crossfade, instant, morph, useTransition } from '../motion.ts'
import type {
  PhaseName,
  ReaderView,
  SectionName,
  SectionView,
  SpecTarget,
  SpecView,
  StoryView,
} from './model.ts'
import { QuestionsPart } from './questions-part.tsx'
import { ReaderBar } from './reader-bar.tsx'
import { ReworkDialog } from './rework-dialog.tsx'
import { SectionPart } from './section-part.tsx'
import { SpecHead } from './spec-head.tsx'
import { type RailGroup, SpecRail, type StageChoice, railOf } from './spec-rail.tsx'
import { StoriesPart } from './stories-part.tsx'
import { TasksPart } from './tasks-part.tsx'

/**
 * The Spec panel: the working surface of a `define` Session, beside the chat (lot 19, brief
 * revisions 3 and 4; core.md, "Session view").
 *
 * Mostly a text to read, so it takes the room only when it is read. By default it is folded to a
 * band beside the chat — the rail's glyphs, their tints and the readiness as `3/7` — and the chat
 * has the rest of the width. The band, a glyph or its fold button unfolds it; the agent starting
 * on a part unfolds it too, onto that part, unless the hand folded it during this Session: a fold
 * by the hand holds until the hand unfolds.
 *
 * Unfolded, a head that stays on top — the key, the title, the status and the one sentence of
 * what is happening — and under it the rail beside the stage, the readiness at the rail's foot.
 * The stage shows one part, or every part of one phase when its heading in the rail is chosen.
 *
 * Which part is on the stage follows one rule. While the reader has chosen nothing, it follows
 * the agent: the part it writes. A row of the rail, a group heading or a thing left before ready
 * pins the choice, and from then on the agent's part only breathes in the rail.
 *
 * The width is what moves, and it pushes the chat (brief revision 4b). The panel is a slot of its
 * row and the chat takes the rest: unfolding, the slot widens on `morph` from the band to its
 * unfolded width and the chat narrows with it from the first frame; folding, the other way. Nothing
 * stands over the chat at any time. The two ends are lengths of different kinds — rems, and a
 * share of the row (`w-spec-panel`, asked of the row, which is its container) — so what moves is
 * how far open the panel is, from 0 to 1, which the slot's width is drawn from (`spec-slot`).
 * What the panel holds is laid at the unfolded width from the first frame and hangs from the
 * slot's left edge, which clips the rest: the stage's text does not reflow on the way, only the
 * chat's does.
 *
 * Everything it shows is handed to it, and everything it does is reported: the panel holds only
 * what is on the stage, whether it is folded, and whether the rework dialog is open. What a save
 * becomes — a version, a conflict, a line in the Journal — is the engine's.
 */

/** The slot the panel takes in its row, whose width moves; what it holds past it is clipped. */
const SLOT = 'spec-slot relative min-h-0 shrink-0 overflow-hidden border-l border-border'

/** What the unfolded panel holds, laid at the unfolded width whatever the slot's own is. */
const OPEN = 'absolute inset-y-0 left-0 flex w-spec-panel flex-col bg-surface-content'

const BAND = 'absolute inset-y-0 left-0 z-10 flex w-spec-band flex-col bg-surface-content'

const BAND_TOP = 'flex shrink-0 justify-center pt-2'

const HEAD = 'flex flex-col gap-1.5 border-b border-border px-5 pt-4 pb-3'

const NOW = 'text-sm text-muted-foreground'

const SCROLL = 'min-h-0 min-w-0 flex-1 overflow-y-auto outline-none focus-ring'

/** The rail and the stage side by side. */
const BODY = 'flex min-h-0 flex-1'

const STAGE = 'flex flex-col gap-10 px-10 pt-5 pb-10'

/** What a part does with the reader's hand, handed down from the panel. */
export interface SpecPartHandlers {
  /** A section's text, with the version its edit was opened on, which the save is checked on. */
  onSaveSection: (name: SectionName, body: string, baseVersion: number) => void
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
  /** Whether the panel starts folded to its band, which it does unless told otherwise. */
  defaultFolded?: boolean | undefined
  /** Told each time the panel folds or unfolds, by the hand or because the agent writes. */
  onFoldChange?: ((folded: boolean) => void) | undefined
  onMarkReady: () => void
  onRework: (reason: string) => void
  onPickRevision: (revision: number) => void
  onTakeOver: () => void
}

export function SpecPanel({
  spec,
  reader,
  defaultReworkOpen = false,
  defaultFolded = true,
  onFoldChange,
  onMarkReady,
  onRework,
  onPickRevision,
  onTakeOver,
  ...handlers
}: SpecPanelProps): ReactNode {
  // What the reader chose, which pins the stage; `null` while they have chosen nothing.
  const [pinned, setPinned] = useState<StageChoice | null>(null)
  const [reworking, setReworking] = useState(defaultReworkOpen)
  const [folded, setFolded] = useState(defaultFolded)
  // Whether the width is on its way. Folding, what was open stays in the slot until it has closed.
  const [moving, setMoving] = useState(false)
  // The fold as it is now, read by the several hands one click may bubble through.
  const isFolded = useRef(defaultFolded)
  // Whether the last fold was the hand's: it holds against the agent until the hand unfolds.
  const byHand = useRef(false)
  const writing = useRef(spec.focus)
  const slot = useRef<HTMLElement>(null)
  // Whether the keyboard was in the panel when the hand folded or unfolded it: the control it
  // was on is gone, and the focus goes to what stands in its place.
  const refocus = useRef(false)
  const width = useTransition(morph)
  // How far open the panel is, from the band (0) to the unfolded width (1).
  const open = useMotionValue(defaultFolded ? 0 : 1)
  const fade = useTransition(crossfade)
  const shown: StageChoice = pinned ?? { part: spec.focus ?? 'problem' }
  const reading = reader !== undefined
  const groups = railOf(spec)

  function fold(next: boolean, hand: boolean): void {
    if (hand) byHand.current = next
    if (isFolded.current === next) return
    refocus.current = hand && (slot.current?.contains(document.activeElement) ?? false)
    isFolded.current = next
    setFolded(next)
    setMoving(true)
    onFoldChange?.(next)
  }

  // The agent starting on a part unfolds the panel onto it — unless the hand folded it.
  useEffect(() => {
    const before = writing.current
    writing.current = spec.focus
    if (spec.focus === undefined || spec.focus === before) return
    if (!isFolded.current || byHand.current) return
    setPinned(null)
    fold(false, false)
  }, [spec.focus])

  /**
   * Writes how far open the panel is onto its slot, which draws its width from it.
   *
   * Called on every frame the value moves rather than subscribed to it, as the shell does with
   * the sidebar's width: a value that changes every frame cannot be a class, and a width
   * assembled in a style attribute is a length living outside the theme.
   */
  function pose(share: number): void {
    slot.current?.style.setProperty('--spec-open', String(share))
  }

  // The first frame has no animation to report a width: the resting one is written before it.
  useLayoutEffect(() => pose(open.get()), [])

  // A fold moves the width on `morph`, from wherever it stands, pushing the chat on every frame.
  // Told to move less, it lands at once.
  useLayoutEffect(() => {
    const target = folded ? 0 : 1
    if (open.get() === target) return
    if (width === instant) {
      open.jump(target)
      pose(target)
      setMoving(false)
      return
    }
    let live = true
    const travel = animate(open, target, { ...width, onUpdate: pose })
    void travel.then(() => {
      if (live) setMoving(false)
    })
    return () => {
      live = false
      travel.stop()
    }
  }, [folded])

  // Folded, the keyboard lands on the band's unfold button; unfolded, on what is on the stage.
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    const target = folded ? '[data-unfold]' : '[data-row][tabindex="0"]'
    slot.current?.querySelector<HTMLElement>(target)?.focus()
  }, [folded])

  const rail = {
    label: `Parts of ${spec.key}`,
    groups,
    current: shown,
    following: spec.focus,
    onSelect: (target: SpecTarget) => setPinned({ part: target }),
    onSelectGroup: (phase: PhaseName) => setPinned({ group: phase }),
    readiness: spec.readiness,
    frozenOn: spec.frozenOn,
    replacedBy: spec.replacedBy,
    onMarkReady,
  }

  return (
    <section ref={slot} aria-label={`Spec ${spec.key}`} className={SLOT}>
      {(!folded || moving) && (
        // Folding, what was open stays under the band until the slot has closed on it, and
        // is out of reach of the keyboard and of a screen reader the whole way.
        <div inert={folded} aria-hidden={folded ? true : undefined} className={OPEN}>
          <header className={HEAD}>
            <SpecHead
              specKey={spec.key}
              title={spec.title}
              type={spec.type}
              status={spec.status}
              revision={spec.revision}
              revisions={spec.revisions}
              superseded={spec.replacedBy !== undefined}
              onPickRevision={onPickRevision}
              onRework={() => setReworking(true)}
              onFold={() => fold(true, true)}
            />
            <p className={NOW}>{spec.now}</p>
          </header>
          {reader !== undefined && (
            <ReaderBar
              writer={reader.writer}
              takeOverRefused={reader.takeOverRefused}
              onTakeOver={onTakeOver}
            />
          )}
          <div className={BODY}>
            <SpecRail {...rail} />
            <SpecStage spec={spec} shown={shown} groups={groups} reading={reading} {...handlers} />
          </div>
        </div>
      )}
      <AnimatePresence initial={false}>
        {folded && (
          // The band: anything pressed in it unfolds the panel, a glyph onto its part. It comes
          // up over the closing panel and goes at once when the slot opens: the part it was
          // pressed for is already there under it, and two rails are one too many.
          <motion.div
            key="band"
            className={BAND}
            initial={CROSSFADE.from}
            animate={CROSSFADE.to}
            transition={fade}
            onClick={() => fold(false, true)}
          >
            <div className={BAND_TOP}>
              <Tooltip label="Unfold the Spec" side="left">
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconChevronLeft size="sm" />}
                  aria-label="Unfold the Spec"
                  data-unfold
                  onClick={() => fold(false, true)}
                />
              </Tooltip>
            </div>
            <SpecRail {...rail} folded />
          </motion.div>
        )}
      </AnimatePresence>
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
      onSave={(body, baseVersion) => onSaveSection(name, body, baseVersion)}
      onApplyMine={(body) => onApplyMine(name, body)}
      onDiscardMine={() => onDiscardMine(name)}
    />
  )
}

export interface SpecStageProps extends SpecPartHandlers {
  spec: SpecView
  /** What is on the stage: one part, or every part of a phase. */
  shown: StageChoice
  /** The groups of the rail, which say which parts a phase has. */
  groups: RailGroup[]
  reading: boolean
}

/** The parts a choice puts on the stage, in the order the rail lists them. */
function partsOf(shown: StageChoice, groups: RailGroup[]): SpecTarget[] {
  if ('part' in shown) return [shown.part]
  return groups.find((group) => group.phase === shown.group)?.rows.map((row) => row.target) ?? []
}

/**
 * The stage: one part, or the parts of one phase one under the other, as they are — and a
 * cross-fade when what is on it changes (brief revisions 3 and 4).
 *
 * Nothing travels: the new content is drawn where the old one was and fades in on the `crossfade`
 * kind — short enough that walking the rail with the arrows never waits on it. The fade is a
 * filter, for the reason the foot of a message gives: the accessibility check measures a text's
 * contrast through an opacity and refuses what it reads mid-flight. New content starts at its top.
 */
export function SpecStage({
  spec,
  shown,
  groups,
  reading,
  ...handlers
}: SpecStageProps): ReactNode {
  const transition = useTransition(crossfade)
  const scroller = useRef<HTMLDivElement>(null)
  const key = 'part' in shown ? `part-${shown.part}` : `group-${shown.group}`
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [key])
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
        key={key}
        className={STAGE}
        initial={CROSSFADE.from}
        animate={CROSSFADE.to}
        transition={transition}
      >
        {partsOf(shown, groups).map((target) => (
          <div key={target} data-part={target}>
            <SpecPart spec={spec} target={target} reading={reading} {...handlers} />
          </div>
        ))}
      </motion.div>
    </div>
  )
}
