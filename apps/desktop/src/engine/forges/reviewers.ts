/**
 * Who can review a Project's pull requests (#502), as the Reviewers dialog of the delivery rules
 * asks for it when it opens: the reviewers are the Project's, written to every repository, so the
 * first repository on a forge answers for it. Read at each asking, never kept: one asking is one
 * reading of the forge.
 *
 * GitHub through `gh api`: the repository's teams (`repos/<owner>/<repo>/teams`), then the people
 * with access (`…/collaborators`), the first hundred of each. A repository with no team (one owned
 * by a person) lists its people. Bitbucket has no such reading among the commands Hemera may run:
 * the dialog says so, and a handle typed is added as it is.
 *
 * A command line that is not ready is never waited on (`operate` would wait behind a need): its
 * trouble is said, with the command that fixes it, and nothing runs.
 */

import type { ForgeName, ForgeRepositoryStatus, ReviewersListed } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import { ForgePort, forgeError } from './port.ts'

const TYPED = 'A handle typed below is added as it is.'

const FORGE_NAMES: Readonly<Record<ForgeName, string>> = {
  github: 'GitHub',
  'bitbucket-cloud': 'Bitbucket Cloud',
  'bitbucket-datacenter': 'Bitbucket Data Center',
  none: 'no forge',
  unknown: 'an unknown forge',
}

const readPeople = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ login: Schema.String }))),
)
const readTeams = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ slug: Schema.String, name: Schema.String }))),
)

const cannot = (sentence: string, fix: string | null = null): ReviewersListed => ({
  kind: 'cannot',
  sentence,
  fix,
})

/** What stands wrong with a command line, in a few words, as the section says it. */
const troubleOf = (status: ForgeRepositoryStatus): string => {
  const cli = status.cli ?? 'The command line'
  const host = status.host ?? 'the forge'
  switch (status.state) {
    case 'missing':
      return `${cli} is not installed`
    case 'signed-out':
      return `${cli} is signed out of ${host}`
    default:
      return `${host} cannot be reached`
  }
}

/** Who can review the Project's pull requests, or why the forge cannot be asked. */
export const listReviewers = (projectId: string) =>
  Effect.gen(function* () {
    const forge = yield* ForgePort
    const statuses = yield* forge.status(projectId)
    const first = statuses.find((one) => one.forge !== 'none' && one.forge !== 'unknown')
    if (first === undefined) {
      return cannot(`No repository of this Project is on a forge Hemera reads. ${TYPED}`)
    }
    if (first.forge !== 'github') {
      return cannot(`Hemera cannot list who reviews on ${FORGE_NAMES[first.forge]}. ${TYPED}`)
    }
    if (first.state !== 'ready') {
      return cannot(`${troubleOf(first)}: Hemera cannot list who reviews. ${TYPED}`, first.fix)
    }
    return yield* forge
      .operate(first.repositoryId, (target, run) =>
        Effect.gen(function* () {
          const { host, owner, slug } = target.identity
          if (owner === null || slug === null) {
            return cannot(`The remote of ${first.path} names no repository on ${host}. ${TYPED}`)
          }
          const path = `repos/${owner}/${slug}`
          const teams = yield* run(['api', '--hostname', host, `${path}/teams?per_page=100`])
          const people = yield* run([
            'api',
            '--hostname',
            host,
            `${path}/collaborators?per_page=100`,
          ])
          if (people.code !== 0) return yield* forgeError(target, people)
          // A repository a person owns has no team: its teams are not asked again.
          const named = teams.code === 0 ? Option.getOrElse(readTeams(teams.stdout), () => []) : []
          const found = Option.getOrElse(readPeople(people.stdout), () => [])
          return {
            kind: 'listed',
            reviewers: [
              ...named.map((team) => ({ handle: `${owner}/${team.slug}`, name: team.name })),
              ...found.map((person) => ({ handle: person.login, name: null })),
            ],
          } satisfies ReviewersListed
        }),
      )
      .pipe(
        Effect.catchTags({
          ForgeError: (failed) => Effect.succeed(cannot(`${failed.message.trim()} ${TYPED}`)),
          ForgeTimeout: (failed) => Effect.succeed(cannot(`${failed.message} ${TYPED}`)),
          ForgeUnreachable: (failed) => Effect.succeed(cannot(`${failed.message} ${TYPED}`)),
          ForgeRefused: (failed) => Effect.succeed(cannot(`${failed.message} ${TYPED}`)),
          UnknownRepository: () => Effect.succeed(cannot(`${first.path} is gone. ${TYPED}`)),
        }),
      )
  })
