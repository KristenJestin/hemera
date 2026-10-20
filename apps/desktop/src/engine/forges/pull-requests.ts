/**
 * A repository's pull requests on its forge (R6), through the port's `operate`: the open pull
 * request from a branch into a base, found before any is created; one created from what the
 * templates rendered; and its status as R9 and S2 read it (state, head commit, the review decision
 * and the approvals).
 *
 * GitHub through `gh pr list`, `gh pr view` and `gh pr create`, with JSON answers; Bitbucket Cloud
 * and Data Center through bkt's `pr list`, `pr view` and `pr create`, whose flags and answers are
 * read from bkt's source and the Bitbucket API, to confirm on a real forge. A forge's message is
 * kept verbatim, masked by the runner already.
 *
 * GitHub also hosts the mission's images (R7): `--attach <path>#<alt>` on `gh pr create` and
 * `gh pr edit` uploads each file and rewrites its reference `![alt](./<file>)` in the description
 * to the uploaded copy; the description is read back to know which were. Whether the account may
 * push to the repository, and whether it is public, come from `gh api repos/<owner>/<repo>`.
 */

import type { PullRequestState, PullRequestStatus } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import { ForgePort, type ForgeTarget, forgeError } from './port.ts'
import type { ForgeAnswer } from './runner.ts'

/** A pull request found open from a branch into a base. */
export interface PullRequestFound {
  readonly number: number
  readonly url: string
  /** Its head commit; Bitbucket gives it shortened. */
  readonly head: string
}

/** What a pull request is created with. */
export interface PullRequestAsked {
  readonly base: string
  readonly head: string
  readonly title: string
  readonly body: string
  readonly reviewers: ReadonlyArray<string>
  /** Files gh uploads into the description, `<path>#<alt>`; none for bkt. */
  readonly attachments: ReadonlyArray<string>
}

/** What hosting an image on a repository depends on: who may see it, and whether one may push. */
export interface RepositoryAccess {
  readonly visibility: string
  readonly push: boolean
}

const GH_LIST_FIELDS = 'number,url,state,headRefOid'
const GH_VIEW_FIELDS = 'number,url,state,headRefOid,reviewDecision,latestReviews'

const GhPullRequest = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
  state: Schema.String,
  headRefOid: Schema.String,
})
const GhList = Schema.fromJsonString(Schema.Array(GhPullRequest))
const GhBody = Schema.fromJsonString(Schema.Struct({ body: Schema.String }))
const GhRepository = Schema.fromJsonString(
  Schema.Struct({
    visibility: Schema.optionalKey(Schema.String),
    private: Schema.Boolean,
    permissions: Schema.optionalKey(Schema.Struct({ push: Schema.Boolean })),
  }),
)
const GhView = Schema.fromJsonString(
  Schema.Struct({
    ...GhPullRequest.fields,
    reviewDecision: Schema.optionalKey(Schema.NullOr(Schema.String)),
    latestReviews: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          author: Schema.Struct({ login: Schema.String }),
          state: Schema.String,
        }),
      ),
    ),
  }),
)

/** A pull request as the Bitbucket API (and so bkt's `--json`) writes it. */
const BktPullRequest = Schema.Struct({
  id: Schema.Number,
  state: Schema.String,
  links: Schema.Struct({ html: Schema.Struct({ href: Schema.String }) }),
  source: Schema.Struct({ commit: Schema.Struct({ hash: Schema.String }) }),
  participants: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        approved: Schema.Boolean,
        user: Schema.Struct({
          nickname: Schema.optionalKey(Schema.String),
          display_name: Schema.optionalKey(Schema.String),
        }),
      }),
    ),
  ),
})
/** A list as bkt prints it: the pull requests alone, or the API's page of them. */
const BktList = Schema.fromJsonString(Schema.Array(BktPullRequest))
const BktPage = Schema.fromJsonString(Schema.Struct({ values: Schema.Array(BktPullRequest) }))
const BktView = Schema.fromJsonString(BktPullRequest)

const readGhList = Schema.decodeUnknownOption(GhList)
const readGhView = Schema.decodeUnknownOption(GhView)
const readGhBody = Schema.decodeUnknownOption(GhBody)
const readGhRepository = Schema.decodeUnknownOption(GhRepository)
const readBktList = (printed: string) =>
  Option.orElse(Schema.decodeUnknownOption(BktList)(printed), () =>
    Option.map(Schema.decodeUnknownOption(BktPage)(printed), (page) => page.values),
  )
const readBktView = Schema.decodeUnknownOption(BktView)

const stateOf = (state: string): PullRequestState => {
  const upper = state.toUpperCase()
  if (upper === 'OPEN') return 'open'
  if (upper === 'MERGED') return 'merged'
  return 'closed'
}

/** The answer of a call that ran, or the forge's own failure. */
const answered = (target: ForgeTarget, answer: ForgeAnswer) =>
  answer.code === 0 ? Effect.succeed(answer) : Effect.fail(forgeError(target, answer))

/** An answer that does not read as the forge's JSON: its failure, never a guess. */
const unreadable = (target: ForgeTarget, answer: ForgeAnswer) =>
  forgeError(target, { ...answer, code: answer.code, stderr: 'its answer could not be read' })

/** The open pull request from `head` into `base`, or none. */
export const findPullRequest = (repositoryId: string, head: string, base: string) =>
  ForgePort.use((port) =>
    port.operate(repositoryId, (target, run) =>
      Effect.gen(function* () {
        if (target.cli === 'gh') {
          const answer = yield* answered(
            target,
            yield* run([
              'pr',
              'list',
              ...target.place,
              '--head',
              head,
              '--base',
              base,
              '--state',
              'open',
              '--json',
              GH_LIST_FIELDS,
            ]),
          )
          const read = readGhList(answer.stdout)
          if (Option.isNone(read)) return yield* unreadable(target, answer)
          const [found] = read.value
          return found === undefined
            ? Option.none<PullRequestFound>()
            : Option.some<PullRequestFound>({
                number: found.number,
                url: found.url,
                head: found.headRefOid,
              })
        }
        const answer = yield* answered(
          target,
          yield* run([
            'pr',
            'list',
            ...target.place,
            '--source',
            head,
            '--target',
            base,
            '--state',
            'OPEN',
            '--json',
          ]),
        )
        const read = readBktList(answer.stdout)
        if (Option.isNone(read)) return yield* unreadable(target, answer)
        const [found] = read.value
        return found === undefined
          ? Option.none<PullRequestFound>()
          : Option.some<PullRequestFound>({
              number: found.id,
              url: found.links.html.href,
              head: found.source.commit.hash,
            })
      }),
    ),
  )

/** Opens a pull request; answers what the CLI printed, the forge's failure otherwise. */
export const createPullRequest = (repositoryId: string, asked: PullRequestAsked) =>
  ForgePort.use((port) =>
    port.operate(repositoryId, (target, run) =>
      Effect.gen(function* () {
        const reviewers =
          asked.reviewers.length === 0 ? [] : ['--reviewer', asked.reviewers.join(',')]
        const answer =
          target.cli === 'gh'
            ? yield* run(
                [
                  'pr',
                  'create',
                  ...target.place,
                  '--base',
                  asked.base,
                  '--head',
                  asked.head,
                  '--title',
                  asked.title,
                  '--body-file',
                  '-',
                  ...reviewers,
                  ...asked.attachments.flatMap((one) => ['--attach', one]),
                ],
                asked.body,
              )
            : yield* run([
                'pr',
                'create',
                ...target.place,
                '--source',
                asked.head,
                '--target',
                asked.base,
                '--title',
                asked.title,
                '--description',
                asked.body,
                ...reviewers,
              ])
        return (yield* answered(target, answer)).stdout
      }),
    ),
  )

/** A pull request's state, head commit, review decision and approvals, read now. */
export const pullRequestStatus = (repositoryId: string, number: number) =>
  ForgePort.use((port) =>
    port.operate(repositoryId, (target, run) =>
      Effect.gen(function* () {
        const forge = { forge: target.forge, host: target.identity.host }
        if (target.cli === 'gh') {
          const answer = yield* answered(
            target,
            yield* run(['pr', 'view', String(number), ...target.place, '--json', GH_VIEW_FIELDS]),
          )
          const read = readGhView(answer.stdout)
          if (Option.isNone(read)) return yield* unreadable(target, answer)
          const view = read.value
          return {
            ...forge,
            number: view.number,
            url: view.url,
            state: stateOf(view.state),
            head: view.headRefOid,
            reviewDecision: view.reviewDecision ?? null,
            approvals: (view.latestReviews ?? [])
              .filter((review) => review.state === 'APPROVED')
              .map((review) => ({ login: review.author.login })),
          } satisfies PullRequestStatus
        }
        const answer = yield* answered(
          target,
          yield* run(['pr', 'view', String(number), ...target.place, '--json']),
        )
        const read = readBktView(answer.stdout)
        if (Option.isNone(read)) return yield* unreadable(target, answer)
        const view = read.value
        return {
          ...forge,
          number: view.id,
          url: view.links.html.href,
          state: stateOf(view.state),
          head: view.source.commit.hash,
          reviewDecision: null,
          approvals: (view.participants ?? [])
            .filter((one) => one.approved)
            .map((one) => ({ login: one.user.nickname ?? one.user.display_name ?? '' })),
        } satisfies PullRequestStatus
      }),
    ),
  )

/**
 * Uploads files into an open pull request's description (gh only), the description first replaced
 * when one is given: answers what gh answered, its exit code and message, since a partial failure
 * still edits the pull request and only reading the description back says which files made it.
 */
export const attachToPullRequest = (
  repositoryId: string,
  number: number,
  attachments: ReadonlyArray<string>,
  body: string | null,
) =>
  ForgePort.use((port) =>
    port.operate(repositoryId, (target, run) =>
      run(
        [
          'pr',
          'edit',
          String(number),
          ...target.place,
          ...attachments.flatMap((one) => ['--attach', one]),
          ...(body === null ? [] : ['--body-file', '-']),
        ],
        body ?? undefined,
      ),
    ),
  )

/** A pull request's description as the forge holds it now (gh only). */
export const pullRequestBody = (repositoryId: string, number: number) =>
  ForgePort.use((port) =>
    port.operate(repositoryId, (target, run) =>
      Effect.gen(function* () {
        const answer = yield* answered(
          target,
          yield* run(['pr', 'view', String(number), ...target.place, '--json', 'body']),
        )
        const read = readGhBody(answer.stdout)
        if (Option.isNone(read)) return yield* unreadable(target, answer)
        return read.value.body
      }),
    ),
  )

/** Whether a GitHub repository is public, and whether the signed-in account may push to it. */
export const repositoryAccess = (repositoryId: string) =>
  ForgePort.use((port) =>
    port.operate(repositoryId, (target, run) =>
      Effect.gen(function* () {
        const { owner, slug } = target.identity
        const answer = yield* answered(
          target,
          yield* run([
            'api',
            '--hostname',
            target.identity.host,
            `repos/${owner ?? ''}/${slug ?? ''}`,
          ]),
        )
        const read = readGhRepository(answer.stdout)
        if (Option.isNone(read)) return yield* unreadable(target, answer)
        const one = read.value
        return {
          visibility: one.visibility ?? (one.private ? 'private' : 'public'),
          push: one.permissions?.push ?? false,
        } satisfies RepositoryAccess
      }),
    ),
  )
