/**
 * The rules of a need: the single place where anything that blocks waits on a human.
 *
 * A need belongs to the application (Git missing), to a Project (an unreadable repository, a
 * Chat's permission) or to a mission, and then optionally to one of its tasks; it blocks that task,
 * never the whole mission. It is of one of four kinds, each with its own fields and its own way of
 * being answered, and it lives `pending` until it is answered, expires, or is withdrawn by its
 * owner. An answer applies once.
 */

import { Match, Predicate, Result, Schema } from 'effect'

/** What is missing, the action to take, and the settings section that takes it, if one does. */
export const EnvironmentFields = Schema.TaggedStruct('Environment', {
  missing: Schema.String,
  action: Schema.String,
  /** The id of an app setting section (`models`, `agents`…), opened by the need. */
  settingsSection: Schema.NullOr(Schema.String),
})

/** The question, its options, and the option recommended with its reason. */
export const DecisionFields = Schema.TaggedStruct('Decision', {
  question: Schema.String,
  options: Schema.Array(Schema.String),
  recommended: Schema.NullOr(Schema.Struct({ option: Schema.String, reason: Schema.String })),
})

/** One attempt at what failed, with what it printed. */
export const Attempt = Schema.Struct({ what: Schema.String, output: Schema.String })

/** What failed, every attempt made, and what is proposed now. */
export const ErrorFields = Schema.TaggedStruct('Error', {
  failed: Schema.String,
  attempts: Schema.Array(Attempt),
  proposals: Schema.Array(Schema.String),
})

/** The call asked for, the agent's reason, and Hemera's: why Hemera asks rather than lets it by. */
export const PermissionFields = Schema.TaggedStruct('Permission', {
  call: Schema.String,
  agentReason: Schema.String,
  /** "outside the Workspace: ~/.ssh/config", "sensitive place: ~/.ssh", "risk 2.9". */
  hemeraReason: Schema.String,
  /** The call touches a sensitive place: it is never allowed for the whole mission. */
  sensitive: Schema.Boolean,
  /** The id of an app setting section (`hemera-auto`) that would settle such calls, if one would. */
  settingsSection: Schema.optionalKey(Schema.String),
  /** The call in words: "Write tests/cli/install.test.ts in its Probe folder", "Run git status". */
  asked: Schema.optionalKey(Schema.String),
  /** The session of the agent that asks, which groups its requests together. */
  agent: Schema.optionalKey(Schema.String),
})

export const NeedFields = Schema.Union([
  EnvironmentFields,
  DecisionFields,
  ErrorFields,
  PermissionFields,
])
export type NeedFields = typeof NeedFields.Type
export type NeedKind = NeedFields['_tag']

export const NEED_STATES = ['pending', 'answered', 'expired', 'withdrawn'] as const
export const NeedState = Schema.Literals(NEED_STATES)
export type NeedState = typeof NeedState.Type

export const ApplicationOwner = Schema.TaggedStruct('Application', {})
export const ProjectOwner = Schema.TaggedStruct('Project', { projectId: Schema.String })
export const MissionOwner = Schema.TaggedStruct('Mission', {
  projectId: Schema.String,
  missionId: Schema.String,
  /** The task it blocks, when it blocks one. */
  taskId: Schema.NullOr(Schema.String),
})

/** Whom a need belongs to. */
export const NeedOwner = Schema.Union([ApplicationOwner, ProjectOwner, MissionOwner])
export type NeedOwner = typeof NeedOwner.Type

export const PERMISSION_CHOICES = ['allow-once', 'allow-for-mission', 'deny'] as const
export const PermissionChoice = Schema.Literals(PERMISSION_CHOICES)
export type PermissionChoice = typeof PermissionChoice.Type

/**
 * The choices a permission need offers. Allow for this mission is never offered on a sensitive
 * place, nor when no mission owns the need.
 */
export function permissionChoices(asked: {
  readonly ownedByMission: boolean
  readonly sensitive: boolean
}): ReadonlyArray<PermissionChoice> {
  return asked.ownedByMission && !asked.sensitive ? PERMISSION_CHOICES : ['allow-once', 'deny']
}

/**
 * How a need is answered: one of the options or proposals it offers, an answer of one's own to a
 * decision, or a choice on a permission. An environment need is not answered: it is retried.
 */
export const ChosenAnswer = Schema.TaggedStruct('Chosen', { option: Schema.String })
export const WrittenAnswer = Schema.TaggedStruct('Written', { text: Schema.String })
export const PermissionAnswer = Schema.TaggedStruct('Permission', { choice: PermissionChoice })
export const NeedAnswer = Schema.Union([ChosenAnswer, WrittenAnswer, PermissionAnswer])
export type NeedAnswer = typeof NeedAnswer.Type

export class NeedAnswerRefused extends Schema.TaggedError<NeedAnswerRefused>()(
  'NeedAnswerRefused',
  { reason: Schema.String },
) {
  override get message(): string {
    return `This answer is refused: ${this.reason}.`
  }
}

type Fitting = Result.Result<NeedAnswer, NeedAnswerRefused>

const refused = (reason: string): Fitting => Result.fail(new NeedAnswerRefused({ reason }))

/** The answer, when it is one the need offers; refused with its reason otherwise. */
export function fittingAnswer(fields: NeedFields, owner: NeedOwner, answer: NeedAnswer): Fitting {
  const chosenAmong = (offered: ReadonlyArray<string>, refusal: string): Fitting =>
    Predicate.isTagged(answer, 'Chosen') && offered.includes(answer.option)
      ? Result.succeed(answer)
      : refused(refusal)
  return Match.value(fields).pipe(
    Match.tagsExhaustive({
      Environment: () => refused('it is answered by Retry'),
      Decision: (decision): Fitting => {
        if (!Predicate.isTagged(answer, 'Written')) {
          return chosenAmong(decision.options, 'it is not one of the options')
        }
        const text = answer.text.trim()
        return text === '' ? refused('it is empty') : Result.succeed(WrittenAnswer.make({ text }))
      },
      Error: (error) => chosenAmong(error.proposals, 'it is not one of the proposals'),
      Permission: (permission): Fitting =>
        Predicate.isTagged(answer, 'Permission') &&
        permissionChoices({
          ownedByMission: Predicate.isTagged(owner, 'Mission'),
          sensitive: permission.sensitive,
        }).includes(answer.choice)
          ? Result.succeed(answer)
          : refused('it is not one of the choices offered'),
    }),
  )
}

/** The longest text an agent may put in one field of a need it asks for. */
export const MAX_REQUESTED_TEXT = 2000
/** The most options an agent may offer in a decision, and the longest one. */
export const MAX_REQUESTED_OPTIONS = 10
export const MAX_REQUESTED_OPTION = 200

const bounded = (length: number) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(length))

/**
 * What an agent may ask for, bounded: the fields of a decision or of an environment need, and
 * nothing else. Its owner, its state and its answer are Hemera's to write, never the agent's.
 */
export const RequestedEnvironment = Schema.Struct({
  missing: bounded(MAX_REQUESTED_TEXT),
  action: bounded(MAX_REQUESTED_TEXT),
  settingsSection: Schema.NullOr(bounded(MAX_REQUESTED_OPTION)),
})

export const RequestedDecision = Schema.Struct({
  question: bounded(MAX_REQUESTED_TEXT),
  options: Schema.Array(bounded(MAX_REQUESTED_OPTION)).check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(MAX_REQUESTED_OPTIONS),
  ),
  recommended: Schema.NullOr(
    Schema.Struct({
      option: bounded(MAX_REQUESTED_OPTION),
      reason: bounded(MAX_REQUESTED_TEXT),
    }),
  ),
})
