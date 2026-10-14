import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { foldedOut } from '../../exit-play.ts'
import { findOpen } from '../../overlay-play.ts'
import { IconBook2, IconChecklist } from '../../icons.ts'
import {
  ProjectSettings,
  type SettingsForm,
} from '../../surfaces/project-settings/project-settings.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-sections.tsx'
import {
  type CheckDraft,
  CheckForm,
  ChecksSection,
  NEW_CHECK,
  type SettingsCheck,
} from './checks.tsx'
import {
  CHECK_COMMANDS,
  CHECKS,
  DENSE_CHECKS,
  LONG_CHECK,
  PLACES,
  PROPOSED_CHECKS,
  checkRefusals,
  draftOf,
  proofLimitRefusal,
} from './checks-fixtures.ts'
import { FormFoot } from './parts.tsx'
import { STALE } from './project-settings-fixtures.ts'

type Open = { kind: 'edit'; id: string } | { kind: 'new'; draft?: CheckDraft | undefined }

interface PageProps {
  /** Null: the checks are on their way. */
  checks: readonly SettingsCheck[] | null
  proposals?: readonly SettingsCheck[] | undefined
  error?: string | undefined
  form?: Open | undefined
  /** Why every save is refused, in words, as one meeting a newer version is. */
  refused?: string | undefined
  onSave: (draft: CheckDraft) => void
  onRemove: (id: string) => void
  onAccept: (ids: readonly string[]) => void
  onReorder: (ids: readonly string[]) => void
  /** How long a proof may run as its field holds it: null for the default, 10 minutes. */
  proofLimit?: string | null | undefined
  onProofLimit: (value: string | null) => void
}

/** What a check becomes once its proposal is accepted: its own id, the proposal's mark gone. */
function accepted(proposal: SettingsCheck): SettingsCheck {
  return { ...proposal, id: proposal.id.replace(/^proposed-/, '') }
}

function resolve(draft: CheckDraft, id: string): SettingsCheck {
  return {
    ...draft,
    id,
    command: CHECK_COMMANDS.find((one) => one.id === draft.command) ?? null,
  }
}

/** A page of Acme's settings around the checks, holding what the renderer will hold. */
function Page(props: PageProps): ReactNode {
  const [checks, setChecks] = useState(props.checks)
  const [proposals, setProposals] = useState(props.proposals ?? [])
  const [form, setForm] = useState<Open | null>(props.form ?? null)
  const [limit, setLimit] = useState(props.proofLimit ?? null)
  const draftFor = (open: Open | null): CheckDraft => {
    if (open === null) return NEW_CHECK
    if (open.kind === 'new') return open.draft ?? NEW_CHECK
    const found = checks?.find((one) => one.id === open.id)
    return found === undefined ? NEW_CHECK : draftOf(found)
  }
  const [draft, setDraft] = useState<CheckDraft>(draftFor(props.form ?? null))
  // What the story is given anew — an image sequence changing its arguments — replaces what it holds.
  const [given, setGiven] = useState({
    checks: props.checks,
    proposals: props.proposals,
    form: props.form,
  })
  if (
    given.checks !== props.checks ||
    given.proposals !== props.proposals ||
    given.form !== props.form
  ) {
    setGiven({ checks: props.checks, proposals: props.proposals, form: props.form })
    setChecks(props.checks)
    setProposals(props.proposals ?? [])
    setForm(props.form ?? null)
    setDraft(draftFor(props.form ?? null))
  }
  const open = (next: Open): void => {
    setDraft(draftFor(next))
    setForm(next)
  }
  const close = (): void => setForm(null)
  const accept = (ids: readonly string[]): void => {
    props.onAccept(ids)
    const taken = proposals.filter((one) => ids.includes(one.id))
    setProposals((before) => before.filter((one) => !ids.includes(one.id)))
    setChecks((before) => [...(before ?? []), ...taken.map(accepted)])
  }
  const editing = form?.kind === 'edit' ? checks?.find((one) => one.id === form.id) : undefined
  const taken = (checks ?? []).filter((one) => one !== editing).map((one) => one.name)
  const refusals = checkRefusals(draft, taken)
  const save = (): void => {
    props.onSave(draft)
    if (props.refused !== undefined || Object.values(refusals).some((one) => one !== undefined))
      return
    setChecks((before) =>
      editing === undefined
        ? [...(before ?? []), resolve(draft, `c${String((before ?? []).length + 1)}`)]
        : (before ?? []).map((one) => (one.id === editing.id ? resolve(draft, one.id) : one)),
    )
    close()
  }
  const dialog: SettingsForm | null =
    form === null
      ? null
      : {
          title: editing?.name ?? 'Add a check',
          icon: <IconChecklist size="sm" />,
          body: (
            <CheckForm
              draft={draft}
              onChange={setDraft}
              commands={CHECK_COMMANDS}
              places={PLACES}
              refusals={refusals}
            />
          ),
          footer: (
            <FormFoot
              refused={props.refused}
              remove={editing === undefined ? undefined : `Remove ${editing.name}`}
              onRemove={() => {
                if (editing === undefined) return
                props.onRemove(editing.id)
                setChecks((before) => (before ?? []).filter((one) => one.id !== editing.id))
                close()
              }}
              save={editing === undefined ? 'Add' : 'Save'}
              onSave={save}
              onCancel={close}
            />
          ),
        }
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ProjectSettings
        name="Acme"
        mainCheckout="~/work/acme"
        sections={[
          ...SECTIONS,
          { id: 'checks', label: 'Checks', icon: <IconChecklist size="sm" /> },
          { id: 'documentation', label: 'Documentation', icon: <IconBook2 size="sm" /> },
        ]}
        current="checks"
        onSection={() => {}}
        onRetry={() => {}}
        form={dialog}
        onCloseForm={close}
      >
        <ChecksSection
          checks={checks}
          proposals={proposals}
          error={props.error}
          onOpen={(id) => open({ kind: 'edit', id })}
          onAdd={() => open({ kind: 'new' })}
          proofLimit={{
            value: limit,
            fallback: 10,
            error: proofLimitRefusal(limit),
            onChange: (value) => {
              props.onProofLimit(value)
              setLimit(value)
            },
          }}
          onAccept={(id) => accept([id])}
          onAcceptAll={() => accept(proposals.map((one) => one.id))}
          onReorder={(ids) => {
            props.onReorder(ids)
            setChecks((before) =>
              ids.flatMap((id) => (before ?? []).filter((one) => one.id === id)),
            )
          }}
        />
      </ProjectSettings>
    </main>
  )
}

const body = () => within(document.body)

/**
 * The Checks of a Project's settings: what Hemera runs to judge the work, never the agent. The
 * checks stand in the order they run, under the moment they run at — after each task, after each
 * requirement, at the end — one line each: the command's glyph, its name, its line, where it runs,
 * the number it expects, and the marks of a check that runs only on some files or asks before
 * running. A line opens its dialog. Missions already running keep the checks they were launched
 * with: the section says it once, under its head.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Checks',
  component: Page,
  parameters: { layout: 'fullscreen' },
  args: {
    checks: CHECKS,
    onSave: fn(),
    onRemove: fn(),
    onAccept: fn(),
    onReorder: fn(),
    onProofLimit: fn(),
  },
  argTypes: {
    checks: { table: { disable: true } },
    proposals: { table: { disable: true } },
  },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

const moment = (canvasElement: HTMLElement, name: string): HTMLElement =>
  within(canvasElement).getByRole('list', { name })

/** Acme's seven checks, under the three moments they run at. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(within(moment(canvasElement, 'After each task')).getAllByRole('listitem')).toHaveLength(
      3,
    )
    expect(
      within(moment(canvasElement, 'After each requirement')).getAllByRole('listitem'),
    ).toHaveLength(2)
    expect(within(moment(canvasElement, 'At the end')).getAllByRole('listitem')).toHaveLength(2)
    // What a line says to a reader: its source, where it runs, what it expects, its marks.
    expect(canvas.getByRole('button', { name: /^coverage,/ })).toHaveAccessibleName(
      'coverage, pnpm --filter api test --coverage, in api, expects a number of at least 70',
    )
    expect(canvas.getByRole('button', { name: /^tests the task wrote,/ })).toHaveAccessibleName(
      'tests the task wrote, pnpm vitest run {files}, in each changed repository, only on the files matching **/*.test.ts',
    )
    expect(canvas.getByRole('button', { name: /^e2e,/ })).toHaveAccessibleName(
      'e2e, from the catalogue, pnpm --filter web e2e --project chromium, in web, asks before running',
    )
    expect(canvas.getByText(/keep the checks they were launched with/)).toBeVisible()
    // A moment's head is set apart from its lines by a darker ground.
    const head = canvas.getByRole('heading', { name: 'After each task' })
    const line = within(moment(canvasElement, 'After each task')).getAllByRole('listitem')[0]
    const ground = getComputedStyle(head).backgroundColor
    expect(ground).not.toBe('rgba(0, 0, 0, 0)')
    expect(ground).not.toBe(line === undefined ? '' : getComputedStyle(line).backgroundColor)
  },
}

const limitField = (canvasElement: HTMLElement): HTMLElement =>
  within(canvasElement).getByRole('textbox', { name: 'How long a proof may run' })

/**
 * How long a proof may run, beside the checks: empty, the field shows the default, 10 minutes, in
 * its quiet tone, and that default applies.
 */
export const ProofLimitDefault: Story = {
  play: async ({ canvasElement }) => {
    const field = limitField(canvasElement)
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', '10')
    expect(within(canvasElement).getByText(/In minutes/)).toBeVisible()
    expect(within(canvasElement).queryByRole('button', { name: /Back to the default/ })).toBeNull()
  },
}

/** A limit written: 30 minutes, the × that empties it back to the default beside it. */
export const ProofLimitChanged: Story = {
  args: { proofLimit: '30' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(limitField(canvasElement)).toHaveValue('30')
    await userEvent.click(
      canvas.getByRole('button', { name: 'Back to the default time limit of a proof' }),
    )
    expect(args.onProofLimit).toHaveBeenLastCalledWith(null)
    await userEvent.type(limitField(canvasElement), '45')
    expect(args.onProofLimit).toHaveBeenLastCalledWith('45')
    expect(canvas.queryByRole('alert')).toBeNull()
  },
}

/** A limit the engine refuses: said under the field, in its words. */
export const ProofLimitRefused: Story = {
  args: { proofLimit: '0' },
  play: async ({ canvasElement }) => {
    expect(await within(canvasElement).findByText('A proof needs at least 1 minute.')).toBeVisible()
    await userEvent.clear(limitField(canvasElement))
    await userEvent.type(limitField(canvasElement), '1500')
    expect(
      await within(canvasElement).findByText('A proof may run 1440 minutes (24 hours) at most.'),
    ).toBeVisible()
  },
}

/**
 * A Project with no check yet: what Hemera proposes from the catalogue stands where it would run,
 * quiet, each with Accept, and Accept all in the head. Nothing is kept before it is accepted.
 */
export const Proposed: Story = {
  args: { checks: [], proposals: PROPOSED_CHECKS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const proposed = canvas.getByRole('list', { name: 'Proposed after each task' })
    expect(within(proposed).getAllByRole('listitem')).toHaveLength(2)
    expect(canvas.getByRole('list', { name: 'Proposed at the end' })).toHaveTextContent('e2e')
    expect(canvas.getByRole('button', { name: 'Accept all 6' })).toBeVisible()
    expect(canvas.getByText(/Nothing is kept until you accept it/)).toBeVisible()
    expect(canvas.queryByRole('list', { name: 'After each task' })).toBeNull()
  },
}

/** One proposal accepted, then the rest at once: each joins the checks of its moment. */
export const AcceptingProposals: Story = {
  args: { checks: [], proposals: PROPOSED_CHECKS },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept typecheck' }))
    expect(args.onAccept).toHaveBeenCalledWith(['proposed-typecheck'])
    await waitFor(() => {
      expect(
        within(moment(canvasElement, 'After each task')).getAllByRole('listitem'),
      ).toHaveLength(1)
    })
    expect(canvas.getByRole('button', { name: 'Accept all 5' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Accept all 5' }))
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: /^Accept all/ })).toBeNull()
    })
    expect(within(moment(canvasElement, 'At the end')).getAllByRole('listitem')).toHaveLength(2)
    expect(canvas.queryByText(/Nothing is kept until you accept it/)).toBeNull()
  },
}

/** Checks kept and proposals left: the proposals stand under the checks of their moment. */
export const SomeAccepted: Story = {
  args: {
    checks: PROPOSED_CHECKS.slice(0, 2).map(accepted),
    proposals: PROPOSED_CHECKS.slice(2),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(within(moment(canvasElement, 'After each task')).getAllByRole('listitem')).toHaveLength(
      2,
    )
    expect(canvas.queryByRole('list', { name: 'Proposed after each task' })).toBeNull()
    expect(canvas.getByRole('list', { name: 'Proposed after each requirement' })).toBeVisible()
  },
}

/** No check and nothing the catalogue could run as one: Hemera asleep, and Add a check. */
export const NoCheck: Story = {
  args: { checks: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'No check yet' })).toBeVisible()
    expect(canvas.getByText(/done, not verified/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a check' }))
    expect(await findOpen(body(), 'dialog', { name: 'Add a check' })).toBeVisible()
  },
}

/** On their way: the rows' own shape. */
export const Loading: Story = {
  args: { checks: null },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('list', { busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(4)
  },
}

/** The checks could not be read: said under the head, in words. */
export const ReadRefused: Story = {
  args: { checks: [], error: 'The checks could not be read: the engine stopped answering.' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'the engine stopped answering',
    )
  },
}

/** A check added from the catalogue: a command picked by its name, where, when. */
export const AddACheck: Story = {
  args: { form: { kind: 'new' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Add a check' })
    const form = within(dialog)
    await userEvent.type(form.getByRole('textbox', { name: 'Name' }), 'web-test')
    await userEvent.click(form.getByRole('tab', { name: 'From the catalogue' }))
    await userEvent.click(form.getByRole('combobox', { name: 'Command of the catalogue' }))
    await userEvent.click(await body().findByRole('option', { name: 'web-test' }))
    expect(form.getByText('pnpm --filter web test')).toBeVisible()
    await userEvent.click(form.getByRole('combobox', { name: 'When' }))
    await userEvent.click(await body().findByRole('option', { name: 'After each requirement' }))
    await userEvent.click(form.getByRole('button', { name: 'Add' }))
    expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web-test', command: 'web-test', when: 'requirement' }),
    )
  },
}

/** A command of the catalogue that asks before running: its mark under the line, in words. */
export const AsksBeforeRunning: Story = {
  args: { form: { kind: 'edit', id: 'e2e' } },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'e2e' })
    expect(within(dialog).getByText('Asks before running')).toBeVisible()
  },
}

/**
 * A free line that runs only the tests the task wrote: `{files}` in the line, the pattern under
 * it; nothing matching, the check is skipped.
 */
export const FreeLineOnFiles: Story = {
  args: { form: { kind: 'edit', id: 'unit' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'tests the task wrote' })
    const form = within(dialog)
    expect(form.getByRole('tab', { name: 'A line of its own' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(form.getByRole('textbox', { name: 'Line' })).toHaveValue('pnpm vitest run {files}')
    expect(form.getByRole('textbox', { name: 'Only files matching' })).toHaveValue('**/*.test.ts')
    // One line for every system: a check has no line of its own per system.
    expect(form.queryByRole('button', { name: 'Lines for Linux and Windows' })).toBeNull()
  },
}

/** Coverage at least 70: a number read in the output, by its pattern, and its minimum. */
export const ExpectsANumber: Story = {
  args: { form: { kind: 'edit', id: 'coverage' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'coverage' })
    const form = within(dialog)
    expect(form.getByRole('combobox', { name: 'Expects' })).toHaveTextContent(
      'A number in its output',
    )
    expect(form.getByRole('textbox', { name: 'At least' })).toHaveValue('70')
    // Back to the exit code: the pattern and its minimum fold away.
    await userEvent.click(form.getByRole('combobox', { name: 'Expects' }))
    await userEvent.click(await body().findByRole('option', { name: 'Exit code 0' }))
    await waitFor(() => {
      expect(form.queryByRole('textbox', { name: 'At least' })).toBeNull()
    })
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ expect: null }))
  },
}

/** Shell syntax in a free line: refused as it is typed, the token named. */
export const ShellSyntaxRefused: Story = {
  args: {
    form: { kind: 'new', draft: { ...NEW_CHECK, name: 'lint', line: 'pnpm lint' } },
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add a check' })
    const form = within(dialog)
    await userEvent.type(form.getByRole('textbox', { name: 'Line' }), ' | tee lint.log')
    expect(await form.findByText(/“\|” is shell syntax/)).toBeVisible()
  },
}

/** A pattern of files written in the line: refused, and said where it goes. */
export const PatternInTheLineRefused: Story = {
  args: {
    form: {
      kind: 'new',
      draft: { ...NEW_CHECK, name: 'unit', line: 'pnpm vitest run src/**/*.test.ts' },
    },
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add a check' })
    expect(
      within(dialog).getByText(/“src\/\*\*\/\*\.test\.ts” is a pattern of files/),
    ).toBeVisible()
  },
}

/** `{files}` in the line with no pattern of files: said under the pattern's field. */
export const FilesWithoutPatternRefused: Story = {
  args: {
    form: {
      kind: 'new',
      draft: { ...NEW_CHECK, name: 'unit', line: 'pnpm vitest run {files}' },
    },
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add a check' })
    const files = within(dialog).getByRole('textbox', { name: 'Only files matching' })
    expect(files).toHaveAccessibleDescription(/The line uses \{files\}: say which files here\./)
  },
}

/** A pattern without a capture group, and a minimum that is not a number: each under its field. */
export const NumberRefused: Story = {
  args: {
    form: {
      kind: 'new',
      draft: {
        ...NEW_CHECK,
        name: 'web coverage',
        line: 'pnpm --filter web test --coverage',
        expect: { pattern: 'Coverage: [0-9.]+%', minimum: 'seventy' },
      },
    },
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add a check' })
    const form = within(dialog)
    expect(form.getByRole('textbox', { name: 'Pattern' })).toHaveAccessibleDescription(
      /captures no number: put the number in parentheses/,
    )
    expect(form.getByRole('textbox', { name: 'At least' })).toHaveAccessibleDescription(
      /“seventy” is not a number\./,
    )
  },
}

/** A pattern of files whose brace does not close, and a name already taken. */
export const NameAndFilesRefused: Story = {
  args: {
    form: {
      kind: 'new',
      draft: {
        ...NEW_CHECK,
        name: 'lint',
        line: 'pnpm vitest run {files}',
        files: 'src/**/*.{ts,tsx',
      },
    },
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add a check' })
    const form = within(dialog)
    expect(form.getByRole('textbox', { name: 'Name' })).toHaveAccessibleDescription(
      'A check named lint already exists.',
    )
    expect(form.getByRole('textbox', { name: 'Only files matching' })).toHaveAccessibleDescription(
      /opens a brace it does not close/,
    )
  },
}

/** A save the engine refused as a whole: the reason above the buttons, the dialog open. */
export const SaveRefused: Story = {
  args: { form: { kind: 'edit', id: 'lint' }, refused: STALE },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'lint' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(STALE)
  },
}

/** Removing a check: the destructive button names it, and its line folds out. */
export const RemoveACheck: Story = {
  args: { form: { kind: 'edit', id: 'typecheck' } },
  play: async ({ canvasElement, args }) => {
    const dialog = await body().findByRole('dialog', { name: 'typecheck' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove typecheck' }))
    expect(args.onRemove).toHaveBeenCalledWith('typecheck')
    await waitFor(() => {
      expect(
        within(moment(canvasElement, 'After each task')).getAllByRole('listitem'),
      ).toHaveLength(2)
    })
  },
}

/** A check moved from the keyboard: its handle has the focus, the arrows move it in its moment. */
export const Reordered: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Move typecheck, after each task' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(args.onReorder).toHaveBeenCalledWith([
      'typecheck',
      'lint',
      'unit',
      'test',
      'coverage',
      'build',
      'e2e',
    ])
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Move typecheck, after each task' })).toHaveFocus()
    })
    // The first of its moment goes no higher: a check changes moment in its dialog.
    await userEvent.keyboard('{ArrowUp}')
    expect(args.onReorder).toHaveBeenCalledTimes(1)
  },
}

/** The keyboard path: the head's action, then each line's handle and line, the focus ring seen. */
export const KeyboardPath: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const add = canvas.getByRole('button', { name: 'Add a check' })
    add.focus()
    await userEvent.tab()
    expect(canvas.getByRole('img', { name: /^Runs only on the files/ })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('img', { name: 'Asks before running' })).toHaveFocus()
    await userEvent.tab()
    const handle = canvas.getByRole('button', { name: 'Move lint, after each task' })
    expect(handle).toHaveFocus()
    expect(handle.matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(handle, '::after').boxShadow).not.toBe('none')
    await userEvent.tab()
    const line = canvas.getByRole('button', { name: /^lint,/ })
    expect(line).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const dialog = await body().findByRole('dialog', { name: 'lint' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() => expect(line).toHaveFocus())
  },
}

/** Long text in every field: a long name, a long free line, a long pattern of files. */
export const LongText: Story = {
  args: { checks: [...CHECKS, LONG_CHECK] },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByText(/--reporter verbose --bail 1/)
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth)
  },
}

/** The long check's dialog: every field holds its whole value. */
export const LongTextForm: Story = {
  args: { checks: [...CHECKS, LONG_CHECK], form: { kind: 'edit', id: 'long' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: LONG_CHECK.name })
    expect(within(dialog).getByRole('textbox', { name: 'Only files matching' })).toHaveValue(
      LONG_CHECK.files,
    )
  },
}

/** A Project that checks a lot: nineteen checks over five repositories. */
export const Dense: Story = {
  args: { checks: DENSE_CHECKS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('button', { name: /^Move / })).toHaveLength(DENSE_CHECKS.length)
  },
}

const rowOf = (canvasElement: HTMLElement, selector: string): HTMLElement => {
  const row = canvasElement.querySelector<HTMLElement>(selector)
  if (row === null) throw new Error(`no row ${selector}`)
  return row
}

const reduced: Story['render'] = (args) => (
  <MotionConfig reducedMotion="always">
    <Page {...args} />
  </MotionConfig>
)

/** The checks of Acme but e2e: build alone at the end. */
const BUILD_ALONE = CHECKS.filter((one) => one.id !== 'e2e')

/** The last check of a moment removed: the moment folds out, its line folding out with it. */
async function removeBuild(canvasElement: HTMLElement): Promise<HTMLElement> {
  const row = rowOf(canvasElement, '[data-check="build"]')
  const dialog = await body().findByRole('dialog', { name: 'build' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Remove build' }))
  await waitFor(() => {
    expect(within(canvasElement).queryByRole('heading', { name: 'At the end' })).toBeNull()
  })
  expect(within(canvasElement).queryByRole('list', { name: 'At the end' })).toBeNull()
  return row
}

/** Removing the last check of a moment: its line folds out, and the moment with it. */
export const RemoveTheLastCheckOfAMoment: Story = {
  args: { checks: BUILD_ALONE, form: { kind: 'edit', id: 'build' } },
  play: async ({ canvasElement }) => {
    await foldedOut(await removeBuild(canvasElement))
  },
}

/** The same with reduced motion: the line and its moment are gone at once. */
export const RemoveTheLastCheckOfAMomentReducedMotion: Story = {
  args: { checks: BUILD_ALONE, form: { kind: 'edit', id: 'build' } },
  render: reduced,
  play: async ({ canvasElement }) => {
    const row = await removeBuild(canvasElement)
    await waitFor(() => expect(row).not.toBeInTheDocument())
  },
}

/** The last check of the Project removed: its line folds out while Hemera falls asleep. */
async function removeLint(canvasElement: HTMLElement): Promise<HTMLElement> {
  const row = rowOf(canvasElement, '[data-check="lint"]')
  const dialog = await body().findByRole('dialog', { name: 'lint' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Remove lint' }))
  expect(
    await within(canvasElement).findByRole('heading', { name: 'No check yet' }),
  ).toBeInTheDocument()
  return row
}

/** Removing the last check: its line folds out with its list, and the section says there is none. */
export const RemoveTheLastCheck: Story = {
  args: { checks: CHECKS.slice(0, 1), form: { kind: 'edit', id: 'lint' } },
  play: async ({ canvasElement }) => {
    await foldedOut(await removeLint(canvasElement))
  },
}

/** The same with reduced motion: the line is gone at once, and the section says there is none. */
export const RemoveTheLastCheckReducedMotion: Story = {
  args: { checks: CHECKS.slice(0, 1), form: { kind: 'edit', id: 'lint' } },
  render: reduced,
  play: async ({ canvasElement }) => {
    const row = await removeLint(canvasElement)
    await waitFor(() => expect(row).not.toBeInTheDocument())
  },
}

/** Lint alone proposed after each task: accepting it empties that moment's proposals. */
const LINT_ALONE = PROPOSED_CHECKS.filter((one) => one.id !== 'proposed-typecheck')

async function acceptLint(canvasElement: HTMLElement): Promise<HTMLElement> {
  const row = rowOf(canvasElement, '[data-proposal="proposed-lint"]')
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Accept lint' }))
  await waitFor(() => {
    expect(
      within(canvasElement).queryByRole('list', { name: 'Proposed after each task' }),
    ).toBeNull()
  })
  expect(within(moment(canvasElement, 'After each task')).getAllByRole('listitem')).toHaveLength(1)
  return row
}

/** Accepting the last proposal of a moment: it folds out with the proposals of its moment. */
export const AcceptTheLastProposalOfAMoment: Story = {
  args: { checks: [], proposals: LINT_ALONE },
  play: async ({ canvasElement }) => {
    await foldedOut(await acceptLint(canvasElement))
  },
}

/** The same with reduced motion: the proposal is gone at once, lint kept in its place. */
export const AcceptTheLastProposalOfAMomentReducedMotion: Story = {
  args: { checks: [], proposals: LINT_ALONE },
  render: reduced,
  play: async ({ canvasElement }) => {
    const row = await acceptLint(canvasElement)
    await waitFor(() => expect(row).not.toBeInTheDocument())
  },
}

/** With reduced motion: a proposal accepted joins its moment at once, nothing travels. */
export const ReducedMotion: Story = {
  args: { checks: [], proposals: PROPOSED_CHECKS },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <Page {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept lint' }))
    expect(within(moment(canvasElement, 'After each task')).getAllByRole('listitem')).toHaveLength(
      1,
    )
  },
}
