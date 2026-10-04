import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { LONG_NAME, LONG_TITLE, REPOSITORIES, STAGE_GROUPS } from '../../shell/shell-fixtures.tsx'
import { ProjectPage } from './project-page.tsx'

/**
 * The Project page: its name and repositories, the entry to its settings, the start field, and
 * its missions by stage. The field's content and the rows' are later tickets'; here their place.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Project',
  component: ProjectPage,
  parameters: { layout: 'fullscreen' },
  args: {
    name: 'Acme',
    repositories: REPOSITORIES,
    groups: STAGE_GROUPS,
    done: 4,
    onStart: fn(),
    onOpenMission: fn(),
    onOpenSettings: fn(),
    onRetry: fn(),
  },
  argTypes: {
    name: { control: 'text' },
    done: { control: 'number' },
    loading: { control: 'boolean' },
    error: { control: 'text' },
    repositories: { table: { disable: true } },
    groups: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen flex-col bg-surface-content">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProjectPage>

export default meta
type Story = StoryObj<typeof meta>

/** A Project with no mission yet: the header, the field, and the empty state in the room below. */
export const Empty: Story = {
  args: { groups: [], done: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('No mission yet')).toBeVisible()
    expect(canvas.getByText('api')).toBeInTheDocument()
  },
}

/** Four stages, one mission each, four done: the page as a Project is lived in. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('list')).toHaveLength(4)
    await userEvent.click(canvas.getByRole('button', { name: /ACME-12/ }))
    expect(args.onOpenMission).toHaveBeenCalledWith('ACME-12')
    await userEvent.click(canvas.getByRole('button', { name: 'Settings of Acme' }))
    expect(args.onOpenSettings).toHaveBeenCalled()
  },
}

/** A long name, long repository names, many long missions in one stage. */
export const Dense: Story = {
  args: {
    name: LONG_NAME,
    repositories: [
      { name: 'acme-platform-api-and-background-workers' },
      { name: 'acme-platform-web-customer-portal' },
      { name: 'shared' },
      { name: 'infrastructure' },
      { name: 'design-system' },
    ],
    groups: [
      {
        stage: 'Building',
        rows: Array.from({ length: 12 }, (_, index) => ({
          missionKey: `ACME-${String(100 + index)}`,
          title: LONG_TITLE,
          when: '09:02',
          ball: 'agent' as const,
        })),
      },
    ],
    done: 128,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { level: 1 })
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    expect(canvas.getAllByRole('listitem')).toHaveLength(12)
  },
}

/** The missions on their way: the rows' own shape under the field. */
export const Loading: Story = {
  args: { loading: true, groups: [] },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('list', { busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
  },
}

/** The Project could not be read: said in the middle, in words, and Try again. */
export const Error: Story = {
  args: { groups: [], error: '/home/acme/work is not readable: permission denied.' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('Hemera could not read Acme')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(args.onRetry).toHaveBeenCalled()
  },
}

/** From the keyboard: the settings, then the field, which Enter sends; then the rows. */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Settings of Acme' })).toHaveFocus()
    await userEvent.tab()
    const field = canvas.getByRole('textbox', { name: 'Start a mission in Acme' })
    expect(field).toHaveFocus()
    await userEvent.keyboard('Export the audit log{Enter}')
    expect(args.onStart).toHaveBeenCalledWith('Export the audit log')
  },
}
