import type {
  EditBuffer,
  EngineEvent,
  JournalEntry,
  SectionName,
  SpecRevision,
  SpecSnapshot,
  SpecType,
} from '@hemera/ipc'
import type { StoryView } from '@hemera/ui'

import { storiesWith } from './spec-views.ts'

/**
 * The Spec a `define` Session shows beside its chat (design D7-07, D7-10, D7-11, D7-12).
 *
 * Like every store of this window, it holds what the engine answered and nothing else: after
 * each act the Spec, its revisions, its edit buffers and its Journal are read again
 * rather than patched here. The engine pushes `spec.changed` for every write, whoever made it —
 * the agent, another Session, the human in another panel — and the Spec on screen is read again
 * when it is about that one.
 *
 * A human save refused because the section moved under it is never lost (D7-12): its text goes
 * into the Spec's edit buffers, which the engine keeps across a restart, and the panel shows the
 * conflict from those buffers against the current text.
 */
export interface SpecState {
  /** The revision on screen, or null while no Spec is open. */
  snapshot: SpecSnapshot | null
  /** The current revision, the one shown or not: what the thread's questions are asked in. */
  current: SpecSnapshot | null
  /** The revision picked, or null for the current one. */
  revision: number | null
  /** Every revision of the open Spec, as the engine lists them. */
  revisions: SpecRevision[]
  /** The human texts kept after a refused save (D7-12). */
  buffers: EditBuffer[]
  /** The Spec's lines of the Journal, newest first: `spec.ready` says when a revision froze. */
  journal: JournalEntry[]
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
}

const EMPTY: SpecState = {
  snapshot: null,
  current: null,
  revision: null,
  revisions: [],
  buffers: [],
  journal: [],
  refusal: null,
}

/** What a story edit is refused with when its story was taken away meanwhile. */
const GONE = 'The story you were editing is gone: your edit was not saved.'

/** How many lines of the Spec's Journal are read, which is the most one page may hold. */
const JOURNAL_PAGE = 200

const listeners = new Set<() => void>()

let state: SpecState = EMPTY
/** Which Spec is on screen, so an answer about another one is never put on this one. */
let shown: string | null = null

export function subscribeToSpec(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function specSnapshot(): SpecState {
  return state
}

function replace(next: SpecState): void {
  state = next
  for (const listener of listeners) listener()
}

/** What a refusal says, without the shape of whatever carried it. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * How many reads of the Spec were started. Reads overlap — a write's own and the one its
 * `spec.changed` sets off — and answer in no set order: a read overtaken by a later one never
 * lands, so what is on screen is never older than what was read last.
 */
let started = 0

/** Reads the open Spec, its revisions, its buffers and its Journal again. */
async function reload(specId: string): Promise<void> {
  started += 1
  const ticket = started
  const picked = state.revision
  const [current, revisions, buffers] = await Promise.all([
    window.hemera.invoke('specs.read', { specId }),
    window.hemera.invoke('specs.revisions', { specId }),
    window.hemera.invoke('specs.buffers.read', { specId }),
  ])
  const snapshot =
    picked === null || picked === current.revision.number
      ? current
      : await window.hemera.invoke('specs.read', { specId, revision: picked })
  const journal = await window.hemera.invoke('journal.read', {
    projectId: current.spec.projectId,
    specId,
    limit: JOURNAL_PAGE,
  })
  if (shown !== specId || ticket !== started) return
  replace({ ...state, snapshot, current, revisions, buffers, journal: journal.entries })
}

/** Reads the open Spec again, keeping a failed read as the refusal on screen. */
async function refresh(specId: string): Promise<void> {
  try {
    await reload(specId)
  } catch (cause) {
    if (shown === specId) replace({ ...state, refusal: message(cause) })
  }
}

/** Runs an act on the open Spec, then reads it again; a refusal is kept as it was said. */
async function acting(act: (specId: string) => Promise<void>): Promise<boolean> {
  const specId = shown
  if (specId === null) return false
  try {
    await act(specId)
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    await refresh(specId)
    return false
  }
  replace({ ...state, refusal: null })
  await refresh(specId)
  return true
}

/** Opens a Spec on its current revision; the same Spec is read again, not closed. */
export async function openSpec(specId: string): Promise<void> {
  if (shown !== specId) replace(EMPTY)
  shown = specId
  await refresh(specId)
}

export function closeSpec(): void {
  shown = null
  replace(EMPTY)
}

/** Picks a revision to read: an older one is shown as it was frozen (D7-05). */
export async function selectRevision(revision: number | null): Promise<void> {
  const specId = shown
  if (specId === null) return
  replace({ ...state, revision })
  await refresh(specId)
}

/**
 * Accepts the agent's proposal: the Spec is created and this `free` Session becomes `define`,
 * its writer (D7-07). The Session changed with it, so whoever asked reads the Sessions again.
 */
export async function createSpec(
  sessionId: string,
  type: SpecType,
  title: string,
): Promise<boolean> {
  try {
    const made = await window.hemera.invoke('specs.create', { sessionId, type, title })
    await openSpec(made.snapshot.spec.id)
    return true
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return false
  }
}

/**
 * Saves one section on the version its editor was opened on (D7-12).
 *
 * Refused while the section moved on since that version, the text goes into the Spec's edit
 * buffers, where a restart finds it too, and the panel shows the conflict against the current
 * text. Any other refusal is said as it was said, and nothing is kept.
 *
 * "Apply mine" is this same save, on the version the conflict names as current: written, the
 * engine lets the buffer go with it; refused again, the conflict is the newer one.
 */
export async function saveSection(
  sessionId: string,
  name: SectionName,
  body: string,
  baseVersion: number,
): Promise<boolean> {
  const specId = shown
  if (specId === null) return false
  try {
    await window.hemera.invoke('specs.writeSection', { specId, sessionId, name, body, baseVersion })
  } catch (cause) {
    try {
      const now = await window.hemera.invoke('specs.read', { specId })
      const moved = (now.sections.find((one) => one.name === name)?.version ?? 0) !== baseVersion
      if (!moved) throw cause
      await window.hemera.invoke('specs.buffers.save', { specId, name, body, baseVersion })
      replace({ ...state, refusal: null })
    } catch (refused) {
      replace({ ...state, refusal: message(refused) })
    }
    await refresh(specId)
    return false
  }
  replace({ ...state, refusal: null })
  await refresh(specId)
  return true
}

/** Lets the human's text of a conflict go, keeping the current one (D7-12). */
export async function discardMine(name: SectionName): Promise<boolean> {
  return await acting(async (specId) => {
    await window.hemera.invoke('specs.buffers.discard', { specId, name })
  })
}

/**
 * Writes back a story edited in place, all the stories of the revision with it (D7-12), onto the
 * story of its id wherever it stands now. A story taken away since is not written at all, and
 * the Spec is read again instead.
 */
export async function saveStory(sessionId: string, changed: StoryView): Promise<boolean> {
  const specId = shown
  const current = state.snapshot
  if (specId === null || current === null) return false
  const stories = storiesWith(current, changed)
  if (stories === null) {
    replace({ ...state, refusal: GONE })
    await refresh(specId)
    return false
  }
  return await acting(async (id) => {
    await window.hemera.invoke('specs.writeStories', { specId: id, sessionId, stories })
  })
}

/** Answers a question of the open Spec with one of its options or a text (D7-03). */
export async function answerQuestion(
  questionId: string,
  answer: { optionId?: string | undefined; text?: string | undefined },
): Promise<boolean> {
  return await acting(async (specId) => {
    await window.hemera.invoke('specs.answerQuestion', {
      specId,
      questionId,
      optionId: answer.optionId,
      text: answer.text,
    })
  })
}

/**
 * "Mark ready", made against the revision and the content version of the snapshot the
 * readiness was computed from, which is the one on screen (D7-10). A Spec that changed since
 * refuses it, and is read again. The Session is the one whose panel the click came from, which
 * the Journal line names (D7-13).
 */
export async function markReady(sessionId: string): Promise<boolean> {
  const { snapshot } = state
  if (snapshot === null) return false
  return await acting(async (specId) => {
    await window.hemera.invoke('specs.markReady', {
      specId,
      expectedRevisionId: snapshot.spec.currentRevisionId,
      expectedContentVersion: snapshot.spec.contentVersion,
      sessionId,
    })
  })
}

/**
 * "Rework" of a `ready` Spec: a new complete draft revision (D7-05). A reason left empty is
 * no reason, and is sent as none. The Session is named as for Mark ready.
 */
export async function rework(sessionId: string, reason: string): Promise<boolean> {
  const current = state.snapshot?.spec.currentRevisionId
  if (current === undefined) return false
  replace({ ...state, revision: null })
  const said = reason.trim()
  return await acting(async (specId) => {
    await window.hemera.invoke('specs.reopen', {
      specId,
      expectedRevisionId: current,
      reason: said === '' ? undefined : said,
      sessionId,
    })
  })
}

/** "Take over": the write right moves to this Session, at once (D7-11). */
export async function takeOver(sessionId: string): Promise<boolean> {
  return await acting(async (specId) => {
    await window.hemera.invoke('specs.transferWrite', { specId, sessionId })
  })
}

export function forgetSpecRefusal(): void {
  if (state.refusal === null) return
  replace({ ...state, refusal: null })
}

/**
 * Listens for `spec.changed`, once for the whole window: the Spec on screen is read again when
 * it is the one that changed, and `changed` hears of every change with its Project — a Spec step
 * can change a Session too (its mission, its Spec, a new Session opened on it).
 */
export function listenToSpecs(changed: (projectId: string) => void): () => void {
  return window.hemera.on((event: EngineEvent) => {
    if (event.event !== 'spec.changed') return
    changed(event.projectId)
    if (event.specId === shown) void refresh(event.specId)
  })
}
