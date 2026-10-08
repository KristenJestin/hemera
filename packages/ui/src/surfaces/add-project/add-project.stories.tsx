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
  /** Whether the Project's mark can be chosen; false where it cannot be kept yet. */
  marked?: boolean | undefined
  /** Whether an agent can propose the rest of the setup, as the dialog offers it. */
  setUp?: 'offered' | 'unavailable' | undefined
}

/** The dialog, holding what a renderer's hook would: the folder, the name, what was found. */
function AddProjectFixture({
  folder: firstFolder = '',
  found: firstFound,
  detecting = false,
  folderError,
  refused: refusal,
  marked = true,
  setUp,
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
  const [settingUp, setSettingUp] = useState(false)
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
        identity={marked ? identity : undefined}
        onIdentity={marked ? setIdentity : undefined}
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
        setup={setUp === undefined ? undefined : SETUP_OFFERS[setUp]}
        setUp={settingUp}
        onSetUp={setSettingUp}
        refused={refused}
        onCreate={() => {
          if (refusal !== undefined) setRefused(refusal)
          else setOpen(false)
        }}
      />
    </div>
  )
}

/** What the dialog offers of the setup, as each story has it. */
const SETUP_OFFERS = {
  offered: {},
  unavailable: { unavailable: 'Claude Code is not signed in' },
} as const

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
    // A form's dialog, as narrow as every other: one folder field needs no more.
    expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 28,
    )
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

/** Where a Project's mark cannot be kept yet: the folder, the name and the repositories, no mark. */
export const WithoutMark: Story = {
  args: { folder: '~/work/acme', found: ACME_FOUND, marked: false },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('acme')
    expect(within(dialog).queryByRole('button', { name: /^Mark of / })).toBeNull()
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3)
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

/** From the keyboard: the folder, the picker, the mark, the name, the boxes; Escape closes. */
export const Focused: Story = {
  args: { folder: '~/work/acme', found: ACME_FOUND },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    const folder = within(dialog).getByRole('textbox', { name: 'Folder' })
    folder.focus()
    await userEvent.tab()
    expect(within(dialog).getByRole('button', { name: 'Choose…' })).toHaveFocus()
    await userEvent.tab()
    expect(within(dialog).getByRole('button', { name: 'Mark of acme' })).toHaveFocus()
    await userEvent.tab()
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus()
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
 * The Project's mark chosen as it is added, from the mark at the head of its name: a symbol, a
 * colour, or a logo of its own; left alone, the name's letter.
 */
export const Marked: Story = {
  args: { folder: '~/work/acme', found: ACME_FOUND },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    const mark = within(dialog).getByRole('button', { name: 'Mark of acme' })
    expect(mark.querySelector('[data-avatar]')).toHaveTextContent('A')
    await userEvent.click(mark)
    const panel = await within(document.body).findByRole('dialog', { name: 'Mark of acme' })
    await userEvent.click(within(panel).getByRole('radio', { name: 'Cyan' }))
    await userEvent.click(within(panel).getByRole('radio', { name: 'Rocket' }))
    expect(mark.querySelector('[data-mark-icon="rocket"]')).not.toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: 'Upload an image…' }))
    expect(mark.querySelector('[data-mark-image]')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog', { name: 'Mark of acme' })).toBeNull()
    })
    // Escape closes the panel and nothing more: the dialog it was opened from stays.
    expect(dialog).toBeInTheDocument()
  },
}

/** An agent can propose the rest of the setup: offered, unticked, the user's choice. */
export const SetUpOffered: Story = {
  args: { folder: '~/work/acme', found: ACME_FOUND, setUp: 'offered' },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    const offer = within(dialog).getByRole('checkbox', {
      name: /^Let an agent propose the rest of the setup/,
    })
    expect(offer).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(offer)
    expect(offer).toHaveAttribute('aria-checked', 'true')
  },
}

/** No agent can: why, and nothing to tick. */
export const SetUpUnavailable: Story = {
  args: { folder: '~/work/acme', found: ACME_FOUND, setUp: 'unavailable' },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add a Project' })
    expect(within(dialog).getByText(/Claude Code is not signed in/)).toBeVisible()
    expect(
      within(dialog).queryByRole('checkbox', { name: /propose the rest of the setup/ }),
    ).toBeNull()
  },
}
