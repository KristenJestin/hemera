import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { AgentText } from '../message/agent-text.tsx'
import type { TaskView } from './model.ts'
import { StageHead } from './stage-head.tsx'

/**
 * The tasks of a Spec on the stage: each a vertical slice, what is true once it is done, and
 * three kinds of small chip — what it waits on (`after T1`), what it realises (`covers S1`),
 * and who runs it (lot 19, brief "Stage"; core.md, "Mission protocols and phases").
 *
 * No task exists before `decompose`: an empty list says so, and says when they will come,
 * rather than looking like something went missing.
 */

const ITEM = 'flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-0.5'

const ITEM_HEAD = 'flex items-baseline gap-2 text-sm font-semibold'

const KEY = 'font-mono text-xs font-medium text-muted-foreground'

const RESULT = 'text-muted-foreground'

const CHIPS = 'mt-1 flex flex-wrap gap-1.5'

export interface TasksStageProps {
  tasks: TaskView[]
  /** Whether the tasks are stale after a rework, which the meta line says. */
  stale?: boolean | undefined
}

export function TasksStage({ tasks, stale = false }: TasksStageProps): ReactNode {
  const yours = tasks.filter((task) => task.executor === 'human').length
  const facts: ReactNode[] =
    tasks.length === 0
      ? ['none yet']
      : [
          `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}${yours > 0 ? `, ${yours} for you` : ''}`,
        ]
  if (stale) {
    facts.push(
      <span key="stale" className="text-warning-muted-foreground">
        stale after the rework
      </span>,
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <StageHead title="Tasks" facts={facts} />
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tasks are written in Decompose, once the plan is finished.
        </p>
      ) : (
        <ul aria-label="Tasks">
          {tasks.map((task) => (
            <li key={task.key} className={ITEM}>
              <p className={ITEM_HEAD}>
                <span className={KEY}>{task.key}</span>
                {task.title}
              </p>
              <div className={RESULT}>
                <AgentText text={task.result} />
              </div>
              <p className={CHIPS}>
                {task.after.map((key) => (
                  <Badge key={`after-${key}`}>{`after ${key}`}</Badge>
                ))}
                {task.covers.map((key) => (
                  <Badge key={`covers-${key}`}>{`covers ${key}`}</Badge>
                ))}
                <Badge>{task.executor}</Badge>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
