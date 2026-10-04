import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Sidebar } from '../../shell/sidebar.tsx'
import { PageHeader } from '../../surfaces/page.tsx'
import { type ProjectMarkProps, ProjectMark } from './project-mark.tsx'
import { ACME_LOGO } from './project-mark-fixtures.ts'

/**
 * Who a Project or a repository is, in one round mark: the letter in the tone of its name, a tone
 * chosen, an icon of the short set, or a small image of the user's own. Each story shows the mark
 * where it is met — beside its name, in the sidebar among other Projects, before the title of the
 * Project's page — never alone on the canvas.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/ProjectMark',
  component: ProjectMark,
  parameters: { layout: 'fullscreen' },
  args: { name: 'Acme' },
  render: (args) => <InContext {...args} />,
} satisfies Meta<typeof ProjectMark>

export default meta

/** The mark where it is met: beside its name, in the sidebar, before the page's title. */
function InContext(props: ProjectMarkProps) {
  return (
    <div className="flex h-screen bg-surface-page">
      <Sidebar
        folded={false}
        waiting={0}
        projects={[
          { id: 'acme', name: props.name, identity: props.identity },
          { id: 'hemera', name: 'Hemera' },
          { id: 'billing', name: 'Billing', identity: { tone: 'warning', icon: 'database' } },
        ]}
        opened={new Set()}
        onOpen={() => {}}
        current={{ kind: 'project', id: 'acme' }}
        onHome={() => {}}
        onProject={() => {}}
        onAddProject={() => {}}
        onSettings={() => {}}
      />
      <div className="mt-2 flex min-w-0 flex-1 flex-col gap-8 rounded-tl-lg border-t border-l border-border bg-surface-content px-8 py-6">
        <PageHeader lead={<ProjectMark {...props} />} title={props.name} />
        <span className="flex items-center gap-2 text-sm" data-beside="">
          <ProjectMark {...props} />
          <span className="font-medium">{props.name}</span>
        </span>
      </div>
    </div>
  )
}
type Story = StoryObj<typeof meta>

/** Nothing chosen: the letter, in the tone read from the name. */
export const Letter: Story = {
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-beside] [data-avatar]')).toHaveTextContent('A')
  },
}

/** A tone chosen: the same letter, in the tone the user gave it. */
export const Tone: Story = {
  args: { identity: { tone: 'build' } },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-beside] [data-avatar]')).toHaveClass('bg-build-muted')
  },
}

/** An icon of the set, in its tone. */
export const Icon: Story = {
  args: { identity: { tone: 'info', icon: 'rocket' } },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-mark-icon="rocket"]')).not.toBeNull()
  },
}

/** A small image of the user's own: a logo. */
export const Image: Story = {
  args: { identity: { image: ACME_LOGO } },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('header [data-mark-image]')).toHaveAttribute(
      'src',
      ACME_LOGO,
    )
    expect(canvasElement.querySelectorAll('[data-mark-image]')).toHaveLength(3)
  },
}

/** Drawn alone, it says its name in a tooltip on itself. */
export const Legend: Story = {
  args: { identity: { icon: 'server' }, legend: true },
  play: async ({ canvasElement }) => {
    const [mark] = within(canvasElement).getAllByRole('img', { name: 'Acme' })
    if (mark === undefined) return
    await userEvent.hover(mark)
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Acme')
    })
  },
}
