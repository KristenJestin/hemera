import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { HOME_ROWS, denseRows } from '../../shell/shell-fixtures.tsx'
import { HomePage } from './home-page.tsx'

/**
 * Home: the frame of four lists — Needs you, Questions, Since you left, Recent — on the sheet.
 * The rows are a later ticket's; here their place, their density, and what an empty list says.
 */
const NONE = { rows: [] }

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Home',
  component: HomePage,
  parameters: { layout: 'fullscreen' },
  args: {
    today: 'Saturday 4 October',
    hasProjects: true,
    needsYou: { rows: HOME_ROWS.needsYou },
    questions: { rows: HOME_ROWS.questions },
    sinceYouLeft: { rows: HOME_ROWS.sinceYouLeft },
    recent: { rows: HOME_ROWS.recent },
    onOpen: fn(),
    onAddProject: fn(),
    onRetry: fn(),
  },
  argTypes: {
    today: { control: 'text' },
    hasProjects: { control: 'boolean' },
    loading: { control: 'boolean' },
    error: { control: 'text' },
    needsYou: { table: { disable: true } },
    questions: { table: { disable: true } },
    sinceYouLeft: { table: { disable: true } },
    recent: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen flex-col bg-surface-content">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HomePage>

export default meta
type Story = StoryObj<typeof meta>

/** No mission yet, in 1.0's first slice: four frames, each saying so in three words. */
export const Empty: Story = {
  args: { needsYou: NONE, questions: NONE, sinceYouLeft: NONE, recent: NONE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Nothing waits for you.')).toBeInTheDocument()
    expect(canvas.getByText('No open question.')).toBeInTheDocument()
    expect(canvas.getByText('Nothing happened.')).toBeInTheDocument()
    expect(canvas.getByText('No mission yet.')).toBeInTheDocument()
  },
}

/** No Project at all: one empty state in the middle, Hemera asleep, and the way to add one. */
export const NoProject: Story = {
  args: { hasProjects: false, needsYou: NONE, questions: NONE, sinceYouLeft: NONE, recent: NONE },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Needs you')).toBeNull()
    expect(canvas.getByRole('img', { name: 'Asleep' })).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a Project' }))
    expect(args.onAddProject).toHaveBeenCalled()
  },
}

/** A morning's Home: two things waiting, a question, what happened, what was worked on. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(
      within(canvas.getByRole('list', { name: 'Needs you' })).getAllByRole('listitem'),
    ).toHaveLength(2)
    await userEvent.click(canvas.getByRole('button', { name: /Run the migration/ }))
    expect(args.onOpen).toHaveBeenCalledWith('n1')
  },
}

/** Every list long, every title long: the page scrolls, no row grows. */
export const Dense: Story = {
  args: {
    needsYou: { rows: denseRows(9, true) },
    questions: { rows: denseRows(6, true) },
    sinceYouLeft: { rows: denseRows(14) },
    recent: { rows: denseRows(8) },
  },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByRole('listitem')
    expect(rows.length).toBe(37)
    const title = within(rows[0]!).getByText(/^Export invoices/)
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
  },
}

/** The lists on their way: the rows' own shape, in each frame, as tall as the rows. */
export const Loading: Story = {
  args: { loading: true, needsYou: NONE, questions: NONE, sinceYouLeft: NONE, recent: NONE },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getAllByRole('list', { busy: true })).toHaveLength(4)
    const skeleton = canvasElement.querySelector('[data-row-skeleton]')!
    // The real row is a control of the same step: the shape is exactly as tall.
    expect(skeleton.getBoundingClientRect().height).toBe(
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 2 + 1,
    )
  },
}

/** The engine could not answer: said in the middle, in words, and Try again. */
export const Error: Story = {
  args: { error: 'The engine did not answer within 10 seconds.' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('did not answer')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(args.onRetry).toHaveBeenCalled()
  },
}

/** From the keyboard: each row is a stop, and Enter opens it. */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: /Run the migration/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(args.onOpen).toHaveBeenCalledWith('n1')
  },
}
