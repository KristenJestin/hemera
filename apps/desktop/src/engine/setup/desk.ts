/**
 * The setup agent's two tools (#44), as the gate's `SetupDesk`: `setup_read` answers what the
 * Project settings show, in plain lines, variables by name only; `setup_propose` checks a whole
 * call as the settings would and stores its cards, changing nothing. Built over the Project
 * settings' use cases, which sit above the tools.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { NO_REPOSITORY_IN_MAIN } from '@hemera/core/domain'
import type { Command, Project, RecipeStep } from '@hemera/ipc'
import { Effect, Layer, Predicate } from 'effect'

import { listCommands } from '../catalogue.ts'
import { getProject } from '../projects.ts'
import { getRecipe } from '../recipe.ts'
import { type ProjectServices, repositoryStatus } from '../repositories.ts'
import type { Secrets } from '../secrets.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { SetupDesk } from '../tools/ports.ts'
import { listVariables } from '../variables.ts'
import type { Preparations } from '../workspaces.ts'
import { propose } from './cards.ts'
import { SetupValues } from './values.ts'

const yesNo = (value: boolean): string => (value ? 'yes' : 'no')

/** A command's line in `setup_read`: its name, type, line, place, roles and write globs. */
const commandLine = (project: Project, command: Command): string => {
  const repository = project.repositories.find((one) => one.id === command.repositoryId)
  const place = [repository?.path, command.folder].filter(Predicate.isNotNullish).join('/')
  const roles = [
    command.check ? 'check' : null,
    command.type === 'serve' ? 'run (a service)' : null,
    command.atOpen ? 'run at open' : null,
    command.askBeforeRunning ? 'ask before running' : null,
    command.readOnly ? 'writes nothing' : null,
  ].filter(Predicate.isNotNull)
  return [
    `- ${command.name} (${command.type}): ${command.line}`,
    command.lineWindows === null ? null : `  Windows: ${command.lineWindows}`,
    command.lineLinux === null ? null : `  Linux: ${command.lineLinux}`,
    `  runs in ${place === '' ? 'the Project folder' : place}`,
    roles.length === 0 ? null : `  roles: ${roles.join(', ')}`,
    command.writeGlobs.length === 0 ? null : `  writes: ${command.writeGlobs.join(', ')}`,
  ]
    .filter(Predicate.isNotNull)
    .join('\n')
}

/** A recipe step in `setup_read`. */
const stepLine = (project: Project, commands: ReadonlyArray<Command>, step: RecipeStep): string => {
  const under = project.repositories.find((one) => one.id === step.repositoryId)?.path ?? 'the root'
  if (step.kind !== 'run')
    return `${String(step.position)}. ${step.kind} ${step.path ?? ''} (under ${under})`
  const command = commands.find((one) => one.id === step.commandId)
  return command === undefined
    ? `${String(step.position)}. run \`${step.line ?? ''}\` (in ${under})`
    : `${String(step.position)}. run the command ${command.name}`
}

/** The Project's setup as plain lines, as its settings show it; variables by name only. */
const read = (grant: Grant) =>
  Effect.gen(function* () {
    const project = yield* getProject(grant.projectId)
    const folderIsRepository = existsSync(join(project.mainCheckout, '.git'))
    const repositories = yield* Effect.forEach(project.repositories, (repository) =>
      Effect.gen(function* () {
        const state = yield* repositoryStatus(repository.id).pipe(
          Effect.map((status) =>
            Predicate.isTagged(status, 'Readable')
              ? `branch ${status.branch ?? '(none)'}, ${status.dirty ? 'with changes' : 'clean'}`
              : `unreadable: ${status.reason}`,
          ),
          Effect.catch((refused) => Effect.succeed(`unreadable: ${refused.message}`)),
        )
        return `- ${repository.path} · remote ${repository.remote ?? '(none)'} · base ${repository.baseBranch} · ${state}`
      }),
    )
    const commands = yield* listCommands(project.id)
    const steps = yield* getRecipe(project.id)
    const variables = yield* listVariables({ projectId: project.id, workspaceId: null })
    const lines = [
      `The Project ${project.name}, in ${project.mainCheckout}.`,
      `The Project folder is a Git repository: ${yesNo(folderIsRepository)}.`,
      ...(!folderIsRepository && project.repositories.length === 0 ? [NO_REPOSITORY_IN_MAIN] : []),
      '',
      'Repositories:',
      ...(repositories.length === 0 ? ['(none declared)'] : repositories),
      '',
      'The catalogue:',
      ...(commands.length === 0 ? ['(empty)'] : commands.map((one) => commandLine(project, one))),
      '',
      'The preparation recipe:',
      ...(steps.length === 0
        ? ['(no step)']
        : steps.map((one) => stepLine(project, commands, one))),
      '',
      'The variables, by name only:',
      variables.length === 0 ? '(none)' : variables.map((one) => one.key).join(', '),
    ]
    return answered(lines.join('\n'))
  })

/** The setup tools over the settings' use cases, their services captured once. */
export const setupDeskLayer = Layer.effect(
  SetupDesk,
  Effect.gen(function* () {
    const context = yield* Effect.context<ProjectServices | Preparations | Secrets | SetupValues>()
    const values = yield* SetupValues
    return {
      read: (grant) =>
        read(grant).pipe(
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
          Effect.provide(context),
        ),
      propose: (grant, args) =>
        propose(grant.projectId, grant.sessionId, args.changes).pipe(
          Effect.map((cards) =>
            answered(
              [
                `Proposed ${String(cards.length)} change(s), one card each; nothing changes until the user accepts a card:`,
                ...cards.map((card) => `- ${card.title}`),
              ].join('\n'),
            ),
          ),
          Effect.catchTag('ProposalRefused', (refused) =>
            Effect.succeed(refusal(`refused: the whole call, for ${refused.reason}`)),
          ),
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
          Effect.provide(context),
        ),
      heard: values.heard,
      passed: values.passed,
    }
  }),
)
