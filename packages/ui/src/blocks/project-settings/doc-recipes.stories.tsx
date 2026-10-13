import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { foldedOut } from '../../exit-play.ts'
import { findOpen } from '../../overlay-play.ts'
import { IconBook2, IconChecklist, IconFileText } from '../../icons.ts'
import {
  ProjectSettings,
  type SettingsForm,
} from '../../surfaces/project-settings/project-settings.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-fixtures.tsx'
import {
  DOC_RECIPES,
  LONG_RECIPE,
  PLACES,
  PROPOSED_RECIPES,
  recipeDraftOf,
  recipeRefusals,
} from './checks-fixtures.ts'
import {
  type DocRecipeDraft,
  DocRecipeForm,
  DocRecipesSection,
  NEW_DOC_RECIPE,
  type SettingsDocRecipe,
  recipeName,
} from './doc-recipes.tsx'
import { FormFoot } from './parts.tsx'
import { STALE } from './project-settings-fixtures.ts'

type Open = { kind: 'edit'; id: string } | { kind: 'new'; draft?: DocRecipeDraft | undefined }

interface PageProps {
  /** Null: the recipes are on their way. */
  recipes: readonly SettingsDocRecipe[] | null
  proposals?: readonly SettingsDocRecipe[] | undefined
  error?: string | undefined
  form?: Open | undefined
  /** Why every save is refused, in words, as one meeting a newer version is. */
  refused?: string | undefined
  onSave: (draft: DocRecipeDraft) => void
  onRemove: (id: string) => void
  onAccept: (ids: readonly string[]) => void
  onReorder: (ids: readonly string[]) => void
}

function withId(draft: DocRecipeDraft, id: string): SettingsDocRecipe {
  return { ...draft, id }
}

/** What a recipe becomes once its proposal is accepted: its own id, the proposal's mark gone. */
function accepted(proposal: SettingsDocRecipe): SettingsDocRecipe {
  return withId(proposal, proposal.id.replace(/^proposed-/, ''))
}

/** A page of Acme's settings around its documentation, holding what the renderer will hold. */
function Page(props: PageProps): ReactNode {
  const [recipes, setRecipes] = useState(props.recipes)
  const [proposals, setProposals] = useState(props.proposals ?? [])
  const [form, setForm] = useState<Open | null>(props.form ?? null)
  const draftFor = (open: Open | null): DocRecipeDraft => {
    if (open === null) return NEW_DOC_RECIPE
    if (open.kind === 'new') return open.draft ?? NEW_DOC_RECIPE
    const found = recipes?.find((one) => one.id === open.id)
    return found === undefined ? NEW_DOC_RECIPE : recipeDraftOf(found)
  }
  const [draft, setDraft] = useState<DocRecipeDraft>(draftFor(props.form ?? null))
  // What the story is given anew — an image sequence changing its arguments — replaces what it holds.
  const [given, setGiven] = useState({
    recipes: props.recipes,
    proposals: props.proposals,
    form: props.form,
  })
  if (
    given.recipes !== props.recipes ||
    given.proposals !== props.proposals ||
    given.form !== props.form
  ) {
    setGiven({ recipes: props.recipes, proposals: props.proposals, form: props.form })
    setRecipes(props.recipes)
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
    setRecipes((before) => [...(before ?? []), ...taken.map(accepted)])
  }
  const editing = form?.kind === 'edit' ? recipes?.find((one) => one.id === form.id) : undefined
  const refusals = recipeRefusals(draft)
  const save = (): void => {
    props.onSave(draft)
    if (props.refused !== undefined || Object.values(refusals).some((one) => one !== undefined))
      return
    setRecipes((before) =>
      editing === undefined
        ? [...(before ?? []), withId(draft, `r${String((before ?? []).length + 1)}`)]
        : (before ?? []).map((one) => (one.id === editing.id ? withId(draft, one.id) : one)),
    )
    close()
  }
  const dialog: SettingsForm | null =
    form === null
      ? null
      : {
          title: editing === undefined ? 'Add a recipe' : recipeName(editing),
          icon: <IconFileText size="sm" />,
          body: (
            <DocRecipeForm draft={draft} onChange={setDraft} places={PLACES} refusals={refusals} />
          ),
          footer: (
            <FormFoot
              refused={props.refused}
              remove={editing === undefined ? undefined : `Remove ${recipeName(editing)}`}
              onRemove={() => {
                if (editing === undefined) return
                props.onRemove(editing.id)
                setRecipes((before) => (before ?? []).filter((one) => one.id !== editing.id))
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
        current="documentation"
        onSection={() => {}}
        onRetry={() => {}}
        form={dialog}
        onCloseForm={close}
      >
        <DocRecipesSection
          recipes={recipes}
          proposals={proposals}
          error={props.error}
          onOpen={(id) => open({ kind: 'edit', id })}
          onAdd={() => open({ kind: 'new' })}
          onAccept={(id) => accept([id])}
          onAcceptAll={() => accept(proposals.map((one) => one.id))}
          onReorder={(ids) => {
            props.onReorder(ids)
            setRecipes((before) =>
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
 * The Documentation of a Project's settings: the files the documenter keeps in line with the code
 * at the end of every Building, one line each — where, which files, what they are for, and whether
 * they apply always or only when the Spec's Impact names some words. A line opens its dialog; its
 * handle moves it. Missions already running keep the recipes they were launched with.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Documentation',
  component: Page,
  parameters: { layout: 'fullscreen' },
  args: {
    recipes: DOC_RECIPES,
    onSave: fn(),
    onRemove: fn(),
    onAccept: fn(),
    onReorder: fn(),
  },
  argTypes: {
    recipes: { table: { disable: true } },
    proposals: { table: { disable: true } },
  },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

const recipesList = (canvasElement: HTMLElement): HTMLElement =>
  within(canvasElement).getByRole('list', { name: 'Recipes' })

/** Acme's five recipes: the readmes, the usage docs, and two contracts named by the Impact. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(within(recipesList(canvasElement)).getAllByRole('listitem')).toHaveLength(5)
    expect(canvas.getByRole('button', { name: /^openapi\.yaml in api,/ })).toHaveAccessibleName(
      'openapi.yaml in api, The HTTP API contract, when the Spec’s Impact names API, interface or contract',
    )
    expect(canvas.getByRole('button', { name: /^README\.md in root,/ })).toHaveAccessibleName(
      'README.md in root, How to install, run and test Acme, always',
    )
    expect(canvas.getByText(/keep the recipes they were launched with/)).toBeVisible()
  },
}

/** No recipe yet: what Hemera found in the main checkout, quiet, each with Accept. */
export const Proposed: Story = {
  args: { recipes: [], proposals: PROPOSED_RECIPES },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const proposed = canvas.getByRole('list', { name: 'Proposed recipes' })
    expect(within(proposed).getAllByRole('listitem')).toHaveLength(5)
    expect(canvas.getByRole('button', { name: 'Accept all 5' })).toBeVisible()
    expect(canvas.getByText(/found these in the main checkout/)).toBeVisible()
    expect(canvas.queryByRole('list', { name: 'Recipes' })).toBeNull()
  },
}

/** One proposal accepted, then the rest: each joins the recipes, in the order they were found. */
export const AcceptingProposals: Story = {
  args: { recipes: [], proposals: PROPOSED_RECIPES },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept README.md in api' }))
    expect(args.onAccept).toHaveBeenCalledWith(['proposed-api'])
    await waitFor(() => {
      expect(within(recipesList(canvasElement)).getAllByRole('listitem')).toHaveLength(1)
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Accept all 4' }))
    await waitFor(() => {
      expect(canvas.queryByRole('list', { name: 'Proposed recipes' })).toBeNull()
    })
    expect(within(recipesList(canvasElement)).getAllByRole('listitem')).toHaveLength(5)
  },
}

/** No recipe and nothing found: Hemera asleep, and Add a recipe. */
export const NoRecipe: Story = {
  args: { recipes: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'No recipe yet' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a recipe' }))
    expect(await findOpen(body(), 'dialog', { name: 'Add a recipe' })).toBeVisible()
  },
}

/** On their way: the rows' own shape. */
export const Loading: Story = {
  args: { recipes: null },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('list', { busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
  },
}

/** The recipes could not be read: said under the head, in words. */
export const ReadRefused: Story = {
  args: { recipes: [], error: 'The recipes could not be read: the engine stopped answering.' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'the engine stopped answering',
    )
  },
}

/** A recipe added: the repository, the files, what they are for, and when it applies. */
export const AddARecipe: Story = {
  args: { form: { kind: 'new' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'Add a recipe' })
    const form = within(dialog)
    await userEvent.click(form.getByRole('combobox', { name: 'In' }))
    await userEvent.click(await body().findByRole('option', { name: 'web' }))
    await userEvent.type(form.getByRole('textbox', { name: 'Files' }), 'docs/**/*.md')
    await userEvent.type(form.getByRole('textbox', { name: 'Purpose' }), 'How the web is used')
    await userEvent.click(form.getByRole('button', { name: 'Add' }))
    expect(args.onSave).toHaveBeenCalledWith({
      place: 'web',
      path: 'docs/**/*.md',
      purpose: 'How the web is used',
      words: null,
    })
  },
}

/** A contract: it applies only when the Spec's Impact names one of its words. */
export const AppliesWhenNamed: Story = {
  args: { form: { kind: 'edit', id: 'openapi' } },
  play: async ({ args }) => {
    const dialog = await body().findByRole('dialog', { name: 'openapi.yaml in api' })
    const form = within(dialog)
    expect(form.getByRole('combobox', { name: 'Applies' })).toHaveTextContent(
      'When the Spec’s Impact names a word',
    )
    const words = form.getByRole('textbox', { name: 'Words' })
    expect(words).toHaveValue('API, interface, contract')
    await userEvent.type(words, ', endpoint')
    // Back to always: the words fold away.
    await userEvent.click(form.getByRole('combobox', { name: 'Applies' }))
    await userEvent.click(await body().findByRole('option', { name: 'Always' }))
    await waitFor(() => {
      expect(form.queryByRole('textbox', { name: 'Words' })).toBeNull()
    })
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ words: null }))
  },
}

/** A path that leaves its repository: refused under the field, the path and the repository named. */
export const PathLeavesRefused: Story = {
  args: {
    form: {
      kind: 'new',
      draft: { ...NEW_DOC_RECIPE, place: 'api', path: '../shared/README.md', purpose: 'Shared' },
    },
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add a recipe' })
    expect(within(dialog).getByRole('textbox', { name: 'Files' })).toHaveAccessibleDescription(
      /\.\.\/shared\/README\.md leaves api: name files inside it\./,
    )
  },
}

/** Applies when the Impact names a word, and no word given: said under the field. */
export const NoWordRefused: Story = {
  args: {
    form: {
      kind: 'new',
      draft: { ...NEW_DOC_RECIPE, path: 'openapi.yaml', purpose: 'The contract', words: [''] },
    },
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add a recipe' })
    expect(within(dialog).getByRole('textbox', { name: 'Words' })).toHaveAccessibleDescription(
      /Name at least one word the Impact may hold\./,
    )
  },
}

/** Files named and nothing said of what they are for: said under the purpose. */
export const PurposeRefused: Story = {
  args: { form: { kind: 'new', draft: { ...NEW_DOC_RECIPE, path: 'CHANGELOG.md' } } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Add a recipe' })
    expect(within(dialog).getByRole('textbox', { name: 'Purpose' })).toHaveAccessibleDescription(
      /Say in one sentence what the files are for\./,
    )
  },
}

/** A save the engine refused as a whole: the reason above the buttons, the dialog open. */
export const SaveRefused: Story = {
  args: { form: { kind: 'edit', id: 'docs' }, refused: STALE },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'docs/**/*.md in root' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(STALE)
  },
}

/** Removing a recipe: the destructive button names it, and its line folds out. */
export const RemoveARecipe: Story = {
  args: { form: { kind: 'edit', id: 'schema' } },
  play: async ({ canvasElement, args }) => {
    const dialog = await body().findByRole('dialog', { name: 'schema/*.json in shared' })
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove schema/*.json in shared' }),
    )
    expect(args.onRemove).toHaveBeenCalledWith('schema')
    await waitFor(() => {
      expect(within(recipesList(canvasElement)).getAllByRole('listitem')).toHaveLength(4)
    })
  },
}

/** A recipe moved from the keyboard: its handle has the focus, the arrows move it. */
export const Reordered: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Move openapi.yaml in api' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(args.onReorder).toHaveBeenCalledWith([
      'readme',
      'api-readme',
      'openapi',
      'docs',
      'schema',
    ])
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Move openapi.yaml in api' })).toHaveFocus()
    })
  },
}

/** The keyboard path: the head's action, then each line's handle and line, the focus ring seen. */
export const KeyboardPath: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Add a recipe' }).focus()
    await userEvent.tab()
    const handle = canvas.getByRole('button', { name: 'Move README.md in root' })
    expect(handle).toHaveFocus()
    expect(handle.matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(handle, '::after').boxShadow).not.toBe('none')
    await userEvent.tab()
    const line = canvas.getByRole('button', { name: /^README\.md in root,/ })
    expect(line).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const dialog = await body().findByRole('dialog', { name: 'README.md in root' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() => expect(line).toHaveFocus())
  },
}

/** Long text in every field: a long path, a long purpose, many words. */
export const LongText: Story = {
  args: { recipes: [...DOC_RECIPES, LONG_RECIPE] },
  play: async ({ canvasElement }) => {
    const purpose = within(canvasElement).getByText(/The architecture decisions of payments/)
    expect(getComputedStyle(purpose).textOverflow).toBe('ellipsis')
  },
}

/** The long recipe's dialog: the purpose wraps whole at the reading measure. */
export const LongTextForm: Story = {
  args: { recipes: [...DOC_RECIPES, LONG_RECIPE], form: { kind: 'edit', id: 'long' } },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: recipeName(LONG_RECIPE) })
    expect(within(dialog).getByRole('textbox', { name: 'Purpose' })).toHaveValue(
      LONG_RECIPE.purpose,
    )
  },
}

/** A Project documented at length: fourteen recipes over five repositories. */
export const Dense: Story = {
  args: {
    recipes: [
      ...DOC_RECIPES,
      LONG_RECIPE,
      ...['web', 'shared', 'ui-kit', 'billing'].flatMap((place) => [
        {
          id: `${place}-readme`,
          place,
          path: 'README.md',
          purpose: `How to run ${place}`,
          words: null,
        },
        {
          id: `${place}-changelog`,
          place,
          path: 'CHANGELOG.md',
          purpose: `What changed in ${place}, release by release`,
          words: ['release', 'version'],
        },
      ]),
    ],
  },
  play: async ({ canvasElement }) => {
    expect(within(recipesList(canvasElement)).getAllByRole('listitem')).toHaveLength(14)
  },
}

/** The last recipe removed: its line folds out with the list while Hemera falls asleep. */
async function removeReadme(canvasElement: HTMLElement): Promise<HTMLElement> {
  const row = canvasElement.querySelector<HTMLElement>('[data-recipe="readme"]')
  if (row === null) throw new Error('no row for the readme')
  const dialog = await body().findByRole('dialog', { name: 'README.md in root' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Remove README.md in root' }))
  expect(
    await within(canvasElement).findByRole('heading', { name: 'No recipe yet' }),
  ).toBeInTheDocument()
  return row
}

/** Removing the last recipe: its line folds out with its list, and the section says there is none. */
export const RemoveTheLastRecipe: Story = {
  args: { recipes: DOC_RECIPES.slice(0, 1), form: { kind: 'edit', id: 'readme' } },
  play: async ({ canvasElement }) => {
    await foldedOut(await removeReadme(canvasElement))
  },
}

/** The same with reduced motion: the line is gone at once, and the section says there is none. */
export const RemoveTheLastRecipeReducedMotion: Story = {
  args: { recipes: DOC_RECIPES.slice(0, 1), form: { kind: 'edit', id: 'readme' } },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <Page {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const row = await removeReadme(canvasElement)
    await waitFor(() => expect(row).not.toBeInTheDocument())
  },
}

/** With reduced motion: a proposal accepted joins the recipes at once, nothing travels. */
export const ReducedMotion: Story = {
  args: { recipes: [], proposals: PROPOSED_RECIPES },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <Page {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept README.md in root' }))
    expect(within(recipesList(canvasElement)).getAllByRole('listitem')).toHaveLength(1)
  },
}
