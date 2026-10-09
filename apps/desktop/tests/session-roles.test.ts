/**
 * The registry of the roles a session can hold: each role's fields, the `test` role the suites
 * register, and CT-06 — a role that does not read the Memory is handed no Memory tool.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  MEMORY_TOOLS,
  ROLES_REGISTERED,
  type RoleEntry,
  memoryContractBroken,
  roleNamed,
} from '../src/engine/sessions/roles.ts'
import { TEST_ROLE } from './test-role.ts'

const shaped = (id: string, readsMemory: boolean): RoleEntry => ({
  ...TEST_ROLE,
  id,
  displayName: id,
  readsMemory,
})

describe('The role registry', () => {
  test('the test role has every field a role ticket fills', () => {
    expect(TEST_ROLE).toMatchObject({
      id: 'test',
      displayName: 'the test role',
      ownerKind: 'mission',
      placeKind: 'workspace',
      writes: true,
      readsMemory: true,
      projectLayer: true,
      mainOf: null,
      countsInCap: true,
    })
    expect(roleNamed([TEST_ROLE], 'test')).toBe(TEST_ROLE)
    expect(roleNamed([TEST_ROLE], 'planner')).toBeUndefined()
  })

  test('the Memory tools are memory_read and every tool that writes the Memory, its Spec and questions included', () => {
    expect([...MEMORY_TOOLS].sort()).toEqual(
      [
        'evidence_add',
        'journal_add',
        'memory_read',
        'note_add',
        'notes_condense',
        'now_set',
        'spec_write_section',
        'requirement_write',
        'requirement_remove',
        'mission_describe',
        'triage_answer',
        'declare_complete',
        'ask_wave',
        'question_retire',
        'question_draft_message',
        'input_integrated',
        'probe_launch',
        'probe_report',
        'proof_write',
        'tasks_write',
        'model_recommend',
        'discussion_reply',
        'discussion_propose_decision',
        'cold_read_fixed',
      ].sort(),
    )
  })
})

describe('The roles this version ships', () => {
  test('the test role is not one of them: only the suites register it', () => {
    expect(ROLES_REGISTERED.map((role) => role.id)).not.toContain('test')
  })
})

describe('A role that does not read the Memory has no Memory tool (CT-06)', () => {
  test('the registry as this version ships it keeps the contract', () => {
    expect(memoryContractBroken([...ROLES_REGISTERED, TEST_ROLE])).toEqual([])
  })

  test('the cold read and the reviewers, registered as not reading the Memory, keep it', () => {
    const roles = ['cold-read', 'spec-reviewer', 'code-reviewer'].map((id) => shaped(id, false))
    expect(memoryContractBroken(roles)).toEqual([])
  })

  test('a role registered as not reading the Memory while its tools write or read it fails', () => {
    expect(memoryContractBroken([shaped('builder', false)])).toEqual([
      'builder does not read the Memory but has memory_read, now_set, journal_add, note_add, notes_condense, evidence_add',
    ])
  })
})
