import { motion } from 'motion/react'
import { type ReactNode, useRef, useState } from 'react'

import { crossfade, useTransition } from '../motion.ts'
import {
  SECTION_TITLES,
  type ReaderView,
  type SectionName,
  type SectionView,
  type SpecView,
  type StageItem,
  type StoryView,
  sectionsOf,
} from './model.ts'
import { PhaseRail } from './phase-rail.tsx'
import { QuestionsStage } from './questions-stage.tsx'
import { ReadinessBar } from './readiness-bar.tsx'
import { ReaderBar } from './reader-bar.tsx'
import { ReworkDialog } from './rework-dialog.tsx'
import { SectionStage } from './section-stage.tsx'
import { SpecHead } from './spec-head.tsx'
import { type OutlineRow, SpecOutline } from './spec-outline.tsx'
import { StoriesStage } from './stories-stage.tsx'
import { TasksStage } from './tasks-stage.tsx'

/**
 * The Spec panel: the working surface of a `define` Session, beside the chat (lot 19; core.md,
 * "Session view").
 *
 * It is not a form and not a ticket. It shows one thing at a time — where the Spec stands, and
 * the piece being worked on now — and keeps everything else as a quiet outline the reader can
 * open. Four zones, top to bottom: the head with the phase rail, the outline beside the stage,
 * and the readiness at the foot. A Session that reads a draft another one writes gets a quiet
 * bar above them all.
 *
 * It stands on the content surface and not on the rim the prototype drew it on: the amber of a
 * stale phase and the green of `Ready to freeze` fall a hair under the contrast the catalogue
 * holds every text to on the rim, and a panel whose warnings cannot be read is no panel.
 *
 * Everything it shows is handed to it, and everything it does is reported: the panel holds only
 * what is on the stage and whether the rework dialog is open. What a save becomes — a version,
 * a conflict, a line in the Journal — is the engine's to decide.
 */

const PANEL = 'flex h-full min-h-0 flex-col bg-surface-content'

const HEAD = 'flex flex-col gap-3 border-b border-border px-5 pt-4 pb-3'

const BODY = 'flex min-h-0 flex-1'

const OUTLINE = 'w-outline shrink-0 overflow-y-auto border-r border-border px-2 py-3'

const STAGE = 'min-w-0 flex-1 overflow-y-auto px-6 pt-5 pb-6'

const FOOT = 'border-t border-border px-5 pt-3 pb-4'

export interface SpecPanelProps {
  spec: SpecView
  /** Present when this Session reads a draft another Session writes. */
  reader?: ReaderView | undefined
  /** What the stage shows first. */
  defaultItem?: StageItem | undefined
  /** Whether the rework dialog starts open, for the story that shows it. */
  defaultReworkOpen?: boolean | undefined
  onSaveSection: (name: SectionName, body: string) => void
  onApplyMine: (name: SectionName, body: string) => void
  onDiscardMine: (name: SectionName) => void
  onSaveStory: (story: StoryView) => void
  onAnswer: (id: string, answer: string) => void
  onMarkReady: () => void
  onRework: (reason: string) => void
  onPickRevision: (revision: number) => void
  onTakeOver: () => void
}

export function SpecPanel({
  spec,
  reader,
  defaultItem = 'problem',
  defaultReworkOpen = false,
  onSaveSection,
  onApplyMine,
  onDiscardMine,
  onSaveStory,
  onAnswer,
  onMarkReady,
  onRework,
  onPickRevision,
  onTakeOver,
}: SpecPanelProps): ReactNode {
  const [item, setItem] = useState<StageItem>(defaultItem)
  const [reworking, setReworking] = useState(defaultReworkOpen)
  const outline = useRef<HTMLDivElement>(null)
  const rows = rowsOf(spec)
  const editable = spec.status === 'draft'

  /** Puts a target on the stage and the keyboard on its row, from a link of the readiness. */
  function goTo(target: StageItem): void {
    setItem(target)
    // The row is drawn with the stop of the tab order once the render lands, and the keyboard
    // goes to it, so the next arrow walks on from where the link led.
    requestAnimationFrame(() => {
      outline.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus()
    })
  }

  return (
    <section aria-label={`Spec ${spec.key}`} className={PANEL}>
      {reader !== undefined && <ReaderBar writer={reader.writer} onTakeOver={onTakeOver} />}
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
        <PhaseRail phases={spec.phases} now={spec.now} />
      </header>
      <div className={BODY}>
        <div ref={outline} className={OUTLINE}>
          <SpecOutline
            label={`Outline of ${spec.key}`}
            rows={rows}
            current={item}
            onSelect={setItem}
          />
        </div>
        <div className={STAGE}>
          <SpecStage
            spec={spec}
            item={item}
            editable={editable}
            reading={reader !== undefined}
            onSaveSection={onSaveSection}
            onApplyMine={onApplyMine}
            onDiscardMine={onDiscardMine}
            onSaveStory={onSaveStory}
            onAnswer={onAnswer}
          />
        </div>
      </div>
      <footer className={FOOT}>
        <ReadinessBar
          readiness={spec.readiness}
          frozenOn={spec.frozenOn}
          onGoTo={goTo}
          onMarkReady={onMarkReady}
        />
      </footer>
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

/** The rows of the outline: the type's sections in order, a line, then the three lists. */
export function rowsOf(spec: SpecView): OutlineRow[] {
  const sections: OutlineRow[] = sectionsOf(spec.type).map((name) => {
    const section = sectionOf(spec, name)
    return { item: name, label: SECTION_TITLES[name], mark: section.mark }
  })
  // Stories are optional and mostly a `feature` matter (core.md, "Spec"): a Spec of another
  // type shows the row only once it has one.
  const stories: OutlineRow[] =
    spec.type === 'feature' || spec.stories.length > 0
      ? [{ item: 'stories', label: 'Stories', mark: spec.storiesMark, count: spec.stories.length }]
      : []
  const lists: OutlineRow[] = [
    ...stories,
    { item: 'tasks', label: 'Tasks', mark: spec.tasksMark, count: spec.tasks.length },
    {
      item: 'questions',
      label: 'Questions',
      mark: spec.questionsMark,
      // The open ones: what the count says is what is left for somebody to answer.
      count: spec.questions.filter((question) => question.answer === undefined).length,
    },
  ]
  lists[0] = { ...lists[0]!, separated: true }
  return [...sections, ...lists]
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

export interface SpecStageProps {
  spec: SpecView
  item: StageItem
  /** Whether the Spec can be changed: a draft, at its current revision. */
  editable: boolean
  /** Whether this Session reads a draft another one writes. */
  reading: boolean
  onSaveSection: (name: SectionName, body: string) => void
  onApplyMine: (name: SectionName, body: string) => void
  onDiscardMine: (name: SectionName) => void
  onSaveStory: (story: StoryView) => void
  onAnswer: (id: string, answer: string) => void
}

/**
 * The stage: one item, and a cross-fade when it changes (lot 19, brief "Motion").
 *
 * Nothing travels: the new item is drawn where the old one was and fades in, on the `crossfade`
 * kind — short enough that walking the outline with the arrows never waits on it. The fade is a
 * filter, for the reason the foot of a message gives: the accessibility check measures a text's
 * contrast through an opacity and refuses what it reads mid-flight.
 */
export function SpecStage({
  spec,
  item,
  editable,
  reading,
  onSaveSection,
  onApplyMine,
  onDiscardMine,
  onSaveStory,
  onAnswer,
}: SpecStageProps): ReactNode {
  const transition = useTransition(crossfade)

  /** The item itself, drawn by the stage of its kind. */
  function itemOf(): ReactNode {
    if (item === 'stories') {
      return (
        <StoriesStage
          stories={spec.stories}
          editable={editable}
          note={reading && editable ? 'you can edit; the agent of the writer is told' : undefined}
          onSaveStory={onSaveStory}
        />
      )
    }
    if (item === 'tasks')
      return <TasksStage tasks={spec.tasks} stale={spec.tasksMark === 'stale'} />
    if (item === 'questions') {
      return <QuestionsStage questions={spec.questions} editable={editable} onAnswer={onAnswer} />
    }
    const name = item
    return (
      <SectionStage
        // A section is its own editor: another one on the stage is another text, never the
        // same area handed a second text while it may hold the caret.
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

  return (
    <motion.div
      key={item}
      initial={{ filter: 'opacity(0)' }}
      animate={{ filter: 'opacity(1)' }}
      transition={transition}
    >
      {itemOf()}
    </motion.div>
  )
}
