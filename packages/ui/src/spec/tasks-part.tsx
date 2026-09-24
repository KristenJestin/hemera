import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { AgentText } from '../message/agent-text.tsx'
import type { Mark, TaskView } from './model.ts'
import { PartHead } from './part-head.tsx'

/**
 * The tasks of the Spec document: each a vertical slice, what is true once it is done, and three
 * kinds of small chip — what it waits on (`after T1`), what it realises (`covers S1`), and who
 * runs it (lot 19, brief revision 2; core.md, "Mission protocols and phases").
 *
 * No task exists before `decompose`: an empty list says so, and says when they will come,
 * rather than looking like something went missing.
 */

const ITEM = 'flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-1'

const ITEM_HEAD = 'flex items-baseline gap-2 text-sm font-semibold'

const KEY = 'font-mono text-xs font-medium text-muted-foreground'

const RESULT = 'text-muted-foreground'

const CHIPS = 'mt-1 flex flex-wrap gap-1.5'

export interface TasksPartProps {
  tasks: TaskView[]
  mark: Mark
}

export function TasksPart({ tasks, mark }: TasksPartProps): ReactNode {
  const yours = tasks.filter((task) => task.executor === 'human').length
  const facts: ReactNode[] =
    tasks.length === 0 ? ['after decompose'] : yours > 0 ? [`${yours} for you`] : []
  if (mark === 'stale') {
    facts.push(
      <span key="stale" className="text-warning-muted-foreground">
        to review
      </span>,
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <PartHead title={`Tasks · ${tasks.length}`} mark={mark} facts={facts} />
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
