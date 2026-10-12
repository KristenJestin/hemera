/**
 * A list of a Project's settings that the engine keeps in order and proposes defaults for: the
 * checks and the doc recipes (#152). The list is read with what the engine proposes while it keeps
 * none; a proposal is kept only once accepted, and the ones left stay where they were, under the
 * id they were proposed with. A reorder is shown at once and written as moves once it settles.
 * Plain functions over a store: no React.
 */

import { type ProviderStore, latestRead } from './ticket-providers-model.ts'

/** What the engine does for one such list. */
export interface ListOps<Kept extends { readonly id: string }, Draft> {
  readonly list: () => Promise<ReadonlyArray<Kept>>
  /** The defaults proposed, never saved: none once the list keeps some. */
  readonly propose: () => Promise<ReadonlyArray<Draft>>
  /** Saves the proposals accepted, all at once. */
  readonly accept: (drafts: ReadonlyArray<Draft>) => Promise<ReadonlyArray<Kept>>
  /** Moves one to its 0-based place; answers the list. */
  readonly move: (id: string, rank: number) => Promise<ReadonlyArray<Kept>>
  /** What the section says before the reason when the list cannot be read or written. */
  readonly unread: string
}

/** A default proposed, under the id the section knows it by until it is accepted. */
export interface Proposal<Draft> {
  readonly id: string
  readonly draft: Draft
}

export interface ListState<Kept, Draft> {
  /** Null while the list is on its way. */
  readonly kept: ReadonlyArray<Kept> | null
  readonly proposals: ReadonlyArray<Proposal<Draft>>
  /** The order shown while a reorder is being written; null otherwise. */
  readonly order: ReadonlyArray<string> | null
  readonly error: string | undefined
}

const said = (unread: string) => (failure: Error) => `${unread}: ${failure.message}`

/** Reads the list and what is proposed for it; only the latest read lands. */
export function readList<Kept extends { readonly id: string }, Draft>(
  ops: ListOps<Kept, Draft>,
  store: ProviderStore<ListState<Kept, Draft>>,
): void {
  const latest = latestRead(store, 'list')
  Promise.all([ops.list(), ops.propose()]).then(
    ([kept, proposed]) => {
      if (!latest()) return
      store.set({
        kept,
        proposals: proposed.map((draft, index) => ({ id: `proposed-${String(index)}`, draft })),
        error: undefined,
      })
    },
    (failure: Error) => {
      if (latest()) store.set({ error: said(ops.unread)(failure) })
    },
  )
}

/** Reads the list again after a change, keeping the proposals the section still shows. */
export function readKept<Kept extends { readonly id: string }, Draft>(
  ops: ListOps<Kept, Draft>,
  store: ProviderStore<ListState<Kept, Draft>>,
): Promise<void> {
  const latest = latestRead(store, 'list')
  return ops.list().then(
    (kept) => {
      if (latest()) store.set({ kept, error: undefined })
    },
    (failure: Error) => {
      if (latest()) store.set({ error: said(ops.unread)(failure) })
    },
  )
}

/** Keeps the proposals named; the others stay proposed, where they were. */
export function acceptProposals<Kept extends { readonly id: string }, Draft>(
  ops: ListOps<Kept, Draft>,
  store: ProviderStore<ListState<Kept, Draft>>,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const named = new Set(ids)
  const chosen = store.get().proposals.filter((one) => named.has(one.id))
  if (chosen.length === 0) return Promise.resolve()
  return ops.accept(chosen.map((one) => one.draft)).then(
    () => {
      store.set({ proposals: store.get().proposals.filter((one) => !named.has(one.id)) })
      return readKept(ops, store)
    },
    (failure: Error) => store.set({ error: said(ops.unread)(failure) }),
  )
}

/** One move: the line taken out, and its 0-based place in the order after it. */
export interface Move {
  readonly id: string
  readonly rank: number
}

/** The one move that turns an order into the next, or null when nothing moved. */
export function moveOf(before: ReadonlyArray<string>, after: ReadonlyArray<string>): Move | null {
  const at = after.findIndex((id, index) => before[index] !== id)
  if (at === -1) return null
  const without = (ids: ReadonlyArray<string>, id: string) => ids.filter((one) => one !== id)
  const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
    a.length === b.length && a.every((id, index) => b[index] === id)
  // Moved up: the line now at `at` came from further down.
  const raised = after[at] ?? ''
  if (same(without(before, raised), without(after, raised))) return { id: raised, rank: at }
  // Moved down: the line that stood at `at` went further down.
  const lowered = before[at] ?? ''
  return { id: lowered, rank: after.indexOf(lowered) }
}

/** The moves, one after the other, that turn an order into the next. */
export function movesOf(before: ReadonlyArray<string>, after: ReadonlyArray<string>): Move[] {
  const moves: Move[] = []
  let current = [...before]
  for (let move = moveOf(current, after); move !== null; move = moveOf(current, after)) {
    const { id, rank } = move
    moves.push(move)
    current = current.filter((one) => one !== id)
    current.splice(rank, 0, id)
  }
  return moves
}

/** Shows an order at once, and writes it as moves, one after the other. */
export function writeOrder<Kept extends { readonly id: string }, Draft>(
  ops: ListOps<Kept, Draft>,
  store: ProviderStore<ListState<Kept, Draft>>,
  ids: ReadonlyArray<string>,
): Promise<void> {
  store.set({ order: ids })
  const before = (store.get().kept ?? []).map((one) => one.id)
  const written = movesOf(before, ids).reduce<Promise<ReadonlyArray<Kept> | null>>(
    (done, move) => done.then(() => ops.move(move.id, move.rank)),
    Promise.resolve(null),
  )
  return written.then(
    (kept) => {
      store.set(kept === null ? { order: null } : { kept, order: null, error: undefined })
    },
    (failure: Error) => {
      store.set({ order: null, error: said(ops.unread)(failure) })
      return readKept(ops, store)
    },
  )
}
