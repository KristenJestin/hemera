/**
 * What the engine answers: its status (which version and channel, on which data folder, and
 * where the Profile's database stands), every change of it, and the calls on the Profile, its
 * Projects, their repositories, their Workspaces and their commands included; and, from main
 * alone, that the window is shown.
 */

import { EngineMainRpcs, type EngineStart, type EngineStatus } from '@hemera/ipc'
import { Stream, SubscriptionRef } from 'effect'
import { Effect } from 'effect'

import { observed, observedStream, type Log } from '../main/diagnostic.ts'
import type { StartedProfile } from './profile.ts'
import {
  addRepository,
  createProject,
  detectRepositories,
  getProject,
  listProjects,
  projectChanges,
  removeRepository,
  setBaseBranch,
  setBranchPrefix,
  setRemote,
  setWorkspacesRoot,
  updateProject,
  updateRepository,
} from './projects.ts'
import {
  repositoryChanges,
  repositoryRemotes,
  repositoryStatus,
  upToDateBase,
} from './repositories.ts'
import { checkLine, listCommands, removeCommand, saveCommand } from './catalogue.ts'
import { beginPreparation } from './preparation.ts'
import { checkRecipe, getRecipe, saveRecipe } from './recipe.ts'
import { listRuns, restartRun, runChanges, runOutput, startRun, stopRun } from './runs.ts'
import { listVariables, removeVariable, revealVariable, setVariable } from './variables.ts'
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  workspaceChanges,
  workspaceStatus,
} from './workspaces.ts'

export const engineHandlers = (start: EngineStart, profile: StartedProfile, log: Log) => {
  const { dataFolder, channel, version } = start
  const statusOf = (database: EngineStatus['database']): EngineStatus => ({
    ready: true,
    version,
    channel,
    dataFolder,
    database,
  })
  const { calls, use, follow } = profile
  return EngineMainRpcs.toLayer({
    'engine.status': () =>
      SubscriptionRef.get(profile.database).pipe(
        Effect.map(statusOf),
        observed('engine.status', log),
      ),
    'engine.statusChanges': () =>
      SubscriptionRef.changes(profile.database).pipe(
        Stream.map(statusOf),
        observedStream('engine.statusChanges', log),
      ),
    'preferences.read': () => calls.readPreferences.pipe(observed('preferences.read', log)),
    'preferences.write': (change) =>
      calls.writePreferences(change).pipe(observed('preferences.write', log)),
    'profile.backups': () => calls.backups.pipe(observed('profile.backups', log)),
    'profile.backup': ({ folder }) => calls.backup(folder).pipe(observed('profile.backup', log)),
    'profile.restore': ({ folder }) => calls.restore(folder).pipe(observed('profile.restore', log)),
    'projects.list': () => use(listProjects).pipe(observed('projects.list', log)),
    'projects.get': ({ id }) => use(getProject(id)).pipe(observed('projects.get', log)),
    'projects.create': (asked) => use(createProject(asked)).pipe(observed('projects.create', log)),
    'projects.update': (edit) => use(updateProject(edit)).pipe(observed('projects.update', log)),
    'projects.detectRepositories': ({ folder }) =>
      use(detectRepositories(folder)).pipe(observed('projects.detectRepositories', log)),
    'projects.setWorkspacesRoot': (edit) =>
      use(setWorkspacesRoot(edit)).pipe(observed('projects.setWorkspacesRoot', log)),
    'projects.setBranchPrefix': (edit) =>
      use(setBranchPrefix(edit)).pipe(observed('projects.setBranchPrefix', log)),
    'projects.changes': () => follow(projectChanges).pipe(observedStream('projects.changes', log)),
    'repositories.add': (asked) =>
      use(addRepository(asked)).pipe(observed('repositories.add', log)),
    'repositories.remove': (edit) =>
      use(removeRepository(edit)).pipe(observed('repositories.remove', log)),
    'repositories.update': (edit) =>
      use(updateRepository(edit)).pipe(observed('repositories.update', log)),
    'repositories.status': ({ id }) =>
      use(repositoryStatus(id)).pipe(observed('repositories.status', log)),
    'repositories.remotes': ({ id }) =>
      use(repositoryRemotes(id)).pipe(observed('repositories.remotes', log)),
    'repositories.setRemote': (edit) =>
      use(setRemote(edit)).pipe(observed('repositories.setRemote', log)),
    'repositories.setBaseBranch': (edit) =>
      use(setBaseBranch(edit)).pipe(observed('repositories.setBaseBranch', log)),
    'repositories.upToDateBase': ({ id }) =>
      use(upToDateBase(id)).pipe(observed('repositories.upToDateBase', log)),
    'repositories.changes': () =>
      follow(repositoryChanges).pipe(observedStream('repositories.changes', log)),
    'workspaces.create': (asked) =>
      use(createWorkspace(asked)).pipe(observed('workspaces.create', log)),
    'workspaces.get': ({ id }) => use(getWorkspace(id)).pipe(observed('workspaces.get', log)),
    'workspaces.list': ({ projectId }) =>
      use(listWorkspaces(projectId)).pipe(observed('workspaces.list', log)),
    'workspaces.status': ({ projectId, workspaceId }) =>
      use(workspaceStatus(projectId, workspaceId)).pipe(observed('workspaces.status', log)),
    'workspaces.prepare': ({ id }) =>
      use(beginPreparation(id, false)).pipe(observed('workspaces.prepare', log)),
    'workspaces.resume': ({ id }) =>
      use(beginPreparation(id, true)).pipe(observed('workspaces.resume', log)),
    'workspaces.remove': ({ id }) =>
      use(removeWorkspace(id)).pipe(observed('workspaces.remove', log)),
    'workspaces.changes': () =>
      follow(workspaceChanges).pipe(observedStream('workspaces.changes', log)),
    'recipe.get': ({ projectId }) => use(getRecipe(projectId)).pipe(observed('recipe.get', log)),
    'recipe.save': (edit) => use(saveRecipe(edit)).pipe(observed('recipe.save', log)),
    'recipe.check': ({ projectId, steps }) =>
      use(checkRecipe(projectId, steps)).pipe(observed('recipe.check', log)),
    'variables.list': (scope) => use(listVariables(scope)).pipe(observed('variables.list', log)),
    'variables.set': (edit) => use(setVariable(edit)).pipe(observed('variables.set', log)),
    'variables.remove': (asked) =>
      use(removeVariable(asked)).pipe(observed('variables.remove', log)),
    'variables.reveal': (asked) =>
      use(revealVariable(asked)).pipe(observed('variables.reveal', log)),
    'catalogue.list': ({ projectId }) =>
      use(listCommands(projectId)).pipe(observed('catalogue.list', log)),
    'catalogue.save': (save) => use(saveCommand(save)).pipe(observed('catalogue.save', log)),
    'catalogue.remove': ({ projectId, id }) =>
      use(removeCommand(projectId, id)).pipe(observed('catalogue.remove', log)),
    'catalogue.checkLine': ({ line }) => checkLine(line).pipe(observed('catalogue.checkLine', log)),
    'runs.list': ({ projectId, workspaceId }) =>
      use(listRuns(projectId, workspaceId)).pipe(observed('runs.list', log)),
    // Started from the window: the user starts it.
    'runs.start': (asked) =>
      use(startRun({ ...asked, startedBy: 'user', sessionId: null })).pipe(
        observed('runs.start', log),
      ),
    'runs.stop': ({ id }) => use(stopRun(id)).pipe(observed('runs.stop', log)),
    'runs.restart': ({ id }) => use(restartRun(id)).pipe(observed('runs.restart', log)),
    'runs.output': ({ id }) => use(runOutput(id)).pipe(observed('runs.output', log)),
    'runs.changes': () => follow(runChanges).pipe(observedStream('runs.changes', log)),
    'engine.windowShown': () => profile.windowShown.pipe(observed('engine.windowShown', log)),
  })
}
