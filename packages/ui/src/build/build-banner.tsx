import type { ReactNode } from 'react'

import { BlockerBlock } from './blocker-block.tsx'
import { type BuildViewProps, dependantsOf } from './build-view.tsx'
import { openBlockerOf } from './model.ts'
import { YoursBlock } from './yours-block.tsx'

/**
 * What waits for the user in a build, as the banner that stands above the chat's composer
 * (lot 5c of issue #115): the first task that is theirs, or the first blocker the agent raised.
 *
 * It was the `build` page that drew it while it held the chat; since the layout puts the chat at
 * the centre of every mission, the banner belongs to whoever arranges the chat — the page hands it
 * the build's own view. "Open" puts the task on the build view's stage, which is the panel the
 * same page draws beside the chat, so the page keeps the selection both read.
 */

export interface BuildBannerProps {
  /** The build's view, as the build view takes it: the page passes the same one to both. */
  view: Omit<BuildViewProps, 'specOpen' | 'onToggleSpec'>
  /** Puts a task on the build view's stage, by its build task id. */
  onOpen: (taskId: string) => void
}

/** The banner of the first thing in the build that waits for the user, if any. */
export function BuildBanner({ view, onOpen }: BuildBannerProps): ReactNode {
  const { build, now } = view
  if (build.phase === 'accepted' || build.phase === 'stopped') return null
  const yours = build.tasks.find((task) => task.state === 'yours')
  if (yours !== undefined) {
    return (
      <YoursBlock
        variant="banner"
        task={yours}
        dependants={dependantsOf(yours.label, build.tasks)}
        onDone={() => view.onTaskDone(yours.id)}
        onSkip={(reason, unblock) => view.onTaskSkip(yours.id, reason, unblock)}
        onOpen={() => onOpen(yours.id)}
      />
    )
  }
  const blocked = build.tasks.find((task) => openBlockerOf(task, build.blockers) !== undefined)
  const blocker = blocked === undefined ? undefined : openBlockerOf(blocked, build.blockers)
  if (blocked === undefined || blocker === undefined) return null
  return (
    <BlockerBlock
      variant="banner"
      blocker={blocker}
      now={now}
      suspended={dependantsOf(blocked.label, build.tasks)}
      onDismiss={() => view.onDismissBlocker(blocker.id, null)}
      onOpen={() => onOpen(blocked.id)}
    />
  )
}
