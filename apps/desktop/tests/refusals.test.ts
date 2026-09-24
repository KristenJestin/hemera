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
import { MigrationError, ProfileAheadError } from '#engine/migrate.ts'
import { UnknownSessionError } from '#engine/sessions.ts'
import { ReadyRefusedError } from '#engine/specs/gate.ts'
import { PhaseRefusedError } from '#engine/specs/protocol.ts'
import { ReopenRefusedError } from '#engine/specs/revisions.ts'
import { UnknownRevisionError, UnknownSpecError } from '#engine/specs/snapshot.ts'
import { UnknownSpecItemError } from '#engine/specs/specs.ts'
import { SpecAnchorRefusedError } from '#engine/specs/write-right.ts'
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
  // The Specs' own (D7-03): each carries the sentence the panel shows.
  new UnknownSpecError({ id: 'spec-1' }),
  new UnknownRevisionError({ key: 'HEM-7', number: 3 }),
  new UnknownSpecItemError({ kind: 'task', name: 'Write the exporter' }),
  new SpecAnchorRefusedError({ reason: 'The Session "Draft" already defines a Spec.' }),
  new PhaseRefusedError({ reason: 'The plan phase cannot finish: the plan section is missing.' }),
  new ReadyRefusedError({ reason: 'HEM-7 changed since its gate was shown.' }),
  new ReopenRefusedError({ reason: 'A stale reopening is refused.' }),
  // The two of the start. They are read in the diagnostic log of a package started from a
  // desktop icon rather than in a window, and `MigrationError` on its own is a start that
  // failed for a reason nobody kept.
  new ProfileAheadError({ writtenByVersion: '0.9.0', migrations: ['0003_later'] }),
  new MigrationError({ migrations: ['0002_sessions'], cause: new Error('no such column: tone') }),
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
    // The start's own, which says which migration and what refused it: the cause is in the
    // sentence, and `named` does not name it a second time beside it.
    expect(
      named(new MigrationError({ migrations: ['0002_sessions'], cause: new Error('locked') })),
    ).toBe('The data folder could not be migrated (0002_sessions): Error: locked')
  })

  test('a failure with nothing to say is named, and never serialised', () => {
    // Not a refusal of the engine: whatever was thrown, which is where `named` has the last
    // word. It is named by its name, and its fields stay out of the window.
    expect(named(new Error(''))).toBe('Error')
    expect(named('a string nobody wrapped')).toBe('a string nobody wrapped')
  })
})
