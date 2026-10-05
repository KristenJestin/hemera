/**
 * What answers a need, by kind, and what an agent may ask for.
 */

import { Result, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  ChosenAnswer,
  DecisionFields,
  EnvironmentFields,
  ErrorFields,
  MAX_REQUESTED_OPTIONS,
  MAX_REQUESTED_TEXT,
  type NeedFields,
  MissionOwner,
  NeedAnswerRefused,
  PermissionAnswer,
  PermissionFields,
  ProjectOwner,
  RequestedDecision,
  RequestedEnvironment,
  WrittenAnswer,
  fittingAnswer,
  permissionChoices,
} from '../src/domain/index.ts'

const MISSION = MissionOwner.make({ projectId: 'acme', missionId: 'm', taskId: null })
const PROJECT = ProjectOwner.make({ projectId: 'acme' })

const DECISION: NeedFields = DecisionFields.make({
  question: 'Which table holds the invoices?',
  options: ['invoices', 'billing_invoices'],
  recommended: { option: 'invoices', reason: 'the api already reads it' },
})
const chosen = (option: string) => ChosenAnswer.make({ option })
const written = (text: string) => WrittenAnswer.make({ text })

const refused = <A, E>(result: Result.Result<A, E>): boolean =>
  Result.isFailure(result) && result.failure instanceof NeedAnswerRefused

describe('An answer fits the need it answers', () => {
  test('a decision takes one of its options, or an answer in words', () => {
    expect(Result.isSuccess(fittingAnswer(DECISION, MISSION, chosen('invoices')))).toBe(true)
    expect(Result.isSuccess(fittingAnswer(DECISION, MISSION, written('both')))).toBe(true)
    expect(refused(fittingAnswer(DECISION, MISSION, chosen('other')))).toBe(true)
    expect(refused(fittingAnswer(DECISION, MISSION, written('  ')))).toBe(true)
  })

  test('an error takes one of its proposals only', () => {
    const error = ErrorFields.make({
      failed: 'the migration test',
      attempts: [],
      proposals: ['Skip the test', 'Stop the task'],
    })
    expect(Result.isSuccess(fittingAnswer(error, MISSION, chosen('Skip the test')))).toBe(true)
    expect(refused(fittingAnswer(error, MISSION, written('try again')))).toBe(true)
  })

  test('an environment need is retried, never answered', () => {
    const environment = EnvironmentFields.make({
      missing: 'Docker is not running',
      action: 'Start Docker',
      settingsSection: null,
    })
    expect(refused(fittingAnswer(environment, MISSION, chosen('x')))).toBe(true)
  })

  test('Allow for this mission is refused where it is not offered', () => {
    const permission = (sensitive: boolean) =>
      PermissionFields.make({
        call: 'cat ~/.ssh/config',
        agentReason: 'read the deploy host',
        hemeraReason: 'sensitive place: ~/.ssh',
        sensitive,
      })
    const forMission = PermissionAnswer.make({ choice: 'allow-for-mission' })
    expect(Result.isSuccess(fittingAnswer(permission(false), MISSION, forMission))).toBe(true)
    expect(refused(fittingAnswer(permission(true), MISSION, forMission))).toBe(true)
    expect(refused(fittingAnswer(permission(false), PROJECT, forMission))).toBe(true)
  })
})

describe('What an agent may ask for is bounded', () => {
  /** What an agent sends is text it wrote, not a value the type checker vouched for. */
  const decision = (json: string) =>
    Schema.decodeUnknownResult(Schema.fromJsonString(RequestedDecision))(json, {
      onExcessProperty: 'error',
    })
  const fields = (more: string) => `{"question":"q","options":["a"],"recommended":null${more}}`

  test('a field Hemera writes itself is refused', () => {
    expect(Result.isSuccess(decision(fields('')))).toBe(true)
    expect(Result.isFailure(decision(fields(',"state":"answered"')))).toBe(true)
    expect(Result.isFailure(decision(fields(',"_tag":"Error"')))).toBe(true)
  })

  test('a text past its bound, no option, or too many options, is refused', () => {
    const long = JSON.stringify('q'.repeat(MAX_REQUESTED_TEXT + 1))
    expect(
      Result.isFailure(decision(`{"question":${long},"options":["a"],"recommended":null}`)),
    ).toBe(true)
    expect(Result.isFailure(decision('{"question":"q","options":[],"recommended":null}'))).toBe(
      true,
    )
    const many = JSON.stringify(Array.from({ length: MAX_REQUESTED_OPTIONS + 1 }, String))
    expect(
      Result.isFailure(decision(`{"question":"q","options":${many},"recommended":null}`)),
    ).toBe(true)
  })

  test('an environment need names what is missing and the action to take', () => {
    const environment = Schema.decodeUnknownResult(Schema.fromJsonString(RequestedEnvironment))
    expect(
      Result.isSuccess(
        environment('{"missing":"Docker","action":"Start it","settingsSection":null}'),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(environment('{"missing":"","action":"x","settingsSection":null}')),
    ).toBe(true)
  })
})

describe('A permission need offers Allow for this mission only where it may', () => {
  test('a mission’s need on an ordinary place offers the three choices', () => {
    expect(permissionChoices({ ownedByMission: true, sensitive: false })).toEqual([
      'allow-once',
      'allow-for-mission',
      'deny',
    ])
  })

  test('a sensitive place, or a need no mission owns, offers Allow once and Deny only', () => {
    expect(permissionChoices({ ownedByMission: true, sensitive: true })).toEqual([
      'allow-once',
      'deny',
    ])
    expect(permissionChoices({ ownedByMission: false, sensitive: false })).toEqual([
      'allow-once',
      'deny',
    ])
  })
})
