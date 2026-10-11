import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import meta_ from './for-you.stories.tsx'
import { PlanningExploration } from './screen.tsx'

/**
 * #193, the alternative: the same Planning card and the same folded rest, but in place of For you
 * only the next thing for the user stands whole — the first permission, else the first question
 * to answer, else the first finding — and what follows it is counted on one line. Calmer than For
 * you, at the price of the whole: the user cannot see what waits behind the first thing, nor
 * choose the order.
 */
const meta = {
  title: 'Explorations/Planning/Next first',
  component: PlanningExploration,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { ...meta_.args, layout: 'next-first' },
  decorators: meta_.decorators,
} satisfies Meta<typeof PlanningExploration>

export default meta
type Story = StoryObj<typeof meta>

const next = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'Next for you' }))

/** Five questions to answer: Q3 whole, the rest counted. */
export const QuestionsWaiting: Story = {
  play: async ({ canvasElement }) => {
    await expect(next(canvasElement).getByRole('article', { name: /^Q3/ })).toBeVisible()
    await expect(next(canvasElement).getByText('Then: 4 questions')).toBeVisible()
  },
}

/** Five findings to settle: the first whole, the rest counted. */
export const ColdReadWithManyFindings: Story = {
  args: { moment: 'coldReadFindings' },
  play: async ({ canvasElement }) => {
    await expect(next(canvasElement).getByText(/^R2 says the characters/)).toBeVisible()
    await expect(next(canvasElement).getByText('Then: 4 findings')).toBeVisible()
  },
}

/** Five permissions: the first as its card, the rest counted. */
export const ProbesWithPermissions: Story = {
  args: { moment: 'probesWithPermissions' },
  play: async ({ canvasElement }) => {
    await expect(next(canvasElement).getByRole('button', { name: 'Allow once' })).toBeVisible()
    await expect(next(canvasElement).getByText('Then: 4 permissions')).toBeVisible()
  },
}
