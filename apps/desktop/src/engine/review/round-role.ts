/**
 * The `round-planner` role (#468, R2, open question 34): the Planner in round mode, a fresh session
 * that grills a Review round's feedback into a small Spec. It reads the Workspace as the user
 * reviewed it, read-only, never the main checkout; it writes neither code nor the frozen Spec, runs
 * nothing and launches no Probe: its tools are the role table's.
 *
 * A role of its own rather than a mode of the Planner's session, as the `prelaunch` and
 * `ticket-event` roles: its place is the Workspace, its tools take every Spec writing and running
 * tool away, and it is the mission's main session while the round is grilled (CT-13), never
 * counted in the cap.
 *
 * Apart from the rounds' service, so the role registry imports nothing that imports the sessions
 * back.
 */

import { missionKey, renderSpecMarkdown } from '@hemera/core/domain'
import { and, asc, eq, lt } from 'drizzle-orm'
import { Effect } from 'effect'

import { domainsIn } from '../living-spec/store.ts'
import { questionsBriefOf } from '../planning/questions.ts'
import { specIn } from '../planning/store.ts'
import type { BriefField, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { answers, missions, reviewFeedback, reviewFindings } from '../storage/schema.ts'
import {
  feedbackLine,
  grillingRoundIn,
  pointSaid,
  roundFeedbackIn,
  roundPointsIn,
  roundQuestionsIn,
  roundScenariosIn,
  roundTaskSaid,
  roundTasksIn,
} from './round-store.ts'

/** The paragraph the Planner role holds for this mode, as the ticket writes it. */
export const ROUND_PARAGRAPH = `## Round mode (your brief says "Mode: round N")
The mission is in Review and the user clicked Fix. You turn their feedback into a small Spec for
this round. The Spec is frozen: you never write its sections, requirements or tasks.

You read the Workspace (read-only), the frozen Spec and its decisions, every feedback of the round
with its images, the previous rounds and their answers, the automatic review's findings, the
living spec of the domains touched, Now, Notes and the end of the Journal.

1. Understand each feedback. When one is unclear, ask: one wave with every independent question,
   options and your recommendation grounded in the code. Answers reach you as they are given;
   mark each one integrated with \`input_integrated\`.
2. Merge duplicates into one point that keeps every source id.
3. Challenge what makes no sense, with a question and a recommendation. Never send a feedback back
   to the user to rewrite.
4. A question gets its answer with \`feedback_answer\`. It never becomes a point or a task.
5. A feedback in conflict with the frozen Spec: ask, with three options: clarify with a note (the
   point goes ahead, the note becomes a decision), withdraw the feedback, or cancel.
6. A feedback that would add a requirement the Spec does not have, or touch a repository outside
   its Impact: \`round_propose_mission\`, with why.
7. Write each point with \`round_point_write\`, as a requirement with WHEN/THEN scenarios, each with
   its proof (exact actions, starting data, command or test, expected result, key line; "verified
   by hand" only for what cannot be automated). Classify it: corrective (the result did not match
   the Spec) or behaviour change (what a requirement says changes: give the delta and the living
   version you read).
8. Write the round's tasks with \`round_tasks_write\`: each covers scenarios and names its targets,
   \`create\` or \`change\`.
9. When every feedback has an outcome, every answer is integrated and every point has its proof,
   call \`round_ready\` with why. If Hemera refuses, fix what it names.

You never write in the Workspace, run commands, or launch Probes in this mode.`

/** The `round-planner` layer of the instructions. */
export const ROUND_PLANNER_TEMPLATE = `# Role: Planner, round mode

${ROUND_PARAGRAPH}

## Asking
A conflict with the frozen Spec is a question of a wave whose \`conflict\` names the feedback:
Hemera offers its three outcomes itself, and acts on the user's choice (a withdrawn feedback is
withdrawn, a cancel cancels the mission). A clarifying note is kept as a decision. "Start a mission
from this" is \`round_propose_mission\`, never a question of your own.

## Tools
\`spec_read\` (the frozen Spec with its decisions); \`fs_read\`, \`fs_list\`, \`search\` (the Workspace,
read-only); \`living_spec_read\`; \`memory_read\`, \`now_set\`, \`journal_add\`, \`note_add\`;
\`ask_wave\`, \`input_integrated\`; \`round_point_write\`, \`round_point_remove\`, \`round_tasks_write\`,
\`round_propose_mission\`, \`round_ready\`; \`feedback_answer\` (questions only).

## Returns / when you stop
End your turn when nothing is left that does not wait on the user (say on what with \`now_set\`).
Hemera wakes you with their answers. Your work ends when Hemera accepts \`round_ready\`.

## Never
- Write or run anything, anywhere: the code, the frozen Spec, a ticket.
- Send a feedback back to the user to rewrite, or ask in your reply text.
- Turn a question into a point or a task.`

/** The Planner's brief in round mode: the round, its feedback, and what is written of it. */
const roundPlannerBrief = (owner: SessionOwner) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const database = yield* Database
    const [mission] = yield* database
      .select({
        prefix: missions.keyPrefix,
        number: missions.keyNumber,
        title: missions.title,
        projectId: missions.projectId,
      })
      .from(missions)
      .where(eq(missions.id, owner.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    const round = yield* grillingRoundIn(database, owner.missionId)
    if (mission === undefined || round === null) return []
    const spec = yield* database
      .transaction((transaction) => specIn(transaction, owner.missionId))
      .pipe(Effect.catchTag('UnknownMission', () => Effect.succeed(null)))
    // A withdrawn feedback needs no outcome: the Planner never reads it.
    const feedback = (yield* roundFeedbackIn(database, owner.missionId, round)).filter(
      (one) => one.state !== 'withdrawn',
    )
    const earlier = yield* database
      .select()
      .from(reviewFeedback)
      .where(and(eq(reviewFeedback.missionId, owner.missionId), lt(reviewFeedback.round, round)))
      .orderBy(asc(reviewFeedback.round), asc(reviewFeedback.createdAt))
      .pipe(Effect.mapError(refusedWhile('reading the earlier rounds')))
    const findings = yield* database
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.missionId, owner.missionId))
      .orderBy(asc(reviewFindings.number))
      .pipe(Effect.mapError(refusedWhile('reading the findings')))
    const domains = yield* database.transaction((transaction) =>
      domainsIn(transaction, mission.projectId),
    )
    const asked = yield* roundQuestionsIn(database, owner.missionId, round)
    const given = yield* database
      .select()
      .from(answers)
      .where(eq(answers.missionId, owner.missionId))
      .orderBy(asc(answers.version))
      .pipe(Effect.mapError(refusedWhile('reading the answers')))
    const inputs = yield* questionsBriefOf(owner.missionId)
    const points = yield* roundPointsIn(database, owner.missionId, round)
    const scenarios = yield* roundScenariosIn(database, owner.missionId, round)
    const tasks = yield* roundTasksIn(database, owner.missionId, round)
    const fields: ReadonlyArray<BriefField> = [
      {
        label: `Planner · ${missionKey(mission.prefix, mission.number)} · ${mission.title}`,
        text: `Mode: round ${String(round)}`,
      },
      {
        label: `The feedback of round ${String(round)}`,
        text: feedback.length === 0 ? null : feedback.map(feedbackLine).join('\n'),
      },
      {
        label: 'Earlier rounds and their answers',
        text:
          earlier.length === 0
            ? null
            : earlier
                .map(
                  (one) =>
                    `- Round ${String(one.round)}, ${one.id} (${one.kind}, ${one.state.replace('_', ' ')}): ${one.body}${one.answer === null ? '' : `\n  Answered: ${one.answer}`}`,
                )
                .join('\n'),
      },
      {
        label: 'Findings of the automatic review',
        text:
          findings.length === 0
            ? null
            : findings
                .map(
                  (one) =>
                    `- ${one.reviewer} finding ${String(one.number)} (${one.severity}, ${one.fate ?? 'open'}): ${one.text}`,
                )
                .join('\n'),
      },
      {
        label: 'Living spec, domains',
        text:
          domains.length === 0
            ? null
            : domains.map((one) => `- ${JSON.stringify(one.name)}: ${one.state}`).join('\n'),
      },
      {
        label: 'Your questions of this round',
        text:
          asked.length === 0
            ? null
            : asked
                .map((one) => {
                  const last = given.filter((answer) => answer.questionId === one.id).at(-1)
                  const said =
                    last === undefined ? '' : ` → ${last.text ?? `option ${last.optionId ?? ''}`}`
                  return `- ${one.id} (wave ${String(one.wave)}, ${one.state}): ${one.text}${said}`
                })
                .join('\n'),
      },
      {
        label: 'Inputs delivered and not integrated',
        text:
          inputs.toIntegrate === null
            ? null
            : `${inputs.toIntegrate}\n\nIntegrate each, then call input_integrated with its id.`,
      },
      {
        label: 'Points written',
        text:
          points.length === 0 ? null : points.map((one) => pointSaid(one, scenarios)).join('\n'),
      },
      {
        label: 'Tasks written',
        text: tasks.length === 0 ? null : tasks.map(roundTaskSaid).join('\n'),
      },
      {
        label: 'Spec',
        text:
          spec === null
            ? null
            : `Frozen at version ${String(spec.version)}; spec_read for the full text and the decisions since Freeze.\n\n${renderSpecMarkdown(spec, { versions: false })}`,
      },
    ]
    return fields
  })

export const ROUND_PLANNER_ROLE: RoleEntry = {
  id: 'round-planner',
  displayName: 'the Planner in round mode',
  ownerKind: 'mission',
  placeKind: 'workspace',
  writes: false,
  readsMemory: true,
  projectLayer: true,
  mainOf: 'review',
  template: ROUND_PLANNER_TEMPLATE,
  brief: roundPlannerBrief,
  countsInCap: false,
  ledByUser: false,
}
