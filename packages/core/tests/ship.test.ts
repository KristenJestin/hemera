/**
 * Ship's guard as one pure rule (R9): every reason Ship is refused now, each in words naming what it
 * is about, all of them at once. Ported from `hemera-legacy`'s `roundAcceptRefusal` (the stale
 * refusal is gone: a change made outside Hemera never blocks Ship).
 */

import { describe, expect, test } from 'vite-plus/test'

import { SHIP_CHANGED, type ShipStanding, shipMovedSaid, shipRefusals } from '../src/domain/ship.ts'

/** A mission in Review with nothing against Ship. */
const clear: ShipStanding = {
  stage: 'review',
  round: 0,
  rounds: [{ number: 1, state: 'collecting' }],
  feedback: [],
  redChecks: [],
  needs: [],
  approvals: [],
}

describe('Ship is refused, every reason named', () => {
  test('a mission in Review with nothing waiting may be shipped', () => {
    expect(shipRefusals(clear)).toEqual([])
  })

  test('a waiting remark refuses Ship, counted', () => {
    expect(shipRefusals({ ...clear, feedback: [{ kind: 'remark', state: 'waiting' }] })).toEqual([
      '1 remark waits for a fix.',
    ])
    expect(
      shipRefusals({
        ...clear,
        feedback: [
          { kind: 'remark', state: 'waiting' },
          { kind: 'code', state: 'waiting' },
        ],
      }),
    ).toEqual(['2 remarks wait for a fix.'])
  })

  test('only a question waiting, a withdrawn remark or an addressed one does not refuse Ship', () => {
    expect(
      shipRefusals({
        ...clear,
        feedback: [
          { kind: 'question', state: 'waiting' },
          { kind: 'remark', state: 'withdrawn' },
          { kind: 'code', state: 'addressed' },
        ],
      }),
    ).toEqual([])
  })

  test('a round being grilled or built refuses Ship; an answered one does not', () => {
    expect(
      shipRefusals({
        ...clear,
        rounds: [
          { number: 1, state: 'answered' },
          { number: 2, state: 'grilling' },
        ],
      }),
    ).toEqual(['Round 2 is being worked on.'])
    expect(shipRefusals({ ...clear, rounds: [{ number: 3, state: 'building' }] })).toEqual([
      'Round 3 is being worked on.',
    ])
    expect(shipRefusals({ ...clear, rounds: [{ number: 1, state: 'answered' }] })).toEqual([])
  })

  test('a red final check refuses Ship, naming the check and where it ran', () => {
    expect(
      shipRefusals({
        ...clear,
        redChecks: [
          { name: 'test', place: 'api' },
          { name: 'lint', place: '' },
        ],
      }),
    ).toEqual(['The final check `test` is red in api.', 'The final check `lint` is red.'])
  })

  test('an open need and a pending permission request each refuse Ship, in their words', () => {
    expect(
      shipRefusals({
        ...clear,
        needs: [
          { kind: 'Decision', said: 'Push and open the pull requests for api?' },
          { kind: 'Permission', said: 'Run git status' },
          { kind: 'Error', said: 'The delivery of api failed.' },
          { kind: 'Environment', said: 'gh is not signed in' },
        ],
      }),
    ).toEqual([
      'A decision waits for you: Push and open the pull requests for api?',
      'A permission request waits for you: Run git status',
      'An error waits for you: The delivery of api failed.',
      'Something to set up waits for you: gh is not signed in',
    ])
  })

  test('a missing team approval refuses Ship when the rules require it', () => {
    expect(
      shipRefusals({
        ...clear,
        approvals: [
          { repository: 'web', pullRequest: true, approved: false },
          { repository: 'api', pullRequest: true, approved: true },
          { repository: 'docs', pullRequest: false, approved: false },
        ],
      }),
    ).toEqual([
      'web’s pull request has no approval yet.',
      'docs has no pull request to approve yet.',
    ])
  })

  test('every reason is answered together, not the first alone', () => {
    expect(
      shipRefusals({
        ...clear,
        rounds: [
          { number: 1, state: 'answered' },
          { number: 2, state: 'collecting' },
        ],
        feedback: [{ kind: 'remark', state: 'waiting' }],
        redChecks: [{ name: 'test', place: 'api' }],
        needs: [{ kind: 'Decision', said: 'Which one?' }],
        approvals: [{ repository: 'web', pullRequest: true, approved: false }],
      }),
    ).toEqual([
      '1 remark waits for a fix.',
      'The final check `test` is red in api.',
      'A decision waits for you: Which one?',
      'web’s pull request has no approval yet.',
    ])
  })

  test('Ship is offered in Review only, never in Building · round N', () => {
    expect(shipRefusals({ ...clear, stage: 'building', round: 2 })).toEqual([
      'Ship is offered in Review: the mission is in Building · round 2.',
    ])
    expect(shipRefusals({ ...clear, stage: 'shipping' })).toEqual([
      'Ship is offered in Review: the mission is in Shipping.',
    ])
  })
})

describe('What Ship says when it stops', () => {
  test('a preview that no longer holds, and a repository that moved during the reruns', () => {
    expect(SHIP_CHANGED).toBe('Something changed since you opened Ship: look again.')
    expect(shipMovedSaid('api')).toBe('api changed while Ship was checking it.')
  })
})
