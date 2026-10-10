import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { loadMentionEditor } from '../components/mention-field/mention-field.tsx'
import { AppFixture, LONG_NAME, MANY_PROJECTS, NOTICES } from './shell-fixtures.tsx'

/**
 * The window every page of 1.0 lives in: the sidebar with Hemera's head, the sheet with its
 * header — the fold, where you are, the page's actions — and what is drawn over it: the engine's
 * state, the notifications. Each story is the whole window, full-bleed in the canvas; the
 * toolbar's viewports give the two sizes it is designed at.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Shell/Window',
  component: AppFixture,
  parameters: { layout: 'fullscreen' },
  render: () => <AppFixture />,
} satisfies Meta<typeof AppFixture>

export default meta
type Story = StoryObj<typeof meta>

/** No Project yet: Home is one empty state, Hemera asleep; the sidebar holds the way to add one. */
export const Empty: Story = {
  render: () => <AppFixture projects={[]} waiting={0} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('button', { name: 'Add a Project' })).toHaveLength(2)
    expect(canvas.getByRole('img', { name: 'Asleep' })).toBeInTheDocument()
  },
}

/** Two Projects, two things waiting, Acme open on its missions, the Home filled. */
export const Filled: Story = {
  render: () => <AppFixture withMissions />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Home, 2 waiting' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(canvas.getByRole('navigation', { name: 'Where you are' })).toHaveTextContent('Home')
    const places = canvas.getByRole('navigation', { name: 'Places' })
    expect(within(places).getByRole('button', { name: /ACME-12/ })).toBeVisible()
  },
}

/** The 1366 by 768 laptop screen, the sidebar open: Needs you's rows are whole in their column. */
export const Laptop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  render: () => <AppFixture withMissions />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = within(canvas.getByRole('region', { name: 'Needs you' })).getByRole('list', {
      name: 'Needs you',
    })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      for (const action of within(row).getAllByRole('button')) {
        expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(
          row.getBoundingClientRect().right,
        )
      }
    }
  },
}

/** Twelve Projects, long names everywhere, every list long: nothing overflows its row. */
export const Dense: Story = {
  render: () => <AppFixture projects={MANY_PROJECTS} waiting={23} withMissions dense />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const long = canvas.getByRole('button', { name: LONG_NAME })
    const name = within(long).getByText(LONG_NAME)
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
  },
}

/** The Projects on their way: their shape in the sidebar, the rows' shape on Home. */
export const Loading: Story = {
  render: () => <AppFixture projects={[]} loading />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('navigation', { name: 'Places' }).querySelector('[aria-busy="true"]'),
    ).not.toBeNull()
    expect(canvas.getAllByRole('list', { busy: true }).length).toBeGreaterThan(0)
  },
}

/** The Projects could not be read: said where they would be, and in the middle of Home. */
export const Error: Story = {
  render: () => (
    <AppFixture
      projects={[]}
      error="Hemera could not read the Projects: the profile is locked by another window."
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('alert').length).toBeGreaterThan(0)
    expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

/** The sidebar folded to its rail: the same places as icons, each named beside it. */
export const Folded: Story = {
  render: () => <AppFixture folded withMissions />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const home = canvas.getByRole('button', { name: 'Home, 2 waiting' })
    expect(canvas.getByText('Projects')).not.toBeVisible()
    await userEvent.hover(home)
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Home, 2 waiting')
    })
    await userEvent.unhover(home)
  },
}

/** A mission open: the trail says Acme › ACME-12 › Review · round 1, and the face has the ball. */
export const OnAMission: Story = {
  render: () => <AppFixture page={{ kind: 'mission', key: 'ACME-12' }} withMissions />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('navigation', { name: 'Where you are' })).toHaveTextContent(
      'AcmeACME-12Review · round 1',
    )
    await userEvent.click(canvas.getByRole('button', { name: /^Spec · frozen/ }))
    await waitFor(() => {
      expect(canvas.getByRole('navigation', { name: 'Where you are' })).toHaveTextContent(
        'AcmeACME-12Review · round 1Spec',
      )
    })
  },
}

/** A Chat open: listed under Acme with its glyph, the trail says Acme › its title. */
export const OnAChat: Story = {
  loaders: [async () => ({ editor: await loadMentionEditor() })],
  render: () => <AppFixture page={{ kind: 'chat', id: 'invoices' }} withMissions withChats />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const places = canvas.getByRole('navigation', { name: 'Places' })
    expect(within(places).getByRole('button', { name: 'Invoices export' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(canvas.getByRole('navigation', { name: 'Where you are' })).toHaveTextContent(
      'AcmeInvoices export',
    )
    await userEvent.click(within(places).getByRole('button', { name: 'Release notes for 2.4' }))
    await waitFor(() => {
      expect(canvas.getByRole('heading', { level: 1, name: 'Release notes for 2.4' })).toBeVisible()
    })
  },
}

/** The engine coming up: the sheet veiled, Hemera's face loading, the chrome in place. */
export const Starting: Story = {
  render: () => <AppFixture engine="starting" />,
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('status', { name: 'Starting Hemera' }),
    ).toBeInTheDocument()
  },
}

/** The engine did not start within its delay: said in words, with the way out. */
export const Late: Story = {
  render: () => <AppFixture engine="late" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('no sign within 10 seconds')
    expect(canvas.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  },
}

/** The engine stopped: said in words, and Restart Hemera. */
export const Stopped: Story = {
  render: () => <AppFixture engine="stopped" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('Hemera stopped')
    expect(canvas.getByRole('button', { name: 'Restart Hemera' })).toBeInTheDocument()
  },
}

/** Notifications while the window has the focus: in the sheet's corner; pressing one leads to its mission. */
export const Notified: Story = {
  render: () => <AppFixture notices={NOTICES} withMissions />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const region = canvas.getByRole('region', { name: 'Notifications' })
    expect(within(region).getAllByRole('button', { name: /^Dismiss/ })).toHaveLength(4)
    await userEvent.click(within(region).getByRole('button', { name: /^Run the migration/ }))
    await waitFor(() => {
      expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(/Export invoices/)
    })
    expect(within(region).getAllByRole('button', { name: /^Dismiss/ })).toHaveLength(3)
  },
}

/**
 * From the keyboard: Home, then the Projects, Add a Project, Settings, then the sheet's header;
 * Enter opens the Project page; the ring is visible on what has the focus.
 */
export const Focused: Story = {
  render: () => <AppFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Home, 2 waiting' })).toHaveFocus()
    await userEvent.tab()
    const acme = canvas.getByRole('button', { name: 'Acme' })
    expect(acme).toHaveFocus()
    await waitFor(() => {
      expect(getComputedStyle(acme, '::after').opacity).toBe('1')
    })
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(canvas.getByRole('heading', { name: 'Acme', level: 1 })).toBeInTheDocument()
    })
    expect(acme).toHaveAttribute('aria-current', 'page')
  },
}

/** Asked for less movement: every state is there at once, and nothing breathes or travels. */
export const ReducedMotion: Story = {
  render: () => (
    <MotionConfig reducedMotion="always">
      <AppFixture notices={NOTICES} withMissions />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('region', { name: 'Notifications' })).toBeInTheDocument()
    expect(canvasElement.querySelector('[data-mark="running"]')).not.toBeNull()
  },
}
