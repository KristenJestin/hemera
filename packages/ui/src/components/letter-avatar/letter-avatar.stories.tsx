import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { LetterAvatar } from './letter-avatar.tsx'

/**
 * Who it is, in a round mark: the first letter of a name, two letters when first letters collide
 * in the same set, and a stable colour derived from the name, from the tone tokens.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/LetterAvatar',
  component: LetterAvatar,
  args: { name: 'Reviewer' },
  argTypes: {
    name: { control: 'text' },
    tone: {
      control: 'inline-radio',
      options: [undefined, 'primary', 'info', 'success', 'warning', 'build'],
    },
    legend: { control: 'boolean' },
    others: { table: { disable: true } },
  },
} satisfies Meta<typeof LetterAvatar>

export default meta
type Story = StoryObj<typeof meta>

/** Alone with its first letter: one letter, round, decoration beside a name already said. */
export const Single: Story = {
  play: async ({ canvasElement }) => {
    const avatar = canvasElement.querySelector<HTMLElement>('[data-avatar]')!
    expect(avatar).toHaveTextContent(/^R$/)
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(parseFloat(getComputedStyle(avatar).borderTopLeftRadius)).toBeGreaterThan(1000)
  },
}

/**
 * A set where first letters collide: each wears two letters, and no two of the set wear the same
 * ones. A name alone with its letter keeps one.
 */
export const Collision: Story = {
  render: () => {
    const set = ['Reviewer', 'Researcher', 'Scout', 'Documenter']
    return (
      <div className="flex items-center gap-2">
        {set.map((name) => (
          <LetterAvatar key={name} name={name} others={set.filter((other) => other !== name)} />
        ))}
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const worn = [...canvasElement.querySelectorAll('[data-avatar]')].map(
      (avatar) => avatar.textContent,
    )
    expect(worn).toEqual(['RV', 'RS', 'S', 'D'])
  },
}

/** The colour is the name's own: the same name, the same tone, whatever set it is drawn in. */
export const Tones: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      {['Reviewer', 'Documenter', 'Planner', 'Scout', 'Tester'].map((name) => (
        <LetterAvatar key={name} name={name} />
      ))}
      <LetterAvatar name="Reviewer" others={['Researcher']} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const avatars = [...canvasElement.querySelectorAll<HTMLElement>('[data-avatar]')]
    const fill = (avatar: HTMLElement): string => getComputedStyle(avatar).backgroundColor
    expect(new Set(avatars.slice(0, 5).map(fill)).size).toBeGreaterThan(2)
    expect(fill(avatars[5]!)).toBe(fill(avatars[0]!))
  },
}

/** Drawn alone, without its name beside it: its legend is a tooltip on the mark itself. */
export const WithLegend: Story = {
  args: { legend: true },
  play: async ({ canvasElement }) => {
    const avatar = within(canvasElement).getByRole('img', { name: 'Reviewer' })
    await userEvent.tab()
    expect(avatar).toHaveFocus()
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Reviewer')
    })
    await userEvent.tab()
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}
