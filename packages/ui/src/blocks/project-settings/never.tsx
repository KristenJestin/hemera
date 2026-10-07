import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconBan, IconPlus, IconTerminal, IconTrash } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { Section, SectionRefusal } from './parts.tsx'

/**
 * The commands never run in a Project: whoever asks — an agent, Hemera Auto — they are refused,
 * and the user is not asked. A line per command, in the mono face, its bin at its end; the bin
 * removes it at once, with no confirmation: a line is put back as easily. A command is added in a
 * dialog, from the head of the section. A line added grows in on `fold`, one removed folds out.
 */
export interface NeverLine {
  id: string
  line: string
}

const ARRIVING = 'overflow-hidden border-b border-border last:border-b-0'

const RULE = 'border-b border-border last:border-b-0'

const ROW = 'flex h-control-lg min-w-0 items-center gap-3 pr-2 pl-4 text-sm'

const GLYPH = 'flex shrink-0 text-muted-foreground'

const LINE = 'min-w-0 flex-1 truncate font-mono text-xs'

export interface NeverRowProps {
  line: NeverLine
  onRemove: () => void
}

/** One command refused: its glyph, its line, its bin. */
export function NeverRow({ line, onRemove }: NeverRowProps): ReactNode {
  const folding = useTransition(fold)
  return (
    <motion.li
      className={ARRIVING}
      data-never={line.line}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <div className={ROW}>
        <span className={GLYPH} aria-hidden="true">
          <IconBan size="sm" />
        </span>
        <span className={LINE}>{line.line}</span>
        <Tooltip label="Remove">
          <IconButton
            variant="ghost"
            size="sm"
            icon={<IconTrash size="sm" />}
            aria-label={`Remove ${line.line}`}
            onClick={onRemove}
          />
        </Tooltip>
      </div>
    </motion.li>
  )
}

/** The row's own shape while the list is on its way. */
function NeverRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <div className={ROW}>
        <span className={GLYPH}>
          <Skeleton shape="block">
            <IconBan size="sm" />
          </Skeleton>
        </span>
        <span className={LINE}>
          <Skeleton>git push --force</Skeleton>
        </span>
        <Skeleton shape="block">
          <span className="flex size-control-sm" />
        </Skeleton>
      </div>
    </li>
  )
}

export interface NeverSectionProps {
  lines: readonly NeverLine[]
  loading?: boolean | undefined
  onAdd: () => void
  onRemove: (id: string) => void
  /** A change the engine refused, in words: the list stands as the engine keeps it. */
  error?: string | undefined
}

export function NeverSection({
  lines,
  loading = false,
  onAdd,
  onRemove,
  error,
}: NeverSectionProps): ReactNode {
  const add = (
    <Button size="sm" onClick={onAdd}>
      <IconPlus size="sm" />
      Add a command
    </Button>
  )
  const empty = !loading && lines.length === 0
  return (
    <Section label="Never run">
      <SectionHead
        title="Never run"
        count={loading || empty ? undefined : lines.length}
        actions={loading || empty ? undefined : add}
      />
      <SectionRefusal error={error} />
      <Frame>
        {empty ? (
          <Empty icon={<IconBan size="md" />} title="Nothing refused" action={add} />
        ) : (
          <ul aria-label="Never run" aria-busy={loading} className="flex flex-col">
            {loading ? (
              <>
                <NeverRowSkeleton />
                <NeverRowSkeleton />
                <NeverRowSkeleton />
              </>
            ) : (
              <AnimatePresence initial={false}>
                {lines.map((line) => (
                  <NeverRow key={line.id} line={line} onRemove={() => onRemove(line.id)} />
                ))}
              </AnimatePresence>
            )}
          </ul>
        )}
      </Frame>
    </Section>
  )
}

export interface NeverFormProps {
  value: string
  onChange: (value: string) => void
  /** Why the line is refused, in words: empty, or refused already. */
  error?: string | undefined
}

/** The form of a refused command: its line, as an agent would run it. */
export function NeverForm({ value, onChange, error }: NeverFormProps): ReactNode {
  return (
    <Input
      label="Command"
      icon={<IconTerminal size="sm" />}
      placeholder="git push --force"
      value={value}
      error={error}
      onValueChange={onChange}
    />
  )
}
