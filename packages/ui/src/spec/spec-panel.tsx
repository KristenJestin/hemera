import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { CROSSFADE, crossfade, useTransition } from '../motion.ts'
import { MissionPanel } from '../session/mission-panel.tsx'
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
 * The mission panel (`session/mission-panel.tsx`) is its shell: the fold to a band beside the
 * chat, the width that pushes the chat as it unfolds, the agent unfolding it onto what it starts
 * on unless the hand folded it, and the keyboard across a fold. What is the Spec's is here.
 *
 * Unfolded, a head that stays on top — the key, the title, the status and the one sentence of
 * what is happening — and under it the rail beside the stage, the readiness at the rail's foot.
 * The stage shows one part, or every part of one phase when its heading in the rail is chosen.
 * Folded, the band is the rail's glyphs, their tints and the readiness as `3/7`.
 *
 * Which part is on the stage follows one rule. While the reader has chosen nothing, it follows
 * the agent: the part it writes. A row of the rail, a group heading or a thing left before ready
 * pins the choice, and from then on the agent's part only breathes in the rail.
 *
 * Everything it shows is handed to it, and everything it does is reported: the panel holds only
 * what is on the stage, and whether the rework dialog is open; its shell, whether it is folded.
 * What a save becomes — a version, a conflict, a line in the Journal — is the engine's.
 */

const HEAD = 'flex flex-col gap-1.5 border-b border-border px-5 pt-4 pb-3'

const NOW = 'text-sm text-muted-foreground'

const SCROLL = 'min-h-0 min-w-0 flex-1 overflow-y-auto outline-none focus-ring'

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
  const shown: StageChoice = pinned ?? { part: spec.focus ?? 'problem' }
  const reading = reader !== undefined
  const groups = railOf(spec)

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
    <>
      <MissionPanel
        label={`Spec ${spec.key}`}
        noun="Spec"
        defaultFolded={defaultFolded}
        onFoldChange={onFoldChange}
        following={spec.focus}
        // Unfolded by the agent, the stage shows the part it starts on, whatever was chosen.
        onFollow={() => setPinned(null)}
        head={(fold) => (
          <>
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
                onFold={fold}
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
          </>
        )}
        rail={<SpecRail {...rail} />}
        stage={
          <SpecStage spec={spec} shown={shown} groups={groups} reading={reading} {...handlers} />
        }
        band={<SpecRail {...rail} folded />}
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
    </>
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
