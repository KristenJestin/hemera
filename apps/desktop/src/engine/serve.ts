/**
 * What the engine answers: its status (which version and channel, on which data folder, and
 * where the Profile's database stands), every change of it, and the calls on the Profile, its
 * Projects, their repositories, their Workspaces, their commands, their missions and the needs
 * included, and the coding agents with their state and updates; and, from main alone, that the
 * window is shown.
 */

import {
  ChatRefused,
  EngineMainRpcs,
  type EngineStart,
  type EngineStatus,
  SetupRefused,
  TesterFolderUnreadable,
} from '@hemera/ipc'
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
import { Evidence, Memory } from './memory/index.ts'
import {
  REGISTRY,
  noticeFeed,
  readNotificationSettings,
  setNotificationKind,
  setNotificationSound,
  setSoundStyle,
} from './notifications.ts'
import { MAX_AGE_DAYS, MAX_TOTAL_MEGABYTES } from './retention.ts'
import { missionBudget, projectLimits, setProjectLimits } from './budget.ts'
import { Chats } from './chat/service.ts'
import { type Chat, chatChanges, chatsOf, renameChat, transcriptOf } from './chat/store.ts'
import { acceptAll, acceptCard, cardsOf, declineCard, setupChanges } from './setup/cards.ts'
import { Setup } from './setup/service.ts'
import { TesterFindings } from './tester/findings.ts'
import { markModel, modelMarksOf, roleModelsOf, setRoleModel } from './sessions/cascade.ts'
import { instructionFilesOf } from './sessions/instructions.ts'
import { ownerOf, sessionsIn } from './sessions/store.ts'
import { threadOf } from './sessions/thread.ts'
import { SESSION_STATES } from '@hemera/core/domain'
import { createStart, searchStart } from './start/field.ts'
import { giveVision, keepPlanning, specChanges } from './planning/calls.ts'
import {
  changesSince,
  markRead,
  readSpec,
  setSpecLanguage,
  specLanguageOf,
} from './planning/store.ts'
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  workspaceChanges,
  workspaceStatus,
} from './workspaces.ts'

/** A Chat as its Project's list shows it. */
const chatSummary = (chat: Chat) => ({
  id: chat.id,
  projectId: chat.projectId,
  title: chat.title,
  setting: chat.setting,
  createdAt: chat.createdAt,
  lastActivityAt: chat.lastActivityAt,
})

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
    // The sessions are read for diagnosis only: nothing here writes to one.
    'sessions.list': ({ ownerKind, ownerId }) =>
      use(
        Effect.map(sessionsIn(SESSION_STATES, ownerOf(ownerKind, ownerId)), (sessions) =>
          sessions.map((session) => ({
            id: session.id,
            provider: session.provider,
            role: session.role,
            lineage: session.lineage,
            parent: session.parent,
            depth: session.depth,
            epoch: session.epoch,
            state: session.state,
            stateReason: session.stateReason,
            createdAt: session.createdAt,
            endedAt: session.endedAt,
          })),
        ),
      ).pipe(observed('sessions.list', log)),
    'sessions.thread': ({ id }) => use(threadOf(id)).pipe(observed('sessions.thread', log)),
    'sessions.instructionFiles': ({ projectId }) =>
      use(instructionFilesOf(projectId, process.platform)).pipe(
        observed('sessions.instructionFiles', log),
      ),
    'chats.list': ({ projectId }) =>
      use(
        Effect.gen(function* () {
          yield* getProject(projectId)
          return (yield* chatsOf(projectId)).map(chatSummary)
        }),
      ).pipe(observed('chats.list', log)),
    'chats.create': ({ projectId }) =>
      use(Chats.use((chats) => chats.create(projectId))).pipe(
        Effect.map(chatSummary),
        observed('chats.create', log),
      ),
    'chats.rename': ({ chatId, title }) =>
      use(renameChat(chatId, title)).pipe(observed('chats.rename', log)),
    'chats.send': ({ chatId, text, mentions }) =>
      use(
        Chats.use((chats) => chats.send(chatId, text, mentions)).pipe(
          Effect.catchTags({
            SessionRefused: (refused) => Effect.fail(new ChatRefused({ reason: refused.reason })),
            DeliveryKindRefused: (refused) =>
              Effect.fail(new ChatRefused({ reason: refused.reason })),
          }),
        ),
      ).pipe(observed('chats.send', log)),
    'chats.stop': ({ chatId }) =>
      use(Chats.use((chats) => chats.stop(chatId))).pipe(observed('chats.stop', log)),
    'chats.setModel': ({ chatId, setting }) =>
      use(Chats.use((chats) => chats.setSetting(chatId, setting))).pipe(
        observed('chats.setModel', log),
      ),
    'chats.transcript': ({ chatId, before }) =>
      use(transcriptOf(chatId, before)).pipe(observed('chats.transcript', log)),
    'chats.changes': () => follow(chatChanges).pipe(observedStream('chats.changes', log)),
    'setup.cards': ({ projectId }) =>
      use(Effect.andThen(getProject(projectId), cardsOf(projectId))).pipe(
        observed('setup.cards', log),
      ),
    'setup.accept': ({ cardId }) => use(acceptCard(cardId)).pipe(observed('setup.accept', log)),
    'setup.decline': ({ cardId }) => use(declineCard(cardId)).pipe(observed('setup.decline', log)),
    'setup.acceptAll': ({ projectId }) =>
      use(Effect.andThen(getProject(projectId), acceptAll(projectId))).pipe(
        observed('setup.acceptAll', log),
      ),
    'setup.propose': ({ projectId }) =>
      use(
        Setup.use((setup) => setup.start(projectId)).pipe(
          Effect.asVoid,
          Effect.catchTags({
            SetupBusy: (busy) => Effect.fail(new SetupRefused({ reason: busy.message })),
            SessionRefused: (refused) => Effect.fail(new SetupRefused({ reason: refused.reason })),
          }),
        ),
      ).pipe(observed('setup.propose', log)),
    'setup.standing': ({ projectId }) =>
      use(Setup.use((setup) => setup.standing(projectId))).pipe(observed('setup.standing', log)),
    'setup.changes': () => follow(setupChanges).pipe(observedStream('setup.changes', log)),
    'tester.findings': () =>
      use(
        TesterFindings.use((findings) => findings.list).pipe(
          Effect.map((all) =>
            all.map(({ head, file }) => ({
              number: head.number,
              title: head.title,
              kind: head.kind,
              place: head.place,
              severity: head.severity,
              occurrences: head.occurrences,
              lastSeen: head.lastSeen,
              file,
            })),
          ),
          Effect.mapError((failed) => new TesterFolderUnreadable({ reason: failed.message })),
        ),
      ).pipe(observed('tester.findings', log)),
    'tester.folder': () =>
      use(TesterFindings.use((findings) => Effect.succeed(findings.folder))).pipe(
        observed('tester.folder', log),
      ),
    'models.roles': ({ projectId, missionId }) =>
      use(roleModelsOf(projectId, missionId)).pipe(observed('models.roles', log)),
    'models.setRole': ({ level, scopeId, role, setting }) =>
      use(setRoleModel(level, scopeId, role, setting)).pipe(observed('models.setRole', log)),
    'models.marks': () => use(modelMarksOf).pipe(observed('models.marks', log)),
    'models.mark': (mark) => use(markModel(mark)).pipe(observed('models.mark', log)),
    'limits.project': ({ projectId }) =>
      use(projectLimits(projectId)).pipe(observed('limits.project', log)),
    'limits.setProject': ({ projectId, limits }) =>
      use(setProjectLimits(projectId, limits)).pipe(observed('limits.setProject', log)),
    'limits.mission': ({ missionId }) =>
      use(missionBudget(missionId)).pipe(observed('limits.mission', log)),
    'memory.now': ({ missionId }) =>
      use(Memory.use((memory) => memory.now(missionId))).pipe(observed('memory.now', log)),
    'memory.journal': ({ missionId, before }) =>
      use(Memory.use((memory) => memory.journal(missionId, before))).pipe(
        observed('memory.journal', log),
      ),
    'memory.notes': ({ missionId, all }) =>
      use(Memory.use((memory) => memory.notes(missionId, all))).pipe(observed('memory.notes', log)),
    'memory.evidenceList': ({ missionId, about }) =>
      use(
        Memory.use((memory) =>
          Effect.andThen(
            Effect.andThen(memory.now(missionId), memory.ready),
            Evidence.use((evidence) => evidence.list(missionId, about)),
          ),
        ),
      ).pipe(observed('memory.evidenceList', log)),
    'memory.evidence': ({ missionId, id }) =>
      use(
        Memory.use((memory) =>
          Effect.andThen(
            memory.ready,
            Evidence.use((evidence) => evidence.read(missionId, id)),
          ),
        ),
      ).pipe(observed('memory.evidence', log)),
    'memory.changes': ({ missionId }) =>
      follow(
        Stream.unwrap(
          Memory.use((memory) => Effect.as(memory.now(missionId), memory.changes(missionId))),
        ),
      ).pipe(observedStream('memory.changes', log)),
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
    // The field searches first and creates only on the user's explicit choice (#84).
    'start.search': ({ projectId, text }) =>
      follow(searchStart(projectId, text)).pipe(observedStream('start.search', log)),
    'start.create': (asked) => use(createStart(asked)).pipe(observed('start.create', log)),
    // Planning (#85): the Spec the Planner writes, and the user's side of it.
    'planning.spec': ({ missionId }) =>
      use(readSpec(missionId)).pipe(observed('planning.spec', log)),
    'planning.changesSince': ({ missionId, version: since }) =>
      use(changesSince(missionId, since)).pipe(observed('planning.changesSince', log)),
    'planning.markRead': ({ missionId, version: read }) =>
      use(markRead(missionId, read)).pipe(observed('planning.markRead', log)),
    'planning.addVision': ({ missionId, text }) =>
      use(giveVision(missionId, text)).pipe(observed('planning.addVision', log)),
    'planning.keepAfterTriage': ({ missionId }) =>
      use(keepPlanning(missionId)).pipe(observed('planning.keepAfterTriage', log)),
    'planning.changed': ({ missionId }) =>
      follow(specChanges(missionId)).pipe(observedStream('planning.changed', log)),
    'planning.specLanguage': ({ projectId }) =>
      use(specLanguageOf(projectId)).pipe(observed('planning.specLanguage', log)),
    'planning.setSpecLanguage': ({ projectId, language }) =>
      use(setSpecLanguage(projectId, language)).pipe(observed('planning.setSpecLanguage', log)),
    'engine.windowShown': () => profile.windowShown.pipe(observed('engine.windowShown', log)),
  }).pipe(Layer.provide(machineAgentsLayer()))
}
