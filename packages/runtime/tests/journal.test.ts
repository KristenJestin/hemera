import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_PAGE_SIZE,
  ExternalEffectInTransactionError,
  InvalidCursorError,
  MAX_PAGE_SIZE,
  lastSequence,
  openProfile,
  readJournal,
  recordChange,
} from '../src/index.ts'
import type { JournalEvent, OpenProfile } from '../src/index.ts'

const NOW = 1_789_000_000_000

function withProfile(body: (profile: OpenProfile, directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-journal-'))
  const profile = openProfile({ directory, now: NOW })
  try {
    body(profile, directory)
  } finally {
    profile.database.close(true)
    rmSync(directory, { recursive: true, force: true })
  }
}

function project(profile: OpenProfile, id: string): void {
  profile.database.run(
    'INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, id, NOW, NOW],
  )
}

function event(overrides: Partial<JournalEvent> = {}): JournalEvent {
  return {
    type: 'project.created',
    entity: 'project',
    entityId: 'p1',
    source: 'user',
    author: 'human',
    occurredAt: NOW,
    projectId: 'p1',
    ...overrides,
  }
}

describe('Mutation réussie', () => {
  test('the state and its event are visible together after the commit', () => {
    withProfile((profile) => {
      const recorded = recordChange(profile.database, event(), () => {
        project(profile, 'p1')
        return 'p1'
      })
      expect(recorded.result).toBe('p1')
      expect(recorded.sequence).toBe(1)

      const page = readJournal(profile.database, { projectId: 'p1' })
      expect(page.events).toHaveLength(1)
      expect(page.events[0]!.type).toBe('project.created')
      expect(page.events[0]!.entityId).toBe('p1')
      expect(page.events[0]!.source).toBe('user')
      expect(profile.database.query('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 1 })
    })
  })

  test('a human change is never attributed to an agent', () => {
    withProfile((profile) => {
      recordChange(profile.database, event(), () => project(profile, 'p1'))
      expect(readJournal(profile.database).events[0]!.author).toBe('human')
    })
  })

  test('the correlations declared for later lots stay empty', () => {
    withProfile((profile) => {
      recordChange(profile.database, event(), () => project(profile, 'p1'))
      const recorded = readJournal(profile.database).events[0]!
      expect(recorded.specId).toBeNull()
      expect(recorded.revisionId).toBeNull()
      expect(recorded.phaseId).toBeNull()
    })
  })
})

describe('Échec de persistance', () => {
  test('a failing mutation leaves neither state nor event behind', () => {
    withProfile((profile) => {
      expect(() =>
        recordChange(profile.database, event(), () => {
          project(profile, 'p1')
          throw new Error('injected failure in the middle of the transaction')
        }),
      ).toThrow(/injected failure/)

      expect(profile.database.query('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 0 })
      expect(readJournal(profile.database).events).toEqual([])
      expect(lastSequence(profile.database)).toBe(0)
    })
  })

  test('a failing event write undoes the state it was written with', () => {
    withProfile((profile) => {
      expect(() =>
        // A correlation that breaks the insert: the event cannot be written.
        recordChange(profile.database, event({ type: null as unknown as string }), () =>
          project(profile, 'p1'),
        ),
      ).toThrow()
      expect(profile.database.query('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 0 })
    })
  })
})

describe('Aucun effet externe dans la transaction', () => {
  test('a mutation that awaits is refused', () => {
    withProfile((profile) => {
      expect(() =>
        recordChange(profile.database, event(), () => Promise.resolve('effect')),
      ).toThrow(ExternalEffectInTransactionError)
      expect(readJournal(profile.database).events).toEqual([])
    })
  })
})

describe('Ordre total des événements', () => {
  test('events written in the same millisecond carry distinct increasing sequences', () => {
    withProfile((profile) => {
      project(profile, 'p1')
      const sequences = [1, 2, 3].map(
        (index) =>
          recordChange(profile.database, event({ type: `entry.${index}`, occurredAt: NOW }), () => {
            // Nothing to change: the event alone is the record.
          }).sequence,
      )
      expect(sequences).toEqual([1, 2, 3])
      expect(new Set(sequences).size).toBe(3)
    })
  })

  test('the sequence keeps growing after a restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-journal-'))
    try {
      const first = openProfile({ directory, now: NOW })
      project(first, 'p1')
      const before = recordChange(first.database, event(), () => {}).sequence
      first.database.close(true)

      const second = openProfile({ directory, now: NOW + 1 })
      try {
        const after = recordChange(
          second.database,
          event({ type: 'project.renamed' }),
          () => {},
        ).sequence
        expect(after).toBeGreaterThan(before)
        expect(lastSequence(second.database)).toBe(after)
      } finally {
        second.database.close(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('Historique volumineux', () => {
  test('a long history is read in bounded pages without loading it whole', () => {
    withProfile((profile) => {
      project(profile, 'p1')
      for (let index = 0; index < 120; index += 1) {
        recordChange(profile.database, event({ type: `entry.${index}` }), () => {})
      }

      let cursor: number | null = null
      const seen: number[] = []
      let pages = 0
      do {
        const page: { events: { sequence: number }[]; nextCursor: number | null } = readJournal(
          profile.database,
          { projectId: 'p1', cursor, limit: 25 },
        )
        expect(page.events.length).toBeLessThanOrEqual(25)
        seen.push(...page.events.map((recorded) => recorded.sequence))
        cursor = page.nextCursor
        pages += 1
      } while (cursor !== null)

      expect(pages).toBe(5)
      expect(seen).toHaveLength(120)
      expect(new Set(seen).size).toBe(120)
      expect([...seen].toSorted((left, right) => left - right)).toEqual(seen)
    })
  })

  test('the page size is bounded whatever is asked', () => {
    withProfile((profile) => {
      project(profile, 'p1')
      for (let index = 0; index < 5; index += 1) {
        recordChange(profile.database, event({ type: `entry.${index}` }), () => {})
      }
      expect(readJournal(profile.database, { limit: 10_000 }).events).toHaveLength(5)
      expect(MAX_PAGE_SIZE).toBeLessThan(10_000)
      expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE)
    })
  })
})

describe('Écriture pendant la pagination', () => {
  test('a write between two pages neither duplicates nor drops an earlier event', () => {
    withProfile((profile) => {
      project(profile, 'p1')
      for (let index = 0; index < 10; index += 1) {
        recordChange(profile.database, event({ type: `before.${index}` }), () => {})
      }

      const first = readJournal(profile.database, { projectId: 'p1', limit: 4 })
      expect(first.events).toHaveLength(4)

      // Someone records while the walk is in progress.
      for (let index = 0; index < 5; index += 1) {
        recordChange(profile.database, event({ type: `during.${index}` }), () => {})
      }

      let cursor = first.nextCursor
      const seen = first.events.map((recorded) => recorded.sequence)
      while (cursor !== null) {
        const page = readJournal(profile.database, { projectId: 'p1', cursor, limit: 4 })
        seen.push(...page.events.map((recorded) => recorded.sequence))
        cursor = page.nextCursor
      }

      expect(new Set(seen).size).toBe(seen.length)
      // The ten events written before the walk are all there, in order.
      expect(seen.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })
  })
})

describe('Lecture par Session', () => {
  test('a session history is read through its indexed correlation', () => {
    withProfile((profile) => {
      project(profile, 'p1')
      profile.database.run(
        'INSERT INTO sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['s1', 'p1', 'A session', NOW, NOW],
      )
      recordChange(
        profile.database,
        event({ type: 'session.created', entity: 'session', entityId: 's1', sessionId: 's1' }),
        () => {},
      )
      recordChange(profile.database, event({ type: 'project.renamed' }), () => {})

      const page = readJournal(profile.database, { sessionId: 's1' })
      expect(page.events).toHaveLength(1)
      expect(page.events[0]!.type).toBe('session.created')

      const plan = profile.database
        .query(
          'EXPLAIN QUERY PLAN SELECT * FROM domain_events WHERE session_id = ? ORDER BY sequence',
        )
        .all('s1') as { detail: string }[]
      // The read uses the index rather than scanning the whole journal.
      expect(plan.map((step) => step.detail).join(' ')).toContain('domain_events_session')
    })
  })
})

describe('Curseur invalide', () => {
  test('an unknown or malformed cursor is refused rather than starting over', () => {
    withProfile((profile) => {
      for (const cursor of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => readJournal(profile.database, { cursor })).toThrow(InvalidCursorError)
      }
    })
  })

  test('a cursor past the end returns an empty page rather than the start', () => {
    withProfile((profile) => {
      project(profile, 'p1')
      recordChange(profile.database, event(), () => {})
      const page = readJournal(profile.database, { cursor: 9_999 })
      expect(page.events).toEqual([])
      expect(page.nextCursor).toBeNull()
    })
  })
})

describe('Journal append-only', () => {
  test('a correction adds an event and never rewrites the one before it', () => {
    withProfile((profile) => {
      const first = recordChange(profile.database, event({ type: 'project.created' }), () =>
        project(profile, 'p1'),
      )
      const correction = recordChange(
        profile.database,
        event({ type: 'project.renamed', payload: { name: 'Hemera' } }),
        () => {
          profile.database.run('UPDATE projects SET name = ? WHERE id = ?', ['Hemera', 'p1'])
        },
      )

      const events = readJournal(profile.database, {}).events
      expect(events.map((entry) => entry.type)).toEqual(['project.created', 'project.renamed'])
      expect(events[0]!.sequence).toBe(first.sequence)
      expect(events[1]!.sequence).toBe(correction.sequence)
      expect(correction.sequence).toBeGreaterThan(first.sequence)
    })
  })

  test('the journal is never rewritten or emptied by a later change', () => {
    withProfile((profile) => {
      recordChange(profile.database, event(), () => project(profile, 'p1'))
      const before = readJournal(profile.database, {}).events

      recordChange(profile.database, event({ type: 'project.renamed' }), () => {
        profile.database.run('UPDATE projects SET name = ? WHERE id = ?', ['Nyx', 'p1'])
      })

      const after = readJournal(profile.database, {}).events
      expect(after.slice(0, before.length)).toEqual(before)
      expect(after).toHaveLength(before.length + 1)
    })
  })
})

describe('Auteur humain distingué', () => {
  test('a change the user made is recorded as human and attributed to no agent', () => {
    withProfile((profile) => {
      recordChange(profile.database, event({ source: 'user', author: 'human' }), () =>
        project(profile, 'p1'),
      )

      const recorded = readJournal(profile.database, {}).events[0]!
      expect(recorded.author).toBe('human')
      expect(recorded.source).toBe('user')
      expect(recorded.author).not.toBe('agent')
    })
  })
})

describe('Corrélations prévues non alimentées', () => {
  test('the spec, revision and phase correlations exist empty and are never invented', () => {
    withProfile((profile) => {
      recordChange(profile.database, event(), () => project(profile, 'p1'))

      const recorded = readJournal(profile.database, {}).events[0]!
      expect(recorded.specId).toBeNull()
      expect(recorded.revisionId).toBeNull()
      expect(recorded.phaseId).toBeNull()

      // They are columns of the schema, not a promise of a payload.
      const columns = (
        profile.database.query('PRAGMA table_info(domain_events)').all() as { name: string }[]
      ).map((column) => column.name)
      expect(columns).toContain('spec_id')
      expect(columns).toContain('revision_id')
      expect(columns).toContain('phase_id')
    })
  })
})

describe('Redémarrage après enregistrement', () => {
  test('events and their correlations are found again after a restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-journal-'))
    try {
      const first = openProfile({ directory, now: NOW })
      project(first, 'p1')
      recordChange(first.database, event({ sessionId: null }), () => {})
      const before = readJournal(first.database, {}).events
      first.database.close(true)

      const second = openProfile({ directory, now: NOW + 1 })
      try {
        const after = readJournal(second.database, {}).events
        expect(after).toEqual(before)
        expect(after[0]!.projectId).toBe('p1')
      } finally {
        second.database.close(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('Continuité après redémarrage', () => {
  test('a sequence given after a restart is above every one already recorded', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hemera-journal-'))
    try {
      const first = openProfile({ directory, now: NOW })
      project(first, 'p1')
      for (const type of ['project.created', 'project.renamed', 'project.configured']) {
        recordChange(first.database, event({ type }), () => {})
      }
      const highest = lastSequence(first.database)
      first.database.close(true)

      const second = openProfile({ directory, now: NOW + 1 })
      try {
        expect(lastSequence(second.database)).toBe(highest)
        const later = recordChange(second.database, event({ type: 'project.archived' }), () => {})
        expect(later.sequence).toBeGreaterThan(highest)
      } finally {
        second.database.close(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('Issue inconnue', () => {
  test('an effect whose outcome was never recorded leaves no outcome behind', () => {
    withProfile((profile) => {
      // The intent is durable before the effect is attempted, and the effect itself is
      // refused inside the transaction, so an unknown outcome can never be written as known.
      recordChange(profile.database, event({ type: 'effect.intended' }), () => {
        project(profile, 'p1')
      })
      expect(() =>
        recordChange(profile.database, event({ type: 'effect.intended' }), () => {
          throw new ExternalEffectInTransactionError()
        }),
      ).toThrow(ExternalEffectInTransactionError)

      const types = readJournal(profile.database, {}).events.map((entry) => entry.type)
      expect(types).toEqual(['effect.intended'])
      expect(types).not.toContain('effect.succeeded')
      expect(types).not.toContain('effect.failed')
    })
  })
})
