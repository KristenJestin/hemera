import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  NEW_STEP,
  RecipeSection,
  type RecipeSectionProps,
  type SettingsStep,
  type StepDraft,
  StepForm,
} from './recipe.tsx'
import { STEPS, shellRefusal } from './project-settings-fixtures.ts'

/**
 * A Project's preparation recipe: what is done in a new Workspace, in order — copy, link, run.
 * Each step carries its number; its handle moves it, by the pointer or by the arrows. A source
 * missing from the main checkout is said on its line. A line opens the step's sheet, drawn here as
 * its form.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Preparation',
  component: RecipeSection,
  parameters: { layout: 'fullscreen' },
  args: { steps: STEPS, onOpen: fn(), onAdd: fn(), onReorder: fn() },
  argTypes: { steps: { table: { disable: true } } },
  render: (args) => <Held {...args} />,
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RecipeSection>

export default meta
type Story = StoryObj<typeof meta>

/** The recipe, holding its order as the page does. */
function Held(args: RecipeSectionProps) {
  const [steps, setSteps] = useState<readonly SettingsStep[]>(args.steps)
  return (
    <RecipeSection
      {...args}
      steps={steps}
      onReorder={(ids) => {
        setSteps((before) => ids.flatMap((id) => before.filter((step) => step.id === id)))
        args.onReorder(ids)
      }}
    />
  )
}

/** Five steps, the second one's source not in the main checkout. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: 'Steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5)
    expect(canvasElement.querySelector('[data-step="2"] [data-problem]')).toHaveTextContent(
      'not in the main checkout',
    )
    await userEvent.click(canvas.getByRole('button', { name: /^4\s*Run/ }))
    expect(args.onOpen).toHaveBeenCalledWith('s4')
  },
}

/** No step yet: Hemera asleep, and the way to add one. */
export const Empty: Story = {
  args: { steps: [] },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('heading', { name: 'No step yet' })).toBeVisible()
  },
}

/** On their way: the rows' own shape, their numbers already there. */
export const Loading: Story = {
  args: { steps: [], loading: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
  },
}

/** A step moved from the keyboard: its handle has the focus, the arrows move it, and it keeps it. */
export const Reordered: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const handle = canvas.getByRole('button', { name: /^Move step 4, Run install/ })
    handle.focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(args.onReorder).toHaveBeenCalledWith(['s1', 's2', 's4', 's3', 's5'])
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /^Move step 3, Run install/ })).toHaveFocus()
    })
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /^Move step 5, Run install/ })).toHaveFocus()
    })
  },
}

/** Long sources and a long line: each ends in an ellipsis on its line. */
export const LongText: Story = {
  args: {
    steps: [
      ...STEPS,
      {
        id: 's6',
        kind: 'copy',
        place: 'shared',
        path: 'config/environments/local/overrides/platform-api-and-background-workers.env',
        command: null,
        line: null,
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const path = within(canvasElement).getByText(/platform-api-and-background-workers\.env/)
    expect(getComputedStyle(path).textOverflow).toBe('ellipsis')
  },
}

/** The form of a step's sheet, holding its draft. */
function Sheet({ draft: first, pathError }: { draft: StepDraft; pathError?: string }) {
  const [draft, setDraft] = useState(first)
  return (
    <div className="mx-auto flex w-full max-w-view-narrow flex-col gap-5 p-4">
      <StepForm
        draft={draft}
        onChange={setDraft}
        places={['api', 'web', 'shared']}
        commands={['install', 'build', 'test']}
        pathError={pathError}
        lineError={shellRefusal(draft.line ?? '')}
      />
    </div>
  )
}

/** A copy whose source is not in the main checkout: said under its field. */
export const SheetMissingSource: Story = {
  render: () => (
    <Sheet
      draft={{ kind: 'copy', place: 'web', path: '.env.local', command: null, line: null }}
      pathError="web/.env.local is not in the main checkout."
    />
  ),
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByText('web/.env.local is not in the main checkout.'),
    ).toBeVisible()
  },
}

/** A run of a line of its own, in which the names Hemera fills are offered. */
export const SheetOwnLine: Story = {
  render: () => (
    <Sheet
      draft={{
        kind: 'run',
        place: 'api',
        path: null,
        command: null,
        line: 'pnpm db:migrate --database acme_',
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('combobox', { name: 'Command' })).toHaveTextContent('A line of its own')
    await userEvent.click(canvas.getByRole('button', { name: 'Insert a name in Line' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: /\{workspace\}\s*Workspace name/,
      }),
    )
    expect(canvas.getByRole('textbox', { name: 'Line' })).toHaveValue(
      'pnpm db:migrate --database acme_{workspace}',
    )
  },
}

/** A run of a catalogue command: the command chosen, no line to write. */
export const SheetCommand: Story = {
  render: () => (
    <Sheet draft={{ kind: 'run', place: '.', path: null, command: 'install', line: null }} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('combobox', { name: 'Command' })).toHaveTextContent('install')
    expect(canvas.queryByRole('textbox', { name: 'Line' })).toBeNull()
  },
}

/** A step not written yet: a copy, at the root. */
export const SheetNew: Story = {
  render: () => <Sheet draft={NEW_STEP} />,
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('combobox', { name: 'Step' })).toHaveTextContent('Copy')
  },
}
