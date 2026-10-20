import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PR_WITHOUT_PUSH, RULES } from '../../blocks/project-settings/delivery-fixtures.ts'
import { DeliveryPage } from '../../blocks/project-settings/delivery-page.tsx'
import { findOpen } from '../../overlay-play.ts'
import { PresetChange, PullRequestsPerRepository, SavedTogether } from './defaults.tsx'

const body = () => within(document.body)

/**
 * The three defaults #467 asks to confirm, as PR #466 built them, each beside its alternative.
 * Saved at each change: recommended, kept. Once for the Project: recommended, kept. A preset
 * change: keeping the repository's own changes is recommended over dropping them, since the
 * engine's model already lays them over any preset and a dropped change cannot be got back.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Delivery gestures/6 Defaults',
  component: DeliveryPage,
  parameters: { layout: 'fullscreen' },
  args: { rules: RULES, onSave: fn(), onCopy: fn(), onCheckAgain: fn() },
  argTypes: { rules: { table: { disable: true } }, form: { table: { disable: true } } },
} satisfies Meta<typeof DeliveryPage>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Default, recommended: each change is checked and saved at once; one the engine refuses stays
 * on screen, unsaved, with its reason at its line (Push left out of web).
 */
export const SavedAtEachChange: Story = {
  args: { rules: PR_WITHOUT_PUSH, open: ['web'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent(/push/)
    expect(canvas.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
  },
}

/** The alternative: the changes gather, and a bar counts them, with Discard and Save. */
export const ChangesSavedTogether: Story = {
  render: () => <SavedTogether rules={RULES} unsaved={2} />,
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('region', { name: 'Unsaved changes' })
    expect(bar).toHaveTextContent('2 changes not saved')
    expect(within(bar).getByRole('button', { name: 'Save' })).toBeVisible()
  },
}

/** Default, recommended: one Pull requests frame, written to every repository. */
export const PullRequestsOnce: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('list', { name: 'Pull requests' })).toHaveLength(1)
    expect(canvas.queryByRole('combobox', { name: 'Pull requests of' })).toBeNull()
  },
}

/** The alternative: the frame writes Every repository, or one; web keeps its own reviewers. */
export const PullRequestsPerRepositoryChosen: Story = {
  render: () => <PullRequestsPerRepository rules={RULES} differs={['web']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Pull requests of' }))
    expect(await findOpen(body(), 'option', { name: 'web, its own' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
  },
}

/** Default: web (4 changes) set to Library is the Library preset again, its changes gone. */
export const PresetDropsChanges: Story = {
  render: () => <PresetChange rules={RULES} repository="web" way="drop" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Preset of web' }))
    await userEvent.click(await body().findByRole('option', { name: 'Library' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /^web, Library, as the preset/ })).toBeVisible(),
    )
  },
}

/**
 * Recommended alternative: web set to Library keeps its own changes — its own commit, Hemera's
 * left out, CI left out, the check on staging — over the Library recipe, Published version added.
 */
export const PresetKeepsChanges: Story = {
  render: () => <PresetChange rules={RULES} repository="web" way="keep" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Preset of web' }))
    await userEvent.click(await body().findByRole('option', { name: 'Library' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /^web, Library, 4 changes/ })).toBeVisible(),
    )
    const steps = canvas.getByRole('list', { name: 'Steps of web' })
    expect(within(steps).getByRole('button', { name: /^Published version/ })).toBeVisible()
  },
}
