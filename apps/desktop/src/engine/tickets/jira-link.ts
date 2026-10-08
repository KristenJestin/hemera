/**
 * The engine's link to a Jira site (#96): the network it goes through, the limit of each call, and
 * how a sealed token is opened.
 *
 * - The network is Electron's `net.fetch` in the engine (Chromium's stack: the system's proxy
 *   settings and certificates apply), handed in by the engine's entry point; Node's `fetch` where
 *   no Electron runs, as in the suites.
 * - Every call has a 30-second limit, its answer read included. A call cut at its limit, or
 *   interrupted, is aborted.
 * - A request goes only to the site it was made for: a redirect to the same site is followed (at
 *   most three times), a redirect anywhere else is refused, so the token never reaches another
 *   host.
 * - What the network says of a failure is masked: it may quote the request.
 * - A sealed token is opened by main, the one process that can decrypt it, at call time.
 */

import { ProviderUnreachable } from '@hemera/core/domain'
import { type JiraDeployment, TokenUnreadable } from '@hemera/ipc'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { LIMITS } from '../git.ts'
import { Secrets } from '../secrets.ts'

/** The part of `fetch` a Jira call uses. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface JiraSettings {
  /** The network: Electron's `net.fetch` in the engine; Node's `fetch` otherwise. */
  readonly fetch?: Fetch | undefined
  /** How long one call may run; 30 seconds otherwise. */
  readonly limitMillis?: number | undefined
  /** Opens a sealed token: main, over the engine's link to it. */
  readonly open?: ((ciphertext: string) => Effect.Effect<string, TokenUnreadable>) | undefined
}

/** What one call answered: its status, its headers, its body as text. */
export interface JiraAnswer {
  readonly status: number
  readonly headers: Headers
  readonly body: string
}

export class JiraLink extends Context.Service<
  JiraLink,
  {
    /** One request to a site, its redirects within the site followed, within the limit. */
    readonly request: (
      site: string,
      path: string,
      init: {
        readonly method: 'GET' | 'POST'
        readonly headers: Record<string, string>
        readonly body?: string
      },
    ) => Effect.Effect<JiraAnswer, ProviderUnreachable>
    readonly open: (ciphertext: string) => Effect.Effect<string, TokenUnreadable>
  }
>()('JiraLink') {}

/** How many redirects within the site are followed. */
const REDIRECTS = 3

/** How a Jira site is named in errors: `Jira (acme.atlassian.net)`. */
export const jiraLabel = (site: string): string => `Jira (${new URL(site).host})`

const noOpener = (): Effect.Effect<string, TokenUnreadable> =>
  Effect.fail(new TokenUnreadable({ reason: 'no main process opens it here' }))

/** The link over this network, with this limit and this opener. */
export const jiraLinkLayer = (settings: JiraSettings = {}) =>
  Layer.effect(
    JiraLink,
    Effect.gen(function* () {
      const secrets = yield* Secrets
      return {
        open: settings.open ?? noOpener,
        request: (site, path, init) => {
          const fetch = settings.fetch ?? globalThis.fetch
          const limit = settings.limitMillis ?? LIMITS.read
          const origin = new URL(site).origin
          const provider = jiraLabel(site)
          const once = (url: string) =>
            Effect.tryPromise({
              try: async (signal) => {
                const response = await fetch(url, { ...init, redirect: 'manual', signal })
                return { response, body: await response.text() }
              },
              catch: (cause) =>
                new ProviderUnreachable({
                  provider,
                  // The network's own words may quote what was sent: masked before they go anywhere.
                  detail:
                    cause instanceof Error ? secrets.mask(cause.message) : 'the request failed',
                }),
            }).pipe(
              Effect.timeoutOption(limit),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      new ProviderUnreachable({
                        provider,
                        detail: `Jira did not answer within ${String(limit / 1000)} seconds`,
                      }),
                    ),
                  onSome: Effect.succeed,
                }),
              ),
            )
          return Effect.gen(function* () {
            let url = `${site}${path}`
            for (let hop = 0; ; hop += 1) {
              const { response, body } = yield* once(url)
              const redirected =
                response.type === 'opaqueredirect' ||
                (response.status >= 300 && response.status < 400)
              if (!redirected) return { status: response.status, headers: response.headers, body }
              const location = response.headers.get('location')
              const next = location === null ? null : URL.parse(location, url)
              if (next === null || next.origin !== origin) {
                return yield* new ProviderUnreachable({
                  provider,
                  detail: `Jira redirected to ${next?.host ?? 'an address it did not say'}; Hemera does not follow a redirect to another host`,
                })
              }
              if (hop >= REDIRECTS) {
                return yield* new ProviderUnreachable({
                  provider,
                  detail: 'Jira redirected too many times',
                })
              }
              url = next.href
            }
          })
        },
      }
    }),
  )

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * A Jira site's address as Hemera may call it: https, or plain http only to this machine, with no
 * credentials, query or fragment in it; null otherwise.
 */
export const secureJiraSite = (site: string): URL | null => {
  const url = URL.parse(site.trim())
  const secure =
    url !== null &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
  return url === null ||
    !secure ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
    ? null
    : url
}

const ServerInfo = Schema.Struct({ deploymentType: Schema.String })
const readServerInfo = Schema.decodeUnknownOption(Schema.fromJsonString(ServerInfo))

/**
 * The deployment a site says it is, from its server information, asked with no token: `Cloud`, or
 * `Server` and `DataCenter`; null when it does not answer or does not say, and without asking for
 * an address `addJira` would refuse.
 */
export const jiraDeployment = (site: string) =>
  Effect.gen(function* () {
    const parsed = secureJiraSite(site)
    if (parsed === null) return null
    const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
    const link = yield* JiraLink
    const answer = yield* Effect.option(
      link.request(base, '/rest/api/2/serverInfo', {
        method: 'GET',
        headers: { accept: 'application/json' },
      }),
    )
    if (Option.isNone(answer) || answer.value.status !== 200) return null
    const info = readServerInfo(answer.value.body)
    if (Option.isNone(info)) return null
    const type = info.value.deploymentType.toLowerCase()
    if (type === 'cloud') return 'cloud' satisfies JiraDeployment
    return type === 'server' || type === 'datacenter'
      ? ('datacenter' satisfies JiraDeployment)
      : null
  })
