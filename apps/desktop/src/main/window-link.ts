/**
 * What main answers the window: the engine's calls, forwarded, and its own.
 *
 * A forwarded call is a call in flight on both links: a window that goes away interrupts it in
 * main, which interrupts it in the engine, and an engine that dies fails it in main with
 * `EngineGone`, which reaches the window as such. Nothing waits on a clock.
 *
 * The preferences pass through main on their way: whatever the engine answers of them is what
 * main paints the next start from (`display-sidecar.ts`) and the theme the window wears now.
 */

import {
  closedAs,
  EngineGone,
  streamClosedAs,
  WindowRpcs,
  type EngineMainRpcs,
  type EnvironmentReport,
  type HemeraAutoStatus,
  type InvalidProviderConfig,
  type JiraTokenStatus,
  type UnknownTicketProvider,
  type Preferences,
  type PreferencesChange,
  type Sound,
  type SoundPreview,
  type SoundStyle,
  type StorageFailed,
  type WindowNotice,
} from '@hemera/ipc'
import { Effect } from 'effect'
import type { Stream } from 'effect'
import type { RpcClient, RpcClientError, RpcGroup } from 'effect/rpc'

import { observed, observedStream, type Log } from './diagnostic.ts'

export type EngineClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof EngineMainRpcs>,
  RpcClientError.RpcClientError
>

/** What main does itself when the window asks. */
export interface Application {
  readonly report: Effect.Effect<EnvironmentReport>
  readonly relaunch: Effect.Effect<void>
  /** Shows the diagnostic log in the system's file manager. */
  readonly showLog: Effect.Effect<void>
  /** The system's own folder picker: the folder chosen, or null when none was. */
  readonly chooseFolder: Effect.Effect<string | null>
  /** The preferences the engine answered: worn now, and kept for the next start's first frame. */
  readonly display: (preferences: Preferences) => Effect.Effect<void>
  /** What main tells the window of notifications, from the moment it listens. */
  readonly notices: Stream.Stream<WindowNotice>
  /** Plays one sound of one style once, as a notification would. */
  readonly preview: (style: SoundStyle, sound: Sound) => Effect.Effect<SoundPreview>
  /** Hemera Auto's key, which main alone seals: where it stands, saved, removed. */
  readonly hemeraAuto: {
    readonly status: Effect.Effect<HemeraAutoStatus, StorageFailed | EngineGone>
    readonly save: (key: string) => Effect.Effect<HemeraAutoStatus, StorageFailed | EngineGone>
    readonly remove: Effect.Effect<HemeraAutoStatus, StorageFailed | EngineGone>
  }
  /** A Jira provider's token, which main alone seals (#96): where it stands, saved, removed. */
  readonly jiraToken: {
    readonly status: (providerId: string) => Effect.Effect<JiraTokenStatus, TokenRefused>
    readonly save: (
      providerId: string,
      token: string,
    ) => Effect.Effect<JiraTokenStatus, TokenRefused>
    readonly remove: (providerId: string) => Effect.Effect<JiraTokenStatus, TokenRefused>
  }
}

type TokenRefused = StorageFailed | EngineGone | UnknownTicketProvider | InvalidProviderConfig

const gone = () => new EngineGone()

/** The preferences as the engine has them, worn by main; a failure is left to the caller. */
export const refreshDisplay = (engine: EngineClient, application: Application) =>
  engine['preferences.read']().pipe(closedAs(gone), Effect.tap(application.display))

/** A change of the preferences, written by the engine, then worn by main. */
export const changePreferences =
  (engine: EngineClient, application: Application) => (change: PreferencesChange) =>
    engine['preferences.write'](change).pipe(
      closedAs(gone),
      Effect.andThen(refreshDisplay(engine, application)),
      Effect.asVoid,
    )

/** A restore staged by the engine, then the relaunch that applies it. */
export const restoreProfile =
  (engine: EngineClient, application: Application) => (folder: string) =>
    engine['profile.restore']({ folder }).pipe(closedAs(gone), Effect.andThen(application.relaunch))

export const windowHandlers = (engine: EngineClient, application: Application, log: Log) =>
  WindowRpcs.toLayer({
    'engine.status': () =>
      engine['engine.status']().pipe(closedAs(gone), observed('engine.status', log)),
    'engine.statusChanges': () =>
      engine['engine.statusChanges']().pipe(
        streamClosedAs(gone),
        observedStream('engine.statusChanges', log),
      ),
    'preferences.read': () =>
      refreshDisplay(engine, application).pipe(observed('preferences.read', log)),
    'preferences.write': (change) =>
      changePreferences(engine, application)(change).pipe(observed('preferences.write', log)),
    'profile.backups': () =>
      engine['profile.backups']().pipe(closedAs(gone), observed('profile.backups', log)),
    'diagnostics.retention': () =>
      engine['diagnostics.retention']().pipe(
        closedAs(gone),
        observed('diagnostics.retention', log),
      ),
    'profile.backup': (request) =>
      engine['profile.backup'](request).pipe(closedAs(gone), observed('profile.backup', log)),
    // A restore takes effect at the next start: once the engine has staged it, Hemera relaunches.
    'profile.restore': ({ folder }) =>
      restoreProfile(engine, application)(folder).pipe(observed('profile.restore', log)),
    // The Projects and their repositories are the engine's alone: forwarded as they are.
    'projects.list': () =>
      engine['projects.list']().pipe(closedAs(gone), observed('projects.list', log)),
    'projects.get': (request) =>
      engine['projects.get'](request).pipe(closedAs(gone), observed('projects.get', log)),
    'projects.create': (request) =>
      engine['projects.create'](request).pipe(closedAs(gone), observed('projects.create', log)),
    'projects.update': (request) =>
      engine['projects.update'](request).pipe(closedAs(gone), observed('projects.update', log)),
    'projects.detectRepositories': (request) =>
      engine['projects.detectRepositories'](request).pipe(
        closedAs(gone),
        observed('projects.detectRepositories', log),
      ),
    'projects.setWorkspacesRoot': (request) =>
      engine['projects.setWorkspacesRoot'](request).pipe(
        closedAs(gone),
        observed('projects.setWorkspacesRoot', log),
      ),
    'projects.setBranchPrefix': (request) =>
      engine['projects.setBranchPrefix'](request).pipe(
        closedAs(gone),
        observed('projects.setBranchPrefix', log),
      ),
    'projects.setKeyPrefix': (request) =>
      engine['projects.setKeyPrefix'](request).pipe(
        closedAs(gone),
        observed('projects.setKeyPrefix', log),
      ),
    'repositories.add': (request) =>
      engine['repositories.add'](request).pipe(closedAs(gone), observed('repositories.add', log)),
    'repositories.remove': (request) =>
      engine['repositories.remove'](request).pipe(
        closedAs(gone),
        observed('repositories.remove', log),
      ),
    'repositories.update': (request) =>
      engine['repositories.update'](request).pipe(
        closedAs(gone),
        observed('repositories.update', log),
      ),
    'repositories.status': (request) =>
      engine['repositories.status'](request).pipe(
        closedAs(gone),
        observed('repositories.status', log),
      ),
    'repositories.remotes': (request) =>
      engine['repositories.remotes'](request).pipe(
        closedAs(gone),
        observed('repositories.remotes', log),
      ),
    'repositories.setRemote': (request) =>
      engine['repositories.setRemote'](request).pipe(
        closedAs(gone),
        observed('repositories.setRemote', log),
      ),
    'repositories.setBaseBranch': (request) =>
      engine['repositories.setBaseBranch'](request).pipe(
        closedAs(gone),
        observed('repositories.setBaseBranch', log),
      ),
    'repositories.upToDateBase': (request) =>
      engine['repositories.upToDateBase'](request).pipe(
        closedAs(gone),
        observed('repositories.upToDateBase', log),
      ),
    'projects.changes': () =>
      engine['projects.changes']().pipe(
        streamClosedAs(gone),
        observedStream('projects.changes', log),
      ),
    'repositories.changes': () =>
      engine['repositories.changes']().pipe(
        streamClosedAs(gone),
        observedStream('repositories.changes', log),
      ),
    // The Workspaces, their recipe and their variables are the engine's alone: forwarded as they are.
    'workspaces.create': (request) =>
      engine['workspaces.create'](request).pipe(closedAs(gone), observed('workspaces.create', log)),
    'workspaces.get': (request) =>
      engine['workspaces.get'](request).pipe(closedAs(gone), observed('workspaces.get', log)),
    'workspaces.list': (request) =>
      engine['workspaces.list'](request).pipe(closedAs(gone), observed('workspaces.list', log)),
    'workspaces.status': (request) =>
      engine['workspaces.status'](request).pipe(closedAs(gone), observed('workspaces.status', log)),
    'workspaces.prepare': (request) =>
      engine['workspaces.prepare'](request).pipe(
        closedAs(gone),
        observed('workspaces.prepare', log),
      ),
    'workspaces.resume': (request) =>
      engine['workspaces.resume'](request).pipe(closedAs(gone), observed('workspaces.resume', log)),
    'workspaces.remove': (request) =>
      engine['workspaces.remove'](request).pipe(closedAs(gone), observed('workspaces.remove', log)),
    'workspaces.changes': () =>
      engine['workspaces.changes']().pipe(
        streamClosedAs(gone),
        observedStream('workspaces.changes', log),
      ),
    'recipe.get': (request) =>
      engine['recipe.get'](request).pipe(closedAs(gone), observed('recipe.get', log)),
    'recipe.save': (request) =>
      engine['recipe.save'](request).pipe(closedAs(gone), observed('recipe.save', log)),
    'recipe.check': (request) =>
      engine['recipe.check'](request).pipe(closedAs(gone), observed('recipe.check', log)),
    'variables.list': (request) =>
      engine['variables.list'](request).pipe(closedAs(gone), observed('variables.list', log)),
    'variables.set': (request) =>
      engine['variables.set'](request).pipe(closedAs(gone), observed('variables.set', log)),
    'variables.remove': (request) =>
      engine['variables.remove'](request).pipe(closedAs(gone), observed('variables.remove', log)),
    'variables.reveal': (request) =>
      engine['variables.reveal'](request).pipe(closedAs(gone), observed('variables.reveal', log)),
    // The commands and their runs are the engine's alone: forwarded as they are.
    'catalogue.list': (request) =>
      engine['catalogue.list'](request).pipe(closedAs(gone), observed('catalogue.list', log)),
    'catalogue.save': (request) =>
      engine['catalogue.save'](request).pipe(closedAs(gone), observed('catalogue.save', log)),
    'catalogue.remove': (request) =>
      engine['catalogue.remove'](request).pipe(closedAs(gone), observed('catalogue.remove', log)),
    'catalogue.checkLine': (request) =>
      engine['catalogue.checkLine'](request).pipe(
        closedAs(gone),
        observed('catalogue.checkLine', log),
      ),
    'runs.list': (request) =>
      engine['runs.list'](request).pipe(closedAs(gone), observed('runs.list', log)),
    'runs.start': (request) =>
      engine['runs.start'](request).pipe(closedAs(gone), observed('runs.start', log)),
    'runs.stop': (request) =>
      engine['runs.stop'](request).pipe(closedAs(gone), observed('runs.stop', log)),
    'runs.restart': (request) =>
      engine['runs.restart'](request).pipe(closedAs(gone), observed('runs.restart', log)),
    'runs.output': (request) =>
      engine['runs.output'](request).pipe(closedAs(gone), observed('runs.output', log)),
    'runs.changes': () =>
      engine['runs.changes']().pipe(streamClosedAs(gone), observedStream('runs.changes', log)),
    // The missions and the needs are the engine's alone: forwarded as they are.
    'missions.list': (request) =>
      engine['missions.list'](request).pipe(closedAs(gone), observed('missions.list', log)),
    'missions.get': (request) =>
      engine['missions.get'](request).pipe(closedAs(gone), observed('missions.get', log)),
    'missions.create': (request) =>
      engine['missions.create'](request).pipe(closedAs(gone), observed('missions.create', log)),
    'missions.launch': (request) =>
      engine['missions.launch'](request).pipe(closedAs(gone), observed('missions.launch', log)),
    'missions.fix': (request) =>
      engine['missions.fix'](request).pipe(closedAs(gone), observed('missions.fix', log)),
    'missions.ship': (request) =>
      engine['missions.ship'](request).pipe(closedAs(gone), observed('missions.ship', log)),
    'missions.cancel': (request) =>
      engine['missions.cancel'](request).pipe(closedAs(gone), observed('missions.cancel', log)),
    'missions.changes': () =>
      engine['missions.changes']().pipe(
        streamClosedAs(gone),
        observedStream('missions.changes', log),
      ),
    'needs.list': () => engine['needs.list']().pipe(closedAs(gone), observed('needs.list', log)),
    'needs.get': (request) =>
      engine['needs.get'](request).pipe(closedAs(gone), observed('needs.get', log)),
    'needs.answer': (request) =>
      engine['needs.answer'](request).pipe(closedAs(gone), observed('needs.answer', log)),
    'needs.retry': (request) =>
      engine['needs.retry'](request).pipe(closedAs(gone), observed('needs.retry', log)),
    // A Project's "never" list is the engine's alone: forwarded as it is.
    'permissions.neverList': (request) =>
      engine['permissions.neverList'](request).pipe(
        closedAs(gone),
        observed('permissions.neverList', log),
      ),
    'permissions.setNeverList': (request) =>
      engine['permissions.setNeverList'](request).pipe(
        closedAs(gone),
        observed('permissions.setNeverList', log),
      ),
    // A mission's grants are the engine's alone: forwarded as they are.
    'permissions.grants': (request) =>
      engine['permissions.grants'](request).pipe(
        closedAs(gone),
        observed('permissions.grants', log),
      ),
    'permissions.revoke': (request) =>
      engine['permissions.revoke'](request).pipe(
        closedAs(gone),
        observed('permissions.revoke', log),
      ),
    'permissions.decisions': () =>
      engine['permissions.decisions']().pipe(
        streamClosedAs(gone),
        observedStream('permissions.decisions', log),
      ),
    'hemeraAuto.setConsent': (request) =>
      engine['hemeraAuto.setConsent'](request).pipe(
        closedAs(gone),
        observed('hemeraAuto.setConsent', log),
      ),
    'hemeraAuto.whoJudges': (request) =>
      engine['hemeraAuto.whoJudges'](request).pipe(
        closedAs(gone),
        observed('hemeraAuto.whoJudges', log),
      ),
    // The key is sealed here, in main: the engine is handed only its ciphertext to store.
    'hemeraAuto.status': () =>
      application.hemeraAuto.status.pipe(observed('hemeraAuto.status', log)),
    'hemeraAuto.saveKey': ({ key }) =>
      application.hemeraAuto.save(key).pipe(observed('hemeraAuto.saveKey', log)),
    'hemeraAuto.removeKey': () =>
      application.hemeraAuto.remove.pipe(observed('hemeraAuto.removeKey', log)),
    // The sessions are the engine's alone, read for diagnosis: forwarded as they are.
    'sessions.list': (request) =>
      engine['sessions.list'](request).pipe(closedAs(gone), observed('sessions.list', log)),
    'sessions.thread': (request) =>
      engine['sessions.thread'](request).pipe(closedAs(gone), observed('sessions.thread', log)),
    'chats.list': (request) =>
      engine['chats.list'](request).pipe(closedAs(gone), observed('chats.list', log)),
    'chats.create': (request) =>
      engine['chats.create'](request).pipe(closedAs(gone), observed('chats.create', log)),
    'chats.rename': (request) =>
      engine['chats.rename'](request).pipe(closedAs(gone), observed('chats.rename', log)),
    'chats.send': (request) =>
      engine['chats.send'](request).pipe(closedAs(gone), observed('chats.send', log)),
    'chats.stop': (request) =>
      engine['chats.stop'](request).pipe(closedAs(gone), observed('chats.stop', log)),
    'chats.setModel': (request) =>
      engine['chats.setModel'](request).pipe(closedAs(gone), observed('chats.setModel', log)),
    'chats.transcript': (request) =>
      engine['chats.transcript'](request).pipe(closedAs(gone), observed('chats.transcript', log)),
    'chats.changes': () =>
      engine['chats.changes']().pipe(streamClosedAs(gone), observedStream('chats.changes', log)),
    'setup.cards': (request) =>
      engine['setup.cards'](request).pipe(closedAs(gone), observed('setup.cards', log)),
    'setup.accept': (request) =>
      engine['setup.accept'](request).pipe(closedAs(gone), observed('setup.accept', log)),
    'setup.decline': (request) =>
      engine['setup.decline'](request).pipe(closedAs(gone), observed('setup.decline', log)),
    'setup.acceptAll': (request) =>
      engine['setup.acceptAll'](request).pipe(closedAs(gone), observed('setup.acceptAll', log)),
    'setup.propose': (request) =>
      engine['setup.propose'](request).pipe(closedAs(gone), observed('setup.propose', log)),
    'setup.standing': (request) =>
      engine['setup.standing'](request).pipe(closedAs(gone), observed('setup.standing', log)),
    'setup.changes': () =>
      engine['setup.changes']().pipe(streamClosedAs(gone), observedStream('setup.changes', log)),
    'tester.findings': () =>
      engine['tester.findings']().pipe(closedAs(gone), observed('tester.findings', log)),
    'tester.folder': () =>
      engine['tester.folder']().pipe(closedAs(gone), observed('tester.folder', log)),
    // The field's search: the window typing again interrupts it here, which interrupts the engine.
    'start.search': (request) =>
      engine['start.search'](request).pipe(
        streamClosedAs(gone),
        observedStream('start.search', log),
      ),
    'start.create': (request) =>
      engine['start.create'](request).pipe(closedAs(gone), observed('start.create', log)),
    'home.sinceYouLeft': (request) =>
      engine['home.sinceYouLeft'](request).pipe(closedAs(gone), observed('home.sinceYouLeft', log)),
    'home.sinceYouLeftChanged': () =>
      engine['home.sinceYouLeftChanged']().pipe(
        streamClosedAs(gone),
        observedStream('home.sinceYouLeftChanged', log),
      ),
    'home.looked': () => engine['home.looked']().pipe(closedAs(gone), observed('home.looked', log)),
    'home.recent': () => engine['home.recent']().pipe(closedAs(gone), observed('home.recent', log)),
    'home.opened': (request) =>
      engine['home.opened'](request).pipe(closedAs(gone), observed('home.opened', log)),
    'memory.journalTail': (request) =>
      engine['memory.journalTail'](request).pipe(
        closedAs(gone),
        observed('memory.journalTail', log),
      ),
    'planning.spec': (request) =>
      engine['planning.spec'](request).pipe(closedAs(gone), observed('planning.spec', log)),
    'planning.changesSince': (request) =>
      engine['planning.changesSince'](request).pipe(
        closedAs(gone),
        observed('planning.changesSince', log),
      ),
    'planning.markRead': (request) =>
      engine['planning.markRead'](request).pipe(closedAs(gone), observed('planning.markRead', log)),
    'planning.addVision': (request) =>
      engine['planning.addVision'](request).pipe(
        closedAs(gone),
        observed('planning.addVision', log),
      ),
    'planning.keepAfterTriage': (request) =>
      engine['planning.keepAfterTriage'](request).pipe(
        closedAs(gone),
        observed('planning.keepAfterTriage', log),
      ),
    'planning.changed': (request) =>
      engine['planning.changed'](request).pipe(
        streamClosedAs(gone),
        observedStream('planning.changed', log),
      ),
    'planning.specLanguage': (request) =>
      engine['planning.specLanguage'](request).pipe(
        closedAs(gone),
        observed('planning.specLanguage', log),
      ),
    'planning.setSpecLanguage': (request) =>
      engine['planning.setSpecLanguage'](request).pipe(
        closedAs(gone),
        observed('planning.setSpecLanguage', log),
      ),
    'planning.tasks': (request) =>
      engine['planning.tasks'](request).pipe(closedAs(gone), observed('planning.tasks', log)),
    'resources.list': (request) =>
      engine['resources.list'](request).pipe(closedAs(gone), observed('resources.list', log)),
    'resources.save': (request) =>
      engine['resources.save'](request).pipe(closedAs(gone), observed('resources.save', log)),
    'resources.holders': () =>
      engine['resources.holders']().pipe(closedAs(gone), observed('resources.holders', log)),
    'resources.changed': () =>
      engine['resources.changed']().pipe(
        streamClosedAs(gone),
        observedStream('resources.changed', log),
      ),
    'coldRead.list': (request) =>
      engine['coldRead.list'](request).pipe(closedAs(gone), observed('coldRead.list', log)),
    'coldRead.again': (request) =>
      engine['coldRead.again'](request).pipe(closedAs(gone), observed('coldRead.again', log)),
    'coldRead.dismiss': (request) =>
      engine['coldRead.dismiss'](request).pipe(closedAs(gone), observed('coldRead.dismiss', log)),
    'coldRead.freshness': (request) =>
      engine['coldRead.freshness'](request).pipe(
        closedAs(gone),
        observed('coldRead.freshness', log),
      ),
    'coldRead.settled': (request) =>
      engine['coldRead.settled'](request).pipe(closedAs(gone), observed('coldRead.settled', log)),
    'coldRead.changed': (request) =>
      engine['coldRead.changed'](request).pipe(
        streamClosedAs(gone),
        observedStream('coldRead.changed', log),
      ),
    'planning.waves': (request) =>
      engine['planning.waves'](request).pipe(closedAs(gone), observed('planning.waves', log)),
    'planning.answer': (request) =>
      engine['planning.answer'](request).pipe(closedAs(gone), observed('planning.answer', log)),
    'planning.waitOnSomeone': (request) =>
      engine['planning.waitOnSomeone'](request).pipe(
        closedAs(gone),
        observed('planning.waitOnSomeone', log),
      ),
    'planning.openQuestions': (request) =>
      engine['planning.openQuestions'](request).pipe(
        closedAs(gone),
        observed('planning.openQuestions', log),
      ),
    'planning.questionsChanged': (request) =>
      engine['planning.questionsChanged'](request).pipe(
        streamClosedAs(gone),
        observedStream('planning.questionsChanged', log),
      ),
    'planning.inputs': (request) =>
      engine['planning.inputs'](request).pipe(closedAs(gone), observed('planning.inputs', log)),
    'livingSpec.domains': (request) =>
      engine['livingSpec.domains'](request).pipe(
        closedAs(gone),
        observed('livingSpec.domains', log),
      ),
    'livingSpec.requirements': (request) =>
      engine['livingSpec.requirements'](request).pipe(
        closedAs(gone),
        observed('livingSpec.requirements', log),
      ),
    'livingSpec.requirement': (request) =>
      engine['livingSpec.requirement'](request).pipe(
        closedAs(gone),
        observed('livingSpec.requirement', log),
      ),
    'livingSpec.runs': (request) =>
      engine['livingSpec.runs'](request).pipe(closedAs(gone), observed('livingSpec.runs', log)),
    'livingSpec.validateDomain': (request) =>
      engine['livingSpec.validateDomain'](request).pipe(
        closedAs(gone),
        observed('livingSpec.validateDomain', log),
      ),
    'livingSpec.rejectDomain': (request) =>
      engine['livingSpec.rejectDomain'](request).pipe(
        closedAs(gone),
        observed('livingSpec.rejectDomain', log),
      ),
    'livingSpec.dropRequirement': (request) =>
      engine['livingSpec.dropRequirement'](request).pipe(
        closedAs(gone),
        observed('livingSpec.dropRequirement', log),
      ),
    'livingSpec.bootstrap': (request) =>
      engine['livingSpec.bootstrap'](request).pipe(
        closedAs(gone),
        observed('livingSpec.bootstrap', log),
      ),
    'livingSpec.changed': (request) =>
      engine['livingSpec.changed'](request).pipe(
        streamClosedAs(gone),
        observedStream('livingSpec.changed', log),
      ),
    'probes.list': (request) =>
      engine['probes.list'](request).pipe(closedAs(gone), observed('probes.list', log)),
    'probes.read': (request) =>
      engine['probes.read'](request).pipe(closedAs(gone), observed('probes.read', log)),
    'probes.changed': (request) =>
      engine['probes.changed'](request).pipe(
        streamClosedAs(gone),
        observedStream('probes.changed', log),
      ),
    'discussions.list': (request) =>
      engine['discussions.list'](request).pipe(closedAs(gone), observed('discussions.list', log)),
    'discussions.read': (request) =>
      engine['discussions.read'](request).pipe(closedAs(gone), observed('discussions.read', log)),
    'discussions.open': (request) =>
      engine['discussions.open'](request).pipe(closedAs(gone), observed('discussions.open', log)),
    'discussions.say': (request) =>
      engine['discussions.say'](request).pipe(closedAs(gone), observed('discussions.say', log)),
    'discussions.accept': (request) =>
      engine['discussions.accept'](request).pipe(
        closedAs(gone),
        observed('discussions.accept', log),
      ),
    'discussions.close': (request) =>
      engine['discussions.close'](request).pipe(closedAs(gone), observed('discussions.close', log)),
    'discussions.changed': (request) =>
      engine['discussions.changed'](request).pipe(
        streamClosedAs(gone),
        observedStream('discussions.changed', log),
      ),
    'tickets.providers': (request) =>
      engine['tickets.providers'](request).pipe(closedAs(gone), observed('tickets.providers', log)),
    'tickets.proposeGithub': (request) =>
      engine['tickets.proposeGithub'](request).pipe(
        closedAs(gone),
        observed('tickets.proposeGithub', log),
      ),
    'tickets.addGithub': (request) =>
      engine['tickets.addGithub'](request).pipe(closedAs(gone), observed('tickets.addGithub', log)),
    'tickets.addJira': (request) =>
      engine['tickets.addJira'](request).pipe(closedAs(gone), observed('tickets.addJira', log)),
    'tickets.jiraDeployment': (request) =>
      engine['tickets.jiraDeployment'](request).pipe(
        closedAs(gone),
        observed('tickets.jiraDeployment', log),
      ),
    // The token is sealed here and never answered back.
    'tickets.saveJiraToken': ({ providerId, token }) =>
      application.jiraToken.save(providerId, token).pipe(observed('tickets.saveJiraToken', log)),
    'tickets.removeJiraToken': ({ providerId }) =>
      application.jiraToken.remove(providerId).pipe(observed('tickets.removeJiraToken', log)),
    'tickets.jiraTokenStatus': ({ providerId }) =>
      application.jiraToken.status(providerId).pipe(observed('tickets.jiraTokenStatus', log)),
    'tickets.updateProvider': (request) =>
      engine['tickets.updateProvider'](request).pipe(
        closedAs(gone),
        observed('tickets.updateProvider', log),
      ),
    'tickets.removeProvider': (request) =>
      engine['tickets.removeProvider'](request).pipe(
        closedAs(gone),
        observed('tickets.removeProvider', log),
      ),
    'tickets.status': (request) =>
      engine['tickets.status'](request).pipe(closedAs(gone), observed('tickets.status', log)),
    'tickets.checkAgain': (request) =>
      engine['tickets.checkAgain'](request).pipe(
        closedAs(gone),
        observed('tickets.checkAgain', log),
      ),
    'tickets.specMode': (request) =>
      engine['tickets.specMode'](request).pipe(closedAs(gone), observed('tickets.specMode', log)),
    'tickets.setSpecMode': (request) =>
      engine['tickets.setSpecMode'](request).pipe(
        closedAs(gone),
        observed('tickets.setSpecMode', log),
      ),
    'tickets.ticket': (request) =>
      engine['tickets.ticket'](request).pipe(closedAs(gone), observed('tickets.ticket', log)),
    'tickets.changed': (request) =>
      engine['tickets.changed'](request).pipe(
        streamClosedAs(gone),
        observedStream('tickets.changed', log),
      ),
    'missions.freezeReadiness': (request) =>
      engine['missions.freezeReadiness'](request).pipe(
        closedAs(gone),
        observed('missions.freezeReadiness', log),
      ),
    'missions.freezeReadinessChanged': (request) =>
      engine['missions.freezeReadinessChanged'](request).pipe(
        streamClosedAs(gone),
        observedStream('missions.freezeReadinessChanged', log),
      ),
    'missions.freeze': (request) =>
      engine['missions.freeze'](request).pipe(closedAs(gone), observed('missions.freeze', log)),
    'missions.returnToPlanning': (request) =>
      engine['missions.returnToPlanning'](request).pipe(
        closedAs(gone),
        observed('missions.returnToPlanning', log),
      ),
    'dependencies.list': (request) =>
      engine['dependencies.list'](request).pipe(closedAs(gone), observed('dependencies.list', log)),
    'dependencies.decide': (request) =>
      engine['dependencies.decide'](request).pipe(
        closedAs(gone),
        observed('dependencies.decide', log),
      ),
    'models.roles': (request) =>
      engine['models.roles'](request).pipe(closedAs(gone), observed('models.roles', log)),
    'models.setRole': (request) =>
      engine['models.setRole'](request).pipe(closedAs(gone), observed('models.setRole', log)),
    'models.marks': () =>
      engine['models.marks']().pipe(closedAs(gone), observed('models.marks', log)),
    'models.mark': (request) =>
      engine['models.mark'](request).pipe(closedAs(gone), observed('models.mark', log)),
    'limits.project': (request) =>
      engine['limits.project'](request).pipe(closedAs(gone), observed('limits.project', log)),
    'limits.setProject': (request) =>
      engine['limits.setProject'](request).pipe(closedAs(gone), observed('limits.setProject', log)),
    'limits.mission': (request) =>
      engine['limits.mission'](request).pipe(closedAs(gone), observed('limits.mission', log)),
    'sessions.instructionFiles': (request) =>
      engine['sessions.instructionFiles'](request).pipe(
        closedAs(gone),
        observed('sessions.instructionFiles', log),
      ),
    // A mission's Memory is the engine's alone: forwarded as it is.
    'memory.now': (request) =>
      engine['memory.now'](request).pipe(closedAs(gone), observed('memory.now', log)),
    'memory.journal': (request) =>
      engine['memory.journal'](request).pipe(closedAs(gone), observed('memory.journal', log)),
    'memory.notes': (request) =>
      engine['memory.notes'](request).pipe(closedAs(gone), observed('memory.notes', log)),
    'memory.evidenceList': (request) =>
      engine['memory.evidenceList'](request).pipe(
        closedAs(gone),
        observed('memory.evidenceList', log),
      ),
    'memory.evidence': (request) =>
      engine['memory.evidence'](request).pipe(closedAs(gone), observed('memory.evidence', log)),
    'memory.changes': (request) =>
      engine['memory.changes'](request).pipe(
        streamClosedAs(gone),
        observedStream('memory.changes', log),
      ),
    // The agents and their updates are the engine's alone: forwarded as they are.
    'agents.list': () => engine['agents.list']().pipe(closedAs(gone), observed('agents.list', log)),
    'agents.checkUpdates': () =>
      engine['agents.checkUpdates']().pipe(closedAs(gone), observed('agents.checkUpdates', log)),
    'agents.update': (request) =>
      engine['agents.update'](request).pipe(closedAs(gone), observed('agents.update', log)),
    'notifications.settings': () =>
      engine['notifications.settings']().pipe(
        closedAs(gone),
        observed('notifications.settings', log),
      ),
    'notifications.setKind': (request) =>
      engine['notifications.setKind'](request).pipe(
        closedAs(gone),
        observed('notifications.setKind', log),
      ),
    'notifications.setSound': (request) =>
      engine['notifications.setSound'](request).pipe(
        closedAs(gone),
        observed('notifications.setSound', log),
      ),
    'notifications.setStyle': (request) =>
      engine['notifications.setStyle'](request).pipe(
        closedAs(gone),
        observed('notifications.setStyle', log),
      ),
    'notifications.preview': ({ style, sound }) =>
      application.preview(style, sound).pipe(observed('notifications.preview', log)),
    'notifications.window': () =>
      application.notices.pipe(observedStream('notifications.window', log)),
    'environment.report': () => application.report.pipe(observed('environment.report', log)),
    'application.relaunch': () => application.relaunch.pipe(observed('application.relaunch', log)),
    'application.showLog': () => application.showLog.pipe(observed('application.showLog', log)),
    'application.chooseFolder': () =>
      application.chooseFolder.pipe(observed('application.chooseFolder', log)),
  })
