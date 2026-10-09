/**
 * The cold read of Planning (#91): a verification agent with a fresh context reads the Spec, its
 * tasks and the repository's code, never the Planning discussion, the answers or the Memory, and
 * reports everything a developer could not carry out without guessing. One pass, bound to the Spec
 * version it read (CT-29); it fixes nothing and never talks to the Planner.
 *
 * Here are the values a pass and its findings are made of, the tools' arguments, and the rules that
 * need nothing but those values: which report is refused, which finding concerns the tasks only,
 * what the brief and the Planner's delivery say, and whether the cold read is settled.
 */

import { Schema } from 'effect'

import type { SpecText } from './spec.ts'

/** Where a pass stands: it waits for a slot of the cap, runs, then is done or failed. */
export const COLD_READ_STATES = ['waiting_for_slot', 'running', 'done', 'failed'] as const
export const ColdReadState = Schema.Literals(COLD_READ_STATES)
export type ColdReadState = typeof ColdReadState.Type

/** Who asked for a pass: Hemera for the first of a Planning cycle, the user for another. */
export const COLD_READ_ASKERS = ['hemera', 'user'] as const
export const ColdReadAsker = Schema.Literals(COLD_READ_ASKERS)
export type ColdReadAsker = typeof ColdReadAsker.Type

/**
 * How bad a finding is: `blocking`, a developer would have to guess; `warning`, likely trouble;
 * `suggestion`, it would read better.
 */
export const COLD_READ_SEVERITIES = ['blocking', 'warning', 'suggestion'] as const
export const ColdReadSeverity = Schema.Literals(COLD_READ_SEVERITIES)
export type ColdReadSeverity = typeof ColdReadSeverity.Type

/**
 * What became of a finding: still `open`, `asked` in a wave (its question named), `fixed` by the
 * Planner (with what it changed), or `dismissed` by the user.
 */
export const FINDING_FATES = ['open', 'asked', 'fixed', 'dismissed'] as const
export const FindingFate = Schema.Literals(FINDING_FATES)
export type FindingFate = typeof FindingFate.Type

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** One finding as the cold read reports it. */
export const ColdReadFinding = Schema.Struct({
  severity: ColdReadSeverity.annotate({
    description:
      '`blocking` (a developer would have to guess), `warning` (likely trouble) or `suggestion` (it would read better).',
  }),
  where: Schema.Array(
    Bounded(
      80,
      'A section name (`why`, `impact`…), or a requirement, scenario, proof or task id (`R2`, `R2.S1`, `R2.S1 proof`, `T3`).',
    ),
  ).annotate({ description: 'Every item of the Spec it concerns, at least one.' }),
  text: Bounded(4000, 'What is wrong, in the language of the user.'),
  question: Schema.optionalKey(
    Bounded(
      2000,
      'For a blocking finding on a section, a requirement, a scenario or a proof: the question a developer would ask.',
    ),
  ),
})
export type ColdReadFinding = typeof ColdReadFinding.Type

/** What `cold_read_report` carries: the whole report, which ends the pass. */
export const ColdReadReport = Schema.Struct({
  findings: Schema.Array(ColdReadFinding).annotate({
    description: 'Every finding, graded; an empty list is a valid report.',
  }),
}).annotate({
  description:
    'End the cold read with your report. Hemera keeps it, bound to the Spec version you read, and hands it on. Call it once: your session ends with it.',
})
export type ColdReadReport = typeof ColdReadReport.Type

/** What `cold_read_fixed` carries. */
export const ColdReadFixed = Schema.Struct({
  finding: Bounded(20, 'The finding (`C1.F2`), as [hemera:cold-read] named it.'),
  what: Bounded(2000, 'What you changed: the section, requirement, scenario or task.'),
}).annotate({
  description:
    'Mark a finding of the cold read fixed: a blocking finding on the tasks only, a warning or a suggestion you agreed with. A blocking finding on the rest is asked in a wave instead.',
})
export type ColdReadFixed = typeof ColdReadFixed.Type

/** A pass as the user and the Planner name it: `C1`, `C2`… per mission. */
export const coldReadLabel = (number: number): string => `C${String(number)}`

/** A finding's id: its pass, then its number in the pass (`C1.F2`). */
export const findingIdOf = (pass: number, number: number): string =>
  `C${String(pass)}.F${String(number)}`

/** Whether a finding concerns the tasks only: every item it names is a task (`T3`). */
export const tasksOnly = (where: ReadonlyArray<string>): boolean =>
  where.length > 0 && where.every((one) => /^T\d+$/.test(one.trim()))

/** Why a report is refused, every fault said; null when it is kept. */
export const coldReadReportRefusal = (findings: ReadonlyArray<ColdReadFinding>): string | null => {
  const faults = findings.flatMap((finding, at) => {
    const named = `Finding ${String(at + 1)}`
    if (finding.where.length === 0) {
      return [
        `${named} names nothing in \`where\`: name the section, requirement, scenario, proof or task it concerns.`,
      ]
    }
    if (
      finding.severity === 'blocking' &&
      !tasksOnly(finding.where) &&
      (finding.question ?? '').trim() === ''
    ) {
      return [
        `${named} is blocking on ${finding.where.join(', ')}: write in \`question\` the question a developer would ask.`,
      ]
    }
    return []
  })
  return faults.length === 0 ? null : `refused: nothing was kept. ${faults.join(' ')}`
}

/** The repositories a Spec names, in its tasks' targets and its proofs' files, each once. */
export const specRepositories = (spec: SpecText): ReadonlyArray<string> => [
  ...new Set([
    ...spec.tasks.flatMap((task) => task.targets.map((target) => target.repository)),
    ...spec.requirements.flatMap((requirement) =>
      requirement.scenarios.flatMap((scenario) => {
        const proof = scenario.proof
        if (proof === null) return []
        return [
          ...(proof.test === undefined ? [] : [proof.test.repository]),
          ...(proof.support_files ?? []).map((file) => file.repository),
        ]
      }),
    ),
  ]),
]

/** The cold read's brief as one field: its heading, and the two lines under it. */
export interface BriefLines {
  readonly label: string
  readonly text: string
}

/** The cold read's brief, as its one field: the heading and the two lines under it. */
export const coldReadBrief = (
  key: string,
  version: number,
  repositories: ReadonlyArray<string>,
): BriefLines => ({
  label: `Cold read of ${key} · Spec version ${String(version)}`,
  text: `Read the Spec with spec_read and the code of: ${repositories.join(', ')}\nReport with cold_read_report.`,
})

/** A finding as it is kept: its id, what the cold read said, and whether it is about tasks only. */
export interface FindingKept {
  readonly id: string
  readonly severity: ColdReadSeverity
  readonly where: ReadonlyArray<string>
  readonly text: string
  readonly question: string | null
  readonly tasksOnly: boolean
}

/** How many findings of each severity. */
export const severityCounts = (
  findings: ReadonlyArray<{ readonly severity: ColdReadSeverity }>,
): Readonly<Record<ColdReadSeverity, number>> => ({
  blocking: findings.filter((one) => one.severity === 'blocking').length,
  warning: findings.filter((one) => one.severity === 'warning').length,
  suggestion: findings.filter((one) => one.severity === 'suggestion').length,
})

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

/** What the Planner does with a finding, as its delivery says it. */
const whatToDo = (finding: FindingKept): string => {
  if (finding.severity !== 'blocking') {
    return '  Fix it if you agree, then cold_read_fixed; otherwise leave it: the user sees it in the report.'
  }
  if (finding.tasksOnly) {
    return '  Fix the task graph yourself, then cold_read_fixed. Never ask it to the user.'
  }
  return `  Question: ${finding.question ?? ''}\n  Ask it in your next wave (ask_wave with from_finding "${finding.id}").`
}

/** What the Planner is handed, as `[hemera:cold-read]`: every finding, each with what to do. */
export const coldReadDelivery = (
  label: string,
  version: number,
  findings: ReadonlyArray<FindingKept>,
): string => {
  const counts = severityCounts(findings)
  return [
    `Cold read ${label} read version ${String(version)} of the Spec: ${plural(counts.blocking, 'blocking', 'blocking')}, ${plural(counts.warning, 'warning', 'warnings')}, ${plural(counts.suggestion, 'suggestion', 'suggestions')}.`,
    '',
    ...findings.map(
      (finding) =>
        `- ${finding.id} · ${finding.severity} · ${finding.where.join(', ')}${finding.tasksOnly ? ' (the tasks only)' : ''}: ${finding.text}\n${whatToDo(finding)}`,
    ),
  ].join('\n')
}

/** A finding as `settled` weighs it. */
export interface FindingStanding {
  readonly id: string
  readonly severity: ColdReadSeverity
  readonly tasksOnly: boolean
  readonly fate: FindingFate
  readonly questionId: string | null
  /** For an asked finding: its question is answered and the answer integrated. */
  readonly questionSettled: boolean
}

/** Why one blocking finding still holds the Freeze, or null. */
const unsettledFinding = (finding: FindingStanding): string | null => {
  if (finding.severity !== 'blocking' || finding.fate === 'dismissed') return null
  if (finding.tasksOnly) {
    return finding.fate === 'fixed'
      ? null
      : `${finding.id} is blocking on the tasks: the Planner has not fixed it, and you have not dismissed it.`
  }
  if (finding.fate === 'open') return `${finding.id} is blocking and not asked yet.`
  if (finding.fate === 'asked' && !finding.questionSettled) {
    return `${finding.id} is asked as ${finding.questionId ?? 'a question'}, and not answered and integrated yet.`
  }
  return null
}

/**
 * Why the cold read is not settled (#92 reads it before Freeze): the latest pass waiting or
 * running, or failed with no pass done in its cycle; otherwise a blocking finding of the pass
 * judged (the latest, or the last done in its cycle when the latest failed) open, asked and not
 * answered and integrated, or about the tasks only and neither fixed nor dismissed. Empty when it
 * is settled.
 */
export const coldReadUnsettled = (
  latest: { readonly label: string; readonly state: ColdReadState } | null,
  /** The findings of the pass judged; null when no pass is done in the latest one's cycle. */
  judged: ReadonlyArray<FindingStanding> | null,
): ReadonlyArray<string> => {
  if (latest === null) return []
  if (latest.state === 'waiting_for_slot')
    return [`Cold read ${latest.label} waits for a free slot.`]
  if (latest.state === 'running') return [`Cold read ${latest.label} is running.`]
  if (judged === null) {
    return latest.state === 'failed' ? [`Cold read ${latest.label} failed: launch another.`] : []
  }
  return judged.flatMap((finding) => {
    const reason = unsettledFinding(finding)
    return reason === null ? [] : [reason]
  })
}
