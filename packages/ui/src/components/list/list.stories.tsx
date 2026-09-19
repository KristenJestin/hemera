import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { IconArchive, IconMessages, IconRestore } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { List, ListItem } from './list.tsx'

/**
 * Rows of things that have a name (design D4-07): a square of icon, a title, a line under it,
 * and something at the end. Told apart by a rule between them, never by a box around each.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/List',
  component: ListItem,
  parameters: { layout: 'padded' },
  args: {
    icon: <IconMessages size="sm" />,
    title: 'CSV invoice export',
    description: '“Invoices should export with HT and TTC…” · 4 messages',
    trailing: '12 min ago',
    onSelect: fn(),
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text', description: 'The line under the title.' },
    trailing: { control: 'text', description: 'What sits at the end: a time, a control.' },
    icon: { control: false },
    onSelect: {
      action: 'selected',
      description: 'Where choosing the row goes; none makes it plain.',
    },
  },
  render: (args) => (
    <List label="Sessions">
      <ListItem {...args} />
    </List>
  ),
} satisfies Meta<typeof ListItem>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** A row that goes somewhere, and a row whose control is at its end. */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <List label="Everything">
      <ListItem
        icon={<IconMessages size="sm" />}
        title="Full-text search"
        description="“Postgres FTS or a separate index?” · 2 messages"
        trailing="yesterday"
        onSelect={fn()}
      />
      <ListItem
        icon={<IconArchive size="sm" />}
        title="ML playground"
        description="archived last week · 4 Sessions"
        trailing={
          <Button variant="secondary" size="sm" onClick={fn()}>
            <IconRestore size="sm" />
            Restore
          </Button>
        }
      />
    </List>
  ),
}

/** Choosing a row: it answers the hand, and says where it went. */
export const States: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSelect?.mockClear()
    await userEvent.click(within(canvasElement).getByRole('button', { name: /CSV invoice/ }))
    expect(args.onSelect).toHaveBeenCalled()
  },
}

/** A row that goes somewhere is one stop of the tab order, and Enter takes it. */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSelect?.mockClear()
    await userEvent.tab()
    expect(within(canvasElement).getByRole('button', { name: /CSV invoice/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(args.onSelect).toHaveBeenCalled()
  },
}
