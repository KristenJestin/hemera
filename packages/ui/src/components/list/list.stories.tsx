import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconFolder } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { List, ListItem } from './list.tsx'

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

/** The repositories of Acme, as the rows draw them once they are there. */
const REPOSITORIES = [
  { title: 'api', description: 'main · up to date', trailing: '2 min ago' },
  { title: 'web', description: 'main · 2 commits behind', trailing: '1 h ago' },
  { title: 'shared', description: 'release · up to date', trailing: 'yesterday' },
] as const

/** Every text of a part of the page that a reader could see. */
function seenWords(room: HTMLElement): string[] {
  const walker = document.createTreeWalker(room, NodeFilter.SHOW_TEXT)
  const seen: string[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? ''
    const holder = node.parentElement!
    if (text !== '' && getComputedStyle(holder).visibility !== 'hidden') seen.push(text)
  }
  return seen
}

/** Where every part of every row stands, to the pixel. */
function layoutOf(list: HTMLElement): string[] {
  return [...list.querySelectorAll<HTMLElement>('li, li [data-part]')].map((part) => {
    const box = part.getBoundingClientRect()
    return `${part.dataset.part ?? 'row'} ${String(box.left)},${String(box.top)} ${String(box.width)}×${String(box.height)}`
  })
}

/**
 * Rows on their way: the very rows, in their loading mode — the same square, the same lines at
 * the length of what they will say, the same thing at the end, each drawn in the skeleton's fill
 * and nothing of the words showing. The list says it is busy, once.
 */
export const Loading: Story = {
  render: (args) => (
    <List label="Repositories of Acme" busy>
      {REPOSITORIES.map((repository) => (
        <ListItem key={repository.title} {...args} {...repository} loading />
      ))}
    </List>
  ),
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: 'Repositories of Acme' })
    expect(list).toHaveAttribute('aria-busy', 'true')
    expect(seenWords(canvasElement)).toEqual([])
    expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** The rows of `Arriving`, loading or there, and the control that turns one into the other. */
function Arriving(args: Parameters<typeof ListItem>[0]): ReactNode {
  const [loading, setLoading] = useState(true)
  return (
    <div className="flex flex-col gap-4">
      <Button variant="secondary" size="sm" onClick={() => setLoading((was) => !was)}>
        {loading ? 'Show the rows' : 'Load again'}
      </Button>
      <List label="Repositories of Acme" busy={loading}>
        {REPOSITORIES.map((repository) => (
          <ListItem key={repository.title} {...args} {...repository} loading={loading} />
        ))}
      </List>
    </div>
  )
}

/**
 * Loading, then there, then loading again: every row and every part of it stands exactly where
 * its skeleton stood, so nothing on the page moves when the rows arrive.
 */
export const LoadingToFilled: Story = {
  render: (args) => <Arriving {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Repositories of Acme' })
    const before = layoutOf(list)
    expect(before.length).toBeGreaterThan(REPOSITORIES.length)
    await userEvent.click(canvas.getByRole('button', { name: 'Show the rows' }))
    await waitFor(() => {
      expect(list).toHaveAttribute('aria-busy', 'false')
    })
    expect(layoutOf(list)).toEqual(before)
    expect(canvas.getByRole('button', { name: /^web/ })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Load again' }))
    expect(layoutOf(list)).toEqual(before)
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
