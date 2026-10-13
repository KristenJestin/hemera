import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconAlertTriangle, IconPencil, IconPlus } from '../../icons.ts'
import { CODE, QUIET, ROW } from './building-parts.tsx'
import type { TaskDetail } from './building-types.ts'

/**
 * A task opened over the Building page, in the mission's sheet: where it aims, its tries and who
 * ran them, the files it touched (a file outside its targets said so), what judged it with the end
 * of what failed, the conflicts it met, and the decision that amended it. One section per thing,
 * a heading each, and only the sections that have something to say.
 */
const SECTION = 'flex flex-col gap-1.5'

const HEADING = 'px-6 text-xs font-medium text-muted-foreground'

const ITEM = cn(ROW, 'px-6')

export function TaskView({
  detail,
  onOpenDiff,
}: {
  detail: TaskDetail
  /** Opens the task's diff; left out while there is no diff to open it in. */
  onOpenDiff?: ((path: string) => void) | undefined
}): ReactNode {
  const outside = detail.files.filter((file) => file.outside).length
  return (
    <div className="flex flex-col gap-5 py-4">
      <p className="px-6 text-sm text-muted-foreground">{detail.requirement}</p>

      {detail.amended !== undefined && (
        <section aria-label="Amended" className={SECTION}>
          <h3 className={HEADING}>Amended by a decision</h3>
          <div className="flex max-w-measure flex-col gap-0.5 px-6 text-sm">
            <p className="break-words">{detail.amended.what}</p>
            <p className="text-xs text-muted-foreground">{detail.amended.by}</p>
          </div>
        </section>
      )}

      <section aria-label="Targets" className={SECTION}>
        <h3 className={HEADING}>Targets</h3>
        <ul className="flex flex-col">
          {detail.targets.map((target) => (
            <li key={target.path} className={cn(ITEM, 'min-h-control-sm py-0.5 font-mono text-xs')}>
              <Legend
                label={target.intent === 'create' ? 'Created by the task' : 'Changed by the task'}
              >
                <span className="flex shrink-0 text-muted-foreground">
                  {target.intent === 'create' ? <IconPlus size="sm" /> : <IconPencil size="sm" />}
                </span>
              </Legend>
              <span className="min-w-0 break-all">{target.path}</span>
            </li>
          ))}
        </ul>
      </section>

      {detail.tries.length === 0 ? (
        <p className="px-6 text-sm text-muted-foreground">Not started yet.</p>
      ) : (
        <section aria-label="Tries" className={SECTION}>
          <h3 className={HEADING}>Tries</h3>
          <ol className="flex flex-col">
            {detail.tries.map((one) => (
              <li key={one.n} className={ITEM}>
                <StatusMark state={one.state} size="sm" legend />
                <span className="shrink-0 font-medium">{`Try ${String(one.n)}`}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{one.runner}</span>
                <span className={QUIET}>{one.took}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {detail.files.length > 0 && (
        <section aria-label="Files" className={SECTION}>
          <h3 className={HEADING}>
            {outside > 0 ? `Files · ${String(outside)} outside its targets` : 'Files'}
          </h3>
          <ul className="flex flex-col">
            {detail.files.map((file) => (
              <li key={file.path} className={cn(ITEM, 'min-h-control-sm py-0.5')}>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
                {file.outside && (
                  <Legend label="Changed outside its targets">
                    <span className="flex text-warning">
                      <IconAlertTriangle size="sm" />
                    </span>
                  </Legend>
                )}
                <span className="shrink-0 text-xs text-success-muted-foreground tabular-nums">{`+${String(file.added)}`}</span>
                <span className="shrink-0 text-xs text-destructive-muted-foreground tabular-nums">{`−${String(file.deleted)}`}</span>
              </li>
            ))}
          </ul>
          {onOpenDiff !== undefined && (
            <span className="px-6">
              <Button variant="link" size="sm" onClick={() => onOpenDiff(detail.task.id)}>
                The task’s diff
              </Button>
            </span>
          )}
        </section>
      )}

      {detail.verdicts.length > 0 && (
        <section aria-label="What judged it" className={SECTION}>
          <h3 className={HEADING}>What judged it</h3>
          <ul className="flex flex-col gap-1">
            {detail.verdicts.map((verdict) => (
              <li key={verdict.name} className="flex flex-col gap-1">
                <div className={cn(ITEM, 'min-h-control-sm py-0.5')}>
                  <StatusMark state={verdict.state} size="sm" legend />
                  <span className="min-w-0 flex-1 truncate">{verdict.name}</span>
                </div>
                {verdict.tail !== undefined && (
                  <pre className={cn(CODE, 'mx-6')}>
                    <code>{verdict.tail.join('\n')}</code>
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.conflicts.length > 0 && (
        <section aria-label="Conflicts" className={SECTION}>
          <h3 className={HEADING}>Conflicts</h3>
          <ul className="flex flex-col">
            {detail.conflicts.map((conflict) => (
              <li
                key={`${conflict.with}-${conflict.path}`}
                className="flex flex-col gap-0.5 px-6 py-1 text-sm"
              >
                <span className="break-words">
                  {`With ${conflict.with} on `}
                  <span className="font-mono text-xs">{conflict.path}</span>
                </span>
                <span className="text-xs text-muted-foreground">{conflict.settled}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
