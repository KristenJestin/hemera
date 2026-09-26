import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Input } from '../components/field/field.tsx'
import { IconPencil, IconPlus, IconVariable, IconX } from '../icons.ts'
import type { VariableLine } from './services-model.ts'

/**
 * The variables of a Project, or of a Workspace overriding the Project's (D8-06).
 *
 * What a run, a preparation step and an agent receive is the machine's environment, then the
 * Project's variables, then the Workspace's. So a Workspace shows both: its own lines, saying
 * which Project value each one overrides, and the Project's lines that still apply to it, marked
 * `inherited` and offered to override. A line the scope does not own is neither edited nor
 * removed from here: an inherited line belongs to the Project, whose settings are where it changes.
 *
 * The list is only a list: a variable is added in the **Add variable** dialog, and its value is
 * rewritten in the **Edit variable** dialog, where the key is fixed. A key typed in the add dialog
 * that this scope already sets is not quietly overwritten: the dialog says it exists and offers to
 * edit it instead. Overriding an inherited line is adding it — the key is the Project's and not
 * the Workspace's, so it is not one that exists here.
 */
const LIST = 'flex flex-col gap-2'

const KEY = 'shrink-0 font-mono text-sm text-foreground'

const VALUE = 'min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground'

const NOTE = 'text-sm text-muted-foreground'

const FORM = 'flex flex-col gap-4'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

/** The key of the variable being edited, which the edit dialog does not let change. */
const FIXED = 'flex flex-col gap-1 text-sm'

const FIXED_TERM = 'font-medium text-foreground'

const FIXED_KEY = 'font-mono text-foreground'

/** The sentence that says a key exists, and the button that goes and edits it. */
const EXISTS = 'flex flex-wrap items-center gap-2'

/** What an environment key is allowed to be: what every shell reads without quoting. */
const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/

const KEY_REFUSAL = 'A variable key is upper-case letters, digits and underscores.'

/** What the dialog holds: a key being added, or the value of a key this scope sets. */
interface Editing {
  mode: 'add' | 'edit'
  key: string
  value: string
}

export interface VariablesEditorProps {
  /** Whose variables these are: the Project's own, or a Workspace's over the Project's. */
  scope: 'project' | 'workspace'
  /** The Project's or the Workspace's name. */
  name: string
  /** The lines of the scope and, on a Workspace, the Project's lines that apply to it. */
  variables: readonly VariableLine[]
  /**
   * Sets a key to a value in this scope, from the add and the edit dialog alike; answers the
   * refusal, or null when it was written.
   */
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
  /** What the dialog holds; kept while it closes, so it does not empty on its way out. */
  const [editing, setEditing] = useState<Editing>({ mode: 'add', key: '', value: '' })
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /**
   * The value's field, which the focus is taken to when the dialog turns from adding a key that
   * exists to editing it: the button that was pressed is gone, and the focus has to land somewhere
   * that is still there.
   */
  const valueField = useRef<HTMLDivElement>(null)
  const [turned, setTurned] = useState(0)

  useEffect(() => {
    if (turned > 0) valueField.current?.querySelector('input')?.focus()
  }, [turned])

  const show = (next: Editing) => {
    setEditing(next)
    setRefusal(null)
    setOpen(true)
  }

  const adding = editing.mode === 'add'
  const key = editing.key.trim()
  // Only a key this scope sets exists here: overriding the Project's is adding one of its own.
  const existing = adding
    ? variables.find((line) => line.key === key && line.inherited !== true)
    : undefined
  const keyRefusal = adding && key !== '' && !KEY_PATTERN.test(key) ? KEY_REFUSAL : undefined
  const ready = key !== '' && keyRefusal === undefined && existing === undefined

  const save = async () => {
    setSaving(true)
    const said = await onSet(key, editing.value)
    setSaving(false)
    setRefusal(said)
    if (said === null) setOpen(false)
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
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => show({ mode: 'add', key: '', value: '' })}
        >
          <IconPlus size="sm" aria-hidden="true" />
          Add variable
        </Button>
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
                      onClick={() => show({ mode: 'add', key: line.key, value: '' })}
                    >
                      Override
                    </Button>
                  </>
                ) : (
                  <>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<IconPencil size="sm" />}
                      aria-label={`Edit ${line.key}`}
                      onClick={() => show({ mode: 'edit', key: line.key, value: line.value })}
                    />
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<IconX size="sm" />}
                      aria-label={`Remove ${line.key}`}
                      onClick={() => onRemove(line.key)}
                    />
                  </>
                )}
              </CardRow>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        title={adding ? 'Add variable' : 'Edit variable'}
        description={
          adding
            ? `A key and its value, given to what runs in ${name} from now on.`
            : `A new value for this key, given to what runs in ${name} from now on.`
        }
        open={open}
        onOpenChange={setOpen}
        actions={
          <>
            <Button
              variant="primary"
              state={saving ? 'loading' : 'idle'}
              disabled={!ready}
              onClick={() => void save()}
            >
              {adding ? 'Add' : 'Save'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <div className={FORM}>
          {adding ? (
            <Input
              label="Key"
              placeholder="PORT"
              value={editing.key}
              error={keyRefusal}
              onValueChange={(next) => {
                setEditing({ ...editing, key: next })
                setRefusal(null)
              }}
            />
          ) : (
            <p className={FIXED}>
              <span className={FIXED_TERM}>Key</span>
              <span className={FIXED_KEY}>{editing.key}</span>
            </p>
          )}
          {existing !== undefined && (
            <div className={EXISTS}>
              <p role="alert" className={REFUSAL}>
                {existing.key} is already set for {name}.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  show({ mode: 'edit', key: existing.key, value: existing.value })
                  setTurned(turned + 1)
                }}
              >
                <IconPencil size="sm" aria-hidden="true" />
                Edit {existing.key}
              </Button>
            </div>
          )}
          <div ref={valueField}>
            <Input
              label="Value"
              placeholder="3001"
              value={editing.value}
              onValueChange={(next) => {
                setEditing({ ...editing, value: next })
                setRefusal(null)
              }}
            />
          </div>
          {refusal !== null && (
            <p role="alert" className={REFUSAL}>
              {refusal}
            </p>
          )}
        </div>
      </Dialog>
    </Card>
  )
}
