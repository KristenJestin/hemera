import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconTestPipe } from '../../icons.ts'
import { findOpen } from '../../overlay-play.ts'
import {
  ProjectSettings,
  type SettingsForm,
} from '../../surfaces/project-settings/project-settings.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-sections.tsx'
import { FormFoot } from './parts.tsx'
import { MAIN_CHECKOUT } from './project-settings-fixtures.ts'
import { TestsForm, TestsSection } from './tests.tsx'
import {
  CUSTOM,
  GUESSED,
  LONG,
  NO_RUNNER,
  PATH_OUTSIDE,
  type Opened,
  UNKNOWN_FORMAT,
  refusedOnSave,
  savedOf,
} from './tests-fixtures.ts'
import {
  type RepositoryTests,
  type TestsDraft,
  draftOfTests,
  testsProblem,
  unchosen,
} from './tests-model.ts'

interface PageProps {
  /** Null: the guesses are on their way. */
  tests: readonly RepositoryTests[] | null
  /** The repository opened when the story opens, and what is already written in its fields. */
  open?: Opened | undefined
  error?: string | undefined
}

/** Acme's settings around the Tests, holding what the renderer holds: the rows, the dialog, its refusal. */
function Page({ tests, open, error }: PageProps): ReactNode {
  const [rows, setRows] = useState(tests)
  const [opened, setOpened] = useState<{ repository: string; draft: TestsDraft } | null>(() => {
    if (open === undefined) return null
    const found = tests?.find((one) => one.repository === open.repository)
    if (found === undefined) return null
    return { repository: open.repository, draft: open.draft ?? draftOfTests(found) }
  })
  const [refusal, setRefusal] = useState<ReturnType<typeof refusedOnSave>>(undefined)
  const sections = [
    SECTIONS[0],
    { id: 'tests', label: 'Tests', icon: <IconTestPipe size="sm" />, problem: testsProblem(rows) },
    ...SECTIONS.slice(1),
  ].filter((one) => one !== undefined)
  const current = rows?.find((one) => one.repository === opened?.repository)
  const close = (): void => {
    setOpened(null)
    setRefusal(undefined)
  }
  const save = (): void => {
    if (opened === null || current === undefined) return
    const refused =
      unchosen(opened.repository, opened.draft) ?? refusedOnSave(current, opened.draft)
    setRefusal(refused)
    if (refused !== undefined) return
    setRows((before) =>
      (before ?? []).map((one) => (one === current ? savedOf(one, opened.draft) : one)),
    )
    close()
  }
  const form: SettingsForm | null =
    opened === null || current === undefined
      ? null
      : {
          title: `Tests of ${opened.repository}`,
          icon: <IconTestPipe size="sm" />,
          body: (
            <TestsForm
              tests={current}
              draft={opened.draft}
              onChange={(draft) => setOpened({ ...opened, draft })}
              refusal={refusal}
            />
          ),
          footer: <FormFoot onSave={save} onCancel={close} />,
        }
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ProjectSettings
        name="Acme"
        mainCheckout={MAIN_CHECKOUT}
        sections={sections}
        current="tests"
        onSection={() => {}}
        onRetry={() => {}}
        form={form}
        onCloseForm={close}
      >
        <TestsSection
          tests={rows}
          error={error}
          onOpen={(repository) => {
            const found = rows?.find((one) => one.repository === repository)
            if (found === undefined) return
            setRefusal(undefined)
            setOpened({ repository, draft: draftOfTests(found) })
          }}
          onBack={(repository) =>
            setRows((before) =>
              (before ?? []).map((one) =>
                one.repository === repository ? Object.assign({}, one, { custom: null }) : one,
              ),
            )
          }
        />
      </ProjectSettings>
    </main>
  )
}

/**
 * The Tests of a Project's settings (#421): which runner reads each repository's tests, and its
 * report, from which a proof's red is read. One line per repository says the runner, where it
 * comes from (the file whose rule guessed it, or a pencil for your own value) and its report; the
 * line opens the dialog where your own value is written, and Back to the guess, at its end,
 * removes it. A repository with no runner found marks the section in the list.
 */
const meta = {
  title: 'Blocks/Project settings/Tests',
  component: Page,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { tests: GUESSED },
  argTypes: { tests: { table: { disable: true } }, open: { table: { disable: true } } },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

/** The guess of each repository, each with the rule that made it. */
export const Guessed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Tests' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    await expect(
      canvas.getByRole('button', {
        name: 'web, vitest, guessed from vite.config.ts, JSON report asked by Hemera',
      }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'shared, go test, guessed from go.mod, no report' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Back to the guess/ })).toBeNull()
  },
}

/** web's own value: vitest writing its JSON report at a path of the repository, set by hand. */
export const Custom: Story = {
  args: { tests: CUSTOM },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', {
        name: 'web, vitest, your own value, JSON report at reports/vitest.json',
      }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Back to the guess for web' })).toBeVisible()
  },
}

/** A value written in the dialog and saved replaces the guess on the line. */
export const SetMyOwn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^api, pytest/ }))
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'Tests of api' })
    await expect(within(dialog).getByText(/guessed from/)).toBeVisible()
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Report' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: /JUnit XML/ }))
    await userEvent.type(
      await within(dialog).findByRole('textbox', { name: 'Report path' }),
      'reports/junit.xml',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(
      await canvas.findByRole('button', {
        name: 'api, pytest, your own value, JUnit XML report at reports/junit.xml',
      }),
    ).toBeVisible()
  },
}

/** Back to the guess from the line: the value written by hand goes, the guess and its rule return. */
export const BackToTheGuess: Story = {
  args: { tests: CUSTOM },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Back to the guess for web' }))
    await expect(
      await canvas.findByRole('button', {
        name: 'web, vitest, guessed from vite.config.ts, JSON report asked by Hemera',
      }),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Back to the guess for web' })).toBeNull()
  },
}

/** A report path that leaves the repository is refused on save, under the path. */
export const PathOutsideTheRepository: Story = {
  args: { open: PATH_OUTSIDE },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'Tests of web' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const path = within(dialog).getByRole('textbox', { name: 'Report path' })
    await waitFor(() => expect(path).toHaveAttribute('aria-invalid', 'true'))
    await expect(within(dialog).getByText(/is outside web/)).toBeVisible()
  },
}

/** A format the reader cannot read from this runner is refused on save, under the format. */
export const UnknownFormat: Story = {
  args: { open: UNKNOWN_FORMAT },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'Tests of api' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(await within(dialog).findByText(/reads no JSON report from pytest/)).toBeVisible()
    // Refused, the dialog stays open on what was written.
    await expect(dialog).toBeVisible()
  },
}

/** No rule found shared's runner: its line says so, and the section's entry carries the glyph. */
export const NoRunnerFound: Story = {
  args: { tests: NO_RUNNER },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'shared, no runner found' })).toBeVisible()
    const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
    await expect(
      within(nav).getByRole('button', { name: 'Tests, no runner found for shared' }),
    ).toBeVisible()
  },
}

/** No runner found, and saved without choosing one: the runner is asked for. */
export const NoRunnerChosen: Story = {
  args: { tests: NO_RUNNER, open: { repository: 'shared' } },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'Tests of shared' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(await within(dialog).findByText('Choose the runner of shared.')).toBeVisible()
  },
}

/** The guesses on their way: the lines' own shape. */
export const Loading: Story = {
  args: { tests: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /guessed from/ })).toBeNull()
  },
}

/** The guesses could not be read: said in words. */
export const ReadRefused: Story = {
  args: { tests: [], error: 'The engine is not answering: the guesses could not be read.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/could not be read/)).toBeVisible()
  },
}

/** A long repository path and a long report path. */
export const LongText: Story = { args: { tests: LONG } }
