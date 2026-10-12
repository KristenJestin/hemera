/**
 * The forge port (#253): for each repository, which forge it uses, what that forge allows, the
 * state of its CLI's own sign-in, and the account signed in; the operations later tickets add (R6,
 * R7, R8, S2, S4) go through `operate`.
 *
 * - The forge is detected from the remote of the repository's delivery remote, or forced per
 *   repository (stored in `repository_forges`); a forced value wins.
 * - The state of a CLI is what its own status says (`gh auth status --hostname <host>`,
 *   `bkt auth status --json`), with the command that fixes it. Hemera never reads a token nor a
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
import { eq } from 'drizzle-orm'
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
import { Git } from '../git.ts'
import {
  type NeedHandler,
  type NeedServices,
  createNeed,
  needService,
  withdrawNeed,
} from '../needs.ts'
import { getProject, getRepository } from '../projects.ts'
import { type DatabaseError, Database, refusedWhile } from '../storage/database.ts'
import { repositoryForges } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type ForcedSetting, type ForgeIdentity, GITHUB_HOST, identify } from './identity.ts'
import { type ForgeAnswer, type ForgeCall, ForgeRunner, type ForgeRunFailure } from './runner.ts'

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
        ) => Effect.Effect<ForgeAnswer, ForgeFailure>,
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
        Schema.Struct({ key: Schema.String, username: Schema.optionalKey(Schema.String) }),
      ),
    ),
  }),
)
const readBktStatus = Schema.decodeUnknownOption(BktStatus)

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

const failed = (call: ForgeCall, answer: ForgeAnswer): ForgeError =>
  new ForgeError({
    forge: call.forge,
    host: call.host,
    command: [call.cli, ...call.args].join(' '),
    exitCode: answer.code,
    message: answer.stderr,
  })

/** What the port stands on. */
export type ForgePortServices = NeedServices | Git | ForgeRunner

/** One repository's state, with the Project it belongs to. */
interface Known {
  readonly projectId: string
  readonly status: ForgeRepositoryStatus
}

/**
 * The port, and the handler its needs' Retry reaches. The layer stands on the needs, Git and the
 * runner.
 */
export const forgePort = () => {
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
      /** The pending need of each Project, CLI and host, by `projectId|cli|host`. */
      const needs = new Map<string, string>()
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
      })

      const checkCli = (cli: ForgeCli, forge: ForgeName, host: string, projectId: string) =>
        Effect.gen(function* () {
          const call = (args: ReadonlyArray<string>) =>
            runner.run({ cli, forge, host, projectId, args })
          if (Option.isNone(yield* runner.find(cli))) {
            return {
              version: null,
              state: 'missing',
              fix: installLine(cli, lookup),
              detail: null,
            } satisfies CliCheck
          }
          const printed = yield* Effect.result(call(['--version']))
          if (Result.isFailure(printed)) return unreachable(printed.failure, null)
          const version = versionOf(printed.success.stdout)
          if (cli === 'gh') {
            const auth = yield* Effect.result(call(['auth', 'status', '--hostname', host]))
            if (Result.isFailure(auth)) return unreachable(auth.failure, version)
            if (auth.success.code === 0) {
              return { version, state: 'ready', fix: null, detail: null } satisfies CliCheck
            }
            if (NETWORK.test(auth.success.stderr)) {
              return {
                version,
                state: 'unreachable',
                fix: null,
                detail: auth.success.stderr,
              } satisfies CliCheck
            }
            return {
              version,
              state: 'signed-out',
              fix: loginLine(forge, host),
              detail: null,
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
            } satisfies CliCheck
          }
          const signedIn = (read.value.hosts ?? []).some((one) => one.key.toLowerCase() === host)
          return signedIn
            ? ({ version, state: 'ready', fix: null, detail: null } satisfies CliCheck)
            : ({
                version,
                state: 'signed-out',
                fix: loginLine(forge, host),
                detail: null,
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

      const needKey = (projectId: string, status: ForgeRepositoryStatus) =>
        `${projectId}|${status.cli ?? ''}|${status.host ?? ''}`

      /** The Project's needs on this CLI and host withdrawn: the check passed. */
      const resolved = (projectId: string, status: ForgeRepositoryStatus) =>
        Effect.gen(function* () {
          const key = needKey(projectId, status)
          const id = needs.get(key)
          if (id === undefined) return
          needs.delete(key)
          yield* withdrawNeed(
            id,
            `${status.cli ?? 'the CLI'} is ready for ${status.host ?? ''} now`,
          )
        }).pipe(Effect.catch(() => Effect.void))

      /** Remembers a repository's state; a change is written to the journal and told. */
      const remember = (projectId: string, status: ForgeRepositoryStatus) =>
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
            new Map(known).set(status.repositoryId, { projectId, status }),
          )
          if (status.state === 'ready') yield* resolved(projectId, status)
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
              const key = `${cli}|${identity.host}`
              found =
                checks.get(key) ?? (yield* checkCli(cli, identity.forge, identity.host, project.id))
              checks.set(key, found)
            }
            yield* remember(project.id, statusOf(repository, identity, found))
          }
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
          return { project, repository, status: known.status }
        })

      /** The Project's need for this CLI and host, made once however many operations wait. */
      const needFor = (projectId: string, waiting: ForgeRepositoryStatus) =>
        Semaphore.withPermits(
          needing,
          1,
        )(
          Effect.gen(function* () {
            const key = needKey(projectId, waiting)
            if (needs.has(key)) return
            const cli = waiting.cli ?? 'the forge CLI'
            const host = waiting.host ?? ''
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
            const need = yield* createNeed(
              FORGE_NEEDS,
              ProjectOwner.make({ projectId }),
              fields,
            ).pipe(
              // A Project's need has no mission to refuse it.
              Effect.catchTags({
                NeedRefused: (refused) => Effect.die(refused),
                UnknownMission: (unknown) => Effect.die(unknown),
              }),
            )
            needs.set(key, need.id)
          }),
        )

      /** Waits until the repository's CLI is said ready. */
      const readyAgain = (repositoryId: string) =>
        SubscriptionRef.changes(memory).pipe(
          Stream.filter((known) => known.get(repositoryId)?.status.state === 'ready'),
          Stream.take(1),
          Stream.runDrain,
        )

      const operate = <A, E>(
        repositoryId: string,
        operation: (
          target: ForgeTarget,
          run: (
            args: ReadonlyArray<string>,
            input?: string,
          ) => Effect.Effect<ForgeAnswer, ForgeFailure>,
        ) => Effect.Effect<A, E>,
      ): Effect.Effect<A, E | ForgeOperationFailure> =>
        provided(
          Effect.gen(function* () {
            for (;;) {
              const { project, status: now } = yield* checkedNow(repositoryId)
              if (now.cli === null || now.host === null || now.state === 'not-needed') {
                return yield* new ForgeRefused({
                  reason: 'This repository has no forge Hemera can reach.',
                })
              }
              if (now.state !== 'ready') {
                yield* needFor(project.id, now)
                yield* readyAgain(repositoryId)
                continue
              }
              const { cli, host, forge } = now
              const identity = yield* identityOf(project, (yield* located(repositoryId)).repository)
              const target: ForgeTarget = {
                projectId: project.id,
                identity: { ...identity, host },
                cli,
                forge,
              }
              const run = (args: ReadonlyArray<string>, input?: string) => {
                const plain: ForgeCall = { cli, forge, host, projectId: project.id, args }
                const call: ForgeCall = input === undefined ? plain : { ...plain, input }
                return runner.run(call).pipe(
                  Effect.catchTags({
                    ForgeCommandRefused: (refused) => Effect.die(refused),
                    ForgeCliMissing: (missing) =>
                      Effect.fail(
                        new ForgeError({
                          forge,
                          host,
                          command: [cli, ...args].join(' '),
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
            const call: ForgeCall = {
              cli: target.cli,
              forge: target.forge,
              host,
              projectId: target.projectId,
              args,
            }
            const answer = yield* run(args)
            if (answer.code !== 0) return yield* failed(call, answer)
            if (target.cli === 'gh') return answer.stdout.trim()
            const read = readBktStatus(answer.stdout)
            const user = Option.isNone(read)
              ? undefined
              : (read.value.hosts ?? []).find((one) => one.key.toLowerCase() === host)?.username
            if (user === undefined || user === '') {
              return yield* failed(call, {
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

      recheck = (need) =>
        Effect.gen(function* () {
          if (!Predicate.isTagged(need.owner, 'Project')) return true
          const projectId = need.owner.projectId
          const key = [...needs.entries()].find(([, id]) => id === need.id)?.[0]
          const states = yield* checkAgain(projectId, null)
          return states.some(
            (one) =>
              (key === undefined || needKey(projectId, one) === key) &&
              one.state !== 'ready' &&
              one.state !== 'not-needed',
          )
        }).pipe(Effect.catch(() => Effect.succeed(true)))

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
