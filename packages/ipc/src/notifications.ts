/**
 * Notifications and sounds, as they cross the links.
 *
 * The engine knows the kinds of events that notify (a registry in code) and says each committed
 * event of one of them as a notice, in words already masked. Main groups the notices that arrive
 * together, decides where they show (in the window when it has the focus, the system's
 * notification otherwise), plays one sound for them, and tells the window what to draw and where a
 * click leads. The settings behind them are the application's, one switch per kind and per sound,
 * listed from the registry.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'

/** The three sounds Hemera ships. */
export const SOUNDS = ['needs-you', 'error', 'done'] as const
export const Sound = Schema.Literals(SOUNDS)
export type Sound = typeof Sound.Type

/** The mark a notice is drawn with in the window: what waits, what finished, what failed. */
export const NoticeTone = Schema.Literals(['you', 'done', 'failed', 'outside'])
export type NoticeTone = typeof NoticeTone.Type

/** Home, filtered to one Project's needs, or all of them for null. */
export const HomeTarget = Schema.TaggedStruct('Home', { projectId: Schema.NullOr(Schema.String) })
export const ProjectTarget = Schema.TaggedStruct('Project', { projectId: Schema.String })
export const MissionTarget = Schema.TaggedStruct('Mission', {
  projectId: Schema.String,
  missionKey: Schema.String,
})
/** A mission, and on it one of its needs. */
export const NeedTarget = Schema.TaggedStruct('Need', {
  projectId: Schema.String,
  missionKey: Schema.String,
  needId: Schema.String,
})

/** Where a click on a notification leads. */
export const NotificationTarget = Schema.Union([
  HomeTarget,
  ProjectTarget,
  MissionTarget,
  NeedTarget,
])
export type NotificationTarget = typeof NotificationTarget.Type

/** The Project a notice is about; none when it is the application's own. */
export const NoticeProject = Schema.Struct({ id: Schema.String, name: Schema.String })
export type NoticeProject = typeof NoticeProject.Type

/**
 * One event, as its kind says it: masked words, the sound and importance of its kind, and where
 * it leads. `subject` is what it is about (a mission's title, a Project's name), `what` what
 * happened in a few words: "ACME-12 · Add roles: a decision waits for you".
 */
export const Notice = Schema.Struct({
  /** The sequence of the event it says, as text. */
  id: Schema.String,
  /** The kind it is of, as registered. */
  kind: Schema.String,
  sound: Schema.NullOr(Sound),
  /** Which sound a group plays: the highest wins. */
  importance: Schema.Number,
  tone: NoticeTone,
  project: Schema.NullOr(NoticeProject),
  missionKey: Schema.NullOr(Schema.String),
  subject: Schema.String,
  what: Schema.String,
  target: NotificationTarget,
  /** The need it is about, whose end takes the notification away. */
  needId: Schema.NullOr(Schema.String),
})
export type Notice = typeof Notice.Type

export const NoticeRaised = Schema.TaggedStruct('NoticeRaised', { notice: Notice })
/** A need was answered, expired or was withdrawn: nothing to notify, and its notification goes. */
export const NeedEnded = Schema.TaggedStruct('NeedEnded', { needId: Schema.String })

/** What the engine tells main as events commit. */
export const NoticeFeed = Schema.Union([NoticeRaised, NeedEnded])
export type NoticeFeed = typeof NoticeFeed.Type

export const KindSetting = Schema.Struct({
  id: Schema.String,
  /** The words of its switch in the settings. */
  label: Schema.String,
  on: Schema.Boolean,
  /** Whether it is on when nothing was chosen. */
  byDefault: Schema.Boolean,
  sound: Schema.NullOr(Sound),
})
export type KindSetting = typeof KindSetting.Type

export const SoundSetting = Schema.Struct({
  sound: Sound,
  label: Schema.String,
  on: Schema.Boolean,
})
export type SoundSetting = typeof SoundSetting.Type

/** The switches of Notifications & sounds: one per registered kind, one per sound. */
export const NotificationSettings = Schema.Struct({
  kinds: Schema.Array(KindSetting),
  sounds: Schema.Array(SoundSetting),
})
export type NotificationSettings = typeof NotificationSettings.Type

/** No kind of that id is registered. */
export class UnknownNotificationKind extends Schema.TaggedError<UnknownNotificationKind>()(
  'UnknownNotificationKind',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This kind of notification does not exist.'
  }
}

const failing = Schema.Union([StorageFailed, EngineGone])

/** The settings, read and written: the application's, never a Project's. */
export const NotificationSettingsRpcs = RpcGroup.make(
  Rpc.make('notifications.settings', { success: NotificationSettings, error: failing }),
  Rpc.make('notifications.setKind', {
    payload: { id: Schema.String, on: Schema.Boolean },
    success: NotificationSettings,
    error: Schema.Union([StorageFailed, EngineGone, UnknownNotificationKind]),
  }),
  Rpc.make('notifications.setSound', {
    payload: { sound: Sound, on: Schema.Boolean },
    success: NotificationSettings,
    error: failing,
  }),
)

/** What the engine tells main alone: each notice and each need ended, as events commit. */
export const NoticeFeedRpcs = RpcGroup.make(
  Rpc.make('notifications.feed', { success: NoticeFeed, error: failing, stream: true }),
)

/** A notification the window draws, while it has the focus. */
export const InAppNotice = Schema.TaggedStruct('InAppNotice', {
  id: Schema.String,
  tone: NoticeTone,
  /** The Project's name, or Hemera's. */
  project: Schema.String,
  missionKey: Schema.NullOr(Schema.String),
  title: Schema.String,
  detail: Schema.NullOr(Schema.String),
  target: NotificationTarget,
})
/** A notification that goes away: its need was answered or expired. */
export const NoticeGone = Schema.TaggedStruct('NoticeGone', { id: Schema.String })
/** A system notification was clicked: the window goes where it leads. */
export const OpenTarget = Schema.TaggedStruct('OpenTarget', { target: NotificationTarget })

/** What main tells the window of notifications. */
export const WindowNotice = Schema.Union([InAppNotice, NoticeGone, OpenTarget])
export type WindowNotice = typeof WindowNotice.Type

/** What the window follows of notifications, from main. */
export const WindowNoticeRpcs = RpcGroup.make(
  Rpc.make('notifications.window', { success: WindowNotice, stream: true }),
)
