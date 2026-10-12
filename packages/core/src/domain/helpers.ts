/**
 * The helpers (#145): child sessions launched through Hemera's tools to hand them one piece of
 * work. A free helper runs on the brief its parent wrote, launched in Building by the Builder or a
 * helper at depth 1; a defined helper (the Prototyper, `./helper-definitions.ts`) has its
 * definition in one place, and the Prototyper is the Planner's, in Planning (#222). A helper's
 * result is the arguments of `helper_result`, read against its shape.
 *
 * Here are the values a helper is made of, the tools' arguments, and the rules that need nothing
 * but those values: the tools a helper's session holds, its brief, and how its result reads.
 */

import { Schema } from 'effect'

/** How deep helpers go: the Builder's helpers, and their own. A helper at this depth launches none. */
export const HELPER_DEPTH = 2

/** Where a helper stands: `running` from its launch, then `done` with its result, or `failed`. */
export const HELPER_STATES = ['running', 'done', 'failed'] as const
export const HelperState = Schema.Literals(HELPER_STATES)
export type HelperState = typeof HelperState.Type

/**
 * Where a helper works: its parent's place (the Workspace), or a throwaway folder of the mission
 * in the data folder (`missions/<key>/prototypes/<n>/`).
 */
export const HELPER_PLACES = ['workspace', 'prototype'] as const
export const HelperPlace = Schema.Literals(HELPER_PLACES)
export type HelperPlace = typeof HelperPlace.Type

/** What a helper receives beside its role: the Spec, the task it is tied to, the brief. */
export const HELPER_INPUTS = ['spec', 'task', 'brief'] as const
export const HelperInput = Schema.Literals(HELPER_INPUTS)
export type HelperInput = typeof HelperInput.Type

/** The tools the depth gives, never a definition. */
export const HELPER_TOOLS = ['helper_launch', 'helper_read'] as const

/** The tools of a task, given to a helper tied to one and for that task only. */
export const HELPER_TASK_TOOLS = ['task_start', 'task_finished', 'task_blocked'] as const

/** The tools that write a file: what a helper that does not write never holds. */
export const WRITING_TOOLS = ['fs_write', 'fs_edit'] as const

/**
 * The tinted pairs a letter avatar wears (#8's `LetterAvatar`): a definition's colour is one of
 * them, a free helper's is read from its name.
 */
export const AVATAR_TONES = ['primary', 'info', 'success', 'warning', 'build'] as const
export const AvatarTone = Schema.Literals(AVATAR_TONES)
export type AvatarTone = typeof AvatarTone.Type

/** A name's own tone, as #8's `letterToneOf` reads it: the same name, the same tone, every time. */
export const avatarToneOf = (name: string): AvatarTone => {
  const hash = [...name].reduce(
    (total, letter) => ((total * 33) ^ letter.charCodeAt(0)) >>> 0,
    5381,
  )
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? 'primary'
}

/** The icon every free helper wears. */
export const FREE_HELPER_ICON = 'helper'

/** A helper as people and agents call it: `H2`. */
export const helperLabel = (number: number): string => `H${String(number)}`

/** The number `H2` or `h2` names, or null for anything else. */
export const helperNumberOf = (named: string): number | null => {
  const match = /^[Hh]([1-9][0-9]{0,8})$/.exec(named.trim())
  return match === null ? null : Number(match[1])
}

const Text = (description: string) =>
  Schema.String.check(Schema.isNonEmpty()).annotate({ description })

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** A file a free helper changed. */
export const ChangedFile = Schema.Struct({
  repository: Text('The repository, by its path as the Project names it (`api`).'),
  path: Text('The path, relative to that repository.'),
})

/** What a free helper hands back. */
export const FreeHelperResult = Schema.Struct({
  summary: Bounded(4000, 'What you did, in a few sentences.'),
  changed: Schema.Array(ChangedFile).annotate({
    description: 'Every file you changed; empty when none.',
  }),
  checked: Schema.Array(Text('One check: what you ran and what it showed.')).annotate({
    description: 'What you checked and how; never a check you did not run.',
  }),
  left: Schema.Array(Text('One thing left to do.')).annotate({
    description: 'What is left; empty when nothing is.',
  }),
})
export type FreeHelperResult = typeof FreeHelperResult.Type

/** What the Prototyper hands back. */
export const PrototyperResult = Schema.Struct({
  tried: Bounded(4000, 'The approach you tried, in a few sentences.'),
  works: Schema.Array(Text('One thing that works, as you saw it run.')).annotate({
    description: 'What works; only what you ran.',
  }),
  does_not_work: Schema.Array(Text('One thing that does not work, and what it did.')).annotate({
    description: 'What does not work, and why.',
  }),
  files: Schema.Array(Text('A file of your folder, by its path relative to it.')).annotate({
    description: 'The files of your folder that show the answer: they become evidence.',
  }),
})
export type PrototyperResult = typeof PrototyperResult.Type

/**
 * Why the Builder, or a helper of its, is refused the Prototyper (#222): trying an interface or an
 * approach is Planning's, and the Builder builds what was validated.
 */
export const PROTOTYPER_BELONGS_TO_PLANNING =
  'the Prototyper belongs to Planning: an interface or an approach is tried there, before the Freeze, and the Builder builds what was validated'

/** Why the Planner is refused a free helper: it runs things through a Probe. */
export const PLANNER_LAUNCHES_ONLY_PROTOTYPER =
  'the Planner launches only the Prototyper; to run something, launch a Probe'

/** The Planner's rule for the Prototyper, as its instructions say it (#222). */
export const PLANNER_PROTOTYPE_RULE = `Launch the Prototyper (helper_launch with helper "prototyper" and the question in the brief)
when the user asks for a prototype, in an answer or through [hemera:prototype], and on your own
when the Spec changes the interface or rests on an approach nobody has run.`

/**
 * What the user says of a Prototyper's result, before the Freeze (#222): taken as it is, or set
 * aside. The Freeze keeps every result, with its verdict or none.
 */
export const PROTOTYPE_VERDICTS = ['validated', 'set-aside'] as const
export const PrototypeVerdict = Schema.Literals(PROTOTYPE_VERDICTS)
export type PrototypeVerdict = typeof PrototypeVerdict.Type

/**
 * Why a Prototyper holds the Freeze, in words, while it runs; null once it ended. A result the user
 * has not judged holds nothing: it is frozen unjudged.
 */
export const prototypeUnsettled = (prototype: {
  readonly label: string
  readonly state: HelperState
  readonly question: string
}): string | null =>
  prototype.state === 'running' ? `Prototyper ${prototype.label} runs: ${prototype.question}` : null

const TaskNamed = Bounded(20, 'The task, by its id (`T4`).')

const HelperNamed = Bounded(20, 'The helper, by its id as helper_launch answered it (`H2`).')

/** What `helper_launch` carries. */
export const HelperLaunch = Schema.Struct({
  helper: Schema.optionalKey(
    Bounded(
      60,
      'A defined helper, by its id (`prototyper`). Leave it out for a free helper that does what your brief says.',
    ),
  ),
  brief: Bounded(
    8000,
    'The work to do, whole: the helper reads nothing else of your conversation. For the Prototyper, the question to answer.',
  ),
  task: Schema.optionalKey(
    TaskNamed.annotate({
      description:
        'A task of the plan the helper carries to task_finished: it becomes its runner, and its files become the helper’s.',
    }),
  ),
  writes: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'For a free helper: whether it may write files. False unless said.',
    }),
  ),
  tools: Schema.optionalKey(
    Schema.Array(Bounded(40, 'A tool of yours, by its name.')).annotate({
      description: 'For a free helper: the tools it holds, a subset of yours. Yours unless said.',
    }),
  ),
}).annotate({
  description:
    'Launch a helper: a sub-agent that does one piece of work and hands back its result. Hemera answers at once with its id; keep working. Its result arrives as [hemera:result]. Refused above the Project’s cap of sub-agents or the mission’s launch budget: do the work yourself then.',
})

/** What `helper_read` carries. */
export const HelperRead = Schema.Struct({ helper: HelperNamed }).annotate({
  description:
    'Where one of your helpers stands: its state, whether it is stuck, its last line, and its result once it is done.',
})

/**
 * What `helper_result` carries: every field of every shape, each said for whom; Hemera reads them
 * against the caller's own shape and names a field that does not read.
 */
export const HelperResult = Schema.Struct({
  summary: Schema.optionalKey(FreeHelperResult.fields.summary),
  changed: Schema.optionalKey(FreeHelperResult.fields.changed),
  checked: Schema.optionalKey(FreeHelperResult.fields.checked),
  left: Schema.optionalKey(FreeHelperResult.fields.left),
  tried: Schema.optionalKey(PrototyperResult.fields.tried),
  works: Schema.optionalKey(PrototyperResult.fields.works),
  does_not_work: Schema.optionalKey(PrototyperResult.fields.does_not_work),
  files: Schema.optionalKey(PrototyperResult.fields.files),
}).annotate({
  description:
    'End your work with your result. A helper: summary, changed, checked, left. The Prototyper: tried, works, does_not_work, files. Call it once: your session ends with it.',
})

/** A free helper's result as its parent reads it. */
export const freeResultText = (result: FreeHelperResult): string =>
  [
    result.summary,
    result.changed.length === 0
      ? 'Changed: nothing.'
      : `Changed: ${result.changed.map((one) => `${one.repository}/${one.path}`).join(', ')}.`,
    result.checked.length === 0
      ? 'Checked: nothing.'
      : ['Checked:', ...result.checked.map((one) => `- ${one}`)].join('\n'),
    result.left.length === 0
      ? 'Left: nothing.'
      : ['Left:', ...result.left.map((one) => `- ${one}`)].join('\n'),
  ].join('\n')

/** The Prototyper's result as its parent reads it, with where its files were kept. */
export const prototyperResultText = (result: PrototyperResult, kept: string): string =>
  [
    `Tried: ${result.tried}`,
    result.works.length === 0
      ? 'Works: nothing.'
      : ['Works:', ...result.works.map((one) => `- ${one}`)].join('\n'),
    result.does_not_work.length === 0
      ? 'Does not work: nothing.'
      : ['Does not work:', ...result.does_not_work.map((one) => `- ${one}`)].join('\n'),
    result.files.length === 0 ? 'Files: none.' : `Files, kept as evidence: ${kept}`,
    'Nothing of it is in the main checkout. The user may judge it before the Freeze, which keeps it with their verdict.',
  ].join('\n')

/** What a helper's session is made of, for the tools it holds. */
export interface HelperToolsAsked<Tool extends string> {
  /** The tools of its role in the role table, the tester mode's already settled. */
  readonly role: ReadonlyArray<Tool>
  /** The definition's tools, or null for a free helper. */
  readonly defined: ReadonlyArray<string> | null
  readonly depth: number
  /** Whether it is tied to a task. */
  readonly task: boolean
  readonly writes: boolean
  /** A free helper's tools as its parent chose them, or null for its role's. */
  readonly chosen: ReadonlyArray<string> | null
}

/**
 * The tools a helper's session holds, in the role table's order: its definition's or its role's
 * (a free helper's narrowed to what its parent chose), no write tool when it does not write, the
 * task tools only when it is tied to a task, the helper tools only below the depth cap, and
 * `helper_result` always.
 */
export const helperToolsOf = <Tool extends string>(
  asked: HelperToolsAsked<Tool>,
): ReadonlyArray<Tool> =>
  asked.role.filter((tool) => {
    const is = (list: ReadonlyArray<string>) => list.includes(tool)
    if (tool === 'helper_result') return true
    if (is(HELPER_TOOLS)) return asked.depth < HELPER_DEPTH
    if (is(HELPER_TASK_TOOLS)) return asked.task
    if (is(WRITING_TOOLS) && !asked.writes) return false
    if (asked.defined !== null && !is(asked.defined)) return false
    // The tester mode's tools come with the role, whatever the parent chose.
    if (tool === 'hemera_report' || tool === 'hemera_reports') return true
    return asked.chosen === null || is(asked.chosen)
  })

/** What a helper's brief is made of. */
export interface HelperBriefAsked {
  readonly label: string
  /** As the base instructions name it: `the Builder`. */
  readonly parentRole: string
  readonly missionKey: string
  readonly depth: number
  readonly brief: string
  readonly task: {
    readonly id: string
    readonly title: string
    readonly result: string
    readonly targets: ReadonlyArray<string>
    readonly scenarios: ReadonlyArray<string>
  } | null
  readonly spec: boolean
  /** Whether the Spec it reads is frozen (Building), or still being planned (Planning). */
  readonly frozen: boolean
  readonly writes: boolean
  /** Its place, in words: `the Workspace`, or its folder. */
  readonly place: string
}

/** The fields of a helper's brief, in its order. */
export const helperBriefFields = (asked: HelperBriefAsked) => [
  {
    label: `Helper ${asked.label} for ${asked.parentRole} of ${asked.missionKey} · depth ${String(asked.depth)}`,
    text: asked.brief,
  },
  {
    label: 'Task',
    text:
      asked.task === null
        ? null
        : `${asked.task.id} ${asked.task.title}: ${asked.task.result.replace(/\.$/, '')}; targets ${asked.task.targets.join(', ') || 'none'}; scenarios ${asked.task.scenarios.join(', ') || 'none'}`,
  },
  {
    label: 'Spec',
    text: !asked.spec
      ? null
      : asked.frozen
        ? 'spec_read (frozen)'
        : 'spec_read (being planned: it may still change)',
  },
  {
    label: 'Place',
    text: `You may write: ${asked.writes ? 'yes' : 'no'}; your place: ${asked.place}`,
  },
]
