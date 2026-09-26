import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { IconCheck } from '../icons.ts'
import { CROSSFADE, collapse, crossfade, expand, morph, useTransition } from '../motion.ts'
import { MissionPanel } from '../session/mission-panel.tsx'
import type {
  PhaseName,
  ReaderView,
  SectionName,
  SectionView,
  SpecTarget,
  SpecView,
} from './model.ts'
import { QuestionsPart } from './questions-part.tsx'
import { ReaderBar } from './reader-bar.tsx'
import { ReworkDialog } from './rework-dialog.tsx'
import { SectionPart } from './section-part.tsx'
import { SpecHead } from './spec-head.tsx'
import { type RailGroup, SpecRail, type StageChoice, railOf } from './spec-rail.tsx'
import { StoriesPart } from './stories-part.tsx'
import { TasksPart } from './tasks-part.tsx'
import { WorkspaceActions, type WorkspaceActionsProps } from './workspace-actions.tsx'

/**
 * The Spec panel: the working surface of a `define` Session, beside the chat (lot 19, brief
 * revisions 3 and 4; core.md, "Session view").
 *
 * The mission panel (`session/mission-panel.tsx`) is its shell: the fold to a band beside the
 * chat, the width that pushes the chat as it unfolds, the agent unfolding it onto what it starts
 * on unless the hand folded it, and the keyboard across a fold. What is the Spec's is here.
 *
 * Unfolded, a head that stays on top — the key, the title, the status, `Rework` on a ready Spec,
 * and no sentence of what the agent is doing — under it the rail beside the stage, and under both
 * a footer the panel's whole width (issue #150). The stage shows one part, or every part of one
 * phase when its heading in the rail is chosen. Folded, the band is the rail's glyphs and their
 * tints. No readiness is drawn (issue #135): what the draft lacks is the agent's to say, and
 * `Mark ready`'s to refuse with. The footer holds `Mark ready` on a draft — quiet until the agent
 * has confirmed the Spec complete, primary from then on — and once the Spec is ready, the build's
 * actions in its place, until the Spec is reworked.
 *
 * Which part is on the stage follows one rule. While the reader has chosen nothing, it follows
 * the agent: the part it writes. A row of the rail or a group heading pins the choice, and from
 * then on the agent's part only breathes in the rail.
 *
 * Everything it shows is handed to it, and everything it does is reported: the panel holds only
 * what is on the stage, and whether the rework dialog is open; its shell, whether it is folded.
 * The agent writes the Spec; the reader reads it and answers, and edits nothing (issue #135).
 */

const HEAD = 'flex flex-col gap-1.5 border-b border-border px-5 pt-4 pb-3'

const NOW = 'text-sm text-muted-foreground'

/** What `Mark ready` was refused with, beside it in the footer, taking the room it leaves. */
const REFUSED = 'min-w-0 flex-1 text-sm text-destructive-muted-foreground'

const SCROLL = 'min-h-0 min-w-0 flex-1 overflow-y-auto outline-none focus-ring'

const STAGE = 'flex flex-col gap-10 px-10 pt-5 pb-10'

/** The footer of the panel, under the rail and the stage alike, its actions at its end. */
const FOOT = 'flex items-center justify-end gap-3 border-t border-border px-5 py-3'

/** What a part does with the reader's hand, handed down from the panel. */
export interface SpecPartHandlers {
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
  /**
   * Whether the Spec was just created in this Session, from the agent's proposal: the panel then
   * arrives, unfolding from nothing on its own spring, rather than standing there (issue #130).
   */
  arrives?: boolean | undefined
  onMarkReady: () => void
  onRework: (reason: string) => void
  onPickRevision: (revision: number) => void
  onTakeOver: () => void
  /**
   * Where the build stands, and what it is launched in (D8-12, D8-13), which the application
   * composes. Drawn in the panel's footer on a Spec that is not being written, and on a launch
   * already asked for whatever the Spec is doing: a draft offers nothing to build, and an older
   * revision of a ready one is read as it was (D7-05).
   */
  build?: WorkspaceActionsProps | undefined
}

export function SpecPanel({
  spec,
  reader,
  defaultReworkOpen = false,
  defaultFolded = true,
  onFoldChange,
  arrives,
  onMarkReady,
  onRework,
  onPickRevision,
  onTakeOver,
  build,
  ...handlers
}: SpecPanelProps): ReactNode {
  // What the reader chose, which pins the stage; `null` while they have chosen nothing.
  const [pinned, setPinned] = useState<StageChoice | null>(null)
  const [reworking, setReworking] = useState(defaultReworkOpen)
  const shown: StageChoice = pinned ?? { part: spec.focus ?? 'problem' }
  // The build is offered on a Spec that is not being written, and never on an older revision of
  // one: only the current revision of a Spec is built, as only it can be reworked (D7-05, D8-12).
  // A launch already asked for stays where it stands once the Spec moves on: a build that started
  // takes its Spec on (`in_progress`), and a Rework takes a waiting launch back — either way the
  // panel is where the Session it opened, or what became of it, is said (D8-13).
  const launched = build !== undefined && build.launch !== null
  const buildable = spec.replacedBy === undefined && (spec.status !== 'draft' || launched)
  // `Mark ready` is offered on the current revision of a draft, whatever it holds: never disabled,
  // what the Spec still lacks is what the engine refuses it with (issue #135). It turns primary
  // once the agent's `ready` proposal was accepted — its attestation stands on the content the
  // Spec is at now (D7-10) — and stays quiet before (issue #150).
  const markable = spec.status === 'draft' && spec.replacedBy === undefined
  const confirmed = spec.readiness.checks.some(
    (check) => check.check === 'attestation' && check.passed,
  )
  const foot: FootContent | null =
    buildable && build !== undefined
      ? { kind: 'build', build }
      : markable
        ? { kind: 'ready', confirmed, refused: spec.readiness.refused, onMarkReady }
        : null
  const groups = railOf(spec)

  const rail = {
    label: `Parts of ${spec.key}`,
    groups,
    current: shown,
    following: spec.focus,
    onSelect: (target: SpecTarget) => setPinned({ part: target }),
    onSelectGroup: (phase: PhaseName) => setPinned({ group: phase }),
  }

  return (
    <>
      <MissionPanel
        label={`Spec ${spec.key}`}
        noun="Spec"
        defaultFolded={defaultFolded}
        onFoldChange={onFoldChange}
        arrives={arrives}
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
              {spec.replacedBy !== undefined && (
                // The one line under the head, and only for an older revision: which phase the
                // agent is on is the rail's to say, and whether it is done the footer's (#150).
                <p className={NOW}>An earlier version · read only</p>
              )}
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
        stage={<SpecStage spec={spec} shown={shown} groups={groups} {...handlers} />}
        band={<SpecRail {...rail} folded />}
        foot={<SpecFoot content={foot} />}
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

/** What the footer holds: `Mark ready` on a draft, the build's actions once the Spec is ready. */
type FootContent =
  | { kind: 'build'; build: WorkspaceActionsProps }
  | {
      kind: 'ready'
      /** Whether the agent confirmed the Spec complete, which makes `Mark ready` the primary. */
      confirmed: boolean
      /** What the last `Mark ready` was refused with. */
      refused: string | undefined
      onMarkReady: () => void
    }

/**
 * The footer of the panel (issues #135, #150): under the rail and the stage together, what the
 * Spec offers at its end — `Mark ready` on a draft, with what it was refused with beside it; once
 * ready, `Use an existing Workspace` and `Prepare and start the build`, then where the launch
 * stands.
 *
 * What it holds arrives and leaves on the `expand` and `collapse` kinds: its height is what makes
 * room, so the rail and the stage above it give it room rather than being covered, and it fades as
 * it goes. Marked ready, `Mark ready` folds away as the build's actions unfold in its place; a
 * Rework takes the build's actions back and brings `Mark ready` back. A Spec opened in either
 * state finds its footer there. While a content leaves it is still in the page, and a button there
 * is a button a second press reaches: so the moment it starts leaving it is `inert` and hidden
 * from assistive technology.
 */
function SpecFoot({ content }: { content: FootContent | null }): ReactNode {
  const transition = useTransition(morph)
  return (
    <AnimatePresence initial={false}>
      {content !== null && (
        <motion.div
          key={content.kind}
          className="shrink-0 overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={transition}
        >
          <Leaving kind={content.kind}>
            {content.kind === 'build' ? (
              <WorkspaceActions {...content.build} />
            ) : (
              <>
                {content.refused !== undefined && (
                  // What the draft still lacks, or that it changed as it was pressed (D7-10).
                  <p role="alert" className={REFUSED}>
                    {content.refused}
                  </p>
                )}
                <Button
                  variant={content.confirmed ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={content.onMarkReady}
                >
                  <IconCheck size="sm" aria-hidden="true" />
                  Mark ready
                </Button>
              </>
            )}
          </Leaving>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The footer's content, out of reach from the moment it starts leaving. */
function Leaving({
  kind,
  children,
}: {
  kind: FootContent['kind']
  children: ReactNode
}): ReactNode {
  const present = useIsPresent()
  return (
    <div
      className={FOOT}
      inert={!present}
      aria-hidden={present ? undefined : true}
      data-foot={kind}
    >
      {children}
    </div>
  )
}

/** A section of the revision, or the empty one its name stands for while nothing is written. */
function sectionOf(spec: SpecView, name: SectionName): SectionView {
  return (
    spec.sections.find((section) => section.name === name) ?? {
      name,
      body: '',
      author: null,
      mark: 'empty',
    }
  )
}

export interface SpecPartProps extends SpecPartHandlers {
  spec: SpecView
  target: SpecTarget
}

/** One part of the Spec, drawn by the part of its kind: a section, or one of the three lists. */
export function SpecPart({ spec, target, onGoToQuestion }: SpecPartProps): ReactNode {
  if (target === 'stories') {
    return <StoriesPart stories={spec.stories} mark={spec.storiesMark} type={spec.type} />
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
  return <SectionPart section={sectionOf(spec, target)} />
}

export interface SpecStageProps extends SpecPartHandlers {
  spec: SpecView
  /** What is on the stage: one part, or every part of a phase. */
  shown: StageChoice
  /** The groups of the rail, which say which parts a phase has. */
  groups: RailGroup[]
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
export function SpecStage({ spec, shown, groups, ...handlers }: SpecStageProps): ReactNode {
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
            <SpecPart spec={spec} target={target} {...handlers} />
          </div>
        ))}
      </motion.div>
    </div>
  )
}
