import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import type { NeedRow } from '../../blocks/need/needs-you-list.tsx'
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

/** What waits across the Projects: Hemera's own first, then Acme's. */
const NEEDS: readonly NeedRow[] = [
  {
    id: 'git',
    project: 'Hemera',
    need: {
      title: 'Git is not on the PATH',
      text: 'Install Git, then Retry.',
      when: '2 h',
      ask: { kind: 'environment' },
    },
  },
  {
    id: 'table',
    project: 'Acme',
    need: {
      title: 'Which table holds the invoices?',
      missionKey: 'ACME-14',
      when: '12 min',
      role: 'planner',
      ask: {
        kind: 'decision',
        options: [
          { label: 'invoices', recommended: 'the api already reads it' },
          { label: 'billing_invoices' },
        ],
      },
    },
  },
]

/**
 * Needs you holds the needs themselves: a row per need, its count in the head, the card unfolded
 * in place where it is answered.
 */
export const NeedsYou: Story = {
  args: {
    needs: {
      rows: NEEDS,
      projects: ['Acme', 'Hemera'],
      on: () => ({ onRetry: fn(), onChoose: fn() }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const needs = within(canvas.getByRole('region', { name: 'Needs you' }))
    expect(needs.getByText('2')).toBeInTheDocument()
    expect(needs.getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(needs.getByRole('button', { name: 'Answer here' }))
    await expect(needs.getByRole('button', { name: 'invoices' })).toBeVisible()
  },
}

/** A need just answered stays a moment, faint, and no longer counts. */
export const NeedAnswered: Story = {
  args: {
    needs: {
      rows: [
        NEEDS[0]!,
        Object.assign({}, NEEDS[1]!, {
          need: Object.assign({}, NEEDS[1]!.need, {
            status: { state: 'applied', answer: 'invoices' },
          }),
        }),
      ],
      projects: ['Acme', 'Hemera'],
      on: () => ({ onRetry: fn(), onChoose: fn() }),
    },
  },
  play: async ({ canvasElement }) => {
    const needs = within(within(canvasElement).getByRole('region', { name: 'Needs you' }))
    expect(needs.getByText('1')).toBeInTheDocument()
    expect(needs.getByText('Applied')).toBeInTheDocument()
  },
}

/**
 * No open question: Needs you takes the whole width, so its titles have room, and Questions sits
 * below it with its empty state.
 */
export const NeedsYouWithoutQuestions: Story = {
  args: { ...NeedsYou.args, questions: NONE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const needs = canvas.getByRole('region', { name: 'Needs you' })
    const questions = canvas.getByRole('region', { name: 'Questions' })
    expect(within(questions).getByText('No open question.')).toBeInTheDocument()
    const room = canvas.getByRole('region', { name: 'Since you left' }).getBoundingClientRect()
    expect(needs.getBoundingClientRect().width).toBe(room.width)
    expect(questions.getBoundingClientRect().top).toBeGreaterThan(
      needs.getBoundingClientRect().bottom,
    )
  },
}

/** Open questions: Needs you and Questions side by side, as wide as each other. */
export const NeedsYouWithQuestions: Story = {
  args: { ...NeedsYou.args, questions: { rows: HOME_ROWS.questions } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const needs = canvas.getByRole('region', { name: 'Needs you' }).getBoundingClientRect()
    const questions = canvas.getByRole('region', { name: 'Questions' }).getBoundingClientRect()
    expect(questions.top).toBe(needs.top)
    expect(questions.left).toBeGreaterThan(needs.right)
  },
}
