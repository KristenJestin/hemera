import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { Input } from '../components/field/field.tsx'
import { IconPlus, IconVariable, IconX } from '../icons.ts'
import type { VariableLine } from './services-model.ts'

/**
 * The variables of a Project, or of a Workspace overriding the Project's (D8-06).
 *
 * What a run, a preparation step and an agent receive is the machine's environment, then the
 * Project's variables, then the Workspace's. So a Workspace shows both: its own lines, saying
 * which Project value each one overrides, and the Project's lines that still apply to it, marked
 * `inherited` and offered to override. A line the scope does not own cannot be removed from
 * here: an inherited line belongs to the Project, and its settings are where it is taken away.
 *
 * One form adds a variable or rewrites it: a key already set is a key whose value is replaced.
 */
const LIST = 'flex flex-col gap-2'

const KEY = 'shrink-0 font-mono text-sm text-foreground'

const VALUE = 'min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground'

const NOTE = 'text-sm text-muted-foreground'

const FORM = 'flex flex-wrap items-start gap-3'

/** What an environment key is allowed to be: what every shell reads without quoting. */
const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/

const KEY_REFUSAL = 'A variable key is upper-case letters, digits and underscores.'

export interface VariablesEditorProps {
  /** Whose variables these are: the Project's own, or a Workspace's over the Project's. */
  scope: 'project' | 'workspace'
  /** The Project's or the Workspace's name. */
  name: string
  /** The lines of the scope and, on a Workspace, the Project's lines that apply to it. */
  variables: readonly VariableLine[]
  /** Sets a key to a value in this scope; answers the refusal, or null when it was written. */
  onSet: (key: string, value: string) => Promise<string | null>
  /** Removes a key this scope owns. */
  onRemove: (key: string) => void
  /** Where the editor sits; never how it looks. */
  className?: string | undefined
}

export function VariablesEditor({
  scope,
  name,
  variables,
  onSet,
  onRemove,
  className,
}: VariablesEditorProps): ReactNode {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)

  const submit = async () => {
    const typed = key.trim()
    if (!KEY_PATTERN.test(typed)) {
      setRefusal(KEY_REFUSAL)
      return
    }
    const said = await onSet(typed, value)
    setRefusal(said)
    if (said === null) {
      setKey('')
      setValue('')
    }
  }

  return (
    <Card
      className={className}
      title="Variables"
      description={
        scope === 'project'
          ? `Given to every run, step and agent of ${name}.`
          : `Given to every run, step and agent of ${name}, over the Project's own.`
      }
    >
      {variables.length === 0 ? (
        <p className={NOTE}>
          No variable is set for {name}. Runs get the machine's environment as it is.
        </p>
      ) : (
        <ul className={LIST} aria-label={`Variables of ${name}`}>
          {variables.map((line) => (
            <li key={line.key}>
              <CardRow>
                <span className="flex shrink-0 text-muted-foreground">
                  <IconVariable size="sm" aria-hidden="true" />
                </span>
                <span className={KEY}>{line.key}</span>
                <span className={VALUE}>{line.value}</span>
                {line.overrides !== undefined && (
                  <Badge tone="info">Overrides {line.overrides}</Badge>
                )}
                {line.inherited === true ? (
                  <>
                    <Badge tone="neutral">inherited</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Override ${line.key}`}
                      onClick={() => {
                        setKey(line.key)
                        setRefusal(null)
                      }}
                    >
                      Override
                    </Button>
                  </>
                ) : (
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconX size="sm" />}
                    aria-label={`Remove ${line.key}`}
                    onClick={() => onRemove(line.key)}
                  />
                )}
              </CardRow>
            </li>
          ))}
        </ul>
      )}

      <div className={FORM}>
        <Input
          label="Key"
          className="min-w-0 flex-1"
          placeholder="PORT"
          value={key}
          onValueChange={(next) => {
            setKey(next)
            setRefusal(null)
          }}
          error={refusal ?? undefined}
        />
        <Input
          label="Value"
          className="min-w-0 flex-1"
          placeholder="3001"
          value={value}
          onValueChange={setValue}
          action={
            <Button
              variant="secondary"
              className="shrink-0"
              disabled={key.trim() === ''}
              onClick={() => void submit()}
            >
              <IconPlus size="sm" />
              Set
            </Button>
          }
        />
      </div>
    </Card>
  )
}
