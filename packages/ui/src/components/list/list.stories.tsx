import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { IconFolder } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { List, ListItem, ListItemSkeleton } from './list.tsx'

/**
 * Rows of things that have a name: a square of icon, a title, a line under it, and something at
 * the end. Told apart by a rule between them, never by a box around each.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/List',
  component: ListItem,
  parameters: { layout: 'padded' },
  args: {
    icon: <IconFolder size="sm" />,
    title: 'api',
    description: 'main · up to date',
    trailing: '2 min ago',
    onSelect: fn(),
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    trailing: { control: 'text' },
    icon: { control: false },
    onSelect: { action: 'selected' },
  },
  render: (args) => (
    <List label="Repositories of Acme">
      <ListItem {...args} />
      <ListItem {...args} title="web" description="main · 2 commits behind" />
      <ListItem {...args} title="shared" description="release · up to date" />
    </List>
  ),
} satisfies Meta<typeof ListItem>

export default meta
type Story = StoryObj<typeof meta>

/** Rows that go somewhere: each is a button, and choosing one says where it went. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSelect?.mockClear()
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^web/ }))
    expect(args.onSelect).toHaveBeenCalled()
  },
}

/** Rows whose control is at their end: the row is plain, the control is what is pressed. */
export const WithAction: Story = {
  render: () => (
    <List label="Archived repositories">
      {['api', 'web', 'shared'].map((name) => (
        <ListItem
          key={name}
          icon={<IconFolder size="sm" />}
          title={name}
          description="archived last week"
          trailing={
            <Button variant="secondary" size="sm" onClick={fn()}>
              Restore
            </Button>
          }
        />
      ))}
    </List>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getAllByRole('button', { name: 'Restore' })).toHaveLength(3)
  },
}

/**
 * Rows on their way: the shape of a row, drawn now. The list says it is busy once, and a row on
 * its way is exactly as tall as the row that replaces it, so nothing moves when they arrive.
 */
export const Loading: Story = {
  render: (args) => (
    <div className="relative flex flex-col">
      <List label="Repositories of Acme" busy>
        <ListItemSkeleton />
        <ListItemSkeleton />
        <ListItemSkeleton />
      </List>
      {/* The row that replaces them, laid over them and never seen: only its height is read. */}
      <div aria-hidden="true" className="invisible absolute inset-x-0 top-0">
        <List label="Arrived">
          <ListItem {...args} />
        </List>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    // Nothing of the content shows while it is on its way: no word over a grey bar.
    expect(canvasElement.innerText.trim()).toBe('')
    const canvas = within(canvasElement)
    const busy = canvas.getByRole('list', { name: 'Repositories of Acme' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    // The last of each, so neither carries the rule that parts a row from the next.
    const skeleton = busy.lastElementChild!
    const row = canvasElement.querySelector('[aria-hidden="true"] li')!
    expect(skeleton.getBoundingClientRect().height).toBe(row.getBoundingClientRect().height)
  },
}

/** From the keyboard: a row that goes somewhere is one stop of the tab order, and Enter takes it. */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSelect?.mockClear()
    await userEvent.tab()
    expect(within(canvasElement).getByRole('button', { name: /^api/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(args.onSelect).toHaveBeenCalled()
  },
}
