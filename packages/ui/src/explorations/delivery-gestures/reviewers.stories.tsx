import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { REVIEWERS, RULES } from '../../blocks/project-settings/delivery-fixtures.ts'
import { FormFoot } from '../../blocks/project-settings/parts.tsx'
import { IconGitMerge } from '../../icons.ts'
import { findOpen } from '../../overlay-play.ts'
import { SameEnd, SamePullRequests, SameWaves } from './frames.tsx'
import { GesturePage } from './gesture-page.tsx'
import { ListedReviewers, TickedReviewers, TypedReviewers } from './reviewers.tsx'

const body = () => within(document.body)

/** The Reviewers dialog over Acme's Delivery rules, its body the variant's. */
function ReviewersPage({ children }: { children: ReactNode }): ReactNode {
  return (
    <GesturePage
      form={{
        title: 'Reviewers',
        icon: <IconGitMerge size="sm" />,
        body: children,
        footer: <FormFoot onSave={() => {}} onCancel={() => {}} />,
      }}
    >
      <SamePullRequests rules={RULES} />
      <SameWaves rules={RULES} />
      <SameEnd rules={RULES} />
    </GesturePage>
  )
}

/**
 * Gesture 1 of #467, adding a reviewer: where the dialog finds the people and teams of the forge.
 * Listed is recommended: one call as the dialog opens (people with access and teams, `gh api` on
 * GitHub, `bkt` on Bitbucket), then the search the dialog already has, instant and offline. Ticked
 * reads the same list but scrolls it; Typed reads no list and checks each handle on the forge.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Delivery gestures/1 Reviewers',
  component: ReviewersPage,
  parameters: { layout: 'fullscreen' },
  args: { children: null },
  argTypes: { children: { table: { disable: true } } },
} satisfies Meta<typeof ReviewersPage>

export default meta
type Story = StoryObj<typeof meta>

/** Recommended, the list read: typing finds people and teams, Add puts them among the chosen. */
export const ListedReady: Story = {
  render: () => (
    <ReviewersPage>
      <ListedReviewers listing="ready" initial={REVIEWERS} />
    </ReviewersPage>
  ),
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Reviewers' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Add a reviewer' }), 'plat')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Add @acme/platform' }))
    const chosen = within(dialog).getByRole('list', { name: 'Chosen reviewers' })
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(3)
  },
}

/** Recommended, while the list is read: what is typed waits under rows of the shape to come. */
export const ListedReading: Story = {
  render: () => (
    <ReviewersPage>
      <ListedReviewers listing="reading" initial={REVIEWERS} initialQuery="na" />
    </ReviewersPage>
  ),
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Reviewers' })
    expect(within(dialog).getByRole('list', { name: 'Reviewers found' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  },
}

/**
 * Recommended, when the forge cannot be asked: the trouble and its command in the dialog, and a
 * handle typed is added as it is.
 */
export const ListedCannotList: Story = {
  render: () => (
    <ReviewersPage>
      <ListedReviewers listing="cannot" initial={REVIEWERS} initialQuery="@acme/ops" />
    </ReviewersPage>
  ),
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Reviewers' })
    expect(within(dialog).getByText(/^gh is signed out of github\.com/)).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add @acme/ops as typed' }))
    const chosen = within(dialog).getByRole('list', { name: 'Chosen reviewers' })
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(3)
  },
}

/** Ticked: the whole list, teams then people, each with its box, under a filter. */
export const TickedFromTheList: Story = {
  render: () => (
    <ReviewersPage>
      <TickedReviewers initial={REVIEWERS} />
    </ReviewersPage>
  ),
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Reviewers' })
    const teams = within(dialog).getByRole('list', { name: 'Teams' })
    const api = within(teams).getByRole('checkbox', { name: '@acme/api' })
    expect(api).not.toBeChecked()
    await userEvent.click(api)
    await waitFor(() => expect(api).toBeChecked())
  },
}

/** Typed: each handle checked on the forge once added; one still being checked. */
export const TypedChecking: Story = {
  render: () => (
    <ReviewersPage>
      <TypedReviewers
        initial={[...REVIEWERS, { handle: 'mokafor' }]}
        checks={{ mokafor: 'checking' }}
      />
    </ReviewersPage>
  ),
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Reviewers' })
    expect(within(dialog).getAllByLabelText('Found on github.com')).toHaveLength(2)
  },
}

/** Typed: a handle nobody has on the forge is said, at its line and in words. */
export const TypedUnknown: Story = {
  render: () => (
    <ReviewersPage>
      <TypedReviewers
        initial={[...REVIEWERS, { handle: 'dreyse' }]}
        checks={{ dreyse: 'unknown' }}
      />
    </ReviewersPage>
  ),
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Reviewers' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Nobody is called dreyse on github.com.',
    )
  },
}
