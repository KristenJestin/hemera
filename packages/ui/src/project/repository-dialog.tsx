import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { motion } from 'motion/react'
import { type FunctionComponent, type ReactNode, useEffect, useId, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Checkbox } from '../components/checkbox/checkbox.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Input } from '../components/field/field.tsx'
import { SuggestInput, type Suggestion } from '../components/suggest/suggest-input.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { relativePathSchema } from '../form/schemas.ts'
import {
  IconBook,
  IconBrowser,
  IconDatabase,
  IconDeviceMobile,
  IconFolder,
  IconGitBranch,
  IconPackage,
  type IconProps,
  IconServer,
  IconSparkles,
  IconTerminal,
} from '../icons.ts'
import { press, useHand, useTransition } from '../motion.ts'
import {
  REPOSITORY_ICONS,
  type RepositoryDraft,
  type RepositoryIcon,
  type RepositoryLine,
} from './model.ts'

/**
 * The dialog a repository of a Project is added or edited in (recette 1 of lot 20).
 *
 * The settings show the repositories as a list and nothing else: what a repository is — where it
 * is, what it is drawn with, whether a new Workspace takes it — is changed here, one repository
 * at a time, and the list only says it. A refusal of the engine is said inside the dialog, which
 * stays open on what was typed.
 */
const FORM = 'flex flex-col gap-4'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const PICKER = 'flex flex-wrap items-center gap-2'

const PICKER_LABEL = 'text-sm font-medium text-foreground'

const PICK =
  'flex size-control-md items-center justify-center rounded-md border border-border bg-card text-muted-foreground focus-ring data-checked:border-primary data-checked:bg-primary-muted data-checked:text-primary-muted-foreground'

/** The glyph of the catalogue each key is drawn with. */
export const REPOSITORY_ICON_GLYPHS: Record<RepositoryIcon, FunctionComponent<IconProps>> = {
  folder: IconFolder,
  server: IconServer,
  browser: IconBrowser,
  database: IconDatabase,
  package: IconPackage,
  book: IconBook,
  mobile: IconDeviceMobile,
  terminal: IconTerminal,
}

/** What each key is called, to a screen reader and in the tooltip of its choice. */
export const REPOSITORY_ICON_LABELS: Record<RepositoryIcon, string> = {
  folder: 'Folder',
  server: 'Server',
  browser: 'Browser',
  database: 'Database',
  package: 'Package',
  book: 'Book',
  mobile: 'Mobile',
  terminal: 'Terminal',
}

/**
 * The mark at the head of a repository's row: its chosen icon, or, when none was chosen, the
 * branch when the folder holds a repository and the folder when it does not.
 */
export function RepositoryMark({
  icon,
  branch,
}: {
  icon: RepositoryIcon | null
  branch: string | null
}): ReactNode {
  const Glyph =
    icon === null ? (branch === null ? IconFolder : IconGitBranch) : REPOSITORY_ICON_GLYPHS[icon]
  return (
    <span className="flex shrink-0 text-muted-foreground">
      <Glyph size="sm" aria-hidden="true" />
    </span>
  )
}

/** The value of the choice that leaves the icon to the row: no key was stored. */
const AUTOMATIC = 'automatic'

const PICKS: { value: RepositoryIcon | typeof AUTOMATIC; label: string }[] = [
  { value: AUTOMATIC, label: 'Automatic: the folder, or its branch' },
  ...REPOSITORY_ICONS.map((icon) => ({ value: icon, label: REPOSITORY_ICON_LABELS[icon] })),
]

/**
 * The icons to choose from, as one radio group: one stop of the tab order, the arrows walk it,
 * Space chooses, and each choice says its name to a screen reader and under the hand.
 */
function IconPicker({
  value,
  onValueChange,
}: {
  value: RepositoryIcon | null
  onValueChange: (icon: RepositoryIcon | null) => void
}): ReactNode {
  const label = useId()
  return (
    <div className="flex flex-col gap-2">
      <span id={label} className={PICKER_LABEL}>
        Icon
      </span>
      <RadioGroup
        className={PICKER}
        aria-labelledby={label}
        value={value ?? AUTOMATIC}
        onValueChange={(next) => {
          const chosen = PICKS.find((pick) => pick.value === next)
          if (chosen === undefined) return
          onValueChange(chosen.value === AUTOMATIC ? null : chosen.value)
        }}
      >
        {PICKS.map((pick) => (
          <IconChoice key={pick.value} pick={pick} />
        ))}
      </RadioGroup>
    </div>
  )
}

/**
 * One icon of the group, with a hand of its own: what a press is a share of is the box it was
 * given, and every tile of the grid is its own box.
 */
function IconChoice({ pick }: { pick: (typeof PICKS)[number] }): ReactNode {
  const transition = useTransition(press)
  const hand = useHand()
  const Glyph = pick.value === AUTOMATIC ? IconSparkles : REPOSITORY_ICON_GLYPHS[pick.value]
  return (
    <Tooltip label={pick.label}>
      <Radio.Root
        value={pick.value}
        nativeButton
        aria-label={pick.label}
        className={PICK}
        render={<motion.button ref={hand.element} whileTap={hand.tap} transition={transition} />}
      >
        <Glyph size="sm" aria-hidden="true" />
      </Radio.Root>
    </Tooltip>
  )
}

/** What a folder under the Workspace is worth saying, on the line that offers it. */
function suggestionsOf(folders: readonly RepositoryLine[]): Suggestion[] {
  return folders.map((one) => {
    const offer: Suggestion = { value: one.path }
    if (one.branch !== null) offer.hint = `git · ${one.branch}`
    return offer
  })
}

export interface RepositoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The repository edited, or null when one is added. */
  repository: RepositoryLine | null
  /** The folders under the Workspace not declared yet, offered while a path is typed. */
  folders?: readonly RepositoryLine[] | undefined
  /** Writes the repository; answers the refusal to show, or null once it is written. */
  onSubmit: (draft: RepositoryDraft) => Promise<string | null>
}

export function RepositoryDialog({
  open,
  onOpenChange,
  repository,
  folders = [],
  onSubmit,
}: RepositoryDialogProps): ReactNode {
  const [path, setPath] = useState(repository?.path ?? '')
  const [icon, setIcon] = useState<RepositoryIcon | null>(repository?.icon ?? null)
  const [included, setIncluded] = useState(repository?.includedByDefault ?? true)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Opened is opened anew, on the repository it is handed: the dialog outlives its openings.
  useEffect(() => {
    if (!open) return
    setPath(repository?.path ?? '')
    setIcon(repository?.icon ?? null)
    setIncluded(repository?.includedByDefault ?? true)
    setRefusal(null)
  }, [open])

  // What the field can refuse on its own is refused as it is typed; an empty field is not an
  // error yet, only a dialog with nothing to save.
  const read = relativePathSchema.safeParse(path)
  const pathError =
    path.trim() === '' || read.success
      ? undefined
      : (read.error.issues[0]?.message ?? 'That path cannot be declared.')
  const adding = repository === null

  const submit = async () => {
    if (!read.success) return
    setSaving(true)
    const said = await onSubmit({ path: read.data.trim(), icon, includedByDefault: included })
    setSaving(false)
    setRefusal(said)
    if (said === null) onOpenChange(false)
  }

  const change = (next: string) => {
    setPath(next)
    setRefusal(null)
  }

  return (
    <Dialog
      title={adding ? 'Add repository' : 'Edit repository'}
      description={
        adding
          ? 'A folder of the Workspace, relative to its root. Nothing is cloned or initialised.'
          : `What ${repository.path} is drawn with, and whether a new Workspace takes it.`
      }
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button
            variant="primary"
            state={saving ? 'loading' : 'idle'}
            disabled={path.trim() === '' || pathError !== undefined}
            onClick={() => void submit()}
          >
            {adding ? 'Add repository' : 'Save'}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className={FORM}>
        {adding ? (
          <SuggestInput
            label="Path"
            placeholder="./sources/api"
            value={path}
            onValueChange={change}
            error={pathError}
            suggestions={suggestionsOf(folders)}
            emptyLabel="Every folder of the Workspace is already declared."
          />
        ) : (
          <Input label="Path" value={path} onValueChange={change} error={pathError} />
        )}
        <IconPicker value={icon} onValueChange={setIcon} />
        <Checkbox
          label="Include in every new Workspace"
          description="A new dedicated Workspace takes a worktree of it, unless it is left out there."
          checked={included}
          onCheckedChange={setIncluded}
        />
        {refusal !== null && (
          <p role="alert" className={REFUSAL}>
            {refusal}
          </p>
        )}
      </div>
    </Dialog>
  )
}
