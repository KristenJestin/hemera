import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { CUSTOM, GUESSED, NO_RUNNER, PATH_OUTSIDE, UNKNOWN_FORMAT } from './test-runner-fixtures.ts'
import { TestsInRepositoryLine } from './tests-in-repository-line.tsx'

/**
 * Variant C: the runner is a column of Repositories. Each line names its runner, a pencil when it
 * is your own and a warning when none was found; pressing it unfolds the line in place, the
 * guess's rule and the fields under it, saved where they are, with no dialog.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Test runner/In the repository line',
  component: TestsInRepositoryLine,
  parameters: { layout: 'fullscreen' },
  args: { tests: GUESSED },
  argTypes: { tests: { table: { disable: true } }, open: { table: { disable: true } } },
} satisfies Meta<typeof TestsInRepositoryLine>

export default meta
type Story = StoryObj<typeof meta>

/** Each line names its guessed runner; web unfolded shows the rule that made it. */
export const Guessed: Story = {
  args: { open: { repository: 'web' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Tests of api: pytest, guessed' })).toBeVisible()
    const web = canvas.getByRole('region', { name: 'Tests of web' })
    expect(web).toHaveTextContent('vitest, guessed from vite.config.ts')
    expect(within(web).queryByRole('button', { name: 'Back to the guess' })).toBeNull()
  },
}

/** web's own value: the pencil on its line, its fields unfolded under it. */
export const Custom: Story = {
  args: { tests: CUSTOM, open: { repository: 'web' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', { name: 'Tests of web: vitest, your own value' }),
    ).toBeVisible()
    const web = canvas.getByRole('region', { name: 'Tests of web' })
    expect(within(web).getByRole('textbox', { name: 'Report path' })).toHaveValue(
      'reports/junit.xml',
    )
  },
}

/** Back to the guess, in the unfolded line: the pencil goes, the fields show the guess again. */
export const BackToTheGuess: Story = {
  args: { tests: CUSTOM, open: { repository: 'web' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const web = canvas.getByRole('region', { name: 'Tests of web' })
    await userEvent.click(within(web).getByRole('button', { name: 'Back to the guess' }))
    expect(
      await canvas.findByRole('button', { name: 'Tests of web: vitest, guessed' }),
    ).toBeVisible()
  },
}

/** A report path that leaves the repository is refused on save, under the path, in the line. */
export const PathOutsideTheRepository: Story = {
  args: { open: PATH_OUTSIDE },
  play: async ({ canvasElement }) => {
    const web = within(canvasElement).getByRole('region', { name: 'Tests of web' })
    await userEvent.click(within(web).getByRole('button', { name: 'Save' }))
    const path = within(web).getByRole('textbox', { name: 'Report path' })
    await waitFor(() => expect(path).toHaveAttribute('aria-invalid', 'true'))
    expect(within(web).getByText(/is outside web/)).toBeVisible()
  },
}

/** A format the reader cannot read from this runner is refused on save, under the format. */
export const UnknownFormat: Story = {
  args: { open: UNKNOWN_FORMAT },
  play: async ({ canvasElement }) => {
    const api = within(canvasElement).getByRole('region', { name: 'Tests of api' })
    await userEvent.click(within(api).getByRole('button', { name: 'Save' }))
    expect(await within(api).findByText(/reads no JSON report from pytest/)).toBeVisible()
  },
}

/** No rule found shared's runner: its line says so in the warning tone. */
export const NoRunnerFound: Story = {
  args: { tests: NO_RUNNER },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const shared = canvas.getByRole('button', { name: 'Tests of shared: no runner found' })
    expect(shared).toBeVisible()
    await userEvent.click(shared)
    const region = await canvas.findByRole('region', { name: 'Tests of shared' })
    expect(within(region).getByRole('combobox', { name: 'Runner' })).toBeVisible()
  },
}
