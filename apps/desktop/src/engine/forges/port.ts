/**
 * The forge port (#253): for each repository, which forge it uses, what that forge allows, the
 * state of its CLI's own sign-in, and the account signed in; the operations later tickets add (R6,
 * R7, R8, S2, S4) go through `operate`.
 *
 * - The forge is detected from the remote of the repository's delivery remote, or forced per
 *   repository (stored in `repository_forges`); a forced value wins.
 * - The state of a CLI is what its own status says (`gh auth status --hostname <host>`,
 *   `bkt auth status --json`), with the command that fixes it. `bkt auth status` reads only bkt's
 *   own configuration, never the network: for bkt, `ready` means a host is configured, not that its
 *   token still works, and `unreachable` is rare (bkt itself failing). Hemera never reads a token nor a
 *   CLI's configuration. It is checked again at once on "Check again", when the window regains
 *   the focus, and before each forge operation.
 * - An operation that finds its CLI not ready does not fail: it waits, behind one Project-level
 *   environment need per CLI and host (open question 45), which is withdrawn once a check passes;
 *   every operation waiting on it then resumes. The Git push is Git's own and never waits here.
 * - Each change of a repository's state is a `forge.cli_state_changed` event, each forcing a
 *   `forge.forced` event.
 */

import { EnvironmentFields, ProjectOwner } from '@hemera/core/domain'
import {
  type CliState,
  type ForcedForge,
  type ForgeCapabilities,
  type ForgeCli,
  ForgeError,
  type ForgeName,
  ForgeRefused,
  type ForgeRepositoryStatus,
  type ForgeTimeout,
  type ForgeUnreachable,
  type Project,
  type Repository,
  type UnknownProject,
  UnknownRepository,
} from '@hemera/ipc'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { join } from 'node:path'
import {
  Context,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect'

import { findOnPath, hostLookup } from '../command-line.ts'
import { DomainEvents } from '../domain-events.ts'
import { Git } from '../git.ts'
import type { DomainEvent } from '../journal.ts'
import {
  type NeedHandler,
  type NeedServices,
  createNeedIn,
  needService,
  withdrawNeed,
} from '../needs.ts'
import { getProject, getRepository } from '../projects.ts'
import { type DatabaseError, Database, refusedWhile } from '../storage/database.ts'
import { forgeNeeds, needs, repositoryForges } from '../storage/schema.ts'
import { Secrets } from '../secrets.ts'
import { mutate } from '../transaction.ts'
import {
  BITBUCKET_CLOUD_HOST,
  type ForcedSetting,
  type ForgeIdentity,
  GITHUB_HOST,
  identify,
} from './identity.ts'
import {
  type ForgeAnswer,
  type ForgeCall,
  ForgeRunner,
  type ForgeRunFailure,
  type ForgeSettings,
} from './runner.ts'
import { type ParsedCommand, REPO_NAME, SAFE_WORD, parseCommand } from './shapes.ts'

/** The service the forge's needs belong to. */
export const FORGE_NEEDS = needService('forge')

/** The first `gh` that attaches an image to a pull request (`--attach`). */
const ATTACH_SINCE = [2, 99, 0] as const

/** What a check of a repository's CLI found. */
interface CliCheck {
  readonly version: string | null
  readonly state: CliState
  readonly fix: string | null
  readonly detail: string | null
  /** The bkt context of the repository's host, which every bkt write names; null for gh. */
  readonly context: string | null
}

/** A failure of an operation once its CLI was ready: the forge's own, or the call's. */
export type ForgeFailure = ForgeError | ForgeTimeout | ForgeUnreachable

export type ForgeOperationFailure =
  | ForgeFailure
  | ForgeRefused
  | DatabaseError
  | UnknownRepository
  | UnknownProject

/** The forge a repository uses and its CLI, as an operation runs against it. */
export interface ForgeTarget {
  readonly projectId: string
  readonly identity: ForgeIdentity & { readonly host: string }
  readonly cli: ForgeCli
  readonly forge: ForgeName
  /**
   * The flags that name the repository on its forge, which every write carries: for gh
   * `--repo host/owner/repo`; for bkt the context of the repository's host (bkt would send the
   * command to its active context otherwise), the workspace or project, and the repository.
   * Empty when the remote names no repository on the forge: a write is then refused (`ForgeRefused`),
   * a read still runs.
   */
  readonly place: ReadonlyArray<string>
}

export class ForgePort extends Context.Service<
  ForgePort,
  {
    /** Each repository of the Project with its forge and its CLI's state, checked when never was. */
    readonly status: (
      projectId: string,
    ) => Effect.Effect<ReadonlyArray<ForgeRepositoryStatus>, DatabaseError | UnknownProject>
    /** Checks again at once, one repository or all; answers the Project's states. */
    readonly checkAgain: (
      projectId: string,
      repositoryId: string | null,
    ) => Effect.Effect<
      ReadonlyArray<ForgeRepositoryStatus>,
      DatabaseError | UnknownProject | UnknownRepository
    >
    /** Forces a repository's forge (null: detected again); answers the Project's states. */
    readonly setForced: (
      projectId: string,
      repositoryId: string,
      forge: ForcedForge | null,
      host: string | null,
    ) => Effect.Effect<
      ReadonlyArray<ForgeRepositoryStatus>,
      DatabaseError | UnknownProject | UnknownRepository | ForgeRefused
    >
    /** What the repository's forge allows, for its host and its CLI's version. */
    readonly capabilities: (
      repositoryId: string,
    ) => Effect.Effect<ForgeCapabilities, DatabaseError | UnknownRepository>
    /** The login the CLI says is signed in for the repository's host, read again at each call. */
    readonly currentUser: (repositoryId: string) => Effect.Effect<string, ForgeOperationFailure>
    /**
     * Runs a forge operation on a repository once its CLI is ready, waiting behind a Project need
     * while it is not; the CLI is checked again first. What later tickets build on.
     */
    readonly operate: <A, E>(
      repositoryId: string,
      operation: (
        target: ForgeTarget,
        run: (
          args: ReadonlyArray<string>,
          input?: string,
        ) => Effect.Effect<ForgeAnswer, ForgeFailure | ForgeRefused>,
      ) => Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | ForgeOperationFailure>
    /** The window regained the focus: every CLI not ready is checked again. */
    readonly focused: Effect.Effect<void>
    /** The Project's states after each change, for as long as the caller listens. */
    readonly changes: (
      projectId: string,
    ) => Stream.Stream<ReadonlyArray<ForgeRepositoryStatus>, DatabaseError | UnknownProject>
  }
>()('ForgePort') {}

const NETWORK =
  /error connecting|dial tcp|no such host|timed? ?out|connection (refused|reset)|network is unreachable|tls|eof/i

const BktStatus = Schema.fromJsonString(
  Schema.Struct({
    hosts: Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          key: Schema.String,
          base_url: Schema.optionalKey(Schema.String),
          username: Schema.optionalKey(Schema.String),
        }),
      ),
    ),
    contexts: Schema.optionalKey(
      Schema.NullOr(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            host: Schema.String,
            active: Schema.optionalKey(Schema.Boolean),
          }),
        ),
      ),
    ),
  }),
)
const readBktStatus = Schema.decodeUnknownOption(BktStatus)

/** The Project a `repository.removed` event names. */
const readRemoved = Schema.decodeUnknownOption(Schema.Struct({ projectId: Schema.String }))

/** A host without its port, lower case. */
const hostName = (host: string): string => host.toLowerCase().replace(/:\d+$/, '')

/** The host of a base URL without its port, or null. */
const baseHost = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Whether a host bkt is configured for is the repository's. bkt keys a host by its base URL's host:
 * a Bitbucket Cloud login is stored under `api.bitbucket.org` (its API), and a Data Center one
 * keeps its HTTP port, which the SSH port of a remote never matches, so the host is compared
 * without its port.
 */
const bktServes = (
  configured: { readonly key: string; readonly base_url?: string },
  forge: ForgeName,
  host: string,
): boolean => {
  const name = baseHost(configured.base_url ?? '') ?? hostName(configured.key)
  if (forge === 'bitbucket-cloud')
    return name === 'api.bitbucket.org' || name === BITBUCKET_CLOUD_HOST
  return name === hostName(host)
}

/** A Data Center project key, which its SSH and HTTPS remotes write in lower case. */
const projectKey = (owner: string): string => owner.toUpperCase()

/**
 * A plain word quoted for the platform's shell: a POSIX shell expands a leading `~` (a Data Center
 * personal project, `~KRIS`) to a home folder unless it is between single quotes, and `cmd.exe`
 * keeps single quotes as part of the word, but takes double quotes off (PowerShell takes off both).
 * A plain word holds no quote to close early.
 */
const quoted = (word: string, platform: NodeJS.Platform): string =>
  platform === 'win32' ? `"${word}"` : `'${word}'`

/** A host, with its port at most: nothing a shell would read as more than a word. */
const SAFE_HOST = /^[A-Za-z0-9.-]+(:\d+)?$/

/**
 * The bkt context to make when bkt is signed in on the repository's host but has no context for
 * it: named after the workspace or project and the host, on bkt's key for the host. The user
 * copies it into a shell, and the owner comes from a remote's URL: a part that is not a plain word
 * is left out (the owner), or no line is given at all (the host).
 */
export const contextLine = (
  forge: ForgeName,
  host: string,
  key: string,
  owner: string | null,
  platform: NodeJS.Platform = process.platform,
): string | null => {
  if (!SAFE_HOST.test(host) || !SAFE_HOST.test(key)) return null
  const named = owner !== null && SAFE_WORD.test(owner) ? owner : null
  const name = named === null ? hostName(host) : `${named.toLowerCase()}-${hostName(host)}`
  const line = `bkt context create ${quoted(name, platform)} --host ${key}`
  if (named === null) return line
  return forge === 'bitbucket-cloud'
    ? `${line} --workspace ${quoted(named, platform)}`
    : `${line} --project ${quoted(projectKey(named), platform)}`
}

/** Whether a command carries each flag of a place with its value: it names its own repository. */
const carries = (parsed: ParsedCommand, place: ReadonlyArray<string>): boolean => {
  for (let at = 0; at < place.length; at += 2) {
    if (parsed.flags.get(place[at] ?? '') !== place[at + 1]) return false
  }
  return true
}

/** The CLI a forge is reached through, or none. */
const cliOf = (forge: ForgeName): ForgeCli | null =>
  forge === 'github'
    ? 'gh'
    : forge === 'bitbucket-cloud' || forge === 'bitbucket-datacenter'
      ? 'bkt'
      : null

const versionOf = (printed: string): string | null => /(\d+\.\d+\.\d+)/.exec(printed)?.[1] ?? null

const atLeast = (version: string | null, wanted: ReadonlyArray<number>): boolean => {
  if (version === null) return false
  const parts = version.split('.').map(Number)
  for (const [at, part] of wanted.entries()) {
    const have = parts[at] ?? 0
    if (have !== part) return have > part
  }
  return true
}

/** The line that installs a CLI on this machine, as its documentation gives it. */
const installLine = (cli: ForgeCli, path: (program: string) => boolean): string => {
  if (cli === 'bkt') {
    return process.platform === 'win32'
      ? 'winget install AvivSinai.Bitbucket-CLI'
      : 'brew install bitbucket-cli'
  }
  if (process.platform === 'win32') return 'winget install --id GitHub.cli'
  if (process.platform === 'darwin') return 'brew install gh'
  return path('pacman') ? 'sudo pacman -S github-cli' : 'sudo apt install gh'
}

/** The line that signs a CLI in for a host. */
const loginLine = (forge: ForgeName, host: string): string =>
  Match.value(forge).pipe(
    Match.when('github', () => `gh auth login --hostname ${host}`),
    Match.when('bitbucket-cloud', () => `bkt auth login https://${host} --kind cloud --web`),
    Match.orElse(() => `bkt auth login https://${host}`),
  )

/** A host as forced: a name, with a port at most; a URL is cut down to its host. */
const forcedHost = (given: string): string | null => {
  const trimmed = given
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/.test(trimmed) ? trimmed : null
}

/**
 * The failure of a call that answered: the forge's message verbatim and the command, both masked
 * by the runner already. What an operation built on `operate` turns a failed answer into.
 */
export const forgeError = (
  target: Pick<ForgeTarget, 'forge'> & { readonly identity: { readonly host: string } },
  answer: ForgeAnswer,
): ForgeError =>
  new ForgeError({
    forge: target.forge,
    host: target.identity.host,
    command: answer.command,
    exitCode: answer.code,
    message: answer.stderr,
  })

/** What the port stands on. */
export type ForgePortServices = NeedServices | Git | ForgeRunner

/** One repository's state, with the Project it belongs to and the bkt context of its host. */
interface Known {
  readonly projectId: string
  readonly status: ForgeRepositoryStatus
  readonly context: string | null
}

/**
 * The port, and the handler its needs' Retry reaches. The layer stands on the needs, Git and the
 * runner.
 */
export const forgePort = (settings: Pick<ForgeSettings, 'waitHold' | 'settleHold'> = {}) => {
  let recheck: NeedHandler['recheck'] = undefined

  const handler: NeedHandler = {
    // An environment need is retried, never answered.
    deliver: () => Effect.succeed([]),
    recheck: (need, retried) =>
      recheck === undefined ? Effect.succeed(true) : recheck(need, retried),
  }

  const layer = Layer.effect(
    ForgePort,
    Effect.gen(function* () {
      const context = yield* Effect.context<ForgePortServices>()
      const runner = yield* ForgeRunner
      const provided = <A, E>(effect: Effect.Effect<A, E, ForgePortServices>) =>
        Effect.provide(effect, context)
      const memory = yield* SubscriptionRef.make<ReadonlyMap<string, Known>>(new Map())
      const secrets = yield* Secrets
      const needing = Semaphore.makeUnsafe(1)

      const lookup = (program: string) =>
        findOnPath(program, hostLookup(process.cwd(), process.env), process.platform) !== null

      const located = getRepository

      const forcedOf = (repositoryId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select()
            .from(repositoryForges)
            .where(eq(repositoryForges.repositoryId, repositoryId))
            .pipe(Effect.mapError(refusedWhile('reading the forced forges')))
          if (row === undefined) return null
          const forge = (
            ['github', 'bitbucket-cloud', 'bitbucket-datacenter', 'none'] as const
          ).find((one) => one === row.forge)
          return forge === undefined ? null : ({ forge, host: row.host } satisfies ForcedSetting)
        })

      const identityOf = (project: Project, repository: Repository) =>
        Effect.gen(function* () {
          const forced = yield* forcedOf(repository.id)
          const remote = repository.remote
          const url =
            remote === null
              ? null
              : yield* Git.use((git) =>
                  git.remotes(join(project.mainCheckout, repository.path)),
                ).pipe(
                  Effect.map(
                    (remotes) => remotes.find((one) => one.name === remote)?.fetchUrl ?? null,
                  ),
                  Effect.orElseSucceed(() => null),
                )
          return identify(url, forced)
        })

      /** What a call that could not answer says, as an unreachable check. */
      const unreachable = (failure: ForgeRunFailure, version: string | null): CliCheck => ({
        version,
        state: Predicate.isTagged(failure, 'ForgeCliMissing') ? 'missing' : 'unreachable',
        fix: null,
        detail: failure.message,
        context: null,
      })

      const checkCli = (
        cli: ForgeCli,
        forge: ForgeName,
        host: string,
        owner: string | null,
        projectId: string,
      ) =>
        Effect.gen(function* () {
          const call = (args: ReadonlyArray<string>) =>
            runner.run({ cli, forge, host, projectId, args })
          if (Option.isNone(yield* runner.find(cli))) {
            return {
              version: null,
              state: 'missing',
              fix: installLine(cli, lookup),
              detail: null,
              context: null,
            } satisfies CliCheck
          }
          const printed = yield* Effect.result(call(['--version']))
          if (Result.isFailure(printed)) return unreachable(printed.failure, null)
          const version = versionOf(printed.success.stdout)
          if (cli === 'gh') {
            const auth = yield* Effect.result(call(['auth', 'status', '--hostname', host]))
            if (Result.isFailure(auth)) return unreachable(auth.failure, version)
            if (auth.success.code === 0) {
              return {
                version,
                state: 'ready',
                fix: null,
                detail: null,
                context: null,
              } satisfies CliCheck
            }
            if (NETWORK.test(auth.success.stderr)) {
              return {
                version,
                state: 'unreachable',
                fix: null,
                detail: auth.success.stderr,
                context: null,
              } satisfies CliCheck
            }
            return {
              version,
              state: 'signed-out',
              fix: loginLine(forge, host),
              detail: null,
              context: null,
            } satisfies CliCheck
          }
          const auth = yield* Effect.result(call(['auth', 'status', '--json']))
          if (Result.isFailure(auth)) return unreachable(auth.failure, version)
          const read = readBktStatus(auth.success.stdout)
          if (auth.success.code !== 0 || Option.isNone(read)) {
            return {
              version,
              state: 'unreachable',
              fix: null,
              detail:
                auth.success.stderr === ''
                  ? 'bkt auth status answered what Hemera cannot read'
                  : auth.success.stderr,
              context: null,
            } satisfies CliCheck
          }
          const signedIn = (read.value.hosts ?? []).find((one) => bktServes(one, forge, host))
          if (signedIn === undefined) {
            return {
              version,
              state: 'signed-out',
              fix: loginLine(forge, host),
              detail: null,
              context: null,
            } satisfies CliCheck
          }
          // bkt sends a command to its active context, whatever its host: a write names the
          // context of the repository's host, the active one when several are. A name that is not
          // one plain word could not be passed to bkt (the runner refuses it): such a context is
          // as good as none, and the line to copy makes one.
          const contexts = (read.value.contexts ?? []).filter(
            (one) => SAFE_WORD.test(one.name) && bktServes({ key: one.host }, forge, host),
          )
          const chosen = contexts.find((one) => one.active === true) ?? contexts[0]
          return chosen === undefined
            ? ({
                version,
                state: 'signed-out',
                fix: contextLine(forge, host, signedIn.key, owner),
                detail: null,
                context: null,
              } satisfies CliCheck)
            : ({
                version,
                state: 'ready',
                fix: null,
                detail: null,
                context: chosen.name,
              } satisfies CliCheck)
        })

      const statusOf = (
        repository: Repository,
        identity: ForgeIdentity,
        check: CliCheck | null,
      ): ForgeRepositoryStatus => ({
        repositoryId: repository.id,
        path: repository.path,
        forge: identity.forge,
        host: identity.host,
        owner: identity.owner,
        slug: identity.slug,
        forced: identity.forced,
        cli: identity.host === null ? null : cliOf(identity.forge),
        version: check?.version ?? null,
        state: check?.state ?? 'not-needed',
        fix: check?.fix ?? null,
        detail: check?.detail ?? null,
      })

      /** The Project's forge needs pending now, with the CLI and host each waits for. */
      const pendingNeeds = (projectId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          return yield* database
            .select({ id: forgeNeeds.needId, cli: forgeNeeds.cli, host: forgeNeeds.host })
            .from(forgeNeeds)
            .innerJoin(needs, eq(needs.id, forgeNeeds.needId))
            .where(and(eq(forgeNeeds.projectId, projectId), eq(needs.state, 'pending')))
            .pipe(Effect.mapError(refusedWhile('reading the forge needs')))
        })

      /** Whether a repository of the Project still waits on this CLI and host, as last checked. */
      const stillWaits = (
        project: Project,
        known: ReadonlyMap<string, Known>,
        cli: string,
        host: string,
      ): boolean =>
        project.repositories.some((repository) => {
          const now = known.get(repository.id)?.status
          return (
            now !== undefined &&
            now.cli === cli &&
            now.host === host &&
            now.state !== 'ready' &&
            now.state !== 'not-needed'
          )
        })

      /**
       * A forge need's row: what it waits for matters only while it is pending, so it goes when the
       * need ends.
       */
      const forgetNeed = (needId: string) =>
        mutate('forgetting a forge need', (transaction) =>
          transaction
            .delete(forgeNeeds)
            .where(eq(forgeNeeds.needId, needId))
            .pipe(
              Effect.mapError(refusedWhile('deleting the forge need')),
              Effect.as({ result: undefined, events: [] }),
            ),
        )

      /**
       * The Project's needs nothing waits on any more withdrawn, and their rows deleted: their CLI
       * is ready for their host, or no repository of the Project reaches that host through it now
       * (forced elsewhere, gone). After a restart the states known are only those checked since,
       * and a repository not known yet may still wait on any of them: each such one is checked
       * first, so a need is settled on the states of all the Project's repositories. The states,
       * the Project and the needs are read, and the needs withdrawn, under the lock a need is made
       * under (`needFor`): a need is then either read with the state that made it, or made after.
       */
      // Typed: it checks the repositories not known yet, and a check settles in turn.
      const settleNeeds = (projectId: string): Effect.Effect<void, never, ForgePortServices> =>
        Effect.gen(function* () {
          if ((yield* pendingNeeds(projectId)).length === 0) return
          yield* statesOf(yield* getProject(projectId))
          yield* Semaphore.withPermits(
            needing,
            1,
          )(
            Effect.gen(function* () {
              const project = yield* getProject(projectId)
              const known = yield* SubscriptionRef.get(memory)
              yield* settings.settleHold ?? Effect.void
              for (const need of yield* pendingNeeds(projectId)) {
                if (stillWaits(project, known, need.cli, need.host)) continue
                yield* withdrawNeed(
                  need.id,
                  `nothing waits on ${need.cli} for ${need.host} any more`,
                )
                yield* forgetNeed(need.id)
              }
            }),
          )
        }).pipe(Effect.catch(() => Effect.void))

      /** Remembers a repository's state; a change is written to the journal and told. */
      const remember = (
        projectId: string,
        status: ForgeRepositoryStatus,
        bktContext: string | null,
      ) =>
        Effect.gen(function* () {
          const before = (yield* SubscriptionRef.get(memory)).get(status.repositoryId)?.status
          const changed =
            before === undefined ||
            before.state !== status.state ||
            before.forge !== status.forge ||
            before.host !== status.host ||
            before.version !== status.version
          if (changed) {
            yield* mutate('noting a forge CLI’s state', () =>
              Effect.succeed({
                result: undefined,
                events: [
                  {
                    type: 'forge.cli_state_changed',
                    entityKind: 'repository',
                    entityId: status.repositoryId,
                    source: 'system' as const,
                    author: 'hemera' as const,
                    payload: {
                      projectId,
                      forge: status.forge,
                      host: status.host,
                      cli: status.cli,
                      version: status.version,
                      state: status.state,
                      before: before?.state ?? null,
                    },
                  },
                ],
              }),
            )
          }
          yield* SubscriptionRef.update(memory, (known) =>
            new Map(known).set(status.repositoryId, { projectId, status, context: bktContext }),
          )
          return status
        })

      /** Checks the repositories given, each CLI and host once. */
      const check = (project: Project, repositories: ReadonlyArray<Repository>) =>
        Effect.gen(function* () {
          const checks = new Map<string, CliCheck>()
          for (const repository of repositories) {
            const identity = yield* identityOf(project, repository)
            const cli = cliOf(identity.forge)
            let found: CliCheck | null = null
            if (cli !== null && identity.host !== null) {
              // A missing bkt context is fixed per workspace or project: checked per owner.
              const key = `${cli}|${identity.host}|${cli === 'bkt' ? (identity.owner ?? '') : ''}`
              found =
                checks.get(key) ??
                (yield* checkCli(cli, identity.forge, identity.host, identity.owner, project.id))
              checks.set(key, found)
            }
            yield* remember(
              project.id,
              statusOf(repository, identity, found),
              found?.context ?? null,
            )
          }
          yield* settleNeeds(project.id)
        })

      const statesOf = (project: Project) =>
        Effect.gen(function* () {
          const known = yield* SubscriptionRef.get(memory)
          const unknown = project.repositories.filter((one) => !known.has(one.id))
          if (unknown.length > 0) yield* check(project, unknown)
          const now = yield* SubscriptionRef.get(memory)
          return project.repositories.flatMap((one) => {
            const status = now.get(one.id)?.status
            return status === undefined ? [] : [status]
          })
        })

      const status = (projectId: string) =>
        provided(Effect.flatMap(getProject(projectId), statesOf))

      const checkAgain = (projectId: string, repositoryId: string | null) =>
        provided(
          Effect.gen(function* () {
            const project = yield* getProject(projectId)
            const repositories =
              repositoryId === null
                ? project.repositories
                : project.repositories.filter((one) => one.id === repositoryId)
            if (repositoryId !== null && repositories.length === 0) {
              return yield* new UnknownRepository({ id: repositoryId })
            }
            yield* check(project, repositories)
            return yield* statesOf(project)
          }),
        )

      const setForced = (
        projectId: string,
        repositoryId: string,
        forge: ForcedForge | null,
        host: string | null,
      ) =>
        provided(
          Effect.gen(function* () {
            const project = yield* getProject(projectId)
            const repository = project.repositories.find((one) => one.id === repositoryId)
            if (repository === undefined) return yield* new UnknownRepository({ id: repositoryId })
            let kept: string | null = null
            if (forge === 'github' || forge === 'bitbucket-datacenter') {
              if (host === null || host.trim() === '') {
                if (forge === 'bitbucket-datacenter') {
                  return yield* new ForgeRefused({
                    reason: 'Bitbucket Data Center has no fixed host: give the host of yours.',
                  })
                }
              } else {
                kept = forcedHost(host)
                if (kept === null) {
                  return yield* new ForgeRefused({ reason: `“${host}” is not a host name.` })
                }
                if (forge === 'github' && kept === GITHUB_HOST) kept = null
              }
            }
            yield* mutate('forcing a repository’s forge', (transaction) =>
              Effect.gen(function* () {
                yield* transaction
                  .delete(repositoryForges)
                  .where(eq(repositoryForges.repositoryId, repositoryId))
                  .pipe(Effect.mapError(refusedWhile('writing the forced forge')))
                if (forge !== null) {
                  yield* transaction
                    .insert(repositoryForges)
                    .values({ repositoryId, forge, host: kept })
                    .pipe(Effect.mapError(refusedWhile('writing the forced forge')))
                }
                return {
                  result: undefined,
                  events: [
                    {
                      type: 'forge.forced',
                      entityKind: 'repository',
                      entityId: repositoryId,
                      source: 'ui' as const,
                      author: 'human' as const,
                      payload: { projectId, forge, host: kept },
                    },
                  ],
                }
              }),
            )
            yield* check(project, [repository])
            return yield* statesOf(project)
          }),
        )

      /** A repository's state now: checked again, as before each forge operation. */
      const checkedNow = (repositoryId: string) =>
        Effect.gen(function* () {
          const { project, repository } = yield* located(repositoryId)
          yield* check(project, [repository])
          const known = (yield* SubscriptionRef.get(memory)).get(repositoryId)
          if (known === undefined) return yield* Effect.die('a checked repository has no state')
          return { project, repository, status: known.status, context: known.context }
        })

      /**
       * A repository's state as last checked, by whichever operation or Check again; checked now
       * when it never was.
       */
      const knownNow = (repositoryId: string) =>
        Effect.gen(function* () {
          const { project, repository } = yield* located(repositoryId)
          const known = (yield* SubscriptionRef.get(memory)).get(repositoryId)
          if (known === undefined) return yield* checkedNow(repositoryId)
          return { project, repository, status: known.status, context: known.context }
        })

      /**
       * The Project's need for this CLI and host, made once however many operations wait, and only
       * while the repository still waits on them as last checked.
       */
      const needFor = (projectId: string, waiting: ForgeRepositoryStatus) =>
        Semaphore.withPermits(
          needing,
          1,
        )(
          Effect.gen(function* () {
            // A check since may have found it ready, or forced elsewhere, and settled the needs
            // already: a need made now would wait on nothing.
            const now = (yield* SubscriptionRef.get(memory)).get(waiting.repositoryId)?.status
            if (
              now === undefined ||
              now.cli !== waiting.cli ||
              now.host !== waiting.host ||
              now.state === 'ready' ||
              now.state === 'not-needed'
            ) {
              return
            }
            const cli = waiting.cli ?? 'the forge CLI'
            const host = waiting.host ?? ''
            const pending = yield* pendingNeeds(projectId)
            if (pending.some((one) => one.cli === cli && one.host === host)) return
            const fix = waiting.fix ?? ''
            const fields = Match.value(waiting.state).pipe(
              Match.when('missing', () =>
                EnvironmentFields.make({
                  missing: `${cli}, to reach ${host}: it is not on the PATH`,
                  action: `Install it: ${fix}\nThen choose Check again.`,
                  settingsSection: null,
                }),
              ),
              Match.when('signed-out', () =>
                EnvironmentFields.make({
                  missing: `${cli} signed in on ${host}`,
                  action: `Sign in: ${fix}\nThen choose Check again.`,
                  settingsSection: null,
                }),
              ),
              Match.orElse(() =>
                EnvironmentFields.make({
                  missing: `${host}, which ${cli} could not reach: ${waiting.detail ?? ''}`,
                  action: 'Choose Check again once it is reachable.',
                  settingsSection: null,
                }),
              ),
            )
            const written = yield* createNeedIn(
              FORGE_NEEDS,
              ProjectOwner.make({ projectId }),
              fields,
            )
            // The need and what it waits for, in one transaction: a restart finds both or neither.
            yield* mutate('waiting on a forge CLI', (transaction) =>
              Effect.gen(function* () {
                const { id, events } = yield* written(transaction)
                yield* transaction
                  .insert(forgeNeeds)
                  .values({ needId: id, projectId, cli, host })
                  .pipe(Effect.mapError(refusedWhile('writing the forge need')))
                return { result: undefined, events }
              }),
            ).pipe(
              // A Project's need has no mission to refuse it.
              Effect.catchTags({
                NeedRefused: (refused) => Effect.die(refused),
                UnknownMission: (unknown) => Effect.die(unknown),
              }),
            )
          }),
        )

      /**
       * Waits until anything changes for the repository: its state is no longer the one waited on
       * (ready, forced elsewhere), or an event names it (removed, forced). The loop then looks again.
       * Only the state, the CLI, the host and the forge count: a detail that differs at each check
       * (an unreachable forge's message) would have waiters wake each other forever. A state change
       * is read from the states alone, which this follows from the waiter's own check on: the event
       * that check wrote would wake it at once, and a forge flipping between two states would be
       * checked back to back. Says what woke it: a state some check wrote, which the waiter reads
       * without checking again (two waiters on a flipping forge would otherwise check in turn, each
       * waking the other), or an event, after which it checks.
       */
      const changed = (
        repositoryId: string,
        seen: ForgeRepositoryStatus,
        events: Stream.Stream<DomainEvent>,
      ) =>
        Effect.raceFirst(
          SubscriptionRef.changes(memory).pipe(
            Stream.filter((known) => {
              const now = known.get(repositoryId)?.status
              return (
                now === undefined ||
                now.state !== seen.state ||
                now.cli !== seen.cli ||
                now.host !== seen.host ||
                now.forge !== seen.forge
              )
            }),
            Stream.take(1),
            Stream.runDrain,
            Effect.as('state' as const),
          ),
          events.pipe(
            Stream.filter(
              (event) =>
                event.entityId === repositoryId && event.type !== 'forge.cli_state_changed',
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.as('event' as const),
          ),
        )

      const operate = <A, E>(
        repositoryId: string,
        operation: (
          target: ForgeTarget,
          run: (
            args: ReadonlyArray<string>,
            input?: string,
          ) => Effect.Effect<ForgeAnswer, ForgeFailure | ForgeRefused>,
        ) => Effect.Effect<A, E>,
      ): Effect.Effect<A, E | ForgeOperationFailure> =>
        provided(
          Effect.gen(function* () {
            let waitedIn: string | null = null
            // Checked at the start and after an event; read as it stands after a state change.
            let fresh = true
            for (;;) {
              const looked = yield* Effect.scoped(
                Effect.gen(function* () {
                  // Followed before the check, so that no change between the two is missed.
                  const events = yield* DomainEvents.use((domain) => domain.subscribe)
                  const checked = fresh
                    ? yield* checkedNow(repositoryId)
                    : yield* knownNow(repositoryId)
                  const now = checked.status
                  if (now.state === 'ready' || now.state === 'not-needed')
                    return Option.some(checked)
                  waitedIn = checked.project.id
                  yield* settings.waitHold ?? Effect.void
                  yield* needFor(checked.project.id, now)
                  fresh = (yield* changed(repositoryId, now, events)) === 'event'
                  return Option.none()
                }),
              ).pipe(
                // The repository went while the operation waited: its need goes too.
                Effect.tapErrorTag('UnknownRepository', () =>
                  waitedIn === null ? Effect.void : settleNeeds(waitedIn),
                ),
              )
              if (Option.isNone(looked)) continue
              const { project, status: now, context: bktContext } = looked.value
              if (now.cli === null || now.host === null || now.state === 'not-needed') {
                return yield* new ForgeRefused({
                  reason: 'This repository has no forge Hemera can reach.',
                })
              }
              const { cli, host, forge } = now
              const identity = yield* identityOf(project, (yield* located(repositoryId)).repository)
              const { owner, slug } = identity
              // A repository its remote does not name, or names with what the shapes would refuse
              // (a space, a `$(…)`), has no place: its reads run, its writes are refused.
              const place =
                owner === null ||
                slug === null ||
                !REPO_NAME.test(slug) ||
                !(cli === 'gh' ? REPO_NAME.test(owner) : SAFE_WORD.test(owner))
                  ? []
                  : cli === 'gh'
                    ? ['--repo', `${host}/${owner}/${slug}`]
                    : bktContext === null
                      ? []
                      : [
                          '--context',
                          bktContext,
                          ...(forge === 'bitbucket-cloud'
                            ? ['--workspace', owner]
                            : ['--project', projectKey(owner)]),
                          '--repo',
                          slug,
                        ]
              const target: ForgeTarget = {
                projectId: project.id,
                identity: { ...identity, host },
                cli,
                forge,
                place,
              }
              const run = (args: ReadonlyArray<string>, input?: string) => {
                const parsed = parseCommand(cli, args)
                if (parsed?.shape.class !== 'read') {
                  // Without its place, a write matches no shape: anything but a read is refused.
                  if (place.length === 0) {
                    return Effect.fail(
                      new ForgeRefused({
                        reason: 'The remote of this repository names no repository on its forge.',
                      }),
                    )
                  }
                  // A write goes to its own repository only, never another of the same host.
                  if (parsed !== null && !carries(parsed, place)) {
                    return Effect.fail(
                      new ForgeRefused({
                        reason: 'This write names another repository than the one it is for.',
                      }),
                    )
                  }
                }
                const plain: ForgeCall = {
                  cli,
                  forge,
                  host,
                  projectId: project.id,
                  args,
                  context: bktContext,
                }
                const call: ForgeCall = input === undefined ? plain : { ...plain, input }
                return runner.run(call).pipe(
                  Effect.catchTags({
                    ForgeCommandRefused: (refused) => Effect.die(refused),
                    ForgeCliMissing: (missing) =>
                      Effect.fail(
                        new ForgeError({
                          forge,
                          host,
                          command: secrets.mask([cli, ...args].join(' ')),
                          exitCode: 127,
                          message: missing.message,
                        }),
                      ),
                  }),
                )
              }
              return yield* operation(target, run)
            }
          }),
        )

      const currentUser = (repositoryId: string) =>
        operate(repositoryId, (target, run) =>
          Effect.gen(function* () {
            const host = target.identity.host
            const args =
              target.cli === 'gh'
                ? ['api', '--hostname', host, 'user', '--jq', '.login']
                : ['auth', 'status', '--json']
            const answer = yield* run(args)
            if (answer.code !== 0) return yield* forgeError(target, answer)
            if (target.cli === 'gh') return answer.stdout.trim()
            const read = readBktStatus(answer.stdout)
            const user = Option.isNone(read)
              ? undefined
              : (read.value.hosts ?? []).find((one) => bktServes(one, target.forge, host))?.username
            if (user === undefined || user === '') {
              return yield* forgeError(target, {
                ...answer,
                stderr: `bkt names no account for ${host}`,
              })
            }
            return user
          }),
        )

      const capabilities = (repositoryId: string) =>
        provided(
          Effect.gen(function* () {
            const { project } = yield* located(repositoryId)
            const known = (yield* statesOf(project)).find(
              (one) => one.repositoryId === repositoryId,
            )
            const forge = known?.forge ?? 'unknown'
            const version = known?.version ?? null
            const none: ForgeCapabilities = {
              runWorkflow: false,
              rerun: false,
              approveManualStep: false,
              attachImage: false,
              readBuildStatuses: false,
              cliVersion: version,
            }
            if (forge === 'github') {
              return {
                ...none,
                runWorkflow: true,
                rerun: true,
                approveManualStep: true,
                attachImage: known?.host === GITHUB_HOST && atLeast(version, ATTACH_SINCE),
                readBuildStatuses: true,
              }
            }
            if (forge === 'bitbucket-cloud') {
              return { ...none, runWorkflow: true, rerun: true, readBuildStatuses: true }
            }
            if (forge === 'bitbucket-datacenter') return { ...none, readBuildStatuses: true }
            return none
          }),
        )

      const focused = provided(
        Effect.gen(function* () {
          const known = yield* SubscriptionRef.get(memory)
          const waiting = new Set(
            [...known.values()]
              .filter((one) => one.status.state !== 'ready' && one.status.state !== 'not-needed')
              .map((one) => one.projectId),
          )
          for (const projectId of waiting) {
            yield* checkAgain(projectId, null).pipe(Effect.catch(() => Effect.void))
          }
        }),
      )

      const changes = (projectId: string) =>
        SubscriptionRef.changes(memory).pipe(
          Stream.mapEffect(() => status(projectId)),
          Stream.changesWith((one, other) => JSON.stringify(one) === JSON.stringify(other)),
        )

      // Retry, and the periodic recheck: the need holds while its own CLI and host are not ready.
      recheck = (need) =>
        provided(
          Effect.gen(function* () {
            const database = yield* Database
            const [waits] = yield* database
              .select()
              .from(forgeNeeds)
              .where(eq(forgeNeeds.needId, need.id))
              .pipe(Effect.mapError(refusedWhile('reading the forge need')))
            if (waits === undefined) return false
            yield* checkAgain(waits.projectId, null)
            const project = yield* getProject(waits.projectId)
            return stillWaits(project, yield* SubscriptionRef.get(memory), waits.cli, waits.host)
          }),
        ).pipe(Effect.catch(() => Effect.succeed(true)))

      // A repository removed while nothing waits on it: its Project's needs are settled now, not
      // at the next Retry or recheck (which a closed automation gate holds back).
      const removals = yield* DomainEvents.use((domain) => domain.subscribe)
      yield* removals.pipe(
        Stream.filter((event) => event.type === 'repository.removed'),
        Stream.runForEach((event) =>
          Option.match(readRemoved(event.payload), {
            onNone: () => Effect.void,
            onSome: ({ projectId }) => provided(settleNeeds(projectId)),
          }),
        ),
        Effect.forkScoped,
      )

      // A need ended elsewhere: Retry and the recheck withdraw it themselves when the CLI turned
      // ready after their own check had kept it. Its row goes now, not at the next start.
      const endings = yield* DomainEvents.use((domain) => domain.subscribe)
      yield* endings.pipe(
        Stream.filter((event) => event.type === 'need.withdrawn' || event.type === 'need.expired'),
        Stream.runForEach((event) =>
          provided(forgetNeed(event.entityId)).pipe(Effect.catch(() => Effect.void)),
        ),
        Effect.forkScoped,
      )

      // The rows of needs that ended another way (kept by an engine before #262, or left by a stop
      // between a need's end and its row's deletion) wait for nothing: they go at the start. One
      // that cannot go is harmless, since only a pending need's row is ever read.
      yield* provided(
        Effect.gen(function* () {
          const database = yield* Database
          const ended = yield* database
            .select({ id: forgeNeeds.needId })
            .from(forgeNeeds)
            .innerJoin(needs, eq(needs.id, forgeNeeds.needId))
            .where(ne(needs.state, 'pending'))
            .pipe(Effect.mapError(refusedWhile('reading the forge needs')))
          if (ended.length === 0) return
          yield* mutate('forgetting the forge needs that ended', (transaction) =>
            transaction
              .delete(forgeNeeds)
              .where(
                inArray(
                  forgeNeeds.needId,
                  ended.map((one) => one.id),
                ),
              )
              .pipe(
                Effect.mapError(refusedWhile('deleting the forge needs')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
        }),
      ).pipe(Effect.catch(() => Effect.void))

      return {
        status,
        checkAgain,
        setForced,
        capabilities,
        currentUser,
        operate,
        focused,
        changes,
      }
    }),
  )

  return { handler, layer }
}
