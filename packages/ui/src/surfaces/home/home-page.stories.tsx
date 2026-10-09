import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../../components/button/button.tsx'
import { LONG_TITLE } from '../../shell/shell-cast.ts'
import { HomePage, type HomePageProps } from './home-page.tsx'
import {
  HOME_NEEDS,
  HOME_ROWS,
  denseQuestions,
  denseRows,
  denseSince,
} from './home-shell-fixture.tsx'

/**
 * Home, coming back: Since you left leads — a card per mission, its events newest first — with
 * Recent under it; what calls (Needs you, Questions) stands in the column beside them.
 */
const NEEDS = {
  rows: HOME_NEEDS,
  projects: ['Acme', 'Hemera'],
  on: () => ({ onRetry: fn(), onChoose: fn() }),
}

const SINCE = { groups: HOME_ROWS.since, more: false, loadingMore: false, onMore: fn() }

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Home',
  component: HomePage,
  parameters: { layout: 'fullscreen' },
  args: {
    today: 'Friday 9 October',
    hasProjects: true,
    needs: NEEDS,
    questions: HOME_ROWS.questions,
    since: SINCE,
    recent: HOME_ROWS.recent,
    onOpen: fn(),
    onAddProject: fn(),
    onRetry: fn(),
  },
  argTypes: {
    today: { control: 'text' },
    hasProjects: { control: 'boolean' },
    loading: { control: 'boolean' },
    error: { control: 'text' },
    needs: { table: { disable: true } },
    questions: { table: { disable: true } },
    since: { table: { disable: true } },
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

const NOTHING = { rows: [], projects: ['Acme'], on: () => ({}) }
const NO_SINCE = { groups: [], more: false, loadingMore: false, onMore: fn() }

/** The morning after a night with failures and finishes, two needs, two questions. */
export const HomeMorning: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('region', { name: 'Questions' })).toBeInTheDocument()
    const since = canvas.getByRole('list', { name: 'Since you left' })
    expect(within(since).getByText(/T3 failed/)).toBeInTheDocument()
    expect(within(since).getByText(/Shipped: api and web merged/)).toBeInTheDocument()
    expect(within(since).getByText(/a teammate answered/)).toBeInTheDocument()
    const recent = within(canvas.getByRole('list', { name: 'Recent' }))
    expect(recent.getByText('Two questions wait for you')).toBeInTheDocument()
    expect(recent.getByText('60%')).toBeInTheDocument()
    await userEvent.click(canvas.getAllByRole('button', { name: /Retry a failed webhook/ })[0]!)
    expect(args.onOpen).toHaveBeenCalledWith('m15')
  },
}

/** Since you left leads: it is the wide column, Needs you and Questions are the narrow one. */
export const SinceLeads: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const since = canvas.getByRole('region', { name: 'Since you left' }).getBoundingClientRect()
    const needs = canvas.getByRole('region', { name: 'Needs you' }).getBoundingClientRect()
    const recent = canvas.getByRole('region', { name: 'Recent' }).getBoundingClientRect()
    expect(needs.left).toBeGreaterThan(since.right)
    expect(since.width).toBeGreaterThan(needs.width)
    expect(recent.top).toBeGreaterThan(since.bottom)
    expect(recent.left).toBe(since.left)
  },
}

/** No Planning question waits: the Questions group is not drawn. */
export const HomeNoQuestion: Story = {
  args: { questions: [] },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('region', { name: 'Questions' })).toBeNull()
  },
}

/** Nothing waits and nothing happened: one quiet state, and Recent under it. */
export const HomeEmpty: Story = {
  args: { needs: NOTHING, questions: [], since: NO_SINCE, recent: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('list', { name: 'Since you left' })).toBeNull()
    expect(canvas.getByText('All quiet')).toBeInTheDocument()
    expect(canvas.getByText('Nothing waits for you.')).toBeInTheDocument()
    expect(canvas.getByText('No mission yet.')).toBeInTheDocument()
    expect(canvas.queryByRole('region', { name: 'Questions' })).toBeNull()
  },
}

/** Needs wait but nothing happened: Since you left says so in a line, not as a quiet Home. */
export const NothingHappened: Story = {
  args: { questions: [], since: NO_SINCE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('All quiet')).toBeNull()
    expect(canvas.getByText('Nothing happened.')).toBeInTheDocument()
  },
}

/** No Project at all: one empty state in the middle, Hemera asleep, and the way to add one. */
export const NoProject: Story = {
  args: { hasProjects: false, needs: NOTHING, questions: [], since: NO_SINCE, recent: [] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Needs you')).toBeNull()
    expect(canvas.getByRole('img', { name: 'Asleep' })).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a Project' }))
    expect(args.onAddProject).toHaveBeenCalled()
  },
}

/** The answer the ticket proposes is read under its question. */
export const QuestionProposed: Story = {
  play: async ({ canvasElement }) => {
    const questions = within(canvasElement.querySelector<HTMLElement>('[aria-label="Questions"]')!)
    expect(questions.getByText(/Admins only/)).toBeInTheDocument()
    expect(questions.getAllByRole('listitem')).toHaveLength(2)
  },
}

/** Titles and events far longer than their rows: cut with an ellipsis, no card grows. */
export const LongTitles: Story = {
  args: {
    since: {
      ...SINCE,
      groups: [
        {
          id: 'long',
          missionId: 'long',
          project: 'Acme',
          missionKey: 'ACME-12',
          title: LONG_TITLE,
          ball: 'agent',
          events: [
            {
              id: 'long-1',
              tone: 'failed',
              text: `${LONG_TITLE}, then the same again until the line is far too long`,
              when: '02:14',
            },
          ],
        },
      ],
    },
    recent: denseRows(1),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const text = canvas.getByText(/then the same again/)
    expect(getComputedStyle(text).textOverflow).toBe('ellipsis')
    const title = within(canvas.getByRole('list', { name: 'Since you left' })).getAllByText(
      LONG_TITLE,
    )[0]!
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
  },
}

/** Fourteen missions that moved, every title long: the page scrolls and no card grows. */
export const Dense: Story = {
  args: {
    since: { ...SINCE, groups: denseSince(14), more: true },
    questions: denseQuestions(6),
    recent: denseRows(8),
  },
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const since = canvas.getByRole('list', { name: 'Since you left' })
    expect(within(since).getAllByRole('list')).toHaveLength(14)
    const title = within(since).getAllByText(/^Export invoices/)[0]!
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    expect(canvas.getAllByRole('list', { name: 'Recent' })).toHaveLength(1)
  },
}

/** The lists on their way: the shape of the cards and rows, each in its place. */
export const Loading: Story = {
  args: { loading: true, needs: NOTHING, questions: [], since: NO_SINCE, recent: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('list', { busy: true })).toHaveLength(3)
    expect(canvas.queryByRole('region', { name: 'Questions' })).toBeNull()
    expect(canvas.queryByText('All quiet')).toBeNull()
    const skeleton = canvasElement.querySelector('[data-row-skeleton]')!
    expect(skeleton).not.toBeNull()
  },
}

/** Needs you is read, the two lists are still on their way: their shapes, and no quiet state yet. */
export const Reading: Story = {
  args: { reading: true, since: NO_SINCE, recent: [], questions: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('list', { busy: true })).toHaveLength(2)
    expect(
      within(canvas.getByRole('region', { name: 'Needs you' })).getAllByRole('listitem'),
    ).toHaveLength(2)
    expect(canvas.queryByText('All quiet')).toBeNull()
    expect(canvas.queryByText('No mission yet.')).toBeNull()
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

/** From the keyboard: a card's ball is a stop, then its mission, and Enter opens it. */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await userEvent.tab()
    expect(
      canvas.getAllByRole('button', { name: /Export invoices as CSV from the billing/ })[0],
    ).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(args.onOpen).toHaveBeenCalledWith('m12')
  },
}

/** An older page waits: the button asks for it, and says it is reading while it does. */
export const SinceMore: Story = {
  args: { since: { ...SINCE, more: true } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Show earlier/ }))
    expect(args.since.onMore).toHaveBeenCalled()
  },
}

export const SinceMoreLoading: Story = {
  args: { since: { ...SINCE, more: true, loadingMore: true } },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: /Show earlier/ })
    expect(button).toHaveAttribute('aria-disabled', 'true')
  },
}

/** A mission of the Project itself has no key: its card is a title, not a way into a mission. */
export const SinceOfTheProject: Story = {
  args: {
    since: {
      ...SINCE,
      groups: [
        {
          id: 'project:acme',
          project: 'Acme',
          title: 'Acme',
          events: [
            { id: 'p1', tone: 'info', text: 'A repository was added: shared', when: '07:00' },
          ],
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const since = within(within(canvasElement).getByRole('list', { name: 'Since you left' }))
    expect(since.getByText('A repository was added: shared')).toBeInTheDocument()
    expect(since.queryByRole('button')).toBeNull()
  },
}

/** Needs you in its column, a third of a 1366 px window wide: the page does not scroll sideways. */
export const NeedsInTheColumn: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const region = canvas.getByRole('region', { name: 'Needs you' })
    expect(region.getBoundingClientRect().width).toBeLessThan(window.innerWidth / 2)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    const list = within(region).getByRole('list', { name: 'Needs you' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getAllByRole('button', { name: /here$/ })).toHaveLength(2)
  },
}

/** A need answered stays a moment, faint, and no longer counts. */
export const NeedAnswered: Story = {
  args: {
    needs: {
      ...NEEDS,
      rows: [
        HOME_NEEDS[0]!,
        {
          ...HOME_NEEDS[1]!,
          need: { ...HOME_NEEDS[1]!.need, status: { state: 'applied', answer: 'invoices' } },
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const needs = within(within(canvasElement).getByRole('region', { name: 'Needs you' }))
    expect(needs.getByText('1')).toBeInTheDocument()
    expect(needs.getByText('Applied')).toBeInTheDocument()
  },
}

/** Needs you unfolds its card in place, in the narrow column. */
export const NeedAnswering: Story = {
  play: async ({ canvasElement }) => {
    const needs = within(within(canvasElement).getByRole('region', { name: 'Needs you' }))
    expect(needs.getByText('2')).toBeInTheDocument()
    await userEvent.click(needs.getByRole('button', { name: 'Answer here' }))
    await expect(needs.getByRole('button', { name: 'invoices' })).toBeVisible()
  },
}

const ARRIVING = HOME_ROWS.since[0]!

function Arrives(args: HomePageProps): ReactNode {
  const [groups, setGroups] = useState(HOME_ROWS.since.slice(1))
  return (
    <>
      <div className="p-2">
        <Button
          size="sm"
          onClick={() => setGroups(HOME_ROWS.since)}
          disabled={groups.length === HOME_ROWS.since.length}
        >
          Let an entry arrive
        </Button>
      </div>
      <HomePage {...args} since={{ ...args.since, groups }} />
    </>
  )
}

/** An entry arrives while Home is open: the card grows into its place and pushes the rest. */
export const SinceEntryArrives: Story = {
  render: (args) => <Arrives {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const since = canvas.getByRole('list', { name: 'Since you left' })
    expect(within(since).queryByText(ARRIVING.title)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Let an entry arrive' }))
    await waitFor(() => {
      expect(within(since).getByText(ARRIVING.title)).toBeInTheDocument()
    })
  },
}

function Toggles(args: HomePageProps): ReactNode {
  const [asked, setAsked] = useState(false)
  return (
    <>
      <div className="p-2">
        <Button size="sm" onClick={() => setAsked(!asked)}>
          {asked ? 'Answer the questions' : 'Ask the questions'}
        </Button>
      </div>
      <HomePage {...args} questions={asked ? HOME_ROWS.questions : []} />
    </>
  )
}

/** The Questions group appears when a question is asked and leaves when the last is answered. */
export const QuestionsAppearAndDisappear: Story = {
  render: (args) => <Toggles {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('region', { name: 'Questions' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Ask the questions' }))
    await waitFor(() => {
      expect(canvas.getByRole('region', { name: 'Questions' })).toBeInTheDocument()
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Answer the questions' }))
    await waitFor(() => {
      expect(canvas.queryByRole('region', { name: 'Questions' })).toBeNull()
    })
  },
}
