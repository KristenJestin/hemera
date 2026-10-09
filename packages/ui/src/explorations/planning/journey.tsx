import type { StoryObj } from '@storybook/react-vite'
import { type ComponentType, type ReactElement, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ContentHeader } from '../../shell/content-header.tsx'
import { stageLabel } from '../coming-back/parts.tsx'
import {
  coldReadFailed,
  coldReadRunning,
  changed,
  discussing,
  findings,
  frozen,
  long,
  outdated,
  probing,
  readyToFreeze,
  wave,
  writing,
} from './fixtures.ts'
import type { Opened, PlanningHandlers, PlanningProps, PlanningState, Question } from './model.ts'

/**
 * The journey the Planning page is played on, story by story: the same moments, the same data,
 * the same checks, for each proposal. The page is live: an answer, a dismissal, Freeze and the
 * rest change it as the engine would, so each story can be played by hand.
 */
export interface Screens {
  Planning: ComponentType<PlanningProps>
}

const REFUSALS = [
  'The Spec changed after you read it: R2 and Decisions',
  'Your answer to Q8 is delivered, not integrated yet',
]

function mapQuestions(
  state: PlanningState,
  id: string,
  change: (question: Question) => Question,
): PlanningState {
  return {
    ...state,
    waves: state.waves.map((one) => ({
      ...one,
      questions: one.questions.map((question) =>
        question.id === id ? change(question) : question,
      ),
    })),
  }
}

/** What the engine does with each gesture, enough to play the page by hand. */
function useLivePlanning(
  initial: PlanningState,
  refuse: boolean,
): [PlanningState, PlanningHandlers] {
  const [state, setState] = useState(initial)
  const handlers: PlanningHandlers = {
    onAnswer: (id, answer) =>
      setState((now) =>
        mapQuestions(now, id, (question) => ({
          ...question,
          state: 'answered',
          answers: [
            ...question.answers.map((version) => ({
              ...version,
              inputState: 'superseded' as const,
            })),
            {
              version: question.answers.length + 1,
              optionId: 'optionId' in answer ? answer.optionId : null,
              text: 'text' in answer ? answer.text : null,
              at: 'now',
              inputState: 'received',
            },
          ],
        })),
      ),
    onWaitOnSomeone: (id) =>
      setState((now) => mapQuestions(now, id, (question) => ({ ...question, state: 'waiting' }))),
    onCopyDraft: fn(),
    onDiscuss: (item) =>
      setState((now) =>
        now.discussions.some(
          (discussion) => discussion.item.kind === item.kind && discussion.item.id === item.id,
        )
          ? now
          : {
              ...now,
              discussions: [
                ...now.discussions,
                {
                  id: `d${String(now.discussions.length + 1)}`,
                  label: `#${String(now.discussions.length + 1)}`,
                  item,
                  state: 'open',
                  outcome: null,
                  decision: null,
                  proposal: null,
                  waitsOn: 'user',
                  messages: [],
                },
              ],
            },
      ),
    onSay: (id, text) =>
      setState((now) => ({
        ...now,
        discussions: now.discussions.map((discussion) =>
          discussion.id === id
            ? {
                ...discussion,
                waitsOn: 'agent',
                messages: [
                  ...discussion.messages,
                  { author: 'user', text, proposal: false, at: 'now' },
                ],
              }
            : discussion,
        ),
      })),
    onAcceptProposal: (id) =>
      setState((now) => ({
        ...now,
        discussions: now.discussions.map((discussion) =>
          discussion.id === id
            ? {
                ...discussion,
                state: 'closed',
                outcome: 'decision',
                decision: discussion.proposal?.text ?? null,
                proposal: null,
                waitsOn: null,
              }
            : discussion,
        ),
      })),
    onCloseDiscussion: (id, decision) =>
      setState((now) => ({
        ...now,
        discussions: now.discussions.map((discussion) =>
          discussion.id === id
            ? {
                ...discussion,
                state: 'closed',
                outcome: decision === null ? 'no_decision' : 'decision',
                decision,
                proposal: null,
                waitsOn: null,
              }
            : discussion,
        ),
      })),
    onDismissFinding: (id) =>
      setState((now) => ({
        ...now,
        passes: now.passes.map((pass) => ({
          ...pass,
          findings: pass.findings.map((finding) =>
            finding.id === id ? { ...finding, fate: 'dismissed' } : finding,
          ),
        })),
      })),
    onRunColdRead: () =>
      setState((now) => ({
        ...now,
        passes: [
          ...now.passes,
          {
            id: `c${String(now.passes.length + 1)}`,
            label: `C${String(now.passes.length + 1)}`,
            requestedBy: 'user',
            state: 'running',
            stuck: false,
            startedAt: Date.now(),
            endedAt: null,
            failure: null,
            findings: [],
          },
        ],
      })),
    onDecideDependency: (id, accept) =>
      setState((now) => ({
        ...now,
        dependencies: now.dependencies.map((dependency) =>
          dependency.id === id
            ? { ...dependency, state: accept ? 'accepted' : 'rejected' }
            : dependency,
        ),
      })),
    onGiveVision: (text) =>
      setState((now) => ({
        ...now,
        visions: [...now.visions, { text, at: 'now', inputState: 'received' }],
      })),
    onMarkRead: () => setState((now) => ({ ...now, changes: [] })),
    onFreeze: () =>
      setState((now) =>
        refuse
          ? { ...now, readiness: { ready: false, unsettled: [] }, refused: REFUSALS }
          : {
              ...now,
              mission: { ...now.mission, stage: 'Ready', frozen: true, ball: 'idle', marks: [] },
              readiness: { ready: false, unsettled: [] },
            },
      ),
    onReturnToPlanning: () =>
      setState((now) => ({
        ...now,
        mission: { ...now.mission, stage: 'Planning', frozen: false, ball: 'agent', marks: [] },
        now: 'Reads the ticket again',
        outdated: undefined,
      })),
    onCancel: fn(),
  }
  return [state, handlers]
}

function Live({
  Planning,
  initial,
  opened,
  refuse = false,
}: {
  Planning: ComponentType<PlanningProps>
  initial: PlanningState
  opened?: Opened | undefined
  refuse?: boolean | undefined
}): ReactElement {
  const [state, handlers] = useLivePlanning(initial, refuse)
  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={fn()}
        crumbs={[
          { id: 'project', label: 'Acme', onPress: fn() },
          { id: 'mission', label: state.mission.key, mono: true, onPress: fn() },
          { id: 'stage', label: stageLabel(state.mission) },
        ]}
      />
      <Planning state={state} opened={opened} {...handlers} />
    </div>
  )
}

/** Whether something is said on screen, as a glyph's name or in words. */
function says(canvasElement: HTMLElement, words: string | RegExp): boolean {
  const canvas = within(canvasElement)
  return (
    canvas.queryAllByRole('img', { name: words }).length > 0 ||
    canvas.queryAllByText(words).length > 0
  )
}

function questionCard(canvasElement: HTMLElement, id: string): HTMLElement {
  return within(canvasElement).getByRole('article', { name: new RegExp(`^${id} · `) })
}

/** Unfolds the waves a proposal folds once they are settled. */
async function unfoldWaves(canvasElement: HTMLElement): Promise<void> {
  const folded = within(canvasElement).queryAllByRole('button', {
    expanded: false,
    name: /^Wave \d/,
  })
  await folded.reduce<Promise<void>>(
    (before, fold) => before.then(() => userEvent.click(fold)),
    Promise.resolve(),
  )
}

function currentStage(canvasElement: HTMLElement): string {
  const track = within(canvasElement).getByRole('list', { name: 'Stage' })
  return track.querySelector('[aria-current="step"]')?.textContent ?? ''
}

export function journeyOf({ Planning }: Screens) {
  const at = (initial: () => PlanningState, opened?: Opened, refuse = false) => ({
    render: () => <Live Planning={Planning} initial={initial()} opened={opened} refuse={refuse} />,
  })

  return {
    /** The first draft: the Planner writes, sections fill in; no question, no Freeze. */
    PlannerWriting: {
      ...at(writing),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(
          within(canvas.getByRole('list', { name: 'Sections' })).getAllByRole('listitem'),
        ).toHaveLength(8)
        expect(says(canvasElement, 'Being written')).toBe(true)
        expect(canvas.getAllByText(/Writes Impact/)[0]).toBeVisible()
        expect(canvas.queryByRole('region', { name: 'Questions' })).toBeNull()
        expect(canvas.queryByRole('button', { name: 'Freeze' })).toBeNull()
      },
    },
    /**
     * Two waves: Q5 open, Q6 waiting on someone with its note and drafted message, a changed
     * answer, a withdrawn, a replaced and a moot question kept readable; no Freeze.
     */
    WaveWaiting: {
      ...at(wave),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByRole('region', { name: 'Questions' })).toBeInTheDocument()
        const q6 = questionCard(canvasElement, 'Q6')
        expect(within(q6).getByRole('img', { name: 'Waiting on someone' })).toBeInTheDocument()
        expect(within(q6).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
        await unfoldWaves(canvasElement)
        expect(says(canvasElement, /^Withdrawn:/)).toBe(true)
        expect(says(canvasElement, 'Replaced by Q6')).toBe(true)
        expect(says(canvasElement, /^Moot:/)).toBe(true)
        expect(says(canvasElement, 'Now B, before A')).toBe(true)
        expect(canvas.queryByRole('button', { name: /Send answers/ })).toBeNull()
        expect(canvas.queryByRole('button', { name: 'Freeze' })).toBeNull()
      },
    },
    /** An answer leaves as it is given: pressed, the option holds and its dot says received. */
    Answering: {
      ...at(wave),
      play: async ({ canvasElement }) => {
        const q5 = questionCard(canvasElement, 'Q5')
        const b = within(q5).getByRole('button', { name: /Only its owner/ })
        await userEvent.click(b)
        await waitFor(() => {
          expect(b).toHaveAttribute('aria-pressed', 'true')
          expect(within(q5).getByRole('img', { name: 'Received' })).toBeInTheDocument()
        })
      },
    },
    /** From the keyboard: from one option to the next, Enter answers. */
    AnsweringByKeyboard: {
      ...at(wave),
      play: async ({ canvasElement }) => {
        const q5 = questionCard(canvasElement, 'Q5')
        const [a, b] = within(q5).getAllByRole('button', { pressed: false })
        a!.focus()
        await userEvent.tab()
        expect(b).toHaveFocus()
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(b).toHaveAttribute('aria-pressed', 'true'))
        expect(b).toHaveFocus()
      },
    },
    /** A discussion open on Q5: the conversation, the proposed decision, and Accept closes it. */
    DiscussionOpen: {
      ...at(discussing, { kind: 'discussion', id: 'd1' }),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const thread = await canvas.findByRole('region', { name: 'Discussion #1' })
        expect(within(thread).getByRole('button', { name: 'Write a decision' })).toBeVisible()
        expect(
          within(thread).getByRole('button', { name: 'Close without a decision' }),
        ).toBeVisible()
        await userEvent.click(within(thread).getByRole('button', { name: 'Accept' }))
        await waitFor(() => expect(within(thread).getByText(/^Closed on a decision/)).toBeVisible())
      },
    },
    /** A Probe runs beside the questions: its chip, no stop; the ended ones with theirs. */
    ProbeRunning: {
      ...at(probing),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByRole('button', { name: /^Probe #2 .*, running$/ })).toBeInTheDocument()
        expect(canvas.getByRole('button', { name: /^Probe #3 .*, done$/ })).toBeInTheDocument()
        expect(canvas.queryByRole('button', { name: /Stop/ })).toBeNull()
      },
    },
    /** A Probe that does not reproduce: its report, opened over the page. */
    ProbeNotReproduced: {
      ...at(probing, { kind: 'probe', id: 'p3' }),
      play: async ({ canvasElement }) => {
        await waitFor(() => expect(within(canvasElement).getByText('Not reproduced')).toBeVisible())
      },
    },
    /** The Spec declared complete: Hemera's one cold read runs. */
    ColdReadRunning: {
      ...at(coldReadRunning),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const cold = canvas.getByRole('region', { name: 'Cold read' })
        expect(within(cold).getByRole('button', { name: 'Cold read C1, running' })).toBeVisible()
        expect(within(cold).queryByRole('button', { name: 'Run another cold read' })).toBeNull()
      },
    },
    /**
     * The cold read reported on an earlier text: a blocker asked as Q8, a blocker on the tasks
     * fixed, a warning and a suggestion to settle; Dismiss settles one.
     */
    ColdReadFindings: {
      ...at(findings),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const cold = canvas.getByRole('region', { name: 'Cold read' })
        expect(within(cold).getAllByRole('listitem').length).toBeGreaterThanOrEqual(4)
        expect(within(cold).getByText(/read an earlier text/)).toBeVisible()
        expect(within(cold).getByText('Asked as Q8')).toBeInTheDocument()
        expect(within(cold).getByText(/^Fixed by the Planner/)).toBeInTheDocument()
        await userEvent.click(within(cold).getByRole('button', { name: 'Dismiss C1.F3' }))
        await waitFor(() =>
          expect(within(cold).queryByRole('button', { name: 'Dismiss C1.F3' })).toBeNull(),
        )
        expect(questionCard(canvasElement, 'Q8')).toBeInTheDocument()
      },
    },
    /** The cold read failed: said in words; another pass is the user's to run. */
    ColdReadFailed: {
      ...at(coldReadFailed),
      play: async ({ canvasElement }) => {
        const cold = within(canvasElement).getByRole('region', { name: 'Cold read' })
        expect(within(cold).getByText(/^The cold read failed/)).toBeVisible()
        await userEvent.click(within(cold).getByRole('button', { name: 'Run another cold read' }))
        await waitFor(() =>
          expect(within(cold).getByRole('button', { name: 'Cold read C2, running' })).toBeVisible(),
        )
      },
    },
    /** A dependency the Planner proposed: only the user accepts it. */
    DependencyProposed: {
      ...at(wave),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(
          canvas.getByRole('button', { name: 'Accept the dependency on ACME-20' }),
        )
        await waitFor(() =>
          expect(
            canvas.queryByRole('button', { name: 'Accept the dependency on ACME-20' }),
          ).toBeNull(),
        )
        expect(canvas.getAllByRole('img', { name: 'Accepted' })).toHaveLength(2)
      },
    },
    /** Back after a while: what changed since the last read, and Mark as read. */
    ChangedSinceLastRead: {
      ...at(changed),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(
          says(canvasElement, 'Changed since your last read') ||
            says(canvasElement, 'Since your last read'),
        ).toBe(true)
        await userEvent.click(canvas.getByRole('button', { name: 'Mark as read' }))
        await waitFor(() =>
          expect(canvas.queryByRole('button', { name: 'Mark as read' })).toBeNull(),
        )
      },
    },
    /** The user's vision, given at any time. */
    Vision: {
      ...at(wave, { kind: 'vision' }),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(await canvas.findByRole('list', { name: 'Your vision so far' })).toBeVisible()
      },
    },
    /** Everything settled: Freeze appears in the head; pressed, the mission is Ready, frozen. */
    ReadyToFreeze: {
      ...at(readyToFreeze),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: 'Freeze' }))
        await waitFor(() => expect(currentStage(canvasElement)).toContain('Ready'))
        expect(canvas.getByRole('img', { name: 'Spec frozen' })).toBeInTheDocument()
        expect(canvas.getByRole('button', { name: 'Return to Planning' })).toBeVisible()
      },
    },
    /** Freeze pressed as the Spec changed: refused, each reason named, and Freeze gone. */
    FreezeRefused: {
      ...at(readyToFreeze, undefined, true),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: 'Freeze' }))
        const reasons = await canvas.findByRole('list', { name: 'Why Freeze was refused' })
        expect(within(reasons).getAllByRole('listitem')).toHaveLength(2)
        expect(canvas.queryByRole('button', { name: 'Freeze' })).toBeNull()
      },
    },
    /** Frozen, Ready: the Spec read-only, no question; Return to Planning brings Planning back. */
    Frozen: {
      ...at(frozen),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByRole('img', { name: 'Spec frozen' })).toBeInTheDocument()
        expect(canvas.queryByRole('region', { name: 'Questions' })).toBeNull()
        expect(canvas.queryByRole('button', { name: 'Freeze' })).toBeNull()
        await userEvent.click(canvas.getByRole('button', { name: 'Return to Planning' }))
        await waitFor(() => expect(currentStage(canvasElement)).toContain('Planning'))
      },
    },
    /** Ready, then the ticket changed: outdated, and the ticket's difference. */
    Outdated: {
      ...at(outdated),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(says(canvasElement, 'Outdated')).toBe(true)
        expect(canvas.getByRole('region', { name: 'What changed on the ticket' })).toBeVisible()
        expect(canvas.getByRole('button', { name: 'Return to Planning' })).toBeVisible()
      },
    },
    /** Long text in every field: nothing spills out of its card. */
    LongText: {
      ...at(long),
      play: async ({ canvasElement }) => {
        const q5 = questionCard(canvasElement, 'Q5')
        expect(q5.scrollWidth).toBeLessThanOrEqual(q5.clientWidth + 1)
      },
    },
  } satisfies Record<string, StoryObj>
}
