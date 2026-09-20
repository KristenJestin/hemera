/**
 * Every channel that is nothing but a message on its way to the engine and back.
 *
 * A list of names and nothing else, in a file of its own so that it can be read by a test: a
 * use case the engine declares, and the main process forgot to relay, is a channel the page
 * calls and nothing answers — which compiles, ships, and fails in front of the user.
 * `channels.ts` is where they are wired, and it cannot be imported outside Electron.
 */

export const RELAYED = [
  'engine.status',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.moveMain',
  'projects.archive',
  'projects.restore',
  'repositories.add',
  'repositories.remove',
  'sessions.list',
  'sessions.create',
  'sessions.rename',
  'sessions.archive',
  'sessions.restore',
  'sessions.append',
  'sessions.read',
  'journal.read',
  'journal.unseen',
  'journal.markSeen',
] as const

export type Relayed = (typeof RELAYED)[number]
