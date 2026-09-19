import { type ReactNode, useEffect, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { useAppForm } from '../form/app-form.ts'
import { projectFormSchema } from '../form/schemas.ts'
import type { ProjectDraft } from './model.ts'

/**
 * Where a Project is created: a name, a tone, and the folder of its `main` Workspace (D4-07).
 *
 * The folder is chosen by the system's own picker, which belongs to the main process — the
 * dialog asks for it through a callback and writes down whatever comes back, and the field
 * stays typeable for the hand that would rather paste a path.
 *
 * What a field can settle on its own it settles here: a name that is empty or longer than a
 * document, a folder nobody named. Whether the folder is *there* is a question only a disk
 * answers, so it is asked of one — `onCheckFolder` — and what comes back is the sentence the
 * field shows.
 *
 * That question is asked when the form is sent and not while it is being typed into. A path is
 * half-written for as long as it is being written, so a disk asked on every keystroke answers
 * about a folder nobody meant; and a validator still running is a form that cannot be sent, so
 * the press that lands between the last character and the answer would do nothing at all.
 *
 * The domain remains the authority on everything else, and what it refuses comes back through
 * `onSubmit` and is said out loud under the form.
 *
 * It opens on the draft it was handed, every time. A dialog that reopened on what was typed
 * into it last is a dialog offering to create the Project that was just created.
 */
const FORM = 'flex flex-col gap-4'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

/** What a Project starts as before anything has been typed into it. */
export const EMPTY_DRAFT: ProjectDraft = { name: '', tone: 'primary', mainPath: '' }

export interface ProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the fields open on; a creation opens on an empty draft. */
  draft?: ProjectDraft | undefined
  /** The word on the button that validates: `Create Project`, or `Save` when editing. */
  action?: string | undefined
  /** Asks the system for a folder, and answers null when the picker was dismissed. */
  onBrowse: () => Promise<string | null>
  /**
   * Asks whatever has a disk what is at a path, and answers the cause when nothing usable is.
   *
   * Absent — in Storybook, which has no disk — a path is taken as given.
   */
  onCheckFolder?: ((path: string) => Promise<string | null>) | undefined
  /** What the caller does with the draft; the message it answers is what the dialog shows. */
  onSubmit: (draft: ProjectDraft) => Promise<string | null>
}

export function ProjectDialog({
  open,
  onOpenChange,
  draft = EMPTY_DRAFT,
  action = 'Create Project',
  onBrowse,
  onCheckFolder,
  onSubmit,
}: ProjectDialogProps): ReactNode {
  const [refusal, setRefusal] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: draft,
    validators: { onChange: projectFormSchema },
    onSubmit: async ({ value }) => {
      const said = await onSubmit(value)
      setRefusal(said)
      if (said === null) onOpenChange(false)
    },
  })

  // Opened is opened anew. The dialog outlives its own openings — it is mounted for as long as
  // the window is — so without this it carries whatever was typed into it the last time.
  useEffect(() => {
    if (!open) return
    form.reset(draft)
    setRefusal(null)
  }, [open])

  return (
    <Dialog
      title="New Project"
      description="A Project is a logical group. Its path belongs to its main Workspace."
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton label={action} />
          </form.AppForm>
        </>
      }
    >
      <div className={FORM}>
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" placeholder="What is it called?" />}
        </form.AppField>
        <form.AppField name="tone">{(field) => <field.ToneField label="Colour" />}</form.AppField>
        <form.AppField
          name="mainPath"
          validators={{ onSubmitAsync: async ({ value }) => await causeOf(value, onCheckFolder) }}
        >
          {(field) => (
            <field.PathField
              label="Folder of the main Workspace"
              placeholder="Where its sources will live"
              description="Nothing is ever written into it. The picker can make one."
              onBrowse={onBrowse}
            />
          )}
        </form.AppField>
        {refusal !== null && (
          <p role="alert" className={REFUSAL}>
            {refusal}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/** What is wrong with a path according to whatever has a disk, and nothing while it is empty. */
export async function causeOf(
  value: string,
  check: ((path: string) => Promise<string | null>) | undefined,
): Promise<string | undefined> {
  if (check === undefined || value.trim() === '') return undefined
  return (await check(value)) ?? undefined
}
