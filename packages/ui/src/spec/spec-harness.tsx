import { type ReactNode, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import {
  SECTION_TITLES,
  type ReaderView,
  type SpecAnswer,
  type SpecTarget,
  type SpecView,
} from './model.ts'
import { phases } from './spec-fixtures.ts'
import { SpecPanel } from './spec-panel.tsx'

/**
 * The Spec held by the state the engine would hold, for the stories (lot 19, phase 0).
 *
 * A story is where the panel is tried, and a panel whose actions go nowhere cannot be. So this
 * stands in for the engine with the few answers phase 1 gives for real — an answer in the chat
 * closes its question and, when it was the last blocking one, lets the gate pass; `Mark ready`
 * marks the Spec ready, or is refused with what is left; `Rework` copies into a new draft whose plan and tasks are stale — and nothing else.
 * Every action is also reported to `on`, which is what a play asserts on.
 */

export interface SpecActions {
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

  const actions: SpecActions = {
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
      setSpec((now) => {
        // Refused while anything is left, with what is left, as the engine refuses it.
        if (now.readiness.todo.length > 0) {
          const left = now.readiness.todo.map((item) => item.label).join(', ')
          return {
            ...now,
            readiness: {
              ...now.readiness,
              refused: `${now.key} is not ready yet. Still to do: ${left}.`,
            },
          }
        }
        return {
          ...now,
          status: 'ready',
          focus: undefined,
          now: '',
          revisions:
            now.revisions.length > 1
              ? now.revisions.map((one) =>
                  one.number === now.revision ? { ...one, detail: 'Latest · ready' } : one,
                )
              : [{ number: now.revision, detail: 'Latest · ready' }],
        }
      })
    },
    onRework: (reason) => {
      on.onRework(reason)
      setSpec((now) => ({
        ...now,
        status: 'draft',
        revision: now.revision + 1,
        revisions: [
          { number: now.revision + 1, detail: 'Latest · draft' },
          ...now.revisions.map((one) =>
            one.number === now.revision
              ? { ...one, detail: 'Marked ready today · read only' }
              : one,
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
        onGoToQuestion={actions.onGoToQuestion}
        onMarkReady={actions.onMarkReady}
        onRework={actions.onRework}
        onPickRevision={actions.onPickRevision}
        onTakeOver={actions.onTakeOver}
      />
    </div>
  )
}
