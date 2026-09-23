import { type FunctionComponent, type ReactNode, useState } from 'react'

import { COMMAND_TYPE_ICONS, type CommandType } from '../activity/command-type.ts'
import { Button, IconButton } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { Input } from '../components/field/field.tsx'
import { Select } from '../components/select/select.tsx'
import { relativePathSchema } from '../form/schemas.ts'
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconLink,
  IconPlayerPlay,
  type IconProps,
  IconPlus,
  IconX,
} from '../icons.ts'

/**
 * The preparation of a Project: the ordered recipe every dedicated Workspace replays once its
 * worktrees are made (D8-05).
 *
 * Three kinds of step and nothing else: `copy` a file of `main` to the same place, `link` it
 * instead, and `run` a command of the catalogue. A step is read as the sentence it is — `copy
 * .env in each repository`, `run install` — because the order is the point, and a sentence
 * per line is what makes an order readable. The engine keeps the state of each step per
 * Workspace; this card only says what the recipe is.
 *
 * A path is relative to the Workspace root and refused otherwise, here and before anything is
 * asked of anybody. A `run` names a command of the catalogue rather than a line, so what a
 * Workspace runs is what the Project already declared.
 */

/** What a step does. */
export type RecipeKind = 'copy' | 'link' | 'run'

/** Where a `copy` or a `link` lands: once at the root, or once in each repository. */
export type RecipeScope = 'root' | 'repositories'

/** One step of the recipe, as the card draws it. */
export interface RecipeStepLine {
  id: string
  kind: RecipeKind
  /** The file a `copy` or a `link` takes, relative to the Workspace root. */
  path?: string | undefined
  /** Where a `copy` or a `link` lands. */
  scope?: RecipeScope | undefined
  /** The command a `run` starts, by the name the catalogue gives it. */
  commandName?: string | undefined
}

/** A step the form hands over: a file and where it goes, or a command of the catalogue. */
export type RecipeStepDraft =
  | { kind: 'copy' | 'link'; path: string; scope: RecipeScope }
  | { kind: 'run'; commandId: string }

/** A command of the catalogue, as a `run` step offers it. */
export interface RecipeCommand {
  id: string
  name: string
  type: CommandType
}

export interface PreparationEditorProps {
  /** The recipe, in the order it runs. */
  steps: readonly RecipeStepLine[]
  /** The Project's catalogue, which is what a `run` step may start. */
  commands: readonly RecipeCommand[]
  /** Adds a step at the end; answers the engine's refusal, or null. */
  onAdd: (step: RecipeStepDraft) => Promise<string | null>
  onRemove: (id: string) => void
  /** Moves a step one place up or down the recipe. */
  onMove: (id: string, direction: 'up' | 'down') => void
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

const NOTE = 'text-sm text-muted-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const SENTENCE = 'min-w-0 flex-1 truncate text-sm text-foreground'

const MARK = 'flex shrink-0 text-muted-foreground'

const KIND_ICONS: Record<RecipeKind, FunctionComponent<IconProps>> = {
  copy: IconCopy,
  link: IconLink,
  run: IconPlayerPlay,
}

const KIND_ITEMS: { value: RecipeKind; label: string; icon: ReactNode }[] = [
  { value: 'copy', label: 'Copy a file', icon: <IconCopy size="sm" /> },
  { value: 'link', label: 'Link a file', icon: <IconLink size="sm" /> },
  { value: 'run', label: 'Run a command', icon: <IconPlayerPlay size="sm" /> },
]

const SCOPE_WORDS: Record<RecipeScope, string> = {
  root: 'at the root',
  repositories: 'in each repository',
}

const SCOPE_ITEMS: { value: RecipeScope; label: string }[] = [
  { value: 'root', label: SCOPE_WORDS.root },
  { value: 'repositories', label: SCOPE_WORDS.repositories },
]

/** The one thing said about a path that is not relative, whatever is wrong with it. */
const NOT_RELATIVE = 'A path is relative to the Workspace root.'

/** A step read as the sentence it is. */
function sentenceOf(step: RecipeStepLine): string {
  if (step.kind === 'run') return `run ${step.commandName ?? ''}`
  return `${step.kind} ${step.path ?? ''} ${SCOPE_WORDS[step.scope ?? 'root']}`
}

export function PreparationEditor({
  steps,
  commands,
  onAdd,
  onRemove,
  onMove,
  className,
}: PreparationEditorProps): ReactNode {
  const [kind, setKind] = useState<RecipeKind>('copy')
  const [path, setPath] = useState('')
  const [scope, setScope] = useState<RecipeScope>('root')
  const [commandId, setCommandId] = useState<string | undefined>(undefined)
  const [pathError, setPathError] = useState<string | undefined>(undefined)
  const [refusal, setRefusal] = useState<string | null>(null)

  const running = kind === 'run'
  const ready = running ? commandId !== undefined : path.trim() !== ''

  const add = async () => {
    let step: RecipeStepDraft
    if (running) {
      if (commandId === undefined) return
      step = { kind: 'run', commandId }
    } else {
      // Refused here, before anybody is asked: a path that is absolute or climbs out of the
      // Workspace is not a place a Workspace has (D8-05).
      if (!relativePathSchema.safeParse(path).success) {
        setPathError(NOT_RELATIVE)
        return
      }
      step = { kind, path: path.trim(), scope }
    }
    const said = await onAdd(step)
    setRefusal(said)
    // The chosen command stays chosen: the next `run` is as likely to be another as the same.
    if (said === null) setPath('')
  }

  return (
    <Card
      title="Preparation"
      description="What every dedicated Workspace does, in this order, once its worktrees are made."
      className={className}
    >
      {steps.length === 0 ? (
        <p className={NOTE}>No step: a Workspace is ready as soon as its worktrees are.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {steps.map((step, index) => {
            const Icon = KIND_ICONS[step.kind]
            const sentence = sentenceOf(step)
            return (
              <li key={step.id}>
                <CardRow>
                  <span className={MARK}>
                    <Icon size="sm" />
                  </span>
                  <span className={SENTENCE}>{sentence}</span>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconArrowUp size="sm" />}
                    aria-label={`Move up: ${sentence}`}
                    disabled={index === 0}
                    onClick={() => onMove(step.id, 'up')}
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconArrowDown size="sm" />}
                    aria-label={`Move down: ${sentence}`}
                    disabled={index === steps.length - 1}
                    onClick={() => onMove(step.id, 'down')}
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconX size="sm" />}
                    aria-label={`Remove: ${sentence}`}
                    onClick={() => onRemove(step.id)}
                  />
                </CardRow>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Step kind"
          value={kind}
          onValueChange={(next) => {
            setKind(next)
            setPathError(undefined)
            setRefusal(null)
          }}
          items={KIND_ITEMS}
        />
        {running ? (
          commands.length === 0 ? (
            <p className={NOTE}>The catalogue holds no command yet.</p>
          ) : (
            <Select
              label="Command"
              placeholder="Choose a command"
              value={commandId}
              onValueChange={setCommandId}
              items={commands.map((one) => {
                const Icon = COMMAND_TYPE_ICONS[one.type]
                return { value: one.id, label: one.name, icon: <Icon size="sm" /> }
              })}
            />
          )
        ) : (
          <>
            <Input
              label="File"
              className="min-w-0 flex-1"
              placeholder=".env"
              value={path}
              error={pathError}
              onValueChange={(next) => {
                setPath(next)
                setPathError(undefined)
                setRefusal(null)
              }}
            />
            <Select label="Where" value={scope} onValueChange={setScope} items={SCOPE_ITEMS} />
          </>
        )}
        <Button variant="secondary" disabled={!ready} onClick={() => void add()}>
          <IconPlus size="sm" />
          Add
        </Button>
      </div>
      {refusal !== null && (
        <p role="alert" className={REFUSAL}>
          {refusal}
        </p>
      )}
    </Card>
  )
}
