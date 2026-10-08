import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { type Identity, ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { IconFolder } from '../../icons.ts'
import {
  type SettingsForm,
  SettingsPage,
  type SettingsSection,
} from '../settings/settings-page.tsx'

export type { SettingsForm, SettingsSection }

/**
 * A Project's settings: one page, the list of its sections down the left, the section chosen
 * beside it, and a dialog over both where one thing of a section is written: a form opens in the
 * design system's dialog, centred, its buttons at its foot — a dialog is for reading, not writing.
 *
 * The header is the Project's own, as on its page — its letter and its name — and under them the
 * folder of its main checkout, the one fact of a Project no section owns. The sections are a list
 * and not a long scroll: a dozen of them will stand here once every slice has added its own, and a
 * page twelve sections long is a page nobody finds anything on. The list stays where it is while
 * the section scrolls; the chosen one wears the list's mark, which travels to the next on
 * `arrival`. A section with something wrong in it says so with its glyph in the list, so the
 * problem is found from any section.
 *
 * A section is the caller's: the page draws the frame, and what is chosen goes in the room beside
 * the list. A Project that cannot be read is said there, in words, with Try again.
 */
export interface ProjectSettingsProps {
  name: string
  /** What the user chose to mark it with; nothing chosen is its letter. */
  identity?: Identity | undefined
  /** The folder of the user's own clones, as it is written on this machine. */
  mainCheckout: string
  sections: readonly SettingsSection[]
  /** The section shown, by id. */
  current: string
  onSection: (id: string) => void
  /** Why the Project could not be read, in words. */
  error?: string | undefined
  onRetry: () => void
  /** The form open over the page, in a dialog, or null. */
  form?: SettingsForm | null | undefined
  onCloseForm: () => void
  /** Launches the setup agent, at any time: its button at the header's end. Left out, none. */
  setUp?: SetUpAction | undefined
  /** The section chosen. */
  children: ReactNode
}

/** The setup's launch from the settings: why it cannot, or why its last launch was refused. */
export interface SetUpAction {
  onStart: () => void
  /** Whether it is being launched. */
  starting?: boolean | undefined
  /** No agent can run it: the button is disabled, `refused` says why. */
  unavailable?: boolean | undefined
  refused?: string | undefined
}

const CHECKOUT = 'flex min-w-0 items-center gap-1.5 font-mono text-xs'

export function ProjectSettings({
  name,
  identity,
  mainCheckout,
  sections,
  current,
  onSection,
  error,
  onRetry,
  form = null,
  onCloseForm,
  setUp,
  children,
}: ProjectSettingsProps): ReactNode {
  return (
    <SettingsPage
      lead={<ProjectMark name={name} identity={identity} />}
      title={name}
      about={
        <span className={CHECKOUT}>
          <IconFolder size="sm" aria-hidden="true" />
          <span className="sr-only">Main checkout:</span>
          <span className="truncate">{mainCheckout}</span>
        </span>
      }
      actions={
        setUp === undefined ? undefined : (
          <span className="flex min-w-0 items-center gap-3">
            {setUp.refused !== undefined && (
              // It wraps at the reading measure rather than being cut: a reason is read whole.
              <span
                role="status"
                className="max-w-measure min-w-0 text-right text-sm text-pretty text-muted-foreground"
              >
                {setUp.refused}
              </span>
            )}
            <Button
              state={setUp.starting === true ? 'loading' : 'idle'}
              disabled={setUp.unavailable === true}
              onClick={setUp.onStart}
            >
              Set up with an agent
            </Button>
          </span>
        )
      }
      label="Settings of the Project"
      sections={sections}
      current={current}
      onSection={onSection}
      form={form}
      onCloseForm={onCloseForm}
    >
      {error === undefined ? (
        children
      ) : (
        <ErrorState title={`Hemera could not read ${name}`} description={error} onRetry={onRetry} />
      )}
    </SettingsPage>
  )
}
