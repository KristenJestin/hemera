import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { findOpen } from '../../overlay-play.ts'
import { CUSTOM, GUESSED, NO_RUNNER, PATH_OUTSIDE, UNKNOWN_FORMAT } from './test-runner-fixtures.ts'
import { TestsInRepositoryDialog } from './tests-in-repository-dialog.tsx'

/**
 * Variant B: no new section. The tests are one more part of a repository's own dialog, opened
 * from its line in Repositories, under its remote and its base: the guess and its rule as a
 * sentence, Set my own to write a value, Back to the guess to drop it. Nothing on the page shows
 * a runner until a repository is opened.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Test runner/In the repository dialog',
  component: TestsInRepositoryDialog,
  parameters: { layout: 'fullscreen' },
  args: { tests: GUESSED, open: { repository: 'web' } },
  argTypes: { tests: { table: { disable: true } }, open: { table: { disable: true } } },
} satisfies Meta<typeof TestsInRepositoryDialog>

export default meta
type Story = StoryObj<typeof meta>

/** web's dialog: its guess said in a sentence, with the rule that made it. */
export const Guessed: Story = {
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'web' })
    const tests = within(dialog).getByRole('group', { name: 'Tests' })
    expect(tests).toHaveTextContent('vitest, guessed from vite.config.ts')
    expect(tests).toHaveTextContent('JSON report asked by Hemera')
    expect(within(tests).getByRole('button', { name: 'Set my own' })).toBeVisible()
  },
}

/** web's own value, in its fields, with Back to the guess beside them. */
export const Custom: Story = {
  args: { tests: CUSTOM },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'web' })
    const tests = within(dialog).getByRole('group', { name: 'Tests' })
    expect(within(tests).getByRole('textbox', { name: 'Report path' })).toHaveValue(
      'reports/junit.xml',
    )
    expect(within(tests).getByRole('button', { name: 'Back to the guess' })).toBeVisible()
  },
}

/** Back to the guess: the fields fold away, and the guess's sentence returns. */
export const BackToTheGuess: Story = {
  args: { tests: CUSTOM },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'web' })
    const tests = within(dialog).getByRole('group', { name: 'Tests' })
    await userEvent.click(within(tests).getByRole('button', { name: 'Back to the guess' }))
    await waitFor(() =>
      expect(within(tests).queryByRole('textbox', { name: 'Report path' })).toBeNull(),
    )
    expect(tests).toHaveTextContent('vitest, guessed from vite.config.ts')
  },
}

/** A report path that leaves the repository is refused on save, under the path. */
export const PathOutsideTheRepository: Story = {
  args: { open: PATH_OUTSIDE },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'web' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const path = within(dialog).getByRole('textbox', { name: 'Report path' })
    await waitFor(() => expect(path).toHaveAttribute('aria-invalid', 'true'))
    expect(within(dialog).getByText(/is outside web/)).toBeVisible()
  },
}

/** A format the reader cannot read from this runner is refused on save, under the format. */
export const UnknownFormat: Story = {
  args: { open: UNKNOWN_FORMAT },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'api' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText(/reads no JSON report from pytest/)).toBeVisible()
    expect(dialog).toBeVisible()
  },
}

/** No rule found shared's runner: its dialog says so; Repositories carries the glyph in the list. */
export const NoRunnerFound: Story = {
  args: { tests: NO_RUNNER, open: { repository: 'shared' } },
  play: async ({ canvasElement }) => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'shared' })
    const tests = within(dialog).getByRole('group', { name: 'Tests' })
    expect(tests).toHaveTextContent('No runner found')
    expect(within(tests).getByRole('button', { name: 'Set my own' })).toBeVisible()
    // Behind the dialog, the page is hidden from a reader: it is looked for all the same.
    const nav = within(canvasElement).getByRole('navigation', {
      name: 'Settings of the Project',
      hidden: true,
    })
    expect(
      within(nav).getByRole('button', {
        name: 'Repositories, no runner found for shared',
        hidden: true,
      }),
    ).toBeInTheDocument()
  },
}
