import { type ReactNode, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import {
  SECTION_TITLES,
  type ReaderView,
  type SectionName,
  type SectionView,
  type SpecAnswer,
  type SpecTarget,
  type SpecView,
  type StoryView,
} from './model.ts'
import { phases } from './spec-fixtures.ts'
import { SpecPanel } from './spec-panel.tsx'

/**
 * The Spec held by the state the engine would hold, for the stories (lot 19, phase 0).
 *
 * A story is where the panel is tried, and a panel whose saves go nowhere cannot be: the text
 * would snap back on every blur. So this stands in for the engine with the few answers phase 1
 * will give for real — a save is a new human version for the agent's next turn, `Apply mine` is
 * one on top of the current version, an answer in the chat closes its question and, when it was
 * the last blocking one, lets the gate fill; `Mark ready` freezes; `Rework` copies into a new
 * draft whose plan and tasks are stale — and nothing else. Every action is also reported to
 * `on`, which is what a play asserts on.
 */

export interface SpecActions {
  onSaveSection: (name: SectionName, body: string, baseVersion: number) => void
  onApplyMine: (name: SectionName, body: string) => void
  onDiscardMine: (name: SectionName) => void
  onSaveStory: (story: StoryView) => void
  onAnswer: (id: string, answer: SpecAnswer) => void
  onGoToQuestion: (id: string) => void
  onMarkReady: () => void
  onRework: (reason: string) => void
  onPickRevision: (revision: number) => void
  onTakeOver: () => void
}

export interface LiveSpec {
  spec: SpecView
  reader: ReaderView | undefined
  /** The same actions, answered the way the engine will answer them. */
  actions: SpecActions
  /** The agent starting on a part: the part it writes, and the sentence saying so. */
  write: (target: SpecTarget) => void
}

/** How a part is named in the sentence of the head. */
function partName(target: SpecTarget): string {
  if (target === 'stories' || target === 'tasks' || target === 'questions') return target
  return SECTION_TITLES[target].toLowerCase()
}

/** The Spec and the reader bar, held, with the actions that change them. */
export function useLiveSpec(
  initial: SpecView,
  initialReader: ReaderView | undefined,
  on: SpecActions,
): LiveSpec {
  const [spec, setSpec] = useState(initial)
  const [reader, setReader] = useState(initialReader)

  function section(name: SectionName, change: (one: SectionView) => SectionView): void {
    setSpec((now) => ({
      ...now,
      sections: now.sections.map((one) => (one.name === name ? change(one) : one)),
    }))
  }

  const actions: SpecActions = {
    onSaveSection: (name, body, baseVersion) => {
      on.onSaveSection(name, body, baseVersion)
      section(name, (one) => ({
        ...one,
        body,
        version: one.version + 1,
        author: 'human',
        mark: 'human',
        pendingForAgent: true,
        copiedFrom: undefined,
      }))
    },
    onApplyMine: (name, body) => {
      on.onApplyMine(name, body)
      section(name, (one) => ({
        ...one,
        body,
        version: (one.conflict?.current ?? one.version) + 1,
        author: 'human',
        mark: 'human',
        pendingForAgent: true,
        conflict: undefined,
      }))
    },
    onDiscardMine: (name) => {
      on.onDiscardMine(name)
      section(name, (one) => ({ ...one, mark: 'agent', conflict: undefined }))
    },
    onSaveStory: (story) => {
      on.onSaveStory(story)
      setSpec((now) => ({
        ...now,
        stories: now.stories.map((one) => (one.id === story.id ? story : one)),
        storiesMark: 'human',
      }))
    },
    onAnswer: (id, answer) => {
      on.onAnswer(id, answer)
      setSpec((now) => {
        const questions = now.questions.map((one) => (one.id === id ? { ...one, answer } : one))
        const blocking = questions.some((one) => one.blocking && one.answer === null)
        if (blocking) return { ...now, questions }
        // The last blocking question answered: its check passes, and the sentence stops
        // naming it.
        return {
          ...now,
          questions,
          readiness: {
            checks: now.readiness.checks.map((check) =>
              check.check === 'questions' ? { check: 'questions', passed: true } : check,
            ),
            todo: now.readiness.todo.filter((item) => item.target !== 'questions'),
          },
        }
      })
    },
    onGoToQuestion: on.onGoToQuestion,
    onMarkReady: () => {
      on.onMarkReady()
      setSpec((now) => ({
        ...now,
        status: 'ready',
        frozenOn: 'today',
        focus: undefined,
        now: 'Ready · frozen, a build can start from it',
        revisions:
          now.revisions.length > 1
            ? now.revisions.map((one) =>
                one.number === now.revision ? { ...one, detail: 'Latest · frozen' } : one,
              )
            : [{ number: now.revision, detail: 'Latest · frozen' }],
      }))
    },
    onRework: (reason) => {
      on.onRework(reason)
      setSpec((now) => ({
        ...now,
        status: 'draft',
        frozenOn: undefined,
        revision: now.revision + 1,
        revisions: [
          { number: now.revision + 1, detail: 'Latest · draft' },
          ...now.revisions.map((one) =>
            one.number === now.revision ? { ...one, detail: 'Frozen today · read only' } : one,
          ),
        ],
        phases: phases('finished', 'stale', 'stale'),
        now: 'Every phase to review · the agent goes over each again',
        focus: 'plan',
        sections: now.sections.map((one) =>
          one.name === 'plan' ? { ...one, mark: 'stale', copiedFrom: now.revision } : one,
        ),
        tasksMark: 'stale',
        readiness: {
          checks: now.readiness.checks.map((check) =>
            check.check === 'phases' || check.check === 'attestation'
              ? { ...check, passed: false, detail: `${check.check} · to be given again` }
              : check,
          ),
          todo: [
            { label: 'plan and decompose', target: 'plan' },
            { label: "the agent's final check" },
          ],
        },
      }))
    },
    onPickRevision: on.onPickRevision,
    onTakeOver: () => {
      on.onTakeOver()
      setReader(undefined)
    },
  }
  function write(target: SpecTarget): void {
    setSpec((now) => ({
      ...now,
      focus: target,
      now: `The agent is writing the ${partName(target)}`,
      sections: now.sections.map((one) =>
        one.name === target ? { ...one, mark: 'writing' } : one,
      ),
      tasksMark: target === 'tasks' ? 'writing' : now.tasksMark,
      storiesMark: target === 'stories' ? 'writing' : now.storiesMark,
    }))
  }
  return { spec, reader, actions, write }
}

export interface LiveSpecPanelProps extends SpecActions {
  spec: SpecView
  reader?: ReaderView | undefined
  defaultReworkOpen?: boolean | undefined
  defaultFolded?: boolean | undefined
  onFoldChange?: ((folded: boolean) => void) | undefined
  /** Whether the Spec was just created here, and the panel arrives. */
  arrives?: boolean | undefined
  /** A part the agent can be made to start on, from a button where the chat stands. */
  agentWrites?: SpecTarget | undefined
}

/**
 * The panel over a held Spec, for the stories that show the panel alone: in a Session's row,
 * beside a stand-in for the chat, which it pushes aside as it unfolds and gives back as it folds.
 */
export function LiveSpecPanel({
  spec: initial,
  reader: initialReader,
  defaultReworkOpen,
  defaultFolded,
  onFoldChange,
  arrives,
  agentWrites,
  ...on
}: LiveSpecPanelProps): ReactNode {
  const { spec, reader, actions, write } = useLiveSpec(initial, initialReader, on)
  return (
    <div className="@container flex h-screen min-h-0 bg-background text-foreground">
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3 p-6 text-sm text-muted-foreground">
        <p>
          The chat of the Session stands here, and takes whatever width the Spec panel leaves it:
          all of it but the band while the panel is folded, and what is left beside the panel once
          it is unfolded.
        </p>
        {agentWrites !== undefined && (
          <Button
            onClick={() => write(agentWrites)}
          >{`Let the agent write the ${partName(agentWrites)}`}</Button>
        )}
      </div>
      <SpecPanel
        spec={spec}
        reader={reader}
        defaultReworkOpen={defaultReworkOpen}
        defaultFolded={defaultFolded}
        onFoldChange={onFoldChange}
        arrives={arrives}
        onSaveSection={actions.onSaveSection}
        onApplyMine={actions.onApplyMine}
        onDiscardMine={actions.onDiscardMine}
        onSaveStory={actions.onSaveStory}
        onGoToQuestion={actions.onGoToQuestion}
        onMarkReady={actions.onMarkReady}
        onRework={actions.onRework}
        onPickRevision={actions.onPickRevision}
        onTakeOver={actions.onTakeOver}
      />
    </div>
  )
}
