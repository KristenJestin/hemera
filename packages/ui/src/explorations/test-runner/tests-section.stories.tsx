import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { findOpen } from '../../overlay-play.ts'
import { CUSTOM, GUESSED, NO_RUNNER, PATH_OUTSIDE, UNKNOWN_FORMAT } from './test-runner-fixtures.ts'
import { TestsSection } from './tests-section.tsx'

/**
 * Variant A, recommended: Tests is a section of the Project's settings of its own. One line per
 * repository says which runner reads its tests, where that comes from — the rule of the guess, or
 * a pencil for your own value — and its report; the line opens the section's dialog, where your
 * own value is written. A repository with no runner found marks the section in the list.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Test runner/A section of its own',
  component: TestsSection,
  parameters: { layout: 'fullscreen' },
  args: { tests: GUESSED },
  argTypes: { tests: { table: { disable: true } }, open: { table: { disable: true } } },
} satisfies Meta<typeof TestsSection>

export default meta
type Story = StoryObj<typeof meta>

/** The guess of each repository, each with the rule that made it. */
export const Guessed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Tests' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(
      canvas.getByRole('button', {
        name: 'web, vitest, guessed from vite.config.ts, JSON report asked by Hemera',
      }),
    ).toBeVisible()
    expect(
      canvas.getByRole('button', { name: 'shared, go test, guessed from go.mod, no report' }),
    ).toBeVisible()
    expect(canvas.queryByRole('button', { name: /^Back to the guess/ })).toBeNull()
  },
}

/** web's own value: vitest writing JUnit XML at a path of the repository, set by hand. */
export const Custom: Story = {
  args: { tests: CUSTOM },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', {
        name: 'web, vitest, your own value, JUnit XML report at reports/junit.xml',
      }),
    ).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Back to the guess for web' })).toBeVisible()
  },
}

/** Back to the guess from the line: the value written by hand goes, the guess and its rule return. */
export const BackToTheGuess: Story = {
  args: { tests: CUSTOM },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Back to the guess for web' }))
    expect(
      await canvas.findByRole('button', {
        name: 'web, vitest, guessed from vite.config.ts, JSON report asked by Hemera',
      }),
    ).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Back to the guess for web' })).toBeNull()
  },
}

/** A report path that leaves the repository is refused on save, under the path. */
export const PathOutsideTheRepository: Story = {
  args: { tests: GUESSED, open: PATH_OUTSIDE },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'Tests of web' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const path = within(dialog).getByRole('textbox', { name: 'Report path' })
    await waitFor(() => expect(path).toHaveAttribute('aria-invalid', 'true'))
    expect(within(dialog).getByText(/is outside web/)).toBeVisible()
  },
}

/** A format the reader cannot read from this runner is refused on save, under the format. */
export const UnknownFormat: Story = {
  args: { tests: GUESSED, open: UNKNOWN_FORMAT },
  play: async () => {
    const dialog = await findOpen(within(document.body), 'dialog', { name: 'Tests of api' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText(/reads no JSON report from pytest/)).toBeVisible()
    // Refused, the dialog stays open on what was written.
    expect(dialog).toBeVisible()
  },
}

/** No rule found shared's runner: its line says so, and the section's entry carries the glyph. */
export const NoRunnerFound: Story = {
  args: { tests: NO_RUNNER },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'shared, no runner found' })).toBeVisible()
    const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
    expect(
      within(nav).getByRole('button', { name: 'Tests, no runner found for shared' }),
    ).toBeVisible()
  },
}
