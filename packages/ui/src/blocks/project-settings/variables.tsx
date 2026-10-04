import { SectionHead } from '../../components/section-head/section-head.tsx'
import type { ReactNode } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconDots, IconEye, IconEyeOff, IconPencil, IconPlus, IconTrash } from '../../icons.ts'
import { Section, TemplateMenu } from './parts.tsx'

/**
 * The variables of a Project: what every command and every step of its Workspaces runs with.
 *
 * A line is the variable's name in the mono face and its value, masked: eight dots, whatever its
 * length, so a mask says nothing of what it hides. The eye at the end shows that one value, and
 * hides it again; nothing else ever shows it. The `…` holds Edit and Remove, Remove in the
 * destructive tone. In its form, the value may hold the names Hemera fills — `{workspace}` and
 * the others — offered by the braces at the end of its field.
 */
export interface SettingsVariable {
  key: string
  /** Its value once shown on request; undefined while it is masked. */
  value?: string | undefined
  /** Whether it is being read to be shown. */
  revealing?: boolean | undefined
}

/** What a masked value is drawn as, whatever its length. */
export const MASK = '••••••••'

const RULE = 'border-b border-border last:border-b-0'

const ROW = 'flex h-control-lg min-w-0 items-center gap-3 pr-2 pl-4 text-sm'

const KEY = 'w-settings-name min-w-0 shrink-0 truncate font-mono text-xs font-medium'

const VALUE = 'min-w-0 flex-1 truncate font-mono text-xs'

const MASKED = 'min-w-0 flex-1 truncate font-mono text-xs tracking-widest text-muted-foreground'

const END = 'flex shrink-0 items-center gap-1'

export interface VariableRowProps {
  variable: SettingsVariable
  onReveal: () => void
  onHide: () => void
  onEdit: () => void
  onRemove: () => void
}

export function VariableRow({
  variable,
  onReveal,
  onHide,
  onEdit,
  onRemove,
}: VariableRowProps): ReactNode {
  const shown = variable.value !== undefined
  return (
    <li className={RULE} data-variable={variable.key}>
      <div className={ROW}>
        <span className={KEY}>{variable.key}</span>
        {shown ? (
          <span className={VALUE}>{variable.value}</span>
        ) : (
          <span className={MASKED}>
            <span aria-hidden="true">{MASK}</span>
            <span className="sr-only">masked</span>
          </span>
        )}
        <span className={END}>
          <Tooltip label={shown ? 'Hide the value' : 'Show the value'}>
            <IconButton
              variant="ghost"
              size="sm"
              state={variable.revealing === true ? 'loading' : 'idle'}
              icon={shown ? <IconEyeOff size="sm" /> : <IconEye size="sm" />}
              aria-label={`${shown ? 'Hide' : 'Show'} the value of ${variable.key}`}
              aria-pressed={shown}
              onClick={shown ? onHide : onReveal}
            />
          </Tooltip>
          <Menu
            label={`More for ${variable.key}`}
            icon={<IconDots size="sm" />}
            groups={[
              [{ label: 'Edit', icon: <IconPencil size="sm" />, onSelect: onEdit }],
              [
                {
                  label: `Remove ${variable.key}`,
                  icon: <IconTrash size="sm" />,
                  destructive: true,
                  onSelect: onRemove,
                },
              ],
            ]}
          />
        </span>
      </div>
    </li>
  )
}

/** The row's own shape while the variables are on their way. */
export function VariableRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <div className={ROW}>
        <span className={KEY}>
          <Skeleton>DATABASE_URL</Skeleton>
        </span>
        <span className={MASKED}>
          <Skeleton>{MASK}</Skeleton>
        </span>
        <span className={END}>
          <Skeleton shape="block">
            <span className="flex size-control-sm" />
          </Skeleton>
          <Skeleton shape="block">
            <span className="flex size-control-sm" />
          </Skeleton>
        </span>
      </div>
    </li>
  )
}

export interface VariablesSectionProps {
  variables: readonly SettingsVariable[]
  loading?: boolean | undefined
  onReveal: (key: string) => void
  onHide: (key: string) => void
  onEdit: (key: string) => void
  onRemove: (key: string) => void
  onAdd: () => void
}

export function VariablesSection({
  variables,
  loading = false,
  onReveal,
  onHide,
  onEdit,
  onRemove,
  onAdd,
}: VariablesSectionProps): ReactNode {
  const add = (
    <Button size="sm" onClick={onAdd}>
      <IconPlus size="sm" />
      Add a variable
    </Button>
  )
  const empty = !loading && variables.length === 0
  return (
    <Section label="Variables">
      <SectionHead
        title="Variables"
        count={loading || empty ? undefined : variables.length}
        actions={loading || empty ? undefined : add}
      />
      <Frame>
        {empty ? (
          <Empty face="asleep" title="No variable yet" action={add} />
        ) : (
          <ul aria-label="Variables" aria-busy={loading} className="flex flex-col">
            {loading ? (
              <>
                <VariableRowSkeleton />
                <VariableRowSkeleton />
                <VariableRowSkeleton />
              </>
            ) : (
              variables.map((variable) => (
                <VariableRow
                  key={variable.key}
                  variable={variable}
                  onReveal={() => onReveal(variable.key)}
                  onHide={() => onHide(variable.key)}
                  onEdit={() => onEdit(variable.key)}
                  onRemove={() => onRemove(variable.key)}
                />
              ))
            )}
          </ul>
        )}
      </Frame>
    </Section>
  )
}

/** What the form of a variable writes. */
export interface VariableDraft {
  key: string
  value: string
}

export interface VariableFormProps {
  draft: VariableDraft
  onChange: (draft: VariableDraft) => void
  /** What is wrong with the name, in words. */
  keyError?: string | undefined
  /** What is wrong with the value: a name Hemera does not fill, a brace never closed. */
  valueError?: string | undefined
}

/** The form of a variable: its name, and its value, which may hold the names Hemera fills. */
export function VariableForm({
  draft,
  onChange,
  keyError,
  valueError,
}: VariableFormProps): ReactNode {
  return (
    <>
      <Input
        label="Name"
        value={draft.key}
        placeholder="DATABASE_URL"
        error={keyError}
        onValueChange={(key) => onChange({ ...draft, key })}
      />
      <Input
        label="Value"
        value={draft.value}
        error={valueError}
        onValueChange={(value) => onChange({ ...draft, value })}
        trailing={
          <TemplateMenu
            field="Value"
            onInsert={(name) => onChange({ ...draft, value: `${draft.value}${name}` })}
          />
        }
      />
    </>
  )
}
