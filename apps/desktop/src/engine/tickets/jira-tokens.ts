/**
 * A Jira provider's API token, as the engine keeps it (#96): only the ciphertext main sealed, in
 * `jira_tokens`, keyed by the provider, removed with it. Never the token.
 *
 * - Saving: main hands the ciphertext and, once, the token; the token is registered as a known
 *   secret value the moment it arrives and checked against the site; a token Jira refuses is not
 *   stored. A site that cannot be reached cannot refuse it: the token is stored, and the provider's
 *   status says the site is unreachable.
 * - At call time the provider opens the ciphertext through main (`jira.ts`), and a token Jira
 *   refuses then is marked refused until another one is saved.
 */

import { type JiraTokenCheck, InvalidProviderConfig } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect, Predicate, Result } from 'effect'

import { Secrets } from '../secrets.ts'
import { refusedWhile } from '../storage/database.ts'
import { jiraTokens } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { checkToken, checkedSource, sealedToken, tokenSource, tokenValues } from './jira.ts'
import { getProvider } from './store.ts'

/** A Jira provider, or a refusal for any other. */
const jiraProviderInfo = (providerId: string) =>
  Effect.gen(function* () {
    const info = yield* getProvider(providerId)
    if (info.jira === null) {
      return yield* new InvalidProviderConfig({ reason: 'only a Jira provider has a token' })
    }
    return { ...info, jira: info.jira }
  })

const tokenEvent = (
  type: string,
  provider: { readonly id: string; readonly projectId: string },
) => ({
  type,
  entityKind: 'ticket_provider',
  entityId: provider.id,
  source: 'ui' as const,
  author: 'human' as const,
  payload: { projectId: provider.projectId },
})

/** Where a provider's token stands, for main: its ciphertext and whether Jira refused it. */
export const jiraTokenState = (providerId: string) =>
  Effect.gen(function* () {
    yield* jiraProviderInfo(providerId)
    const row = yield* sealedToken(providerId)
    return { ciphertext: row?.ciphertext ?? null, refused: row?.refusedAt != null }
  })

/**
 * Keeps the ciphertext of a token main sealed, once the site did not refuse the token itself:
 * `invalid` and nothing stored when it did.
 */
export const saveJiraToken = (providerId: string, ciphertext: string, token: string) =>
  Effect.gen(function* () {
    const info = yield* jiraProviderInfo(providerId)
    const checked = yield* Effect.result(checkToken(info, token))
    if (
      Result.isFailure(checked) &&
      (Predicate.isTagged(checked.failure, 'ProviderNotAuthenticated') ||
        Predicate.isTagged(checked.failure, 'TicketForbidden'))
    ) {
      return 'invalid' satisfies JiraTokenCheck
    }
    yield* mutate('saving the Jira token', (transaction) =>
      transaction
        .insert(jiraTokens)
        .values({ providerId, ciphertext, refusedAt: null, savedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: jiraTokens.providerId,
          set: { ciphertext, refusedAt: null, savedAt: new Date().toISOString() },
        })
        .pipe(
          Effect.mapError(refusedWhile('saving the Jira token')),
          Effect.as({ result: undefined, events: [tokenEvent('tickets.jira_token_saved', info)] }),
        ),
    )
    // The token stored is the one masked under the provider's own source from now on.
    yield* Secrets.useSync((secrets) =>
      secrets.register(tokenSource(providerId), tokenValues(info, token)),
    )
    return 'saved' satisfies JiraTokenCheck
  })

/** Removes a provider's token; its value is no longer a known secret once nothing holds it. */
export const removeJiraToken = (providerId: string) =>
  Effect.gen(function* () {
    const info = yield* jiraProviderInfo(providerId)
    yield* mutate('removing the Jira token', (transaction) =>
      transaction
        .delete(jiraTokens)
        .where(eq(jiraTokens.providerId, providerId))
        .pipe(
          Effect.mapError(refusedWhile('removing the Jira token')),
          Effect.as({
            result: undefined,
            events: [tokenEvent('tickets.jira_token_removed', info)],
          }),
        ),
    )
    yield* Secrets.useSync((secrets) => {
      secrets.unregister(tokenSource(providerId))
      secrets.unregister(checkedSource(providerId))
    })
  })
