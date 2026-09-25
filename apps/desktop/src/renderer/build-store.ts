import type {
  BuildView,
  ChannelArguments,
  EngineEvent,
  SpecRevision,
  SpecSnapshot,
} from '@hemera/ipc'

import { attentionOf } from './build-views.ts'

/**
 * The build a `build` Session shows at its centre (design D10-04, D10-08, D10-12).
 *
 * Like every store of this window, it holds what the engine answered and nothing else: the build
 * as `build.read` answers it, read again whenever the engine pushes `build.changed` for it, and
 * the frozen revision the build works from, which "Spec" opens read only — read as the define
 * page reads a Spec, `specs.read` on the revision the build was started on. The window never sets
 * a task's state: an action says what the user did, and the build it answers is what is shown.
 *
 * What waits for the user — a task that became theirs, a blocker the agent raised — is also told
 * by an OS notification, for every build and not only the one on screen: the user may be
 * anywhere when a build needs them (D10-08).
 */
export interface BuildState {
  /** The build on screen, or null while no `build` Session is open. */
  view: BuildView | null
  /** The frozen revision it works from, once read. */
  spec: SpecSnapshot | null
  /** The revisions of its Spec, which say when that revision was frozen. */
  revisions: SpecRevision[]
  /** What the last act or reading was refused with, in the engine's own words, or null. */
  refusal: string | null
}

const EMPTY: BuildState = { view: null, spec: null, revisions: [], refusal: null }

const listeners = new Set<() => void>()

let state: BuildState = EMPTY
/** Which build Session is on screen, so an answer about another one is never put on this one. */
let shown: string | null = null

export function subscribeToBuild(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function buildSnapshot(): BuildState {
  return state
}

function replace(next: BuildState): void {
  state = next
  for (const listener of listeners) listener()
}

/** What a refusal says, without the shape of whatever carried it. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * How many reads of the build were started. Reads overlap — an act's own answer and the reads its
 * `build.changed` sets off — and answer in no set order: a read overtaken by a later one never
 * lands, so what is on screen is never older than what was read last.
 */
let started = 0

/** Puts a build on screen, reading its frozen revision the first time it is shown. */
async function show(view: BuildView, ticket: number): Promise<void> {
  if (shown !== view.sessionId || ticket !== started) return
  const frozen = state.spec
  if (
    frozen !== null &&
    frozen.spec.id === view.specId &&
    frozen.revision.number === view.revision
  ) {
    replace({ ...state, view })
    return
  }
  const [spec, revisions] = await Promise.all([
    window.hemera.invoke('specs.read', { specId: view.specId, revision: view.revision }),
    window.hemera.invoke('specs.revisions', { specId: view.specId }),
  ])
  if (shown !== view.sessionId || ticket !== started) return
  replace({ ...state, view, spec, revisions })
}

/** Reads the build on screen again, keeping a failed read as the refusal on screen. */
async function refresh(sessionId: string): Promise<void> {
  started += 1
  const ticket = started
  const reading = readOf(sessionId)
  try {
    const view = await window.hemera.invoke('build.read', { sessionId })
    noticedIfLatest(view, reading)
    await show(view, ticket)
  } catch (cause) {
    if (shown === sessionId) replace({ ...state, refusal: message(cause) })
  }
}

/** Opens the build of a `build` Session; the same one is read again, not closed. */
export async function openBuild(sessionId: string): Promise<void> {
  if (shown !== sessionId) replace(EMPTY)
  shown = sessionId
  await refresh(sessionId)
}

export function closeBuild(): void {
  shown = null
  replace(EMPTY)
}

/** The actions of the build view, each named by what the user did (D10-04). */
type BuildAction =
  | 'build.pause'
  | 'build.resume'
  | 'build.accept'
  | 'build.stop'
  | 'build.taskDone'
  | 'build.taskSkip'
  | 'build.dismissBlocker'

/**
 * Runs an action on the build on screen and shows the build it answers; a refusal is kept as it
 * was said, and the build is read again under it.
 */
async function acting<K extends BuildAction>(
  name: K,
  more: Omit<ChannelArguments<K>, 'sessionId'>,
): Promise<boolean> {
  const sessionId = shown
  if (sessionId === null) return false
  started += 1
  const ticket = started
  const reading = readOf(sessionId)
  try {
    // SAFETY: `more` is the argument of `name` without its `sessionId`, which is put back here;
    // TypeScript cannot rebuild the argument of a generic channel from its two halves.
    const argument = { ...more, sessionId } as ChannelArguments<K>
    const view = await window.hemera.invoke(name, argument)
    replace({ ...state, refusal: null })
    noticedIfLatest(view, reading)
    await show(view, ticket)
    return true
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    await refresh(sessionId)
    return false
  }
}

export async function pauseBuild(): Promise<boolean> {
  return await acting('build.pause', {})
}

export async function resumeBuild(): Promise<boolean> {
  return await acting('build.resume', {})
}

export async function acceptBuild(): Promise<boolean> {
  return await acting('build.accept', {})
}

export async function stopBuild(): Promise<boolean> {
  return await acting('build.stop', {})
}

/** A task that is the user's, done by them (D10-08). `taskId` is the build task's id. */
export async function doneTask(taskId: string): Promise<boolean> {
  return await acting('build.taskDone', { taskId })
}

/** A task that is the user's, skipped with its reason; `unblock` lets its dependants go (D10-03). */
export async function skipTask(taskId: string, reason: string, unblock: boolean): Promise<boolean> {
  return await acting('build.taskSkip', { taskId, reason, unblock })
}

/** Puts a blocker aside: its task is ready again (D10-08). */
export async function dismissBlocker(blockerId: string): Promise<boolean> {
  return await acting('build.dismissBlocker', { blockerId })
}

/** How the OS is told that a build needs the user: a title and a sentence. */
export type Notifier = (title: string, body: string) => void

/** The platform's own notification, which Electron shows as the OS's (D10-08). */
const osNotification: Notifier = (title, body) => {
  // Shown by being made: nothing else is done with it.
  void new Notification(title, { body })
}

/** Where notifications go while the window listens; nowhere before. */
let notify: Notifier | null = null
/** When the window began to listen: what waited before that was not news to tell. */
let since = ''
/** What already waited in each build the last time it was read, by its key. */
const told = new Map<string, ReadonlySet<string>>()

/**
 * Tells the OS what began to wait for the user since the build was last read. A build read for
 * the first time tells only what began to wait after the window began to listen: a task that was
 * already the user's before is not news.
 */
function noticed(view: BuildView): void {
  if (notify === null) return
  const waiting = attentionOf(view)
  const before = told.get(view.sessionId)
  for (const one of waiting) {
    const fresh = before === undefined ? one.at >= since : !before.has(one.key)
    if (fresh) notify(one.title, one.body)
  }
  told.set(view.sessionId, new Set(waiting.map((one) => one.key)))
}

/**
 * How many reads of each build were started, for what it tells the OS: the reads answer in no set
 * order, and one overtaken by a later read of the same build tells nothing, or an older answer
 * would forget what the newer one told and tell it again.
 */
const readsOf = new Map<string, number>()

function readOf(sessionId: string): number {
  const ticket = (readsOf.get(sessionId) ?? 0) + 1
  readsOf.set(sessionId, ticket)
  return ticket
}

function noticedIfLatest(view: BuildView, ticket: number): void {
  if (readsOf.get(view.sessionId) === ticket) noticed(view)
}

/** Reads a build that is not on screen, for what it may have to tell the OS. */
async function heard(sessionId: string): Promise<void> {
  const reading = readOf(sessionId)
  try {
    noticedIfLatest(await window.hemera.invoke('build.read', { sessionId }), reading)
  } catch {
    // A build that cannot be read now tells nothing now; its next change reads it again.
  }
}

/**
 * Listens for `build.changed`, once for the whole window: the build on screen is read again when
 * it is the one that changed, and any other build is read for what it has to tell the OS. The
 * notifier is the platform's unless one is handed in.
 */
export function listenToBuilds(notifier: Notifier = osNotification): () => void {
  notify = notifier
  since = new Date().toISOString()
  const stop = window.hemera.on((event: EngineEvent) => {
    if (event.event !== 'build.changed') return
    if (event.sessionId === shown) void refresh(event.sessionId)
    else void heard(event.sessionId)
  })
  return () => {
    notify = null
    told.clear()
    stop()
  }
}
