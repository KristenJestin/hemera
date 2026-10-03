/**
 * What the engine answers: its status (which version and channel, on which data folder, and
 * where the Profile's database stands), every change of it, and the calls on the Profile, its
 * Projects and their repositories included.
 */

import { EngineRpcs, type EngineStart, type EngineStatus } from '@hemera/ipc'
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
  return EngineRpcs.toLayer({
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
  })
}
