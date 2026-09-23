import { type ReactNode, useState } from 'react'

import type {
  ReaderView,
  SectionName,
  SectionView,
  SpecView,
  StageItem,
  StoryView,
} from './model.ts'
import { phases } from './spec-fixtures.ts'
import { SpecPanel } from './spec-panel.tsx'

/**
 * The Spec panel held by the state the engine would hold, for the stories (lot 19, phase 0).
 *
 * A story is where the panel is tried, and a panel whose saves go nowhere cannot be: the text
 * would snap back on every blur. So this stands in for the engine with the few answers phase 1
 * will give for real — a save is a new human version for the agent's next turn, `Apply mine` is
 * one on top of the current version, an answer closes its question and, when it was the last
 * blocking one, lets the gate fill; `Mark ready` freezes; `Rework` copies into a new draft whose
 * plan and tasks are stale — and nothing else. Every action is also reported to `on`, which is
 * what a play asserts on.
 */

export interface SpecActions {
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

export interface LiveSpecPanelProps extends SpecActions {
  spec: SpecView
  reader?: ReaderView | undefined
  defaultItem?: StageItem | undefined
  defaultReworkOpen?: boolean | undefined
}

export function LiveSpecPanel({
  spec: initial,
  reader: initialReader,
  defaultItem,
  defaultReworkOpen,
  ...on
}: LiveSpecPanelProps): ReactNode {
  const [spec, setSpec] = useState(initial)
  const [reader, setReader] = useState(initialReader)

  function section(name: SectionName, change: (one: SectionView) => SectionView): void {
    setSpec((now) => ({
      ...now,
      sections: now.sections.map((one) => (one.name === name ? change(one) : one)),
    }))
  }

  return (
    <SpecPanel
      spec={spec}
      reader={reader}
      defaultItem={defaultItem}
      defaultReworkOpen={defaultReworkOpen}
      onSaveSection={(name, body) => {
        on.onSaveSection(name, body)
        section(name, (one) => ({
          ...one,
          body,
          version: one.version + 1,
          author: 'human',
          mark: 'human',
          pendingForAgent: true,
          copiedFrom: undefined,
        }))
      }}
      onApplyMine={(name, body) => {
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
      }}
      onDiscardMine={(name) => {
        on.onDiscardMine(name)
        section(name, (one) => ({ ...one, mark: 'agent', conflict: undefined }))
      }}
      onSaveStory={(story) => {
        on.onSaveStory(story)
        setSpec((now) => ({
          ...now,
          stories: now.stories.map((one) => (one.key === story.key ? story : one)),
          storiesMark: 'human',
        }))
      }}
      onAnswer={(id, answer) => {
        on.onAnswer(id, answer)
        setSpec((now) => {
          const questions = now.questions.map((one) =>
            one.id === id ? { ...one, answer: { text: answer, by: 'you, now' } } : one,
          )
          const blocking = questions.some((one) => one.blocking && one.answer === undefined)
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
      }}
      onMarkReady={() => {
        on.onMarkReady()
        setSpec((now) => ({
          ...now,
          status: 'ready',
          frozenOn: 'today',
          now: `Ready · frozen at revision ${now.revision}, a build can start from it`,
          revisions:
            now.revisions.length > 1
              ? now.revisions.map((one) =>
                  one.number === now.revision ? { ...one, detail: 'current, frozen' } : one,
                )
              : [{ number: now.revision, detail: 'current, frozen' }],
        }))
      }}
      onRework={(reason) => {
        on.onRework(reason)
        setSpec((now) => ({
          ...now,
          status: 'draft',
          frozenOn: undefined,
          revision: now.revision + 1,
          revisions: [
            { number: now.revision + 1, detail: 'current, draft' },
            ...now.revisions.map((one) =>
              one.number === now.revision ? { ...one, detail: 'read only · frozen today' } : one,
            ),
          ],
          phases: phases('finished', 'stale', 'stale'),
          now: 'Rework · the agent re-declares each phase',
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
              { label: 'plan and decompose declared again', target: 'plan' },
              { label: 'the attestation' },
            ],
          },
        }))
      }}
      onPickRevision={on.onPickRevision}
      onTakeOver={() => {
        on.onTakeOver()
        setReader(undefined)
      }}
    />
  )
}
