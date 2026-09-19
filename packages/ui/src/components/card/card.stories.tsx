import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { IconArchive, IconGitBranch } from '../../icons.ts'
import { Badge } from '../badge/badge.tsx'
import { Button } from '../button/button.tsx'
import { Input } from '../field/field.tsx'
import { Card, CardRow } from './card.tsx'

/**
 * The surface every block of a page is drawn on (design D4-07).
 *
 * A surface, a line and a shadow, and everything inside it rounded one step further in. What
 * needs a rim with a body inside it is `Frame`, not this.
 */
const meta = {
  title: 'Components/Card',
  component: Card,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  args: {
    title: 'Main Workspace',
    description: 'The root every repository path below is relative to.',
    tone: 'default',
    children: <Input label="Folder" defaultValue="/home/someone/Projects/atlas" />,
  },
  argTypes: {
    title: { control: 'text', description: 'What the card is about.' },
    description: { control: 'text', description: 'A line under the title.' },
    tone: {
      control: 'inline-radio',
      options: ['default', 'danger'],
      description: 'Whether the subject takes something away.',
      table: { defaultValue: { summary: 'default' } },
    },
    actions: { control: false, description: 'One control at the end of the title row.' },
    children: { control: false },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** The two tones, and a card with nothing but a surface. */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <Card title="Identity" description="What the Project is called and which dot it wears.">
        <Input label="Name" defaultValue="Atlas" />
      </Card>
      <Card
        title="Archive this Project"
        description="Its tab disappears; its Journal stays whole."
        tone="danger"
      >
        <div>
          <Button variant="destructive">
            <IconArchive size="sm" />
            Archive Atlas
          </Button>
        </div>
      </Card>
      <Card>A card with no title is a surface, which is a card too.</Card>
    </div>
  ),
}

/** What a row inside a card looks like: on the page's colour, rounded one step in. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Card title="Repositories" description="Relative to the folder of the main Workspace.">
      <div className="flex flex-col gap-2">
        <CardRow>
          <IconGitBranch size="sm" />
          <span className="min-w-0 flex-1 truncate font-mono text-sm">./sources/api</span>
          <Badge tone="success">git · main</Badge>
        </CardRow>
        <CardRow>
          <IconGitBranch size="sm" />
          <span className="min-w-0 flex-1 truncate font-mono text-sm">./docs</span>
          <Badge tone="neutral">no repository</Badge>
        </CardRow>
      </div>
    </Card>
  ),
}

/** A control at the end of the title row: one, and never a second subject. */
export const WithAnAction: Story = {
  args: {
    title: 'Appearance',
    description: undefined,
    actions: (
      <Button size="sm" onClick={fn()}>
        Reset
      </Button>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Reset' }))
    expect(canvas.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
  },
}
