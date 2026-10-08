/**
 * The Probes of Planning (#89): a sub-agent the Planner launches in the background whenever it would
 * otherwise have to assume how the code, a library or a bug behaves. It runs in a worktree of its
 * own, taken from the up-to-date base, and answers with one report: reproduced or not, the exact
 * actions and the output seen, the test that shows it, and the neighbouring cases that break too.
 *
 * Here are the values a Probe is made of, the tools' arguments, and the rules that need nothing but
 * those values: which report is refused, and how a Probe and its report read.
 */

import { Schema } from 'effect'

/**
 * Where a Probe stands: `preparing` (its worktree and the recipe), `running` (its session), then
 * `done` or `failed`; `interrupted` after a restart, until it is relaunched; `wiping`, then `wiped`.
 */
export const PROBE_STATES = [
  'preparing',
  'running',
  'done',
  'failed',
  'interrupted',
  'wiping',
  'wiped',
] as const
export const ProbeState = Schema.Literals(PROBE_STATES)
export type ProbeState = typeof ProbeState.Type

/** What a Probe found. */
export const PROBE_OUTCOMES = ['reproduced', 'not_reproduced', 'answered', 'inconclusive'] as const
export const ProbeOutcome = Schema.Literals(PROBE_OUTCOMES)
export type ProbeOutcome = typeof ProbeOutcome.Type

const Text = (description: string) =>
  Schema.String.check(Schema.isNonEmpty()).annotate({ description })

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** The test that shows the behaviour, whole, at the path a Builder would give it. */
export const ProbeTest = Schema.Struct({
  repository: Text('The repository it belongs to, by its path as the Project names it (`api`).'),
  path: Text('Its path, relative to that repository, inside your worktree.'),
  code: Text('Its whole code, as it is written in the file.'),
})
export type ProbeTest = typeof ProbeTest.Type

/** A neighbouring case tried, and what it did. */
export const ProbeNeighbour = Schema.Struct({
  what: Text('The case: another input, a boundary value.'),
  observed: Text('What it did, quoted.'),
  evidence: Schema.String.annotate({
    description: 'The command and output that show it, or the evidence it was kept as.',
  }),
})
export type ProbeNeighbour = typeof ProbeNeighbour.Type

/** What `probe_report` carries: the report a Probe ends with. */
export const ProbeReport = Schema.Struct({
  outcome: ProbeOutcome.annotate({
    description:
      '`reproduced`, `not_reproduced`, `answered` (a question that is not a bug) or `inconclusive` (say what is missing).',
  }),
  answer: Bounded(4000, 'The answer to the question, in one or a few sentences.'),
  actions: Schema.Array(Text('One action, exact enough to replay word for word.')).annotate({
    description: 'Every action you took, in order: what a Builder replays.',
  }),
  starting_data: Schema.String.annotate({
    description: 'The data the actions start from (fixtures, inputs); empty when none.',
  }),
  command: Schema.optionalKey(Text('The command that shows the behaviour, as you ran it.')),
  expected: Text('What should happen.'),
  observed: Schema.optionalKey(
    Text('What happened, verbatim and trimmed: the output of a real run, never a paraphrase.'),
  ),
  key_line: Schema.optionalKey(Text('The line of `observed` that shows the behaviour.')),
  test: Schema.optionalKey(
    ProbeTest.annotate({ description: 'The smallest test that shows it, if you wrote one.' }),
  ),
  base_commit: Text('The commit your worktree was made from, as your brief gives it.'),
  neighbours: Schema.Array(ProbeNeighbour).annotate({
    description: 'The neighbouring cases you tried that break too; empty when none did.',
  }),
  evidence: Schema.Array(Text('Evidence kept with evidence_add, by its name.')).annotate({
    description: 'The evidence you kept, by name.',
  }),
}).annotate({
  description:
    'End your work with your report. Hemera keeps it with what you created or changed in your worktree, and hands it to the Planner. Call it once: your session ends with it.',
})
export type ProbeReport = typeof ProbeReport.Type

/** What `probe_launch` carries. */
export const ProbeLaunch = Schema.Struct({
  question: Bounded(
    500,
    'The one question to answer by running things (`does the importer keep accents?`).',
  ),
  scenario: Schema.optionalKey(
    Bounded(40, 'The scenario it serves (`R1.S2`), when it serves one.'),
  ),
  brief: Bounded(
    4000,
    'Your hints: where to look, the starting data, what you already know. The Probe reads nothing else of your conversation.',
  ),
}).annotate({
  description:
    'Launch a Probe: a sub-agent that answers one question by running things in a worktree of its own, from the up-to-date base. Hemera answers at once with its number; keep working. Its report arrives as [hemera:probe].',
})

/** What `probe_read` carries. */
export const ProbeRead = Schema.Struct({
  probe: Bounded(20, 'The Probe, by its number as probe_launch answered it (`#3`).'),
}).annotate({ description: 'Where a Probe stands, and its report once it is done.' })

/** A Probe as people and agents call it: `#3`. */
export const probeLabel = (number: number): string => `#${String(number)}`

/** Now's line while a Probe runs: "Probe #85 runs: does the importer keep accents?". */
export const probeRunsSaid = (number: number, question: string): string =>
  `Probe ${probeLabel(number)} runs: ${question}`

/** The number `#3` or `3` names, or null for anything else. */
export const probeNumberOf = (named: string): number | null => {
  const match = /^#?([1-9][0-9]{0,8})$/.exec(named.trim())
  return match === null ? null : Number(match[1])
}

/**
 * Why a report is refused, as the Probe reads it, or null when it is kept: `reproduced` needs the
 * output of a real run.
 */
export const probeReportRefusal = (report: ProbeReport): string | null =>
  report.outcome === 'reproduced' && (report.observed ?? '').trim() === ''
    ? 'refused: a reproduced behaviour needs the observed output of a real run, quoted verbatim in `observed`'
    : null

/** A report as the Planner reads it, in `[hemera:probe]` and `probe_read`. */
export const probeReportText = (number: number, question: string, report: ProbeReport): string =>
  [
    `Probe ${probeLabel(number)}: ${question}`,
    `Outcome: ${report.outcome}`,
    `Answer: ${report.answer}`,
    `Base commit: ${report.base_commit}`,
    report.starting_data.trim() === '' ? null : `Starting data: ${report.starting_data}`,
    report.actions.length === 0
      ? null
      : ['Actions:', ...report.actions.map((action, at) => `${String(at + 1)}. ${action}`)].join(
          '\n',
        ),
    report.command === undefined ? null : `Command: ${report.command}`,
    `Expected: ${report.expected}`,
    report.observed === undefined ? null : `Observed (verbatim):\n${report.observed}`,
    report.key_line === undefined ? null : `Key line: ${report.key_line}`,
    report.test === undefined
      ? null
      : `Test: ${report.test.repository}/${report.test.path}\n${report.test.code}`,
    report.neighbours.length === 0
      ? 'Neighbouring cases: none broke'
      : [
          'Neighbouring cases that break too:',
          ...report.neighbours.map(
            (one) =>
              `- ${one.what}: ${one.observed}${one.evidence.trim() === '' ? '' : ` (${one.evidence})`}`,
          ),
        ].join('\n'),
    report.evidence.length === 0 ? null : `Evidence: ${report.evidence.join(', ')}`,
  ]
    .filter((part) => part !== null)
    .join('\n')
