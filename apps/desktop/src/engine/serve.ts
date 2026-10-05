/**
 * What the engine answers: its status (which version and channel, on which data folder, and
 * where the Profile's database stands), every change of it, and the calls on the Profile, its
 * Projects, their repositories, their Workspaces, their commands, their missions and the needs
 * included, and the coding agents with their state and updates; and, from main alone, that the
 * window is shown.
 */

import { EngineMainRpcs, type EngineStart, type EngineStatus } from '@hemera/ipc'
import { Layer, Stream, SubscriptionRef } from 'effect'
import { Effect } from 'effect'

import { observed, observedStream, type Log } from '../main/diagnostic.ts'
import { Agents, machineAgentsLayer } from './agents/service.ts'
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
import { createMission, getMission, listMissions, missionChanges, moveMission } from './missions.ts'
import { answerNeed, getNeed, listNeeds, retryNeed } from './needs.ts'
import { listGrants, revokeGrant } from './permissions/grants.ts'
import { HemeraAuto, decisionChanges, whoJudgesFor } from './permissions/hemera-auto.ts'
import { neverList, setNeverList } from './permissions/never-list.ts'
import {
  REGISTRY,
  noticeFeed,
  readNotificationSettings,
  setNotificationKind,
  setNotificationSound,
  setSoundStyle,
} from './notifications.ts'
import { MAX_AGE_DAYS, MAX_TOTAL_MEGABYTES } from './retention.ts'
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
    'diagnostics.retention': () =>
      Effect.succeed({
        folder: dataFolder,
        maxAgeDays: MAX_AGE_DAYS,
        maxTotalMegabytes: MAX_TOTAL_MEGABYTES,
      }).pipe(observed('diagnostics.retention', log)),
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
    'missions.list': ({ projectId }) =>
      use(listMissions(projectId)).pipe(observed('missions.list', log)),
    'missions.get': ({ id }) => use(getMission(id)).pipe(observed('missions.get', log)),
    'missions.create': (asked) => use(createMission(asked)).pipe(observed('missions.create', log)),
    // The moves the window asks for are the user's: an agent never reaches them.
    'missions.freeze': ({ id }) =>
      use(moveMission(id, 'freeze', 'user')).pipe(observed('missions.freeze', log)),
    'missions.backToPlanning': ({ id }) =>
      use(moveMission(id, 'backToPlanning', 'user')).pipe(observed('missions.backToPlanning', log)),
    'missions.launch': ({ id }) =>
      use(moveMission(id, 'launch', 'user')).pipe(observed('missions.launch', log)),
    'missions.fix': ({ id }) =>
      use(moveMission(id, 'fix', 'user')).pipe(observed('missions.fix', log)),
    'missions.ship': ({ id }) =>
      use(moveMission(id, 'ship', 'user')).pipe(observed('missions.ship', log)),
    'missions.cancel': ({ id }) =>
      use(moveMission(id, 'cancel', 'user')).pipe(observed('missions.cancel', log)),
    'missions.changes': () => follow(missionChanges).pipe(observedStream('missions.changes', log)),
    'needs.list': () => use(listNeeds).pipe(observed('needs.list', log)),
    'needs.get': ({ id }) => use(getNeed(id)).pipe(observed('needs.get', log)),
    'needs.answer': (asked) => use(answerNeed(asked)).pipe(observed('needs.answer', log)),
    'needs.retry': ({ id }) => use(retryNeed(id)).pipe(observed('needs.retry', log)),
    'permissions.neverList': ({ projectId }) =>
      use(neverList(projectId)).pipe(observed('permissions.neverList', log)),
    'permissions.setNeverList': ({ projectId, entries }) =>
      use(setNeverList(projectId, entries)).pipe(observed('permissions.setNeverList', log)),
    'permissions.grants': ({ missionId }) =>
      use(listGrants(missionId)).pipe(observed('permissions.grants', log)),
    'permissions.revoke': ({ grantId }) =>
      use(revokeGrant(grantId)).pipe(observed('permissions.revoke', log)),
    'permissions.decisions': () =>
      follow(decisionChanges).pipe(observedStream('permissions.decisions', log)),
    'hemeraAuto.setConsent': ({ consent }) =>
      use(HemeraAuto.use((auto) => auto.setConsent(consent))).pipe(
        observed('hemeraAuto.setConsent', log),
      ),
    'hemeraAuto.whoJudges': ({ agent, mode }) =>
      use(whoJudgesFor(agent, mode)).pipe(observed('hemeraAuto.whoJudges', log)),
    // The key itself is main's alone: what main sealed is stored, what main decrypted is held.
    'jevKey.state': () =>
      use(HemeraAuto.use((auto) => auto.state)).pipe(observed('jevKey.state', log)),
    'jevKey.ciphertext': () =>
      use(HemeraAuto.use((auto) => auto.ciphertext)).pipe(observed('jevKey.ciphertext', log)),
    'jevKey.store': ({ ciphertext }) =>
      use(HemeraAuto.use((auto) => auto.storeKey(ciphertext))).pipe(observed('jevKey.store', log)),
    'jevKey.restore': ({ key }) =>
      use(HemeraAuto.use((auto) => auto.restoreKey(key))).pipe(observed('jevKey.restore', log)),
    'jevKey.remove': () =>
      use(HemeraAuto.use((auto) => auto.removeKey)).pipe(observed('jevKey.remove', log)),
    'agents.list': () => Agents.use((agents) => agents.list).pipe(observed('agents.list', log)),
    'agents.checkUpdates': () =>
      Agents.use((agents) => agents.checkUpdates).pipe(observed('agents.checkUpdates', log)),
    // Run only because the user asked, from the window.
    'agents.update': ({ agent }) =>
      Agents.use((agents) => agents.update(agent)).pipe(observed('agents.update', log)),
    'notifications.settings': () =>
      use(readNotificationSettings(REGISTRY)).pipe(observed('notifications.settings', log)),
    'notifications.setKind': ({ id, on }) =>
      use(setNotificationKind(REGISTRY, id, on)).pipe(observed('notifications.setKind', log)),
    'notifications.setSound': ({ sound, on }) =>
      use(setNotificationSound(REGISTRY, sound, on)).pipe(observed('notifications.setSound', log)),
    'notifications.setStyle': ({ style }) =>
      use(setSoundStyle(REGISTRY, style)).pipe(observed('notifications.setStyle', log)),
    'notifications.feed': () =>
      follow(noticeFeed(REGISTRY)).pipe(observedStream('notifications.feed', log)),
    'engine.windowShown': () => profile.windowShown.pipe(observed('engine.windowShown', log)),
  }).pipe(Layer.provide(machineAgentsLayer()))
}
