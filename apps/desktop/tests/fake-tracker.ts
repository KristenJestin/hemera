/**
 * A fake tracker for the ticket sync's suites (#97): GitHub issues of `acme/shop` on a host, kept in
 * memory, behind the `TicketProviders` port, never a real tracker. Each issue has a title, a body,
 * a status and comments; every change moves its update date, as GitHub's does. The tracker writes
 * down what it is asked (the grouped `changedSince` with the tickets it named, and each full read),
 * can hold its next grouped question until the suite releases it, and can be out of reach.
 */

import {
  GithubIssue,
  ProviderUnreachable,
  type TicketComment,
  type TicketReference,
  type TicketVersion,
  TicketNotFound,
  TicketUnreadable,
  canonicalTicket,
  readSections,
  ticketKeyOf,
} from '@hemera/core/domain'
import { Effect, Layer, Predicate } from 'effect'

import {
  MissingTicket,
  MovedTicket,
  type TicketChange,
  commentFingerprint,
  ticketFingerprint,
} from '../src/engine/tickets/provider.ts'
import { TicketProviders } from '../src/engine/tickets/search.ts'

export interface FakeIssue {
  title: string
  body: string
  state: 'open' | 'closed'
  wording: string
  comments: Array<{ id: string; author: string | null; body: string; editedAt: string | null }>
  updatedAt: string
}

export interface FakeTracker {
  readonly layer: Layer.Layer<TicketProviders>
  /** The issue `acme/shop#<number>` on a host, made or changed; its update date moves. */
  readonly set: (
    number: number,
    change: Partial<Omit<FakeIssue, 'updatedAt'>>,
    host?: string,
  ) => void
  readonly remove: (number: number, host?: string) => void
  /** The issue answers not found while hidden, its update date kept: shown again, unchanged. */
  readonly hide: (number: number, hidden: boolean, host?: string) => void
  /** The issue's full read fails as unreadable, while the grouped question still sees it move. */
  readonly unreadable: (number: number, broken: boolean, host?: string) => void
  /** Each grouped question, by host, with the keys it named. */
  readonly asked: () => ReadonlyArray<{
    readonly host: string
    readonly keys: ReadonlyArray<string>
  }>
  readonly reads: () => ReadonlyArray<string>
  /** The most grouped questions that ran at once. */
  readonly mostAtOnce: () => number
  /** How many grouped questions run now. */
  readonly running: () => number
  /** Holds the grouped questions from now until `release`. */
  readonly hold: () => void
  readonly release: () => void
  readonly offline: (out: boolean) => void
}

const DAY = Date.parse('2026-10-01T10:00:00Z')

export const fakeTracker = (): FakeTracker => {
  const issues = new Map<string, FakeIssue>()
  const asked: Array<{ host: string; keys: string[] }> = []
  const reads: string[] = []
  const hidden = new Set<string>()
  const broken = new Set<string>()
  let tick = 0
  let atOnce = 0
  let most = 0
  let out = false
  let gate: { promise: Promise<void>; release: () => void } | null = null
  const nextDate = () => {
    tick += 1
    return new Date(DAY + tick * 60_000).toISOString()
  }
  const id = (host: string, number: number) => `${host}/acme/shop#${String(number)}`

  const versionOf = (host: string, number: number, issue: FakeIssue): TicketVersion => {
    const sections = readSections(issue.body)
    const reference = GithubIssue.make({ host, owner: 'acme', repo: 'shop', number })
    const comments: TicketComment[] = issue.comments.map((one) => ({
      id: one.id,
      author: one.author,
      body: one.body,
      createdAt: new Date(DAY).toISOString(),
      editedAt: one.editedAt,
      fingerprint: commentFingerprint(one.body),
    }))
    return {
      provider: 'github',
      reference: canonicalTicket(reference),
      key: ticketKeyOf(reference),
      url: `https://${host}/acme/shop/issues/${String(number)}`,
      title: issue.title,
      description: issue.body,
      sections: sections.sections,
      unrecognised: sections.unrecognised,
      status: { state: issue.state, wording: issue.wording },
      author: 'ada',
      labels: [],
      comments,
      updatedAt: issue.updatedAt,
      readAt: new Date().toISOString(),
      fingerprint: ticketFingerprint(issue.title, issue.body),
    }
  }

  const providerFor = (host: string) => {
    const label = host === 'github.com' ? 'GitHub' : `GitHub (${host})`
    const offline = () => new ProviderUnreachable({ provider: label, detail: 'no network' })
    const owns = (reference: TicketReference) =>
      Predicate.isTagged(reference, 'GithubIssue') &&
      (reference.host === null || reference.host === host)
    return {
      kind: 'github' as const,
      label,
      status: Effect.succeed({ state: 'ready' as const, sentence: 'Ready.', fix: null }),
      reads: owns,
      read: (reference: TicketReference) =>
        Effect.gen(function* () {
          if (out) return yield* Effect.fail(offline())
          const key = Predicate.isTagged(reference, 'GithubIssue')
            ? id(host, reference.number)
            : null
          const issue = key === null || hidden.has(key) ? undefined : issues.get(key)
          reads.push(ticketKeyOf(reference))
          if (key !== null && broken.has(key)) {
            return yield* Effect.fail(
              new TicketUnreadable({ key: ticketKeyOf(reference), detail: 'an unreadable body' }),
            )
          }
          if (issue === undefined || !Predicate.isTagged(reference, 'GithubIssue')) {
            return yield* Effect.fail(
              new TicketNotFound({ key: ticketKeyOf(reference), detail: 'none' }),
            )
          }
          return versionOf(host, reference.number, issue)
        }),
      search: () => Effect.succeed([]),
      changedSince: (known: ReadonlyArray<{ reference: TicketReference; updatedAt: string }>) =>
        Effect.gen(function* () {
          const mine = known.filter((one) => owns(one.reference))
          asked.push({ host, keys: mine.map((one) => ticketKeyOf(one.reference)) })
          atOnce += 1
          most = Math.max(most, atOnce)
          const held = gate
          if (held !== null) yield* Effect.promise(() => held.promise)
          atOnce -= 1
          if (out) return yield* Effect.fail(offline())
          const changes: TicketChange[] = []
          for (const one of mine) {
            if (!Predicate.isTagged(one.reference, 'GithubIssue')) continue
            const reference = GithubIssue.make({ ...one.reference, host })
            const issue = hidden.has(id(host, reference.number))
              ? undefined
              : issues.get(id(host, reference.number))
            if (issue === undefined) {
              changes.push(
                MissingTicket.make({
                  reference: canonicalTicket(reference),
                  error: new TicketNotFound({ key: ticketKeyOf(reference), detail: 'gone' }),
                }),
              )
            } else if (issue.updatedAt !== one.updatedAt) {
              changes.push(
                MovedTicket.make({
                  reference: canonicalTicket(reference),
                  updatedAt: issue.updatedAt,
                }),
              )
            }
          }
          return changes
        }),
    }
  }

  return {
    layer: Layer.succeed(TicketProviders, {
      of: (info) => Effect.succeed(providerFor(info.host)),
    }),
    set: (number, change, host = 'github.com') => {
      const was = issues.get(id(host, number))
      issues.set(id(host, number), {
        title: 'Export notes as Markdown',
        body: '## Why\nExports are slow.\n',
        state: 'open',
        wording: 'open',
        comments: [],
        ...was,
        ...change,
        updatedAt: nextDate(),
      })
    },
    remove: (number, host = 'github.com') => {
      issues.delete(id(host, number))
    },
    hide: (number, hide, host = 'github.com') => {
      if (hide) hidden.add(id(host, number))
      else hidden.delete(id(host, number))
    },
    unreadable: (number, on, host = 'github.com') => {
      if (on) broken.add(id(host, number))
      else broken.delete(id(host, number))
    },
    asked: () => asked.map((one) => ({ host: one.host, keys: [...one.keys] })),
    reads: () => [...reads],
    mostAtOnce: () => most,
    running: () => atOnce,
    hold: () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      gate = { promise, release: () => resolve() }
    },
    release: () => {
      const held = gate
      gate = null
      held?.release()
    },
    offline: (now) => {
      out = now
    },
  }
}
