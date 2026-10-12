/**
 * The write locks of a Building's commands (#142, CT-02), held in this engine's memory: a command
 * that can write holds its repository (or, when it declares write globs, the paths matching them)
 * while it runs. Another task's file tool write there waits until it ends, and no other task's
 * writing command starts in that repository meanwhile. A command of the same task does not wait
 * for itself. A file tool write holds its file while it is written, so no other task's command
 * starts there in the middle of it. A restart ends every run, so nothing of a lock outlives the
 * engine.
 */

import { posix } from 'node:path'

import { Deferred, Effect } from 'effect'

/** A writing command holding its repository, or the paths of its globs there. */
export interface WriteLock {
  readonly id: string
  readonly buildingId: string
  readonly repository: string
  /** The globs it declared, relative to its repository; null for the whole repository. */
  readonly globs: ReadonlyArray<string> | null
  /** The task whose command it is; null for a session that runs none. */
  readonly taskId: string | null
  readonly command: string
  readonly released: Deferred.Deferred<void>
}

/** The sentence a write or a command that waits for a lock is told. */
export const waitingSaid = (lock: WriteLock): string =>
  `waiting for \`${lock.command}\`${lock.taskId === null ? '' : ` (${lock.taskId})`}, which writes in ${lock.repository}`

/** Whether a lock holds a path of its repository. */
const holds = (lock: WriteLock, path: string): boolean =>
  lock.globs === null || lock.globs.some((glob) => posix.matchesGlob(path, glob))

/** Whether a lock is another task's: a task's own command never holds it back. */
const others = (lock: WriteLock, taskIds: ReadonlyArray<string>): boolean =>
  lock.taskId === null || !taskIds.includes(lock.taskId)

/** A file tool write in progress: no other task's command takes its repository meanwhile. */
export interface WriteInProgress {
  readonly id: string
  readonly buildingId: string
  readonly repository: string
  readonly taskIds: ReadonlyArray<string>
  readonly done: Deferred.Deferred<void>
}

export const writeLocks = () => {
  const held = new Map<string, WriteLock>()
  const writing = new Map<string, WriteInProgress>()

  /** The lock another task holds on a file, or null. */
  const onFile = (
    buildingId: string,
    taskIds: ReadonlyArray<string>,
    file: { readonly repository: string; readonly path: string },
  ): WriteLock | null =>
    [...held.values()].find(
      (lock) =>
        lock.buildingId === buildingId &&
        lock.repository === file.repository &&
        others(lock, taskIds) &&
        holds(lock, file.path),
    ) ?? null

  /** The lock another task's command holds in one of these repositories, or null. */
  const onRepositories = (
    buildingId: string,
    taskIds: ReadonlyArray<string>,
    repositories: ReadonlyArray<string>,
  ): WriteLock | null =>
    [...held.values()].find(
      (lock) =>
        lock.buildingId === buildingId &&
        repositories.includes(lock.repository) &&
        others(lock, taskIds),
    ) ?? null

  /** Another task's file tool write in progress in one of these repositories, or null. */
  const writeIn = (
    buildingId: string,
    taskIds: ReadonlyArray<string>,
    repositories: ReadonlyArray<string>,
  ): WriteInProgress | null =>
    [...writing.values()].find(
      (one) =>
        one.buildingId === buildingId &&
        repositories.includes(one.repository) &&
        !one.taskIds.some((id) => taskIds.includes(id)),
    ) ?? null

  /**
   * Waits while `find` names a lock, each time until it is released; answers the first one waited
   * for, or null when none held the way.
   */
  const waitWhile = (find: () => WriteLock | null) =>
    Effect.gen(function* () {
      let first: WriteLock | null = null
      for (let lock = find(); lock !== null; lock = find()) {
        first ??= lock
        yield* Deferred.await(lock.released)
      }
      return first
    })

  /** Waits until no other task's file tool write is in progress in these repositories. */
  const waitForWrites = (
    buildingId: string,
    taskIds: ReadonlyArray<string>,
    repositories: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      for (
        let one = writeIn(buildingId, taskIds, repositories);
        one !== null;
        one = writeIn(buildingId, taskIds, repositories)
      ) {
        yield* Deferred.await(one.done)
      }
    })

  return {
    /** The way a file tool write of these tasks is held, waited out; the first lock, or null. */
    waitForFile: (
      buildingId: string,
      taskIds: ReadonlyArray<string>,
      file: { readonly repository: string; readonly path: string },
    ) => waitWhile(() => onFile(buildingId, taskIds, file)),
    /** The lock a file tool write of these tasks would wait for now, or null. */
    heldFile: onFile,
    /**
     * A file tool write of these tasks begun once no other task's command holds its file, in one
     * step with the last check, and put into `sink` in that same step: answers the first lock
     * waited for. `endWrite` ends it.
     */
    beginWrite: (
      buildingId: string,
      taskIds: ReadonlyArray<string>,
      file: { readonly repository: string; readonly path: string },
      sink: WriteInProgress[],
    ) =>
      Effect.gen(function* () {
        let first: WriteLock | null = null
        for (;;) {
          const waited = yield* waitWhile(() => onFile(buildingId, taskIds, file))
          first ??= waited
          if (onFile(buildingId, taskIds, file) !== null) continue
          const begun: WriteInProgress = {
            id: crypto.randomUUID(),
            buildingId,
            repository: file.repository,
            taskIds,
            done: Deferred.makeUnsafe<void>(),
          }
          writing.set(begun.id, begun)
          sink.push(begun)
          return first
        }
      }),
    endWrite: (begun: WriteInProgress) =>
      Effect.suspend(() => {
        writing.delete(begun.id)
        return Deferred.succeed(begun.done, undefined)
      }),
    /**
     * The locks of a writing command taken once no other task's command or file write holds its
     * repositories, in one step with the last check; answers the first lock waited for. The locks
     * go into `sink` in that same step, so whoever holds the sink can release them on any exit.
     */
    take: (
      buildingId: string,
      taskId: string | null,
      command: string,
      repositories: ReadonlyArray<string>,
      globs: ReadonlyArray<string> | null,
      sink: WriteLock[],
    ) =>
      Effect.gen(function* () {
        const mine = taskId === null ? [] : [taskId]
        let first: WriteLock | null = null
        for (;;) {
          const waited = yield* waitWhile(() => onRepositories(buildingId, mine, repositories))
          first ??= waited
          yield* waitForWrites(buildingId, mine, repositories)
          // Nothing yields between the last check and the take: no other command slips in.
          if (
            onRepositories(buildingId, mine, repositories) !== null ||
            writeIn(buildingId, mine, repositories) !== null
          )
            continue
          for (const repository of repositories) {
            const lock: WriteLock = {
              id: crypto.randomUUID(),
              buildingId,
              repository,
              globs,
              taskId,
              command,
              released: Deferred.makeUnsafe<void>(),
            }
            held.set(lock.id, lock)
            sink.push(lock)
          }
          return first
        }
      }),
    /** Releases locks: whatever waited for them goes on. */
    release: (locks: ReadonlyArray<WriteLock>) =>
      Effect.forEach(
        locks,
        (lock) => {
          held.delete(lock.id)
          return Deferred.succeed(lock.released, undefined)
        },
        { discard: true },
      ),
    /** Whether another task's command holds a path now: its changes are not attributed yet. */
    pending: (
      buildingId: string,
      taskIds: ReadonlyArray<string>,
      file: { readonly repository: string; readonly path: string },
    ) => onFile(buildingId, taskIds, file) !== null,
  }
}

export type WriteLocks = ReturnType<typeof writeLocks>
