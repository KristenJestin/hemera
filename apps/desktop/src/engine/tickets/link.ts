/**
 * The ticket a mission comes from, and what Hemera read of it (#95).
 *
 * - **The snapshot.** A version read is kept in `ticket_versions`, its text masked before it is
 *   written. A mission keeps two of them in `mission_tickets`: the base version its Spec is built
 *   from and the last known version. Both are the version read at creation; a later read moves the
 *   last known one only (moving the base is #97's), or both while the mission has no base yet.
 * - **A ticket unreadable at creation** gives a mission with its reference and no version; the next
 *   read ("Check again", or #97's check) stores it as both, and tells the mission's Journal.
 * - **Offline, signalled once.** The first outage after a success sets the provider's
 *   `unreachable_since` and writes one `tickets.provider_unreachable`; later failures in the same
 *   outage write nothing. The next success clears it and writes `tickets.provider_back`. The
 *   check-and-set is one guarded update under the engine's write lock, so two failures at once
 *   still write one event. A rate limit is an outage until its reset: no call is made before it.
 *
 * Nothing is lost: the last known version stays readable whatever the provider answers.
 */

import {
  CanonicalTicket,
  LIVE_STAGES,
  type ProviderStatus,
  ProviderLimited,
  type TicketError,
  TicketErrorSchema,
  type TicketWriteError,
  type TicketReference,
  parseTicketReference,
  ticketKeyOf,
} from '@hemera/core/domain'
import {
  InvalidMissionIdea,
  type MissionTicket,
  NoProviderReads,
  type TicketProviderInfo,
} from '@hemera/ipc'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { Effect, Option, Predicate, Result, Schema } from 'effect'

import { linkedTo } from '../missions.ts'
import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missionTickets, missions, ticketProviders, ticketVersions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { isOutage, undying } from './provider.ts'
import {
  type LiveProvider,
  TicketProviders,
  liveProviders,
  readersOf,
  resolvedAmong,
} from './search.ts'
import { getProvider, specModeOf } from './store.ts'
import { compareVersion, keepVersionIn } from './events.ts'
import { type TicketLinkAtCreation, maskedVersion, versionOf } from './versions.ts'

const providerEvent = (
  type: string,
  provider: TicketProviderInfo,
  payload: Record<string, string>,
) => ({
  type,
  entityKind: 'ticket_provider',
  entityId: provider.id,
  source: 'system' as const,
  author: 'hemera' as const,
  payload: { projectId: provider.projectId, host: provider.host, ...payload },
})

const isTicketError = Schema.is(TicketErrorSchema)

/** The provider reached again: its outage cleared and said once. */
const reached = (provider: TicketProviderInfo, label: string) =>
  mutate('clearing an outage', (transaction) =>
    Effect.gen(function* () {
      const cleared = yield* transaction
        .update(ticketProviders)
        .set({ unreachableSince: null, limitedUntil: null })
        .where(
          and(eq(ticketProviders.id, provider.id), isNotNull(ticketProviders.unreachableSince)),
        )
        .returning({ id: ticketProviders.id })
        .pipe(Effect.mapError(refusedWhile('writing the provider')))
      return {
        result: undefined,
        events:
          cleared.length === 0
            ? []
            : [providerEvent('tickets.provider_back', provider, { provider: label })],
      }
    }),
  )

/** The provider out of reach: the first failure of an outage is said, the later ones are not. */
const unreached = (
  provider: TicketProviderInfo,
  label: string,
  message: string,
  limitedUntil: string | null,
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    yield* mutate('recording an outage', (transaction) =>
      Effect.gen(function* () {
        if (limitedUntil !== null) {
          yield* transaction
            .update(ticketProviders)
            .set({ limitedUntil })
            .where(eq(ticketProviders.id, provider.id))
            .pipe(Effect.mapError(refusedWhile('writing the provider')))
        }
        const started = yield* transaction
          .update(ticketProviders)
          .set({ unreachableSince: new Date().toISOString() })
          .where(and(eq(ticketProviders.id, provider.id), isNull(ticketProviders.unreachableSince)))
          .returning({ id: ticketProviders.id })
          .pipe(Effect.mapError(refusedWhile('writing the provider')))
        return {
          result: undefined,
          events:
            started.length === 0
              ? []
              : [
                  providerEvent('tickets.provider_unreachable', provider, {
                    provider: label,
                    message: secrets.mask(message),
                  }),
                ],
        }
      }),
    )
  })

/** When the provider's rate limit resets, while it is not reset yet. */
const limitedUntilOf = (providerId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ until: ticketProviders.limitedUntil })
      .from(ticketProviders)
      .where(eq(ticketProviders.id, providerId))
      .pipe(Effect.mapError(refusedWhile('reading the provider')))
    const until = row?.until ?? null
    return until !== null && Date.parse(until) > Date.now() ? until : null
  })

/** The rate limit Hemera waits out, said as the provider's error. */
const waiting = (label: string, until: string) =>
  new ProviderLimited({
    provider: label,
    detail: 'Hemera waits for the rate limit to reset',
    resetAt: until,
  })

/**
 * A call on a provider, its outage kept: refused at once during a rate limit, the first failure of
 * an outage said once, the next success said once.
 */
export const observed = <A, E extends TicketWriteError, R>(
  live: LiveProvider,
  call: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const { info, provider } = live
    const limited = yield* limitedUntilOf(info.id)
    if (limited !== null) return yield* waiting(provider.label, limited)
    const outcome = yield* Effect.result(undying(provider.label, call))
    if (Result.isSuccess(outcome)) {
      yield* reached(info, provider.label)
      return outcome.success
    }
    const failure = outcome.failure
    if (isOutage(failure)) {
      yield* unreached(
        info,
        provider.label,
        failure.message,
        Predicate.isTagged(failure, 'ProviderLimited') ? failure.resetAt : null,
      )
    }
    return yield* Effect.fail(failure)
  })

/** The providers of a Project that read a reference, in order, and the reference as it resolves. */
const readersFor = (projectId: string, reference: TicketReference) =>
  Effect.gen(function* () {
    const live = yield* liveProviders(projectId)
    const resolved = resolvedAmong(live, reference)
    const readers = readersOf(live, resolved)
    if (readers.length === 0) return yield* new NoProviderReads({ key: ticketKeyOf(reference) })
    return { readers, resolved }
  })

/**
 * The reference read by each of its readers in turn until one answers (a bare Jira key may belong
 * to any Jira provider of the Project): the one that answered and its version, or every failure, in
 * order. A failure of the data folder ends it at once.
 */
const readInTurn = (readers: ReadonlyArray<LiveProvider>, resolved: TicketReference) =>
  Effect.gen(function* () {
    const failures: Array<{ readonly reader: LiveProvider; readonly failure: TicketError }> = []
    for (const reader of readers) {
      const read = yield* Effect.result(observed(reader, reader.provider.read(resolved)))
      if (Result.isSuccess(read)) return { answered: { reader, version: read.success }, failures }
      if (!isTicketError(read.failure)) return yield* Effect.fail(read.failure)
      failures.push({ reader, failure: read.failure })
    }
    return { answered: null, failures }
  })

/**
 * What a creation from a ticket is linked with: the provider that answers it, the Project's Spec
 * mode, and the version read now; or, when none answers and one is out of reach, that provider and
 * no version (said once, as any outage). None at all when no provider of the Project reads the
 * reference. A ticket every provider answers does not exist, may not be read, or is not a ticket (a
 * pull request) refuses the creation in the first provider's sentence: no Planner ever waits for
 * it.
 */
export const readForCreation = (projectId: string, reference: TicketReference) =>
  Effect.gen(function* () {
    const found = yield* Effect.option(readersFor(projectId, reference))
    if (Option.isNone(found)) return null
    const { readers, resolved } = found.value
    const { answered, failures } = yield* readInTurn(readers, resolved)
    const out = failures.find((one) => isOutage(one.failure))
    const [first] = failures
    if (answered === null && out === undefined && first !== undefined) {
      return yield* new InvalidMissionIdea({ reason: first.failure.message.replace(/\.$/, '') })
    }
    const reader = answered?.reader ?? out?.reader ?? readers[0]
    if (reader === undefined) return null
    return {
      providerId: reader.info.id,
      mode: yield* specModeOf(projectId),
      version: answered?.version ?? null,
    } satisfies TicketLinkAtCreation
  })

/**
 * Reads a ticket of a Project's providers now, and answers it masked. When a mission of the Project
 * is linked to it, the version becomes its last known one (and its base too, while it had none: the
 * ticket could not be read at creation, and the mission's Journal says it is read now).
 */
export const readTicket = (projectId: string, reference: TicketReference) =>
  Effect.gen(function* () {
    const { readers, resolved } = yield* readersFor(projectId, reference)
    const { answered, failures } = yield* readInTurn(readers, resolved)
    if (answered === null) {
      const failure = failures.find((one) => isOutage(one.failure)) ?? failures[0]
      if (failure !== undefined) return yield* Effect.fail(failure.failure)
      return yield* new NoProviderReads({ key: ticketKeyOf(reference) })
    }
    const { reader, version } = answered
    const secrets = yield* Secrets
    // Kept for the mission of the Project linked to it, as the sync keeps it (#97), compared with
    // its last known version before the transaction.
    const database = yield* Database
    const [linked] = yield* database
      .select({ missionId: missionTickets.missionId })
      .from(missionTickets)
      .innerJoin(missions, eq(missions.id, missionTickets.missionId))
      .where(linkedTo(projectId, resolved))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the mission’s ticket')))
    if (linked !== undefined) {
      const compared = yield* compareVersion(linked.missionId, version)
      yield* mutate('keeping the version read', (transaction) =>
        Effect.map(
          keepVersionIn(transaction, linked.missionId, reader.info.id, version, compared),
          (kept) => ({ result: undefined, events: kept.events }),
        ),
      )
    }
    return maskedVersion(version, secrets.mask)
  })

/** The ticket a mission comes from, with its base and last known versions; null for none. */
export const missionTicket = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({
        link: missionTickets,
        reference: missions.ticketReference,
        key: missions.ticketKey,
        url: missions.ticketUrl,
      })
      .from(missionTickets)
      .innerJoin(missions, eq(missions.id, missionTickets.missionId))
      .where(eq(missionTickets.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission’s ticket')))
    if (row === undefined || row.reference === null || row.key === null) return null
    const ids = [row.link.baseVersionId, row.link.lastVersionId].filter((id) => id !== null)
    const versions =
      ids.length === 0
        ? []
        : yield* database
            .select()
            .from(ticketVersions)
            .where(inArray(ticketVersions.id, ids))
            .pipe(Effect.mapError(refusedWhile('reading the ticket versions')))
    const byId = (id: string | null) => {
      const found = versions.find((version) => version.id === id)
      return found === undefined ? null : versionOf(found)
    }
    return {
      missionId,
      providerId: row.link.providerId,
      reference: CanonicalTicket.make(row.reference),
      key: row.key,
      url: row.url,
      mode: row.link.mode === 'linked' || row.link.mode === 'remote' ? row.link.mode : 'local',
      base: byId(row.link.baseVersionId),
      last: byId(row.link.lastVersionId),
    } satisfies MissionTicket
  })

/** A provider's status now, as its CLI says it; nothing is written. */
export const providerStatus = (providerId: string) =>
  Effect.gen(function* () {
    const info = yield* getProvider(providerId)
    const provider = yield* TicketProviders.use((providers) => providers.of(info))
    return yield* provider.status
  })

/**
 * "Check again": the provider's status now, its outage cleared or said, then the tickets of its
 * live missions that could not be read yet, read. During a rate limit, the provider stays out of
 * reach until its reset.
 */
export const checkAgain = (providerId: string) =>
  Effect.gen(function* () {
    const info = yield* getProvider(providerId)
    const live: LiveProvider = {
      info,
      provider: yield* TicketProviders.use((providers) => providers.of(info)),
    }
    const status: ProviderStatus = yield* live.provider.status
    // A rate limit is kept until its reset, whatever the CLI says of its login meanwhile.
    const limited = yield* limitedUntilOf(info.id)
    if (status.state === 'ready' && limited !== null) {
      return {
        state: 'unreachable',
        sentence: waiting(live.provider.label, limited).message,
        fix: null,
      } satisfies ProviderStatus
    }
    if (status.state === 'ready') yield* reached(info, live.provider.label)
    else yield* unreached(info, live.provider.label, status.sentence, status.limitedUntil ?? null)
    if (status.state !== 'ready') return status
    const database = yield* Database
    const unread = yield* database
      .select({ key: missions.ticketKey, url: missions.ticketUrl })
      .from(missionTickets)
      .innerJoin(missions, eq(missions.id, missionTickets.missionId))
      .where(
        and(
          eq(missionTickets.providerId, providerId),
          isNull(missionTickets.baseVersionId),
          inArray(missions.stage, [...LIVE_STAGES]),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the missions')))
    for (const one of unread) {
      const reference = parseTicketReference(one.url ?? one.key ?? '')
      if (reference !== null) yield* Effect.ignore(readTicket(info.projectId, reference))
    }
    return status
  })
