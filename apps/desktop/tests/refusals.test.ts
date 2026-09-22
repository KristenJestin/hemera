/**
 * What a refusal says when it crosses the port to the window (design D3-02, D5-12).
 *
 * Every use case of this process answers a value or a refusal, and the refusal is shown to
 * whoever asked: under the field they were filling, in the composer, over the thread. An Effect
 * error carries a tag and a few fields and no message of its own, so a refusal nobody wrote a
 * sentence for used to cross as `StaleVersionError {"entity":"session","expected":1}` — a shape,
 * and not an answer. This suite is about the sentence: each refusal of the engine has one, and
 * what goes on the wire is never the JSON of an error.
 */

import { describe, expect, test } from 'vite-plus/test'

import { AgentNotInstalledError } from '#engine/agents/discovery.ts'
import { AgentRuntimeError } from '#engine/agents/runtime.ts'
import { AgentUpdateRefusedError } from '#engine/agents/service.ts'
import { AgentSpawnError } from '#engine/agents/supervisor.ts'
import { UnknownHeldAgentError } from '#engine/agents/pool.ts'
import { named } from '#engine/index.ts'
import { UnknownSessionError } from '#engine/sessions.ts'
import { DatabaseError } from '#engine/storage/database.ts'
import { StaleVersionError } from '#engine/transaction.ts'

/** Every refusal this process can answer with, as one of each. */
const REFUSALS: readonly Error[] = [
  new StaleVersionError({ entity: 'session', id: 'session-1', expected: 1 }),
  new StaleVersionError({ entity: 'project', id: 'project-1', expected: 3 }),
  new DatabaseError({ doing: 'reading the Session', cause: new Error('the file is locked') }),
  new AgentRuntimeError({ what: 'starting the agent', cause: 'the process would not run' }),
  new AgentNotInstalledError({ id: 'claude' }),
  new AgentSpawnError({ command: 'opencode', cause: 'ENOENT' }),
  new AgentUpdateRefusedError({ reason: 'Codex is not on this machine.' }),
  new UnknownHeldAgentError({ sessionId: 'session-1' }),
  new UnknownSessionError('session-1'),
]

describe('A refusal crossing the port', () => {
  test('A refusal is a sentence, never JSON', () => {
    for (const refusal of REFUSALS) {
      const said = named(refusal)
      // A sentence: words, and not the fields the refusal happens to carry.
      expect(said).not.toBe('')
      expect(said).not.toContain('{')
      expect(said).not.toContain('":')
      expect(said).toMatch(/[A-Za-z]{3}/)
      // And not the name of a kind of refusal on its own, which answers nothing.
      expect(said).not.toBe(refusal.name)
    }
  })

  test('the refusals the window shows say what happened and what to do', () => {
    expect(named(new StaleVersionError({ entity: 'session', id: 'one', expected: 1 }))).toBe(
      'This Session changed elsewhere; reopen it and try again.',
    )
    expect(named(new AgentNotInstalledError({ id: 'claude' }))).toBe(
      'Claude Code is not installed on this machine.',
    )
    expect(named(new AgentRuntimeError({ what: 'prompting', cause: 'no agent is running' }))).toBe(
      'prompting: no agent is running',
    )
  })

  test('a failure with nothing to say is named, and never serialised', () => {
    // Not a refusal of the engine: whatever was thrown, which is where `named` has the last
    // word. It is named by its name, and its fields stay out of the window.
    expect(named(new Error(''))).toBe('Error')
    expect(named('a string nobody wrapped')).toBe('a string nobody wrapped')
  })
})
