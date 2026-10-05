/**
 * The rules of a mission that need no storage: which moves exist between its stages and who
 * makes them, when its Spec is frozen, what a key prefix may be, what a mark carries, and who has
 * the ball.
 */

import { Result, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  AgentWorking,
  type Ball,
  type BallInputs,
  Blocked,
  BlockedMark,
  ChangedOutsideMark,
  Dependency,
  Idle,
  InvalidKeyPrefix,
  LIVE_STAGES,
  MOVES,
  Mark,
  type Move,
  MoveRefused,
  Resource,
  STAGES,
  STAGE_BALL,
  type Stage,
  WaitingOnSomeone,
  WaitingOnSomeoneMark,
  WaitingOnYou,
  ballOf,
  checkedMove,
  defaultKeyPrefix,
  isFrozen,
  keyPrefix,
  markSentence,
  missionKey,
  moveBetween,
} from '../src/domain/index.ts'

const refusal = <A, E>(result: Result.Result<A, E>): E | undefined =>
  Result.isFailure(result) ? result.failure : undefined
const value = <A, E>(result: Result.Result<A, E>): A | undefined =>
  Result.isSuccess(result) ? result.success : undefined

/** Every move the stages allow, written out once more by hand: the table the test holds them to. */
const ALLOWED: ReadonlyArray<readonly [Stage, Stage, Move]> = [
  ['planning', 'ready', 'freeze'],
  ['ready', 'planning', 'backToPlanning'],
  ['ready', 'building', 'launch'],
  ['building', 'review', 'endBuilding'],
  ['review', 'building', 'fix'],
  ['review', 'shipping', 'ship'],
  ['shipping', 'done', 'complete'],
  ['planning', 'cancelled', 'cancel'],
  ['ready', 'cancelled', 'cancel'],
  ['building', 'cancelled', 'cancel'],
  ['review', 'cancelled', 'cancel'],
  ['shipping', 'cancelled', 'cancel'],
]

describe('The stages form a straight line, and only the listed moves join them', () => {
  for (const from of STAGES) {
    for (const to of STAGES) {
      const allowed = ALLOWED.find(([a, b]) => a === from && b === to)
      test(`${from} → ${to} is ${allowed === undefined ? 'refused' : allowed[2]}`, () => {
        expect(moveBetween(from, to)).toBe(allowed?.[2] ?? null)
      })
    }
  }

  test('there is no Shipping → Building move: a broken CI is a mark, not a stage', () => {
    expect(moveBetween('shipping', 'building')).toBeNull()
  })

  test('Cancelled is final: no move leaves it', () => {
    for (const to of STAGES) expect(moveBetween('cancelled', to)).toBeNull()
  })

  test('a move from a stage it does not leave is refused, naming the move', () => {
    const refused = refusal(checkedMove('ship', 'planning', 'user'))
    expect(refused).toBeInstanceOf(MoveRefused)
    expect(refused?.move).toBe('ship')
    expect(refused?.message).toMatch(/Ship/)
  })

  test('Cancel is allowed at every stage before Done, and nowhere after', () => {
    for (const stage of LIVE_STAGES) {
      expect(value(checkedMove('cancel', stage, 'user'))).toBe('cancelled')
    }
    expect(refusal(checkedMove('cancel', 'done', 'user'))).toBeInstanceOf(MoveRefused)
    expect(refusal(checkedMove('cancel', 'cancelled', 'user'))).toBeInstanceOf(MoveRefused)
  })
})

describe('Each move has its actor, and no other may make it', () => {
  const human: ReadonlyArray<Move> = ['freeze', 'backToPlanning', 'launch', 'fix', 'ship', 'cancel']

  test('the human moves are the user’s, and Hemera’s are Hemera’s', () => {
    for (const move of human) expect(MOVES[move].actor).toBe('user')
    expect(MOVES.endBuilding.actor).toBe('hemera')
    expect(MOVES.complete.actor).toBe('hemera')
  })

  test('a human move made by Hemera is refused', () => {
    for (const move of human) {
      const from = ALLOWED.find(([, , one]) => one === move)?.[0] ?? 'planning'
      expect(refusal(checkedMove(move, from, 'hemera'))).toBeInstanceOf(MoveRefused)
    }
  })

  test('a move of Hemera’s made by the user is refused', () => {
    expect(refusal(checkedMove('endBuilding', 'building', 'user'))).toBeInstanceOf(MoveRefused)
    expect(refusal(checkedMove('complete', 'shipping', 'user'))).toBeInstanceOf(MoveRefused)
  })
})

describe('The Spec is frozen from Ready to Done', () => {
  test('frozen in Ready, Building, Review, Shipping and Done, and not otherwise', () => {
    expect(STAGES.filter(isFrozen)).toEqual(['ready', 'building', 'review', 'shipping', 'done'])
  })
})

describe('A key prefix is 2 to 6 capitals and digits, starting with a letter', () => {
  test('a prefix is kept in capitals, without the spaces around it', () => {
    expect(value(keyPrefix(' acme '))).toBe('ACME')
    expect(value(keyPrefix('A1'))).toBe('A1')
    expect(value(keyPrefix('ABCDEF'))).toBe('ABCDEF')
  })

  test('too short, too long, a leading digit or another character is refused', () => {
    for (const candidate of ['', 'A', 'ABCDEFG', '1ACME', 'AC-ME', 'ÉTÉ']) {
      expect(refusal(keyPrefix(candidate))).toBeInstanceOf(InvalidKeyPrefix)
    }
  })

  test('a new Project’s default prefix comes from its name and is always a valid one', () => {
    expect(defaultKeyPrefix('Acme')).toBe('ACME')
    expect(defaultKeyPrefix('Hemera')).toBe('HEME')
    expect(defaultKeyPrefix('été 2026')).toBe('ETE2')
    expect(defaultKeyPrefix('42 shared tools')).toBe('SHAR')
    for (const name of ['x', '1', '—', '']) {
      expect(Result.isSuccess(keyPrefix(defaultKeyPrefix(name)))).toBe(true)
    }
  })

  test('a key is the prefix, a dash and the number', () => {
    expect(missionKey('ACME', 12)).toBe('ACME-12')
  })
})

describe('A mark carries what it needs, and says it in a sentence', () => {
  /** A mark as it would arrive from outside: text, not a value the type checker vouched for. */
  const decode = Schema.decodeUnknownResult(Schema.fromJsonString(Mark))

  test('a blocked mark without a cause is refused', () => {
    expect(Result.isFailure(decode('{"_tag":"Blocked"}'))).toBe(true)
    expect(Result.isFailure(decode('{"_tag":"Blocked","cause":{}}'))).toBe(true)
    expect(
      Result.isSuccess(
        decode('{"_tag":"Blocked","cause":{"_tag":"Dependency","missionKey":"ACME-11"}}'),
      ),
    ).toBe(true)
  })

  test('a blocked mark names its dependency, or its resource and who holds it', () => {
    expect(
      markSentence(BlockedMark.make({ cause: Dependency.make({ missionKey: 'ACME-11' }) })),
    ).toBe('blocked by ACME-11')
    expect(
      markSentence(
        BlockedMark.make({
          cause: Resource.make({ name: 'shared database', heldBy: 'ACME-11' }),
        }),
      ),
    ).toBe('blocked by shared database · ACME-11')
  })

  test('a repository changed outside Hemera is said in plain words', () => {
    expect(markSentence(ChangedOutsideMark.make({ repositoryId: 'api' }))).toBe(
      'Changed outside Hemera',
    )
  })
})

describe('Who has the ball', () => {
  const ON_ACME_11 = Dependency.make({ missionKey: 'ACME-11' })
  const blocked = BlockedMark.make({ cause: ON_ACME_11 })
  const waiting = WaitingOnSomeoneMark.make({ question: 'Which region?', note: null })

  const quiet: Omit<BallInputs, 'stage'> = {
    pendingNeeds: 0,
    sessionWorking: false,
    questionWaiting: false,
    marks: [],
  }

  test('Done and Cancelled have no ball, whatever else holds', () => {
    for (const stage of ['done', 'cancelled'] as const) {
      expect(
        ballOf({
          stage,
          pendingNeeds: 2,
          sessionWorking: true,
          questionWaiting: true,
          marks: [blocked],
        }),
      ).toBeNull()
    }
  })

  test('with nothing going on: idle before Review, waiting on you in Review, on someone in Shipping', () => {
    expect(ballOf({ ...quiet, stage: 'planning' })).toEqual(Idle.make({}))
    expect(ballOf({ ...quiet, stage: 'ready' })).toEqual(Idle.make({}))
    expect(ballOf({ ...quiet, stage: 'building' })).toEqual(Idle.make({}))
    expect(ballOf({ ...quiet, stage: 'review' })).toEqual(WaitingOnYou.make({}))
    expect(ballOf({ ...quiet, stage: 'shipping' })).toEqual(WaitingOnSomeone.make({}))
  })

  test('a blocked mission names its causes', () => {
    const ball = ballOf({ ...quiet, stage: 'ready', marks: [blocked] })
    expect(ball).toEqual(Blocked.make({ causes: [ON_ACME_11] }))
  })

  /**
   * Every combination of the inputs on every live stage: waiting on you, then agent working; then
   * the stage's own answer in Review and Shipping; elsewhere waiting on someone, blocked, idle.
   */
  const flags = [false, true] as const
  for (const stage of LIVE_STAGES) {
    for (const need of flags) {
      for (const question of flags) {
        for (const working of flags) {
          for (const someone of flags) {
            for (const isBlocked of flags) {
              const inputs: BallInputs = {
                stage,
                pendingNeeds: need ? 1 : 0,
                questionWaiting: question,
                sessionWorking: working,
                marks: [...(someone ? [waiting] : []), ...(isBlocked ? [blocked] : [])],
              }
              // The table's own answers are held by the test of a quiet mission above.
              const staged = STAGE_BALL[stage] ?? null
              const expected: Ball | null =
                need || question
                  ? WaitingOnYou.make({})
                  : working
                    ? AgentWorking.make({})
                    : staged !== null
                      ? staged
                      : someone
                        ? WaitingOnSomeone.make({})
                        : isBlocked
                          ? Blocked.make({ causes: [ON_ACME_11] })
                          : Idle.make({})
              const name = `${stage}, need ${String(need)}, question ${String(question)}, working ${String(working)}, someone ${String(someone)}, blocked ${String(isBlocked)}`
              test(name, () => {
                expect(ballOf(inputs)).toEqual(expected)
              })
            }
          }
        }
      }
    }
  }
})
