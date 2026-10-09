/**
 * The rules of a mission: its stages and the moves between them, who makes each move, when its
 * Spec is frozen, what its key is made of, the marks it carries, and who has the ball.
 *
 * A mission belongs to a Project, moves through its stages in a straight line, and carries
 * everything else (blocked, waiting on someone, outdated…) as marks on its current stage, never as
 * a stage. Its type (feature, bug, maintenance) is information only: nothing here takes it.
 */

import { Match, Predicate, Result, Schema } from 'effect'

/** The stages in their order, then the final state a cancel leads to. */
export const STAGES = [
  'planning',
  'ready',
  'building',
  'review',
  'shipping',
  'done',
  'cancelled',
] as const
export const Stage = Schema.Literals(STAGES)
export type Stage = typeof Stage.Type

/** The stages a mission still lives in: every one before Done. */
export const LIVE_STAGES = ['planning', 'ready', 'building', 'review', 'shipping'] as const
export type LiveStage = (typeof LIVE_STAGES)[number]

export const isLive = (stage: Stage): stage is LiveStage =>
  LIVE_STAGES.some((live) => live === stage)

export const MISSION_TYPES = ['feature', 'bug', 'maintenance'] as const
export const MissionType = Schema.Literals(MISSION_TYPES)
export type MissionType = typeof MissionType.Type

/** Who moves a mission: the user's gestures, or Hemera at the end of its own work. */
export const Actor = Schema.Literals(['user', 'hemera'])
export type Actor = typeof Actor.Type

interface MoveRule {
  readonly from: ReadonlyArray<Stage>
  readonly to: Stage
  readonly actor: Actor
  /** The gesture, as the user knows it. */
  readonly label: string
}

export const MOVE_NAMES = [
  'freeze',
  'backToPlanning',
  'launch',
  'endBuilding',
  'fix',
  'ship',
  'complete',
  'cancel',
] as const
export const MoveName = Schema.Literals(MOVE_NAMES)
export type Move = typeof MoveName.Type

/**
 * Every move there is, and no other. There is no pause, no resume, and no Shipping → Building: a
 * CI broken after the merge is the mark `fixing` while the mission stays in Shipping.
 */
export const MOVES: Record<Move, MoveRule> = {
  freeze: { from: ['planning'], to: 'ready', actor: 'user', label: 'Freeze' },
  backToPlanning: { from: ['ready'], to: 'planning', actor: 'user', label: 'Update the Spec' },
  launch: { from: ['ready'], to: 'building', actor: 'user', label: 'Launch' },
  endBuilding: { from: ['building'], to: 'review', actor: 'hemera', label: 'End of the build' },
  fix: { from: ['review'], to: 'building', actor: 'user', label: 'Fix' },
  ship: { from: ['review'], to: 'shipping', actor: 'user', label: 'Ship' },
  complete: { from: ['shipping'], to: 'done', actor: 'hemera', label: 'Delivery complete' },
  cancel: { from: LIVE_STAGES, to: 'cancelled', actor: 'user', label: 'Cancel' },
}

/** A move was refused: from this stage, by this actor, or by what its guard found. */
export class MoveRefused extends Schema.TaggedError<MoveRefused>()('MoveRefused', {
  move: MoveName,
  stage: Stage,
  reasons: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `${MOVES[this.move].label} is refused: ${this.reasons.join('; ')}.`
  }
}

/** The move that joins two stages, or null when none does. */
export function moveBetween(from: Stage, to: Stage): Move | null {
  return MOVE_NAMES.find((move) => MOVES[move].to === to && MOVES[move].from.includes(from)) ?? null
}

/** The stage a move leads to from `stage`, refused from another stage or by another actor. */
export function checkedMove(
  move: Move,
  stage: Stage,
  actor: Actor,
): Result.Result<Stage, MoveRefused> {
  const rule = MOVES[move]
  const refused = (reason: string) =>
    Result.fail(new MoveRefused({ move, stage, reasons: [reason] }))
  if (!rule.from.includes(stage)) return refused(`the mission is in ${stage}`)
  if (rule.actor !== actor) {
    return refused(rule.actor === 'user' ? 'only the user makes it' : 'only Hemera makes it')
  }
  return Result.succeed(rule.to)
}

/** The Spec is frozen from Ready to Done; only a return to Planning unfreezes it. */
export const isFrozen = (stage: Stage): boolean =>
  stage === 'ready' ||
  stage === 'building' ||
  stage === 'review' ||
  stage === 'shipping' ||
  stage === 'done'

export class InvalidKeyPrefix extends Schema.TaggedError<InvalidKeyPrefix>()('InvalidKeyPrefix', {
  prefix: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `“${this.prefix}” cannot be a key prefix: ${this.reason}.`
  }
}

const PREFIX = /^[A-Z][A-Z0-9]{1,5}$/

/** The prefix given when a Project's name leaves nothing to make one of. */
const FALLBACK_KEY_PREFIX = 'PROJ'

/** The length of a default prefix: room is left for a digit when it is taken. */
const DEFAULT_PREFIX_LENGTH = 4

/** A Project's key prefix: 2 to 6 capitals and digits, starting with a letter. */
export function keyPrefix(candidate: string): Result.Result<string, InvalidKeyPrefix> {
  const prefix = candidate.trim().toUpperCase()
  if (PREFIX.test(prefix)) return Result.succeed(prefix)
  return Result.fail(
    new InvalidKeyPrefix({
      prefix: candidate,
      reason: '2 to 6 capitals and digits, starting with a letter',
    }),
  )
}

/**
 * The prefix a new Project is given: the first letters and digits of its name in capitals,
 * accents dropped, from its first letter on. Whether it is free is the engine's to check.
 */
export function defaultKeyPrefix(name: string): string {
  const letters = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, DEFAULT_PREFIX_LENGTH)
  return letters.length >= 2 ? letters : FALLBACK_KEY_PREFIX
}

/** A mission's key: its Project's prefix when it was created, and its number in that Project. */
export const missionKey = (prefix: string, number: number): string => `${prefix}-${String(number)}`

/** Another mission this one depends on. */
export const Dependency = Schema.TaggedStruct('Dependency', { missionKey: Schema.String })
/** An exclusive resource another mission holds. */
export const Resource = Schema.TaggedStruct('Resource', {
  name: Schema.String,
  heldBy: Schema.String,
})

/** What blocks a mission: another mission it depends on, or a resource another mission holds. */
export const BlockedCause = Schema.Union([Dependency, Resource])
export type BlockedCause = typeof BlockedCause.Type

/** Why a mission is outdated: what moved since its Spec was written. */
export const OutdatedReason = Schema.Literals([
  'ticket-changed',
  'target-moved',
  'dependency-merged',
  'dependency-cancelled',
])
export type OutdatedReason = typeof OutdatedReason.Type

export const BlockedMark = Schema.TaggedStruct('Blocked', { cause: BlockedCause })
/** A Planning question waits on someone other than the user. */
export const WaitingOnSomeoneMark = Schema.TaggedStruct('WaitingOnSomeone', {
  question: Schema.String,
  note: Schema.NullOr(Schema.String),
})
/** Information only: nothing forces a return to Planning. */
export const OutdatedMark = Schema.TaggedStruct('Outdated', {
  reason: OutdatedReason,
  /** Where the difference can be read. */
  reference: Schema.String,
  /** What moved, as the user is shown it. */
  difference: Schema.String,
})
export const ChangedOutsideMark = Schema.TaggedStruct('ChangedOutside', {
  repositoryId: Schema.String,
})
/** A CI broken after the merge is being fixed; in Shipping only. */
export const FixingMark = Schema.TaggedStruct('Fixing', {})

/**
 * The marks a mission carries on its current stage. "Needs you" is not one of them: it is derived
 * from the pending needs the mission owns, never set.
 */
export const Mark = Schema.Union([
  BlockedMark,
  WaitingOnSomeoneMark,
  OutdatedMark,
  ChangedOutsideMark,
  FixingMark,
])
export type Mark = typeof Mark.Type

const causeIdentity = Match.type<BlockedCause>().pipe(
  Match.tagsExhaustive({
    Dependency: (cause) => `dependency:${cause.missionKey}`,
    Resource: (cause) => `resource:${cause.name}`,
  }),
)

/** What makes two marks the same one: setting it again changes nothing. */
export const markIdentity = Match.type<Mark>().pipe(
  Match.tagsExhaustive({
    Blocked: (mark) => `blocked:${causeIdentity(mark.cause)}`,
    WaitingOnSomeone: (mark) => `waiting-on-someone:${mark.question}`,
    Outdated: (mark) => `outdated:${mark.reason}:${mark.reference}`,
    ChangedOutside: (mark) => `changed-outside:${mark.repositoryId}`,
    Fixing: () => 'fixing',
  }),
)

const causeSentence = Match.type<BlockedCause>().pipe(
  Match.tagsExhaustive({
    Dependency: (cause) => cause.missionKey,
    Resource: (cause) => `${cause.name} · ${cause.heldBy}`,
  }),
)

/** A mark, as the interface says it. */
export const markSentence = Match.type<Mark>().pipe(
  Match.tagsExhaustive({
    Blocked: (mark) => `blocked by ${causeSentence(mark.cause)}`,
    WaitingOnSomeone: () => 'waiting on someone',
    Outdated: () => 'outdated',
    ChangedOutside: () => 'Changed outside Hemera',
    Fixing: () => 'fixing',
  }),
)

export const AgentWorking = Schema.TaggedStruct('AgentWorking', {})
export const WaitingOnYou = Schema.TaggedStruct('WaitingOnYou', {})
export const WaitingOnSomeone = Schema.TaggedStruct('WaitingOnSomeone', {})
export const Blocked = Schema.TaggedStruct('Blocked', { causes: Schema.Array(BlockedCause) })
export const Idle = Schema.TaggedStruct('Idle', {})

/** Who has the ball: the key indicator of a mission. Done and Cancelled have none. */
export const Ball = Schema.Union([AgentWorking, WaitingOnYou, WaitingOnSomeone, Blocked, Idle])
export type Ball = typeof Ball.Type

/**
 * Who has the ball in Review and Shipping when no need waits and no session works (open question
 * 49; its recommended default, in a table so the answer can change without touching a caller).
 * A stage that is not in the table leaves it to the marks, then to idle.
 */
export const STAGE_BALL: Partial<Record<LiveStage, Ball>> = {
  review: WaitingOnYou.make({}),
  shipping: WaitingOnSomeone.make({}),
}

export interface BallInputs {
  readonly stage: Stage
  /** The needs the mission owns that wait on the user. */
  readonly pendingNeeds: number
  /** Whether a session of the mission is working now. */
  readonly sessionWorking: boolean
  /** Whether a Planning question waits on the user. */
  readonly questionWaiting: boolean
  readonly marks: ReadonlyArray<Mark>
}

/**
 * Who has the ball: waiting on you when a need or a question waits, else agent working when a
 * session works; otherwise the stage's own answer when the table has one, else waiting on someone,
 * blocked and idle, in that order.
 */
export function ballOf(inputs: BallInputs): Ball | null {
  const { stage } = inputs
  if (!isLive(stage)) return null
  if (inputs.pendingNeeds > 0 || inputs.questionWaiting) return WaitingOnYou.make({})
  if (inputs.sessionWorking) return AgentWorking.make({})
  const staged = STAGE_BALL[stage]
  if (staged !== undefined) return staged
  if (inputs.marks.some(Predicate.isTagged('WaitingOnSomeone'))) return WaitingOnSomeone.make({})
  const causes = inputs.marks.flatMap((mark) =>
    Predicate.isTagged(mark, 'Blocked') ? [mark.cause] : [],
  )
  if (causes.length > 0) return Blocked.make({ causes })
  return Idle.make({})
}
