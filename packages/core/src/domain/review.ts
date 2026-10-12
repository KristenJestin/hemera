/**
 * The automatic code review at the end of a Building (#147): two fresh, read-only reviewers make
 * one pass each on a checkpoint of the result, and each finding they report has a fate. One that
 * contradicts the Spec becomes a decision need, never work for the Builder before the user's
 * answer; every other one becomes a special task (`RV1`, `RV2`…) developed in Building like any
 * task, with no scenario and no Proof block (CT-41).
 *
 * Pure rules: the engine runs the reviewers, keeps their findings and builds the special tasks.
 */

import { Schema } from 'effect'

/** The two reviewers: the contract (does the result meet the frozen Spec?) and the code. */
export const REVIEWERS = ['spec-reviewer', 'code-reviewer'] as const
export const Reviewer = Schema.Literals(REVIEWERS)
export type Reviewer = typeof Reviewer.Type

/** How a reviewer is named to the user. */
export const REVIEWER_NAMES: Readonly<Record<Reviewer, string>> = {
  'spec-reviewer': 'Spec reviewer',
  'code-reviewer': 'Code reviewer',
}

export const REVIEW_SEVERITIES = ['blocking', 'warning', 'suggestion'] as const
export const ReviewSeverity = Schema.Literals(REVIEW_SEVERITIES)
export type ReviewSeverity = typeof ReviewSeverity.Type

/** Where a reviewer's pass stands. */
export const REVIEW_PASS_STATES = ['waiting', 'running', 'done', 'failed'] as const
export const ReviewPassState = Schema.Literals(REVIEW_PASS_STATES)
export type ReviewPassState = typeof ReviewPassState.Type

/**
 * What became of a finding: a decision need waiting for the user, a special task, a decision
 * recorded in the Spec ("the result is right"), or dismissed by the user.
 */
export const REVIEW_FATES = ['decision', 'special_task', 'recorded', 'dismissed'] as const
export const ReviewFate = Schema.Literals(REVIEW_FATES)
export type ReviewFate = typeof ReviewFate.Type

/** The options of a finding that contradicts the Spec (open point, its default). */
export const SPEC_IS_RIGHT = 'The Spec is right: make the code follow it'
export const RESULT_IS_RIGHT = 'The result is right: record it as a decision'
export const DISMISS_FINDING = 'Dismiss'
export const CONTRADICTION_OPTIONS = [SPEC_IS_RIGHT, RESULT_IS_RIGHT, DISMISS_FINDING] as const

/** The prefix of a special task's id: `RV1`, `RV2`… in a mission. */
export const SPECIAL_TASK_PREFIX = 'RV'

export const specialTaskId = (number: number): string => `${SPECIAL_TASK_PREFIX}${String(number)}`

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

const Named = (maximum: number, description: string) =>
  Schema.optionalKey(Bounded(maximum, description))

/** One finding as `review_report` carries it. */
export const ReviewFinding = Schema.Struct({
  severity: ReviewSeverity.annotate({
    description: '`blocking` (must change before Review), `warning` or `suggestion`.',
  }),
  requirement: Named(40, 'The requirement it is about (`R2`), if any.'),
  scenario: Named(40, 'The scenario it is about (`R2.S1`), if any.'),
  repository: Named(200, 'The repository of the file it is about, by its path in the Project.'),
  path: Named(1000, 'The file it is about, relative to its repository, if any.'),
  line: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: 'The line it is about, if any.',
    }),
  ),
  text: Bounded(4000, 'What is wrong and what should change, in the language of the user.'),
  contradicts_spec: Schema.Boolean.annotate({
    description: 'True when fixing it would change what the Spec says.',
  }),
  evidence: Named(
    4000,
    'What you read that shows it: the Spec text, the file and lines, the check output. Required for a blocking finding.',
  ),
})
export type ReviewFinding = typeof ReviewFinding.Type

/** What `review_report` carries: every finding of the pass, none being a valid report. */
export const ReviewReport = Schema.Struct({
  findings: Schema.Array(ReviewFinding).annotate({
    description: 'Every finding of your pass, once each; an empty list when you found nothing.',
  }),
}).annotate({
  description:
    'Report your pass once: every finding, each with its severity and evidence. Then end your turn.',
})
export type ReviewReport = typeof ReviewReport.Type

/** What `checkpoint_read` takes. */
export const CheckpointRead = Schema.Struct({
  repository: Named(200, 'A repository of the checkpoint; every repository without it.'),
  path: Named(
    1000,
    'A file of the checkpoint: its diff from the base it branched from, and its content; the file list without it.',
  ),
}).annotate({
  description:
    'Read the checkpoint of the result you review: the files changed per repository with their lines, or one file with its diff and content at the checkpoint. Never the live Workspace.',
})
export type CheckpointRead = typeof CheckpointRead.Type

/** What `evidence_read` takes. */
export const EvidenceRead = Schema.Struct({
  scenario: Named(40, 'One scenario: its proof runs, red and green.'),
  check: Named(200, 'One final check, by its name: its result and output.'),
}).annotate({
  description:
    'Read the evidence of the Building: the proof runs (red and green, classified, up to date or not), the final checks with their output, the manual scenarios, the documenter’s report, the files changed outside their targets and those written before the red.',
})
export type EvidenceRead = typeof EvidenceRead.Type

/** Why a finding cannot be kept, or null when it can. `listed` says whether a file is in the checkpoint. */
export function findingProblem(
  finding: ReviewFinding,
  listed: (repository: string | null, path: string) => boolean,
): string | null {
  if (finding.severity === 'blocking' && (finding.evidence ?? '').trim() === '') {
    return 'a blocking finding carries its evidence: what you read that shows it'
  }
  if (finding.path !== undefined && !listed(finding.repository ?? null, finding.path)) {
    const named =
      finding.repository === undefined ? finding.path : `${finding.repository}/${finding.path}`
    return `${named} is not in the checkpoint: name a file you read there`
  }
  return null
}

/** The first line of a text, cut to a title's length. */
const titleOf = (text: string): string => {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length <= 120 ? line : `${line.slice(0, 119)}…`
}

/** What a special task says, written by Hemera from its finding. */
export function specialTaskOf(finding: { readonly text: string }) {
  return {
    title: titleOf(finding.text),
    result: `The automatic review's finding is addressed: ${finding.text.trim()}`,
  }
}
