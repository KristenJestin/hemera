import type { AttemptView, BuildView } from '@hemera/ipc'
import type { BuildAttemptView, BuildViewData } from '@hemera/ui'

/**
 * What the build view of a `build` Session draws from the engine's `BuildView`, and what in it
 * calls for the user (D10-08, D10-12).
 *
 * The design system's model was drawn close to the engine's on purpose, so this is a mapping and
 * nothing more: the fields cross as they are, and the plain words are the design system's. Kept
 * apart from the page, which imports the components, so a test reads it without a DOM.
 */

function attemptOf(attempt: AttemptView): BuildAttemptView {
  return {
    ...attempt,
    checks: attempt.checks.map((check) => ({ ...check })),
    files: attempt.files.map((file) => ({ ...file })),
  }
}

/**
 * The build as the view draws it. A story is keyed `S1`, `S2` by its order in the revision, as the
 * Spec panel keys it; the engine lists the stories in that order.
 */
export function buildViewDataOf(view: BuildView): BuildViewData {
  return {
    sessionId: view.sessionId,
    specId: view.specId,
    specKey: view.specKey,
    specTitle: view.specTitle,
    phase: view.phase,
    pausedAt: view.pausedAt,
    detail: view.detail,
    note: view.note,
    tasks: view.tasks.map((task) => ({
      ...task,
      dependsOn: [...task.dependsOn],
      storyIds: [...task.storyIds],
      attempts: task.attempts.map(attemptOf),
    })),
    blockers: view.blockers.map((blocker) => ({ ...blocker })),
    stories: view.stories.map((story, at) => ({
      id: story.id,
      key: `S${String(at + 1)}`,
      title: story.title,
      labels: [...story.labels],
      state: story.state,
      attempts: story.attempts.map(attemptOf),
    })),
    endAttempts: view.endAttempts.map(attemptOf),
    canAccept: view.canAccept,
  }
}

/**
 * Something in a build that waits for the user (D10-08): a task that is theirs, or a blocker the
 * agent raised and nobody dismissed. `key` tells one from another across two readings of the
 * build, and `at` is when it began to wait, which tells one raised before the window listened.
 */
export interface Attention {
  readonly key: string
  readonly at: string
  /** The notification's title and body, in plain words. */
  readonly title: string
  readonly body: string
}

/** What waits for the user in a build now; nothing once the build is accepted or stopped. */
export function attentionOf(view: BuildView): Attention[] {
  if (view.phase === 'accepted' || view.phase === 'stopped') return []
  const yours = view.tasks
    .filter((task) => task.state === 'yours')
    .map((task) => {
      // A task comes back to the user once per time it became theirs, which is its end time.
      const at = task.endedAt ?? task.updatedAt
      return {
        key: `yours:${task.id}:${at}`,
        at,
        title: `${task.label} is yours · ${view.specKey}`,
        body: task.title,
      }
    })
  const blockers = view.blockers
    .filter((blocker) => blocker.dismissedAt === null)
    .map((blocker) => ({
      key: `blocker:${blocker.id}`,
      at: blocker.raisedAt,
      title: `The agent says ${blocker.label} contradicts the Spec · ${view.specKey}`,
      body: blocker.reason,
    }))
  return [...yours, ...blockers]
}
