/**
 * A round of Review as a small Spec (#468, R2): what the user's Fix turns a round's feedback into.
 *
 * The Planner, in round mode, grills the round's feedback into points written as requirements,
 * each with its scenarios and their proofs, its classification and its decisions, and the round's
 * tasks; then "Building · round N" builds them with the whole Building machinery, and the agent
 * answers every remark. Here are the ids, the fixed answers Hemera offers, the tools' arguments, and
 * the rules that need nothing but those values. Nothing here touches the database or Git.
 */

import { Schema } from 'effect'

import { Proof, TaskTarget } from './proofs.ts'
import { Delta } from './spec.ts'

/**
 * `corrective`: the result is made to match the frozen Spec, and the living spec does not change;
 * `behaviour`: what a requirement says changes, with a delta on it.
 */
export const ROUND_POINT_KINDS = ['corrective', 'behaviour'] as const
export const RoundPointKind = Schema.Literals(ROUND_POINT_KINDS)
export type RoundPointKind = typeof RoundPointKind.Type

/** A point of round `round`, numbered from 1 in it: `R2.1`. */
export const roundPointId = (round: number, number: number): string =>
  `R${String(round)}.${String(number)}`

/** A scenario of a point, numbered from 1 in it: `R2.1.S1`. */
export const roundScenarioId = (point: string, number: number): string =>
  `${point}.S${String(number)}`

/** A task of round `round`, numbered from 1 in it: `R2.T1`. */
export const roundTaskId = (round: number, number: number): string =>
  `R${String(round)}.T${String(number)}`

/** What a Building of a round is called, on screen and in its Journal. */
export const roundLabel = (round: number): string => `Building · round ${String(round)}`

/**
 * The three outcomes of a feedback in conflict with the frozen Spec, in the order Hemera offers
 * them (open question 35): the point goes ahead with a note recorded as a decision, the feedback is
 * withdrawn, or the mission is cancelled. An answer in the user's own words is the note.
 */
export const CLARIFY = 'Clarify with a note'
export const WITHDRAW_FEEDBACK = 'Withdraw the remark'
export const CANCEL_MISSION_TOO = 'Cancel the mission'
export const CONFLICT_OPTIONS = [CLARIFY, WITHDRAW_FEEDBACK, CANCEL_MISSION_TOO] as const

/** What each conflict outcome says beside its label. */
export const CONFLICT_DETAILS: Readonly<Record<(typeof CONFLICT_OPTIONS)[number], string>> = {
  [CLARIFY]:
    'The point goes ahead; the note (the recommendation, or your own words) is kept as a decision saying how it fits the Spec.',
  [WITHDRAW_FEEDBACK]: 'The remark is withdrawn: nothing is built for it.',
  [CANCEL_MISSION_TOO]:
    'The mission is cancelled: everything stops, and the work is kept until you confirm the cleanup.',
}

/**
 * The two answers to "Start a mission from this" (open question 79): a mission of its own, or a
 * behaviour change kept in this round.
 */
export const START_A_MISSION = 'Start a mission from this'
export const KEEP_IN_ROUND = 'Keep it in this round as a behaviour change'
export const NEW_MISSION_OPTIONS = [START_A_MISSION, KEEP_IN_ROUND] as const

/** What each answer says beside its label. */
export const NEW_MISSION_DETAILS: Readonly<Record<(typeof NEW_MISSION_OPTIONS)[number], string>> = {
  [START_A_MISSION]:
    'It leaves this round: you start the mission from the remark when you choose, and the remark closes then.',
  [KEEP_IN_ROUND]: 'It stays a point of this round, as a behaviour change.',
}

/** The answer Hemera gives a remark the user chose to make a mission of its own. */
export const TO_A_MISSION =
  'Kept out of this round: it is to start as a mission of its own (Start a mission from this).'

/** How a mission started from a feedback shows its origin: `Started from ACME-12, round 2`. */
export const startedFromSaid = (key: string, round: number): string =>
  `Started from ${key}, round ${String(round)}`

const Text = (description: string) =>
  Schema.String.check(Schema.isNonEmpty()).annotate({ description })

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

const Round = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
  description: 'The round, as your brief numbers it.',
})

export const RoundScenarioAsked = Schema.Struct({
  id: Schema.optionalKey(Bounded(40, 'The scenario (`R2.1.S1`) to keep; a new one without it.')),
  when: Bounded(1000, 'WHEN: the situation and the action, as a user would do it.'),
  then: Bounded(1000, 'THEN: the observable result, concrete enough for a test to check.'),
  proof: Proof.annotate({
    description:
      'Its proof, whole, as in Planning: the exact actions, the starting data, the test or the command, the expected result, the key line; `by_hand` only for what cannot be automated. Its files go into the Workspace as it is now.',
  }),
})
export type RoundScenarioAsked = typeof RoundScenarioAsked.Type

export const RoundDecisionAsked = Schema.Struct({
  choice: Bounded(2000, 'What is decided.'),
  alternatives: Schema.Array(Bounded(2000, 'An alternative that was set aside.')),
  why: Bounded(2000, 'Why this one.'),
})
export type RoundDecisionAsked = typeof RoundDecisionAsked.Type

export const RoundDelta = Schema.Struct({
  requirement: Bounded(
    40,
    'The requirement it changes: one of the frozen Spec (`R2`), one of the living spec (`LR3`), or the name of the one it adds.',
  ),
  change: Delta.annotate({ description: '`added`, `modified` or `removed`.' }),
  living_version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description:
      'The version of the living requirement you read (living_spec_read), 0 when the living spec has none.',
  }),
})
export type RoundDelta = typeof RoundDelta.Type

export const RoundPointWrite = Schema.Struct({
  round: Round,
  id: Schema.optionalKey(Bounded(20, 'The point (`R2.1`) to rewrite; a new point without it.')),
  text: Bounded(4000, 'The point, written as a requirement.'),
  kind: RoundPointKind.annotate({
    description:
      '`corrective` (the result did not match the frozen Spec) or `behaviour` (what a requirement says changes: give the delta).',
  }),
  delta: Schema.optionalKey(
    RoundDelta.annotate({ description: 'For `behaviour`: the change to the requirement.' }),
  ),
  scenarios: Schema.Array(RoundScenarioAsked).annotate({
    description: 'Its scenarios, whole: one left out is removed.',
  }),
  decisions: Schema.Array(RoundDecisionAsked).annotate({
    description: 'The decisions it takes, with the alternatives and why.',
  }),
  sources: Schema.Array(Bounded(80, 'A feedback of the round it comes from, by its id.')).annotate({
    description: 'Every feedback it comes from: several when they say the same thing.',
  }),
}).annotate({
  description:
    'Write a point of the round, or rewrite one: a requirement with its scenarios and their proofs, its classification and decisions, and every feedback it comes from. Refused on an unknown source, a behaviour point without delta, or a scenario without proof.',
})

export const RoundPointRemove = Schema.Struct({
  round: Round,
  id: Bounded(20, 'The point (`R2.1`).'),
  reason: Bounded(2000, 'Why it goes.'),
}).annotate({
  description:
    'Remove a point before round_ready. Its feedback then needs another outcome. Its id is never reused.',
})

export const RoundTaskAsked = Schema.Struct({
  id: Schema.optionalKey(Bounded(20, 'The task (`R2.T1`) to keep; a new task without it.')),
  title: Bounded(200, 'What the task builds, in a few words.'),
  result: Bounded(2000, 'What is true once it is done.'),
  points: Schema.Array(Text('A point it builds (`R2.1`).')),
  scenarios: Schema.Array(Text('A scenario it covers (`R2.1.S1`).')),
  targets: Schema.Array(TaskTarget).annotate({
    description: 'The files it creates or changes, in the Workspace as it is now.',
  }),
  depends_on: Schema.Array(
    Text('A task done before it: its id (`R2.T1`), or the title of a task new in this write.'),
  ),
})
export type RoundTaskAsked = typeof RoundTaskAsked.Type

export const RoundTasksWrite = Schema.Struct({
  round: Round,
  tasks: Schema.Array(RoundTaskAsked).annotate({
    description: 'The whole graph of the round, in order: a task left out is removed.',
  }),
}).annotate({
  description:
    "Write the round's task graph, whole: each task covers scenarios and names its targets. Refused, every problem named and nothing written, on a cycle, a reference to nothing, or a target that is not as its intent says in the Workspace.",
})

export const RoundProposeMission = Schema.Struct({
  feedback: Bounded(80, 'The feedback, by its id.'),
  reason: Bounded(
    2000,
    'Why it is a mission of its own: the requirement the Spec does not have, or the repository outside its Impact.',
  ),
}).annotate({
  description:
    'Put "Start a mission from this" to the user as a wave question, for a feedback that adds a requirement the Spec does not have or touches a repository outside its Impact. The user may keep it in this round as a behaviour change.',
})

export const RoundReady = Schema.Struct({
  why: Bounded(2000, 'Why the round is ready to build.'),
}).annotate({
  description:
    'End the grilling. Refused, naming what is missing, unless every feedback has an outcome, no question of the round is open, every answer is integrated, every point has a scenario with its proof, and the task graph holds. Then the mission goes to "Building · round N".',
})

export const FeedbackAnswer = Schema.Struct({
  source: Bounded(80, 'The feedback, by its id.'),
  text: Bounded(8000, 'What you did, or why nothing changed.'),
}).annotate({
  description:
    'Answer a feedback of the round: what you did, or why nothing changed. It marks it addressed, never resolved: only the user resolves it.',
})

/** Why a point's write is refused before anything is read, or null: its own shape. */
export function roundPointRefusal(asked: {
  readonly kind: RoundPointKind
  readonly delta?: RoundDelta | undefined
  readonly sources: ReadonlyArray<string>
}): string | null {
  if (asked.kind === 'behaviour' && asked.delta === undefined) {
    return 'refused: a behaviour change carries its delta: the requirement, the change and the living version you read.'
  }
  if (asked.kind === 'corrective' && asked.delta !== undefined) {
    return 'refused: a corrective point changes no requirement: leave the delta out, or classify it as a behaviour change.'
  }
  if (asked.sources.length === 0) {
    return 'refused: a point comes from at least one feedback of the round: name it in sources.'
  }
  if (new Set(asked.sources).size !== asked.sources.length) {
    return 'refused: a source is named twice.'
  }
  return null
}
