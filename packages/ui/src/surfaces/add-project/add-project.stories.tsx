import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import type { Identity } from '../../components/project-mark/project-mark.tsx'
import { ACME_LOGO } from '../../components/project-mark/project-mark-fixtures.ts'
import { AddProject, type FoundRepository } from './add-project.tsx'

/**
 * Adding a Project by hand: a folder, typed or chosen; the repositories Hemera finds in it,
 * proposed and ticked; a folder that holds none accepted, and a repository added by its path; a
 * name, the folder's until another is written. Each story is the dialog over the window.
 */
interface AddProjectFixtureProps {
  /** The folder given as the story starts; empty for none yet. */
  folder?: string | undefined
  /** What Hemera finds in the folder. */
  found?: readonly FoundRepository[] | undefined
  /** Whether Hemera is still looking as the story starts. */
  detecting?: boolean | undefined
  folderError?: string | undefined
  /** Why creating the Project is refused. */
  refused?: string | undefined
}

/** The dialog, holding what a renderer's hook would: the folder, the name, what was found. */
function AddProjectFixture({
  folder: firstFolder = '',
  found: firstFound,
  detecting = false,
  folderError,
  refused: refusal,
}: AddProjectFixtureProps) {
  const [open, setOpen] = useState(true)
  const [folder, setFolder] = useState(firstFolder)
  const [name, setName] = useState(firstFolder === '' ? '' : (firstFolder.split('/').at(-1) ?? ''))
  const [found, setFound] = useState<FoundRepository[] | null>(
    firstFound === undefined ? null : [...firstFound],
  )
  const [identity, setIdentity] = useState<Identity>({})
  const [byHand, setByHand] = useState('')
  const [refused, setRefused] = useState<string | undefined>(undefined)
  // The system's picker, as a story can have it: it gives Acme's folder, and Hemera looks in it.
  const [looking, setLooking] = useState(detecting)
  useEffect(() => {
    if (!looking || detecting) return undefined
    const done = setTimeout(() => {
      setFound(ACME_FOUND.map((one) => ({ ...one })))
      setLooking(false)
    }, 400)
    return () => clearTimeout(done)
  }, [looking, detecting])
  return (
    <div className="flex h-screen bg-surface-content">
      {!open && (
        <button type="button" className="m-auto text-sm" onClick={() => setOpen(true)}>
          Add a Project
        </button>
      )}
      <AddProject
        open={open}
        onOpenChange={setOpen}
        folder={folder}
        onFolder={setFolder}
        onChooseFolder={() => {
          setFolder('~/work/acme')
          setName('acme')
          setFound(null)
          setLooking(true)
        }}
        folderError={folderError}
        name={name}
        onName={setName}
        identity={identity}
        onIdentity={setIdentity}
        onChooseImage={() => setIdentity((before) => ({ ...before, image: ACME_LOGO }))}
        found={found}
        detecting={looking}
        onChoose={(path, chosen) =>
          setFound((before) =>
            (before ?? []).map((one) =>
              one.path === path ? { path: one.path, chosen, byHand: one.byHand } : one,
            ),
          )
        }
        byHand={byHand}
        onByHand={setByHand}
        onAddByHand={() => {
          if (byHand.trim() === '') return
          setFound((before) => [
            ...(before ?? []),
            { path: byHand.trim(), chosen: true, byHand: true },
          ])
          setByHand('')
        }}
        refused={refused}
        onCreate={() => {
          if (refusal !== undefined) setRefused(refusal)
          else setOpen(false)
        }}
      />
    </div>
  )
}

/** What Hemera finds in Acme's folder: three repositories under it. */
const ACME_FOUND: readonly FoundRepository[] = [
  { path: 'api', chosen: true },
  { path: 'web', chosen: true },
  { path: 'shared', chosen: true },
]

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Add a Project',
  component: AddProjectFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AddProjectFixture>

export default meta
type Story = StoryObj<typeof meta>

/** No folder yet: the field and the picker, nothing else to fill. */
export const Empty: Story = {
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    expect(within(dialog).getByRole('textbox', { name: 'Folder' })).toHaveValue('')
    expect(within(dialog).queryByRole('textbox', { name: 'Name' })).toBeNull()
  },
}

/** A folder chosen: Hemera looks in it — the rows' own shape — and proposes what it found, ticked. */
export const Found: Story = {
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose…' }))
    expect(within(dialog).getByRole('list', { busy: true })).toBeInTheDocument()
    await waitFor(() => {
      expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3)
    })
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('acme')
    expect(within(dialog).getByRole('button', { name: 'Add acme' })).toBeVisible()
  },
}

/** Hemera looking in the folder: the rows' own shape, Add held back until it is done. */
export const Detecting: Story = {
  args: { folder: '~/work/acme', detecting: true },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    expect(dialog.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
    expect(within(dialog).getByRole('button', { name: 'Add acme' })).toBeDisabled()
  },
}

/** The folder is itself a repository: `.` proposed, and one under it left out by the user. */
export const FolderIsRepository: Story = {
  args: {
    folder: '~/work/hemera',
    found: [
      { path: '.', chosen: true },
      { path: 'vendor/effect', chosen: false },
    ],
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    expect(within(dialog).getByRole('checkbox', { name: '. (the folder itself)' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'vendor/effect' })).not.toBeChecked()
  },
}

/**
 * A folder that is not a repository and holds none: accepted all the same — none found, and a
 * repository added by its path, by hand.
 */
export const NoRepository: Story = {
  args: { folder: '~/work/notes', found: [] },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    expect(dialog).toHaveTextContent('None in this folder')
    expect(within(dialog).getByRole('button', { name: 'Add notes' })).toBeEnabled()
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Add a repository by its path' }),
      'drafts{Enter}',
    )
    expect(within(dialog).getByRole('checkbox', { name: 'drafts' })).toBeChecked()
  },
}

/** A folder Hemera cannot use: said under its field, in words. */
export const FolderRefused: Story = {
  args: {
    folder: '~/work/acme',
    found: [],
    folderError: '“~/work/acme” is refused: it is already the main checkout of the Project Acme.',
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    expect(within(dialog).getByText(/already the main checkout of the Project Acme/)).toBeVisible()
    expect(within(dialog).getByRole('textbox', { name: 'Folder' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  },
}

/** Creating the Project refused: said above the buttons, in words, the dialog kept as it was. */
export const Refused: Story = {
  args: {
    folder: '~/work/acme',
    found: ACME_FOUND,
    refused: 'This Project name is refused: it is longer than 120 characters.',
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add acme' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('longer than 120 characters')
  },
}

/** A long folder and long repository paths: each held on its line, cut at its end. */
export const LongText: Story = {
  args: {
    folder:
      '~/work/clients/acme-platform-services-and-internal-tooling/checkouts/2026/main-checkout',
    found: [
      { path: 'services/platform-api-and-background-workers', chosen: true },
      { path: 'apps/customer-portal-and-self-service-onboarding', chosen: true },
      { path: 'shared', chosen: true },
    ],
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3)
  },
}

/** From the keyboard: the folder, the picker, the name, the mark, the boxes; Escape closes. */
export const Focused: Story = {
  args: { folder: '~/work/acme', found: ACME_FOUND },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    const folder = within(dialog).getByRole('textbox', { name: 'Folder' })
    folder.focus()
    await userEvent.tab()
    expect(within(dialog).getByRole('button', { name: 'Choose…' })).toHaveFocus()
    await userEvent.tab()
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await userEvent.tab()
    // The colours are one stop, the arrows walk them.
    const chosen = within(dialog).getByRole('radio', { checked: true })
    expect(chosen).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(within(dialog).getByRole('radio', { checked: true })).toHaveFocus()
    })
    expect(within(dialog).getByRole('radio', { checked: true })).not.toBe(chosen)
    await userEvent.tab()
    expect(within(dialog).getByRole('combobox', { name: 'Icon' })).toHaveFocus()
    await userEvent.tab()
    expect(within(dialog).getByRole('button', { name: 'Choose an image…' })).toHaveFocus()
    await userEvent.tab()
    const api = within(dialog).getByRole('checkbox', { name: 'api' })
    expect(api).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(api).not.toBeChecked()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/**
 * The Project's mark chosen as it is added: a colour, an icon of the set, or a logo of its own —
 * drawn beside its name as the sidebar will draw it; left alone, the name's letter.
 */
export const Marked: Story = {
  args: { folder: '~/work/acme', found: ACME_FOUND },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    const preview = dialog.querySelector('[data-mark-preview]')
    expect(preview?.querySelector('[data-avatar]')).toHaveTextContent('A')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Cyan' }))
    expect(within(dialog).getByRole('radio', { name: 'Cyan' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Icon' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Rocket' }))
    await waitFor(() => {
      expect(preview?.querySelector('[data-mark-icon="rocket"]')).not.toBeNull()
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Choose an image…' }))
    expect(preview?.querySelector('[data-mark-image]')).not.toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove the image' }))
    expect(preview?.querySelector('[data-mark-image]')).toBeNull()
  },
}
