/**
 * The proofs and the tasks of a Spec (#90): how each scenario is proven (the exact actions, the
 * starting data, the test or the command, the expected result, and what is seen today when the
 * scenario describes a wrong behaviour), the Builder's tasks with the files they target, and the
 * Planner's recommended model for Building.
 *
 * Here are their values, the tools' arguments, and the rules that need nothing but those values:
 * which proof is refused at write, which task graph is refused, and how they read.
 */

import { Schema } from 'effect'

import { AgentProvider } from './agents.ts'
import { shellSyntaxIn } from './commands.ts'

/** `automated`: an automated acceptance test or a command; `by_hand`: verified by the user. */
export const PROOF_MODES = ['automated', 'by_hand'] as const
export const ProofMode = Schema.Literals(PROOF_MODES)
export type ProofMode = typeof ProofMode.Type

/**
 * How a file reaches its repository (CT-37): written whole where the path does not exist at the
 * base commit, or added to an existing file as a patch against it. Never an overwrite.
 */
export const INSERTIONS = ['new_file', 'addition'] as const
export const Insertion = Schema.Literals(INSERTIONS)
export type Insertion = typeof Insertion.Type

/** What a task does to its target (CT-30): creates a file that is not there, or changes one that is. */
export const TARGET_INTENTS = ['create', 'change'] as const
export const TargetIntent = Schema.Literals(TARGET_INTENTS)
export type TargetIntent = typeof TargetIntent.Type

const Text = (description: string) =>
  Schema.String.check(Schema.isNonEmpty()).annotate({ description })

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** No line break: the field is written on one line of the Spec's Markdown. */
const oneLine = Schema.makeFilter((text: string) => !/[\r\n]/.test(text), {
  expected: 'one line, without a line break',
})

/** Text the Spec writes on one line. */
const Line = (description: string) => Text(description).check(oneLine)

/** Bounded text the Spec writes on one line. */
const BoundedLine = (maximum: number, description: string) =>
  Bounded(maximum, description).check(oneLine)

const Repository = Line('The repository, by its path as the Project names it (`api`).')
/**
 * Why a path is not one of a file inside its repository as Git names it, or null: relative, with
 * forward slashes, no empty, `.` or `..` segment, no drive letter, and never in `.git`.
 */
export const repositoryFileRefusal = (path: string): string | null => {
  if (/[\r\n]/.test(path)) return 'it holds a line break'
  if (path.includes('\\')) return 'it holds a backslash: use forward slashes'
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'it is absolute'
  const segments = path.split('/')
  if (segments.some((segment) => segment === '..')) return 'it climbs out with ..'
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return 'it has an empty or a . segment'
  }
  if (segments.some((segment) => segment.toLowerCase() === '.git')) return 'it is inside .git'
  return null
}

const RelativePath = Text('Its path, relative to that repository, with forward slashes.').check(
  Schema.makeFilter((path) => repositoryFileRefusal(path) === null, {
    expected:
      'a path relative to the repository, with forward slashes, without `..`, a drive letter or `.git`',
  }),
)
const InsertionField = Insertion.annotate({
  description:
    '`new_file`: the path does not exist at the base commit, and the file is written whole. `addition`: the file exists, and `patch` adds to it.',
})
const Patch = Schema.optionalKey(
  Text(
    'For `addition`: a unified patch against the file as it is at the base commit, as `git diff` prints it.',
  ),
)
const Against = Schema.optionalKey(
  Text('For `addition`: the commit the patch was written against.'),
)

/** The automated test of a scenario: its whole code, where it goes, how, and what runs it. */
export const ProofTest = Schema.Struct({
  repository: Repository,
  path: RelativePath,
  code: Text('The whole code of the test, as it reads once inserted.'),
  insertion: InsertionField,
  patch: Patch,
  against: Against,
  command: Line('What runs it: a catalogue command id, or one command line without shell syntax.'),
})
export type ProofTest = typeof ProofTest.Type

/** A file the proof needs beside its test: a fixture, a helper, some data (CT-31). */
export const SupportFile = Schema.Struct({
  repository: Repository,
  path: RelativePath,
  insertion: InsertionField,
  content: Schema.optionalKey(
    Schema.String.annotate({
      description: 'For `new_file`: its whole content (empty for an empty file).',
    }),
  ),
  patch: Patch,
  against: Against,
  from_probe: Schema.optionalKey(Line('The Probe that captured it (`#2`).')),
})
export type SupportFile = typeof SupportFile.Type

/** A support file as the page reads it: by reference, without its content. */
export const SupportFileSeen = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  insertion: Insertion,
  against: Schema.optionalKey(Schema.String),
  from_probe: Schema.optionalKey(Schema.String),
})
export type SupportFileSeen = typeof SupportFileSeen.Type

/** Where a wrong behaviour was seen: a commit of one repository. */
export const BaseCommit = Schema.Struct({
  repository: Repository,
  commit: Line('The commit it was seen on.'),
})
export type BaseCommit = typeof BaseCommit.Type

/** The Proof block of a scenario, as the Planner writes it and Hemera keeps it. */
export const Proof = Schema.Struct({
  mode: ProofMode.annotate({
    description:
      '`automated` (a test or a command), or `by_hand` only for what cannot be automated: a visual result, an animation, readability.',
  }),
  actions: Schema.Array(Line('One action, exact enough to replay word for word.')).annotate({
    description: 'The exact steps, in order.',
  }),
  starting_data: Schema.String.check(oneLine).annotate({
    description: 'The data the actions start from (fixtures, inputs); "None." when none.',
  }),
  expected: Line(
    'The result after the change. For an automated proof, the assertion whose failure is the valid red.',
  ),
  test: Schema.optionalKey(
    ProofTest.annotate({ description: 'For `automated`: the test, whole, and what runs it.' }),
  ),
  command: Schema.optionalKey(
    Line(
      'For `automated` without a test file: the catalogue command id or the one command line whose output or exit code shows the result.',
    ),
  ),
  support_files: Schema.optionalKey(
    Schema.Array(SupportFile).annotate({
      description: 'The files the proof needs beside its test.',
    }),
  ),
  seen_today: Schema.Boolean.annotate({
    description:
      'True when the scenario describes a wrong behaviour that exists now: `observed`, `key_line` and `base_commit` are then required.',
  }),
  observed: Schema.optionalKey(
    Text('What a real run printed today, verbatim and trimmed: never a paraphrase.'),
  ),
  key_line: Schema.optionalKey(
    Line('The line of `observed` that shows the behaviour, copied exactly.'),
  ),
  base_commit: Schema.optionalKey(
    Schema.Array(BaseCommit).annotate({
      description: 'Where it was seen: the commit of each repository it was seen in.',
    }),
  ),
  from_probe: Schema.optionalKey(Line('The Probe whose report it comes from (`#2`).')),
  evidence: Schema.optionalKey(
    Schema.Array(Line('Evidence kept with evidence_add, by its name.')).annotate({
      description: 'The evidence that shows it.',
    }),
  ),
})
export type Proof = typeof Proof.Type

/** A Proof block as the page and the readable file read it: its support files by reference. */
export const ProofSeen = Schema.Struct({
  ...Proof.fields,
  support_files: Schema.optionalKey(Schema.Array(SupportFileSeen)),
})
export type ProofSeen = typeof ProofSeen.Type

/** What `proof_write` carries: a proof written whole, or a Probe whose report becomes one. */
export const ProofWrite = Schema.Struct({
  scenario: Bounded(40, 'The scenario (`R1.S2`).'),
  proof: Schema.optionalKey(Proof.annotate({ description: 'The proof, whole.' })),
  probe: Schema.optionalKey(
    Bounded(
      20,
      'Instead of `proof`: a done Probe (`#2`) whose report becomes the proof, its captured files the support files.',
    ),
  ),
  support_files: Schema.optionalKey(
    Schema.Array(SupportFile).annotate({
      description: 'With `probe`: support files of yours, added to those the Probe captured.',
    }),
  ),
  base_version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description:
      "The version of the scenario's proof you read (0 when it has none): a proof changed since is refused.",
  }),
})
  .annotate({
    description:
      "Write a scenario's Proof, whole: the exact actions, the starting data, the test or the command, the expected result. Refused, naming the field, when what is seen today lacks its output, key line or base commit, or when a file would not go in at the base commit.",
  })
  .check(
    Schema.makeFilter((asked) => (asked.proof === undefined) !== (asked.probe === undefined), {
      expected: 'either a proof or a probe',
    }),
  )

/** A file a task targets, and whether the task creates or changes it. */
export const TaskTarget = Schema.Struct({
  repository: Repository,
  path: RelativePath,
  intent: TargetIntent.annotate({
    description: '`create` (the path does not exist at the base commit) or `change` (it does).',
  }),
})
export type TaskTarget = typeof TaskTarget.Type

/** A task as `tasks_write` carries it. */
export const TaskAsked = Schema.Struct({
  id: Schema.optionalKey(BoundedLine(12, 'The task (`T2`) to keep; a new task without it.')),
  title: BoundedLine(200, 'What the task builds, in a few words.'),
  result: BoundedLine(2000, 'What is true once it is done.'),
  requirements: Schema.Array(Line('A requirement it covers (`R1`).')),
  scenarios: Schema.Array(Line('A scenario it covers (`R1.S2`).')),
  targets: Schema.Array(TaskTarget).annotate({ description: 'The files it creates or changes.' }),
  depends_on: Schema.Array(
    Line('A task done before it: its id (`T1`), or the title of a task new in this write.'),
  ),
})
export type TaskAsked = typeof TaskAsked.Type

export const TasksWrite = Schema.Struct({
  tasks: Schema.Array(TaskAsked).annotate({
    description: 'The whole graph, in order: a task left out is removed, and its id never reused.',
  }),
  base_version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: 'The version of the task graph as you read it (0 before the first write).',
  }),
}).annotate({
  description:
    'Write the task graph for the Builder, whole: vertical slices, each covering scenarios and naming its targets. Refused, with every problem named and nothing written, on a cycle, a reference to nothing, or a target that is not as its intent says at the base commit.',
})

export const ModelRecommend = Schema.Struct({
  agent: AgentProvider.annotate({ description: 'The agent: `claude`, `codex` or `opencode`.' }),
  model: BoundedLine(200, 'The model, as the agent names it.'),
  effort: Schema.optionalKey(
    BoundedLine(100, 'The effort, as the agent names it, when it has one.'),
  ),
  reason: BoundedLine(2000, 'Why: the size and the risk of the work.'),
}).annotate({
  description:
    'Recommend the model Building runs on, with your reason. The user sees it before Building starts and may change it.',
})

/** A task as it is kept: its stable id, and the rank it was written at. */
export interface SpecTaskText {
  readonly id: string
  readonly title: string
  readonly result: string
  readonly requirements: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<string>
  readonly targets: ReadonlyArray<TaskTarget>
  readonly dependsOn: ReadonlyArray<string>
}

/** The Planner's recommended setting for Building, with its reason. */
export interface ModelRecommendation {
  readonly agent: AgentProvider
  readonly model: string
  readonly effort: string | null
  readonly reason: string
}

/** What is wrong with a task graph. */
export type GraphProblem =
  | {
      readonly kind: 'unknown_task' | 'unknown_requirement' | 'unknown_scenario'
      /** The task whose reference names nothing. */
      readonly task: string
      /** The id that names nothing. */
      readonly target: string
    }
  | {
      readonly kind: 'duplicate_task'
      /** The id more than one task holds. */
      readonly task: string
    }
  | {
      readonly kind: 'cycle'
      /** The closed path by task title, in the direction of the dependencies: `A`, `B`, `A`. */
      readonly path: ReadonlyArray<string>
    }

/** The live ids a task may cover. */
export interface Coverable {
  readonly requirements: ReadonlySet<string>
  readonly scenarios: ReadonlySet<string>
}

/** The problems of a task graph: references to nothing, and each cycle as a closed path by title. */
export function taskGraph(
  tasks: ReadonlyArray<
    Pick<SpecTaskText, 'id' | 'title' | 'requirements' | 'scenarios' | 'dependsOn'>
  >,
  coverable: Coverable,
): ReadonlyArray<GraphProblem> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const problems: GraphProblem[] = []
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const task of tasks) {
    if (seen.has(task.id) && !twice.has(task.id)) {
      twice.add(task.id)
      problems.push({ kind: 'duplicate_task', task: task.id })
    }
    seen.add(task.id)
  }
  for (const task of tasks) {
    for (const target of task.dependsOn) {
      if (!byId.has(target)) problems.push({ kind: 'unknown_task', task: task.id, target })
    }
    for (const target of task.requirements) {
      if (!coverable.requirements.has(target)) {
        problems.push({ kind: 'unknown_requirement', task: task.id, target })
      }
    }
    for (const target of task.scenarios) {
      if (!coverable.scenarios.has(target)) {
        problems.push({ kind: 'unknown_scenario', task: task.id, target })
      }
    }
  }
  // Depth first, in the order written: an edge back onto the current path closes a cycle.
  const done = new Set<string>()
  const path: string[] = []
  const titleOf = (id: string): string => byId.get(id)?.title ?? id
  const visit = (id: string): void => {
    path.push(id)
    for (const target of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(target)) continue
      const at = path.indexOf(target)
      if (at !== -1) {
        problems.push({ kind: 'cycle', path: [...path.slice(at), target].map(titleOf) })
      } else if (!done.has(target)) {
        visit(target)
      }
    }
    path.pop()
    done.add(id)
  }
  for (const task of tasks) if (!done.has(task.id)) visit(task.id)
  return problems
}

/** A cycle as the refusal names it: `A → B → C → A`. */
export const cycleSaid = (path: ReadonlyArray<string>): string => path.join(' → ')

/** A graph problem as the Planner reads it. */
export const graphProblemSaid = (problem: GraphProblem): string => {
  switch (problem.kind) {
    case 'cycle':
      return `The tasks depend on each other in a cycle: ${cycleSaid(problem.path)}.`
    case 'duplicate_task':
      return `${problem.task} is the id of more than one task: each task has its own.`
    case 'unknown_task':
      return `${problem.task} depends on ${problem.target}, which is no task of the graph.`
    case 'unknown_requirement':
      return `${problem.task} covers ${problem.target}, which is no requirement of the Spec.`
    case 'unknown_scenario':
      return `${problem.task} covers ${problem.target}, which is no scenario of the Spec.`
  }
}

const BY_HAND_ONLY =
  'is for an automated proof: a proof verified by hand has actions, starting data and expected only.'

/** What an inserted file lacks, by the field that names it. */
const insertionRefusals = (
  field: string,
  file: {
    readonly insertion: Insertion
    readonly patch?: string | undefined
    readonly against?: string | undefined
  },
  content: string | undefined | null,
): ReadonlyArray<string> => {
  if (file.insertion === 'new_file') {
    return content === undefined
      ? [`\`${field}.content\` is required for a new file: its whole content.`]
      : []
  }
  return [
    file.patch === undefined
      ? `\`${field}.patch\` is required for an addition: the unified patch against the file at the base commit.`
      : null,
    file.against === undefined
      ? `\`${field}.against\` is required for an addition: the commit the patch was written against.`
      : null,
  ].filter((said) => said !== null)
}

const shellSaid = (field: string, line: string): ReadonlyArray<string> => {
  const token = shellSyntaxIn(line)
  return token === null
    ? []
    : [
        `\`${field}\` holds shell syntax (“${token}”): name a catalogue command, or one command line.`,
      ]
}

/** What a proof seen today lacks: its output, its key line found verbatim in it, its base commit. */
export function seenTodayRefusals(
  proof: Pick<ProofSeen, 'seen_today' | 'observed' | 'key_line' | 'base_commit'>,
): ReadonlyArray<string> {
  if (!proof.seen_today) return []
  const refusals: string[] = []
  if (proof.observed === undefined) {
    refusals.push(
      '`observed` is required when `seen_today` is true: quote what a real run printed today, verbatim.',
    )
  }
  if (proof.key_line === undefined) {
    refusals.push(
      '`key_line` is required when `seen_today` is true: copy the line of `observed` that shows the behaviour.',
    )
  } else if (proof.key_line.trim() === '') {
    refusals.push('`key_line` is blank: copy the line of `observed` that shows the behaviour.')
  } else if (
    proof.observed !== undefined &&
    !proof.observed.split('\n').some((line) => line.includes(proof.key_line?.trim() ?? ''))
  ) {
    refusals.push('`key_line` is not in a line of `observed`: copy one line exactly from there.')
  }
  if (proof.base_commit === undefined || proof.base_commit.length === 0) {
    refusals.push(
      '`base_commit` is required when `seen_today` is true: the commit of each repository it was seen on.',
    )
  }
  return refusals
}

/**
 * Why a proof is refused at write, each naming its field, or none: what is seen today needs its
 * output, its key line found verbatim in it and its base commit; a by-hand proof holds no test nor
 * command; an addition needs its patch and the commit it was written against; a new file needs its
 * content; a command line holds no shell syntax.
 */
export function proofRefusals(proof: Proof): ReadonlyArray<string> {
  const refusals: string[] = [...seenTodayRefusals(proof)]
  const supportFiles = proof.support_files ?? []
  if (proof.mode === 'by_hand') {
    if (proof.test !== undefined) refusals.push(`\`test\` ${BY_HAND_ONLY}`)
    if (proof.command !== undefined) refusals.push(`\`command\` ${BY_HAND_ONLY}`)
    if (supportFiles.length > 0) refusals.push(`\`support_files\` ${BY_HAND_ONLY}`)
    return refusals
  }
  if (proof.test !== undefined) {
    refusals.push(...insertionRefusals('test', proof.test, proof.test.code))
    refusals.push(...shellSaid('test.command', proof.test.command))
    if (proof.command !== undefined) {
      refusals.push(
        '`command` is for a proof without a test file: the test is run by `test.command`.',
      )
    }
  } else if (proof.command !== undefined) {
    refusals.push(...shellSaid('command', proof.command))
  }
  const given = new Set<string>()
  for (const [at, file] of supportFiles.entries()) {
    const field = `support_files[${String(at)}]`
    refusals.push(...insertionRefusals(field, file, file.content))
    const named = `${file.repository}/${file.path}`
    if (proof.test?.repository === file.repository && proof.test.path === file.path) {
      refusals.push(`\`${field}\`: ${named} is the path of the test: a proof gives each file once.`)
    } else if (given.has(named)) {
      refusals.push(`\`${field}\`: ${named} is given twice: a proof gives each file once.`)
    }
    given.add(named)
  }
  return refusals
}

/** Every file a proof inserts, with the field that names it: its test, then its support files. */
export interface InsertedFile {
  readonly field: string
  readonly repository: string
  readonly path: string
  readonly insertion: Insertion
  readonly patch: string | null
}

export const insertedFiles = (proof: Proof): ReadonlyArray<InsertedFile> => [
  ...(proof.test === undefined
    ? []
    : [
        {
          field: 'test',
          repository: proof.test.repository,
          path: proof.test.path,
          insertion: proof.test.insertion,
          patch: proof.test.patch ?? null,
        },
      ]),
  ...(proof.support_files ?? []).map((file, at) => ({
    field: `support_files[${String(at)}]`,
    repository: file.repository,
    path: file.path,
    insertion: file.insertion,
    patch: file.patch ?? null,
  })),
]

/** A proof as the page and the readable file read it: its support files by reference. */
export const proofSeen = (proof: Proof): ProofSeen => {
  const { support_files: files, ...rest } = proof
  if (files === undefined) return rest
  return {
    ...rest,
    support_files: files.map(({ content: _content, patch: _patch, ...reference }) => reference),
  }
}

const INSERTION_SAID: Readonly<Record<Insertion, string>> = {
  new_file: 'new file',
  addition: 'addition',
}

/** A fence longer than any run of `~` in what it holds, so nothing inside closes it. */
const fenceFor = (text: string): string =>
  '~'.repeat(Math.max(3, ...[...text.matchAll(/~+/g)].map((run) => run[0].length + 1)))

const indented = (text: string): string =>
  text
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n')

/** A proof as the readable file and `spec_read` give it, indented under its scenario. */
export const proofText = (proof: ProofSeen): string =>
  [
    `  - Proof: ${[
      proof.mode === 'automated' ? 'automated' : 'verified by hand',
      ...(proof.seen_today ? ['seen today'] : []),
      ...(proof.from_probe === undefined ? [] : [`from Probe ${proof.from_probe}`]),
    ].join(', ')}`,
    `    - Actions: ${proof.actions.map((action, at) => `${String(at + 1)}. ${action}`).join(' ')}`,
    `    - Starting data: ${proof.starting_data}`,
    `    - Expected: ${proof.expected}`,
    proof.test === undefined
      ? null
      : [
          `    - Test: ${proof.test.repository}/${proof.test.path} (${INSERTION_SAID[proof.test.insertion]}), run by \`${proof.test.command}\``,
          '',
          `      ${fenceFor(proof.test.code)}`,
          indented(proof.test.code.replace(/\n$/, '')),
          `      ${fenceFor(proof.test.code)}`,
          '',
        ].join('\n'),
    proof.command === undefined ? null : `    - Command: \`${proof.command}\``,
    proof.support_files === undefined || proof.support_files.length === 0
      ? null
      : `    - Support files: ${proof.support_files
          .map((file) => `${file.repository}/${file.path} (${INSERTION_SAID[file.insertion]})`)
          .join(', ')}`,
    proof.observed === undefined
      ? null
      : [
          '    - Observed:',
          '',
          `      ${fenceFor(proof.observed)}`,
          indented(proof.observed),
          `      ${fenceFor(proof.observed)}`,
          '',
        ].join('\n'),
    proof.key_line === undefined ? null : `    - Key line: ${proof.key_line}`,
    proof.base_commit === undefined || proof.base_commit.length === 0
      ? null
      : `    - Seen on: ${proof.base_commit.map((one) => `${one.repository} ${one.commit}`).join(', ')}`,
    proof.evidence === undefined || proof.evidence.length === 0
      ? null
      : `    - Evidence: ${proof.evidence.join(', ')}`,
  ]
    .filter((part) => part !== null)
    .join('\n')

/** A task as the readable file gives it, on one line. */
export const taskText = (task: SpecTaskText): string =>
  [
    `- ${task.id} · ${task.title}: ${task.result}`,
    `Covers ${[...task.requirements, ...task.scenarios].join(', ') || 'nothing'}.`,
    task.targets.length === 0
      ? null
      : `Targets: ${task.targets.map((target) => `${target.intent} ${target.repository}/${target.path}`).join(', ')}.`,
    task.dependsOn.length === 0 ? null : `After ${task.dependsOn.join(', ')}.`,
  ]
    .filter((part) => part !== null)
    .join(' ')

/** The recommendation as the readable file gives it. */
export const recommendationText = (recommendation: ModelRecommendation): string =>
  `${[
    recommendation.agent,
    recommendation.model,
    ...(recommendation.effort === null ? [] : [`effort ${recommendation.effort}`]),
  ].join(' · ')}: ${recommendation.reason}`
