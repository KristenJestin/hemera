import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import * as moments from '../../surfaces/planning/planning-fixtures.ts'
import { planningSteps } from './planning-progress.ts'
import { PlanningSteps } from './planning-steps.tsx'

/**
 * Where Planning stands, at the top of the rail: the Spec, the user's answers, the cold read and
 * Freeze, each with its mark and where it stands in a few words; on the step under way, what the
 * Planner does next. A step that leads somewhere is pressed to go there.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/PlanningSteps',
  component: PlanningSteps,
  args: { steps: planningSteps(moments.starting()), onGo: fn() },
  decorators: [
    (Story) => (
      <div className="w-view-narrow">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlanningSteps>

export default meta
type Story = StoryObj<typeof meta>

/** The first second: the Spec under way and what comes next; the vision is the user's meanwhile. */
export const Starting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const spec = canvas.getByRole('listitem', { name: /The Spec/ })
    await expect(spec).toHaveTextContent('Next: write Why and Goals')
    await userEvent.click(within(spec).getByRole('button', { name: 'Give your vision' }))
    await expect(args.onGo).toHaveBeenCalledWith({ kind: 'vision' })
  },
}

/** Questions wait: the step is the user's, and a press leads to the first one. */
export const QuestionsWaiting: Story = {
  args: { steps: planningSteps(moments.asked()) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const answers = canvas.getByRole('listitem', { name: /Your answers/ })
    await expect(within(answers).getByRole('img', { name: 'Waiting for you' })).toBeVisible()
    await userEvent.click(within(answers).getByRole('button', { name: /Your answers/ }))
    await expect(args.onGo).toHaveBeenCalledWith({ kind: 'question', id: 'Q5' })
  },
}

/** Declared complete: the cold read reads the Spec, Freeze comes after it. */
export const ColdReadRunning: Story = {
  args: { steps: planningSteps(moments.coldReadRunning()) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const coldRead = canvas.getByRole('listitem', { name: /Cold read/ })
    await expect(within(coldRead).getByRole('img', { name: 'Running' })).toBeVisible()
    await expect(coldRead).toHaveTextContent('Reading the Spec')
  },
}

/** Nothing left: Freeze is the user's. */
export const ReadyToFreeze: Story = {
  args: { steps: planningSteps(moments.readyToFreeze()) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('listitem', { name: /Freeze/ })).toHaveTextContent(
      'Ready: yours to press',
    )
  },
}

/** The Planner stopped while writing: the step failed. */
export const PlannerStopped: Story = {
  args: { steps: planningSteps(moments.plannerFailed()) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const spec = canvas.getByRole('listitem', { name: /The Spec/ })
    await expect(within(spec).getByRole('img', { name: 'Failed' })).toBeVisible()
  },
}

/** Frozen: every step done. */
export const Frozen: Story = {
  args: { steps: planningSteps(moments.frozen()) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('img', { name: 'Done' })).toHaveLength(4)
  },
}
