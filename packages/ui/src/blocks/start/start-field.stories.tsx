import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  StartField,
  type StartFieldProps,
  type StartResultView,
  type StartTriage,
} from './start-field.tsx'

/**
 * The field that starts a mission: it searches first and creates last. What it finds unfolds
 * under it, the Project's missions, then tickets, and "Create a mission" is always the last
 * choice and never what Enter does while something else shows. The Planner's answer stands under it.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Start/StartField',
  component: StartField,
  args: {
    projectName: 'Acme',
    text: '',
    onText: fn(),
    results: [],
    onOpen: fn(),
    onCreate: fn(),
    onTriageAction: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-2xl p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StartField>

export default meta
type Story = StoryObj<typeof meta>

const FOUND: readonly StartResultView[] = [
  {
    kind: 'mission',
    key: 'ACME-12',
    title: 'Export invoices as CSV from the billing page',
    done: false,
    open: false,
  },
  { kind: 'mission', key: 'ACME-9', title: 'Export the movements', done: true, open: false },
  {
    kind: 'ticket',
    key: 'acme/shop#41',
    title: 'Export invoices as CSV',
    linkedMission: 'ACME-12',
  },
  {
    kind: 'ticket',
    key: 'acme/shop#56',
    title: 'Export the audit log as JSON',
    linkedMission: null,
  },
  { kind: 'create', title: 'export', ticket: null },
]

/** The field holds what is typed, as the window's part does. */
function Typing(props: StartFieldProps): ReactNode {
  const [text, setText] = useState(props.text)
  return (
    <StartField
      {...props}
      text={text}
      onText={(next) => {
        setText(next)
        props.onText(next)
      }}
    />
  )
}

const typing: Story['render'] = (args) => <Typing {...args} />

/** Nothing typed: the field alone, its keystroke on the right. */
export const Empty: Story = {
  render: typing,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: 'Start a mission in Acme' })).toBeVisible()
    expect(canvas.queryByRole('list', { name: 'Found' })).toBeNull()
  },
}

/** "export" typed: missions first, then tickets, and Create a mission last. */
export const Searching: Story = {
  args: { text: 'export', results: FOUND },
  render: typing,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const found = canvas.getByRole('list', { name: 'Found' })
    const choices = within(found).getAllByRole('button')
    expect(choices).toHaveLength(5)
    expect(choices[0]).toHaveTextContent('ACME-12')
    expect(choices[2]).toHaveTextContent('acme/shop#41')
    expect(choices.at(-1)).toHaveTextContent('Create a mission “export”')
    expect(within(found).getByText('Done')).toBeVisible()
  },
}

/** Before the first answer of the search. */
export const Waiting: Story = {
  args: { text: 'export', results: 'searching' },
  render: typing,
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status', { name: 'Searching' })).toBeVisible()
  },
}

/** A provider that did not answer is said once, under the results. */
export const WithNotice: Story = {
  args: {
    text: 'export',
    results: FOUND,
    notice: 'GitHub did not answer: the tickets of acme/shop are missing.',
  },
  render: typing,
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByText(/GitHub did not answer/)).toBeVisible()
  },
}

/** A ticket's address is recognised: the mission linked to it is the one Enter opens. */
export const TicketUrlOpens: Story = {
  args: {
    text: 'https://github.com/acme/shop/issues/41',
    results: [
      {
        kind: 'mission',
        key: 'ACME-12',
        title: 'Export invoices as CSV from the billing page',
        done: false,
        open: true,
      },
      { kind: 'create', title: 'Export invoices as CSV', ticket: 'acme/shop#41' },
    ],
  },
  render: typing,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('textbox', { name: 'Start a mission in Acme' }))
    await userEvent.keyboard('{Enter}')
    expect(args.onOpen).toHaveBeenCalledWith('ACME-12')
    expect(args.onCreate).not.toHaveBeenCalled()
  },
}

/** A ticket nobody linked: Create a mission says which ticket it starts from. */
export const TicketToStart: Story = {
  args: {
    text: 'acme/shop#56',
    results: [
      {
        kind: 'ticket',
        key: 'acme/shop#56',
        title: 'Export the audit log as JSON',
        linkedMission: null,
      },
      { kind: 'create', title: 'Export the audit log as JSON', ticket: 'acme/shop#56' },
    ],
  },
  render: typing,
  play: ({ canvasElement }) => {
    const choices = within(within(canvasElement).getByRole('list', { name: 'Found' })).getAllByRole(
      'button',
    )
    expect(choices.at(-1)).toHaveTextContent('acme/shop#56')
  },
}

/** Enter does not create while other results show. */
export const EnterDoesNotCreate: Story = {
  args: { text: 'export', results: FOUND },
  render: typing,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('textbox', { name: 'Start a mission in Acme' }),
    )
    await userEvent.keyboard('{Enter}')
    expect(args.onCreate).not.toHaveBeenCalled()
    expect(args.onOpen).not.toHaveBeenCalled()
  },
}

/** The create choice is there but the search goes on: Enter waits for it to end. */
export const EnterWaitsForTheSearch: Story = {
  args: {
    text: 'Fix the typo in the footer',
    results: [{ kind: 'create', title: 'Fix the typo in the footer', ticket: null }],
    searching: true,
  },
  render: typing,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('textbox', { name: 'Start a mission in Acme' }),
    )
    await userEvent.keyboard('{Enter}')
    expect(args.onCreate).not.toHaveBeenCalled()
  },
}

/** Nothing else found: Enter creates, and the row says so. */
export const EnterCreatesAlone: Story = {
  args: {
    text: 'Fix the typo in the footer',
    results: [{ kind: 'create', title: 'Fix the typo in the footer', ticket: null }],
  },
  render: typing,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('textbox', { name: 'Start a mission in Acme' }),
    )
    await userEvent.keyboard('{Enter}')
    expect(args.onCreate).toHaveBeenCalledTimes(1)
  },
}

/** Pressing the last choice creates. */
export const CreateByPress: Story = {
  args: { text: 'export', results: FOUND },
  render: typing,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Create a mission/ }))
    expect(args.onCreate).toHaveBeenCalledTimes(1)
  },
}

/** From the keyboard: the arrows go down the results and back to the field. */
export const Focused: Story = {
  args: { text: 'export', results: FOUND },
  render: typing,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByRole('textbox', { name: 'Start a mission in Acme' })
    await userEvent.click(field)
    const choices = within(canvas.getByRole('list', { name: 'Found' })).getAllByRole('button')
    await userEvent.keyboard('{ArrowDown}')
    expect(choices[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(choices[2]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(choices[1]).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(args.onOpen).toHaveBeenCalledWith('ACME-9')
    await userEvent.keyboard('{ArrowUp}')
    expect(choices[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(field).toHaveFocus())
  },
}

const answered = (triage: StartTriage, text: string): NonNullable<Story['args']> => ({
  text,
  results: [],
  triage,
})

/** The Planner reads what was typed: its loading face under the field. */
export const TriageReading: Story = {
  args: answered({ kind: 'reading' }, 'Export the audit log'),
  render: typing,
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status', { name: 'Hemera reads it' })).toBeVisible()
  },
}

/** The answer: this belongs to an existing mission. */
export const TriageBelongs: Story = {
  args: answered({ kind: 'belongs', key: 'ACME-12' }, 'Keep the date range in the file name'),
  render: typing,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('This belongs to ACME-12')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Add it to ACME-12' }))
    expect(args.onTriageAction).toHaveBeenCalledWith('open')
    await userEvent.click(canvas.getByRole('button', { name: 'Start a mission anyway' }))
    expect(args.onTriageAction).toHaveBeenCalledWith('anyway')
  },
}

/** The answer: it was delivered already, by a mission or a requirement not validated yet. */
export const TriageDelivered: Story = {
  args: answered({ kind: 'delivered', key: 'ACME-9', proposed: false }, 'Export the movements'),
  render: typing,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Already delivered by ACME-9')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Open ACME-9' })).toBeVisible()
  },
}

/** Delivered by a requirement the user has not validated yet. */
export const TriageDeliveredProposed: Story = {
  args: answered({ kind: 'delivered', key: 'ACME-9', proposed: true }, 'Export the movements'),
  render: typing,
  play: ({ canvasElement }) => {
    expect(within(canvasElement).getByText('Delivered by ACME-9, not validated yet')).toBeVisible()
  },
}

/** The answer: too small for a mission, the Chat is the place. */
export const TriageSmall: Story = {
  args: answered({ kind: 'small' }, 'Fix the typo in the footer'),
  render: typing,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Ask in a Chat' }))
    expect(args.onTriageAction).toHaveBeenCalledWith('chat')
  },
}
