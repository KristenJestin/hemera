/**
 * What the setup agent may propose for a Project (#44), and how a proposal is said.
 *
 * An agent reads the setup freely and changes nothing of it: every change it wants is a proposal
 * the user accepts, one card per change, applied through the very use cases the Project settings
 * call. The changes of one call are one batch. In 1.0 a change is one of four kinds (open
 * question 71): declare a repository (with its remote and base branch when the agent read them),
 * add or rewrite a catalogue command (with its roles and write globs), add a step at the end of
 * the preparation recipe, set a Project variable.
 *
 * A change is said the same way on its card, in the Journal and in the answer the agent reads: a
 * title, and the details under it. A variable's value is never part of either.
 */

import { Schema } from 'effect'

import { COMMAND_TYPES } from './commands.ts'
import { RECIPE_KINDS } from './workspace.ts'

/** The kinds of change a setup proposal carries. */
export const SETUP_CHANGE_KINDS = ['repository', 'command', 'step', 'variable'] as const
export type SetupChangeKind = (typeof SETUP_CHANGE_KINDS)[number]

const Text = (description: string) =>
  Schema.String.check(Schema.isNonEmpty()).annotate({ description })
const Maybe = (description: string) => Schema.optionalKey(Text(description))
const Flag = (description: string) =>
  Schema.optionalKey(Schema.Boolean.annotate({ description: `${description} False without it.` }))

/** A repository the Project would declare, by its path under the Project folder. */
export const RepositoryProposal = Schema.Struct({
  kind: Schema.Literal('repository'),
  path: Text('The repository’s folder, relative to the Project folder (`api`).'),
  remote: Maybe('The remote Hemera fetches and compares with, when you read it (`origin`).'),
  baseBranch: Maybe('The branch missions start from, when you read it.'),
})

/** A catalogue command added, or rewritten when the catalogue already holds its name. */
export const CommandProposal = Schema.Struct({
  kind: Schema.Literal('command'),
  name: Text('Its name in the catalogue: a rewrite when the catalogue already holds it.'),
  type: Schema.Literals(COMMAND_TYPES).annotate({
    description: 'What it is for: `serve` for a service, `test`, `lint`, `typecheck`, `build`…',
  }),
  line: Text('The command line, without shell syntax (no `|`, `>`, `&&`, `;`, `$(…)` or glob).'),
  lineWindows: Maybe('Its own line on Windows, when it differs.'),
  lineLinux: Maybe('Its own line on Linux, when it differs.'),
  repository: Maybe(
    'The declared repository it runs under, by its path; the Project folder without it.',
  ),
  folder: Maybe('A folder under that repository it runs in.'),
  check: Flag('Whether it may be used as a check.'),
  atOpen: Flag('Whether it runs once each time Hemera opens.'),
  askBeforeRunning: Flag(
    'Whether nobody runs it without the user’s permission: anything that migrates, seeds, resets or touches a shared resource.',
  ),
  readOnly: Flag('Whether it writes nothing in the repository.'),
  writeGlobs: Schema.optionalKey(
    Schema.Array(Text('A glob of files it may write, relative to its folder.')).annotate({
      description: 'The files it rewrites: a formatter’s, a generated client, the lockfile.',
    }),
  ),
})

/** A step added at the end of the preparation recipe. */
export const StepProposal = Schema.Struct({
  kind: Schema.Literal('step'),
  step: Schema.Literals(RECIPE_KINDS).annotate({
    description: '`copy` or `link` a file or folder into a fresh Workspace, or `run` a command.',
  }),
  repository: Maybe('The declared repository it applies under, by its path; the root without it.'),
  path: Maybe('What a copy or a link places, or the folder a run runs in, under its repository.'),
  command: Maybe('For a run: the catalogue command it starts, by its name.'),
  line: Maybe('For a run of its own: the line, without shell syntax.'),
})

/** A Project variable set to a value. The value is hidden from every record and view. */
export const VariableProposal = Schema.Struct({
  kind: Schema.Literal('variable'),
  name: Text('The variable’s name (`DATABASE_URL`).'),
  value: Schema.String.annotate({
    description:
      'Its value: only a safe default a repository gives (an example file meant to be copied), never one from a secret file.',
  }),
})

/** One change as the agent proposes it. */
export const SetupProposal = Schema.Union([
  RepositoryProposal,
  CommandProposal,
  StepProposal,
  VariableProposal,
])
export type SetupProposal = typeof SetupProposal.Type

/** A variable as a card keeps it: its name, and whether it replaces one; never its value. */
export const VariableChange = Schema.Struct({
  kind: Schema.Literal('variable'),
  name: Schema.String,
  replaces: Schema.Boolean,
})

/** A command as a card keeps it, and whether the catalogue held its name. */
export const CommandChange = Schema.Struct({
  ...CommandProposal.fields,
  replaces: Schema.Boolean,
})

/** One change as its card keeps it. */
export const SetupChange = Schema.Union([
  RepositoryProposal,
  CommandChange,
  StepProposal,
  VariableChange,
])
export type SetupChange = typeof SetupChange.Type

/** One line under a change's title. */
export interface SetupDetail {
  readonly label: string
  readonly value: string
}

/** Where a change applies, as a reader reads it. */
const placeOf = (repository: string | undefined, folder: string | undefined): string => {
  const parts = [repository, folder].filter((part) => part !== undefined && part !== '')
  return parts.length === 0 ? 'the Project folder' : parts.join('/')
}

/** The one line a change is said in: on its card, in the Journal, and to the agent. */
export function setupChangeTitle(change: SetupChange): string {
  switch (change.kind) {
    case 'repository':
      return `Declare the repository ${change.path}`
    case 'command':
      return change.replaces
        ? `Change the command ${change.name}`
        : `Add the command ${change.name}`
    case 'step':
      if (change.step === 'run') {
        return change.command === undefined
          ? 'Add a preparation step that runs a line'
          : `Add a preparation step that runs ${change.command}`
      }
      return `Add a preparation step that ${change.step === 'copy' ? 'copies' : 'links'} ${change.path ?? ''}`
    case 'variable':
      return `Set the variable ${change.name}`
  }
}

/** Everything the change would write, said field by field; never a variable's value. */
export function setupChangeDetails(change: SetupChange): ReadonlyArray<SetupDetail> {
  switch (change.kind) {
    case 'repository':
      return [
        { label: 'Path', value: change.path },
        ...(change.remote === undefined ? [] : [{ label: 'Remote', value: change.remote }]),
        ...(change.baseBranch === undefined
          ? []
          : [{ label: 'Base branch', value: change.baseBranch }]),
      ]
    case 'command':
      return [
        { label: 'Type', value: change.type },
        { label: 'Line', value: change.line },
        ...(change.lineWindows === undefined
          ? []
          : [{ label: 'Windows', value: change.lineWindows }]),
        ...(change.lineLinux === undefined ? [] : [{ label: 'Linux', value: change.lineLinux }]),
        { label: 'Runs in', value: placeOf(change.repository, change.folder) },
        ...(change.check === true ? [{ label: 'Check', value: 'yes' }] : []),
        ...(change.atOpen === true ? [{ label: 'Runs when Hemera opens', value: 'yes' }] : []),
        ...(change.askBeforeRunning === true
          ? [{ label: 'Asks before running', value: 'yes' }]
          : []),
        ...(change.readOnly === true ? [{ label: 'Writes nothing', value: 'yes' }] : []),
        ...((change.writeGlobs ?? []).length === 0
          ? []
          : [{ label: 'Writes', value: (change.writeGlobs ?? []).join(', ') }]),
      ]
    case 'step':
      if (change.step !== 'run') {
        return [
          { label: change.step === 'copy' ? 'Copies' : 'Links', value: change.path ?? '' },
          { label: 'Under', value: placeOf(change.repository, undefined) },
        ]
      }
      return change.command === undefined
        ? [
            { label: 'Line', value: change.line ?? '' },
            { label: 'Runs in', value: placeOf(change.repository, change.path) },
          ]
        : [{ label: 'Command', value: change.command }]
    case 'variable':
      return [
        { label: 'Scope', value: 'the Project' },
        { label: 'Value', value: change.replaces ? 'replaced, not shown' : 'set, not shown' },
      ]
  }
}

/** Where a card stands: waiting for the user, or decided once and for all. */
export const SETUP_CARD_STATES = ['pending', 'accepted', 'declined'] as const
export const SetupCardState = Schema.Literals(SETUP_CARD_STATES)
export type SetupCardState = typeof SetupCardState.Type

/** What the setup session's state reads as, for the new-Project screen. */
export const SETUP_STATES = ['none', 'waiting', 'working', 'done', 'failed'] as const
export const SetupState = Schema.Literals(SETUP_STATES)
export type SetupState = typeof SetupState.Type

/** The line `setup_read` says of a folder that is no repository and declares none. */
export const NO_REPOSITORY_IN_MAIN =
  'no repository in main: the Project folder is not a Git repository and no repository is declared'

/** What a card refused at the click says when its value is no longer held. */
export const VALUE_FORGOTTEN = 'the value is no longer held; ask for a new proposal'
