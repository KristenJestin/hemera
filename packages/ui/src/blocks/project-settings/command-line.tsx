import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Input } from '../../components/field/field.tsx'
import { Select } from '../../components/select/select.tsx'
import { Tabs } from '../../components/tabs/tabs.tsx'
import { IconChevronRight } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { type CommandType, typeIcon } from './command-types.tsx'
import { TemplateMenu } from './parts.tsx'

/**
 * Where a command is entered, the one field for it everywhere: the catalogue's own editor, the
 * run step of the preparation, and wherever a command is asked for next.
 *
 * Where the catalogue can be used, two tabs: a command of the catalogue, chosen by its name — its
 * line shown under it, in the quiet tone — or a line of its own. Where a command of the catalogue
 * is being written, the line alone. The line is one field that every system runs, with the names
 * Hemera fills offered by the braces at its end; under it, a fold opens a line of its own for
 * Linux and Windows, each showing the common line in its quiet tone until one is written.
 * A line holding shell syntax is refused as it is typed, the token named, under the line it is in:
 * Hemera runs a command without a shell.
 */
export interface CommandLineValue {
  /** The command of the catalogue chosen, by id; null for a line of its own. */
  command: string | null
  /** The line every system runs, unless it has its own. */
  line: string
  lineLinux: string | null
  lineWindows: string | null
}

/** A command of the catalogue, as the field offers it. */
export interface CatalogueChoice {
  id: string
  name: string
  type: CommandType
  line: string
}

export interface CommandLineFieldProps {
  value: CommandLineValue
  onChange: (value: CommandLineValue) => void
  /**
   * The commands of the catalogue that may be chosen instead of a line. Left out where a command
   * of the catalogue is itself being written: there, only a line.
   */
  commands?: readonly CatalogueChoice[] | undefined
  /** What the engine refuses in a line, in words, the token named; undefined for nothing. */
  refusalOf: (line: string) => string | undefined
  /**
   * Whether a line of its own may be written for Linux and Windows; false hides the fold where
   * such a line cannot be kept yet.
   */
  systems?: boolean | undefined
}

/** A line with nothing in it yet. */
export const EMPTY_LINE: CommandLineValue = {
  command: null,
  line: '',
  lineLinux: null,
  lineWindows: null,
}

/** The systems a line of its own may be written for, in the order the fold shows them. */
const SYSTEMS = [
  { key: 'lineLinux', label: 'Line on Linux' },
  { key: 'lineWindows', label: 'Line on Windows' },
] as const

const DISCLOSURE =
  'flex h-control-text w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-ring hover-motion'

const DISCLOSURE_CHEVRON = 'flex chevron-motion aria-expanded:rotate-90'

const LABEL = 'text-sm font-medium'

const QUIET = 'truncate font-mono text-xs text-muted-foreground'

/** A line that may hold the names Hemera fills: the braces at its end offer them. */
function LineInput({
  label,
  value,
  placeholder,
  error,
  onValueChange,
}: {
  label: string
  value: string
  placeholder?: string | undefined
  error?: string | undefined
  onValueChange: (value: string) => void
}): ReactNode {
  return (
    <Input
      label={label}
      value={value}
      placeholder={placeholder}
      error={error}
      onValueChange={onValueChange}
      trailing={
        <TemplateMenu field={label} onInsert={(name) => onValueChange(`${value}${name}`)} />
      }
    />
  )
}

/** The line every system runs, and the fold with a line of its own for each system. */
function Lines({
  value,
  onChange,
  refusalOf,
  systems: ownLines = true,
}: Omit<CommandLineFieldProps, 'commands'>): ReactNode {
  const folding = useTransition(fold)
  const [systems, setSystems] = useState(value.lineLinux !== null || value.lineWindows !== null)
  return (
    <div className="flex flex-col gap-2">
      <LineInput
        label="Line"
        value={value.line}
        error={refusalOf(value.line)}
        onValueChange={(line) => onChange({ ...value, line })}
      />
      {ownLines && (
        <button
          type="button"
          className={DISCLOSURE}
          aria-expanded={systems}
          onClick={() => setSystems(!systems)}
        >
          <span className={DISCLOSURE_CHEVRON} aria-expanded={systems} aria-hidden="true">
            <IconChevronRight size="sm" />
          </span>
          Lines for Linux and Windows
        </button>
      )}
      <AnimatePresence initial={false}>
        {systems && (
          <motion.div
            key="systems"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <div className="flex flex-col gap-3 pt-1">
              {SYSTEMS.map((system) => {
                const own = value[system.key]
                return (
                  <LineInput
                    key={system.key}
                    label={system.label}
                    value={own ?? ''}
                    placeholder={value.line}
                    error={own === null ? undefined : refusalOf(own)}
                    onValueChange={(line) =>
                      onChange({ ...value, [system.key]: line === '' ? null : line })
                    }
                  />
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function CommandLineField({
  value,
  onChange,
  commands,
  refusalOf,
  systems = true,
}: CommandLineFieldProps): ReactNode {
  if (commands === undefined) {
    return <Lines value={value} onChange={onChange} refusalOf={refusalOf} systems={systems} />
  }
  const chosen = commands.find((one) => one.id === value.command)
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL} aria-hidden="true">
        Command
      </span>
      <Tabs<'catalogue' | 'line'>
        label="Command"
        value={value.command === null ? 'line' : 'catalogue'}
        onValueChange={(mode) =>
          onChange(
            mode === 'line'
              ? { ...value, command: null }
              : { ...value, command: value.command ?? commands[0]?.id ?? null },
          )
        }
        items={[
          {
            value: 'catalogue',
            label: 'From the catalogue',
            panel: (
              <div className="flex flex-col gap-1">
                <Select
                  label="Command of the catalogue"
                  className="w-full"
                  value={value.command ?? undefined}
                  mark={
                    chosen === undefined ? undefined : (
                      <span className="flex text-muted-foreground">{typeIcon(chosen.type)}</span>
                    )
                  }
                  onValueChange={(command) => onChange({ ...value, command })}
                  items={commands.map((one) => ({
                    value: one.id,
                    label: one.name,
                    icon: <span className="flex text-muted-foreground">{typeIcon(one.type)}</span>,
                  }))}
                />
                {chosen !== undefined && <span className={QUIET}>{chosen.line}</span>}
              </div>
            ),
          },
          {
            value: 'line',
            label: 'A line of its own',
            panel: (
              <Lines value={value} onChange={onChange} refusalOf={refusalOf} systems={systems} />
            ),
          },
        ]}
      />
    </div>
  )
}
