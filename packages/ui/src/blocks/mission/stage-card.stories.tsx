import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { LiveChip } from '../../components/live-chip/live-chip.tsx'
import { IconTerminal } from '../../icons.ts'
import { StageCard } from './stage-card.tsx'

/**
 * Where a mission's stage stands, at the top of its page, the same on every stage: Hemera's face
 * in the expression of what happens, one line that says what happens or what waits, and the
 * progress line under it. What runs, when something does, is its chips under that.
 */
const meta = {
  title: 'Blocks/Mission/Stage card',
  component: StageCard,
  tags: ['autodocs'],
  args: {
    stage: 'Planning',
    face: 'writing',
    line: 'Writes Goals',
    progress: { step: 'The Spec', detail: '4 of 8 sections written' },
  },
  decorators: [
    (Story) => (
      <div className="w-view-narrow">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StageCard>

export default meta
type Story = StoryObj<typeof meta>

const card = (canvasElement: HTMLElement, name: string) =>
  within(within(canvasElement).getByRole('region', { name }))

/** Planning while the Planner writes: the face writes, the line says what, the Spec's count under it. */
export const PlanningWriting: Story = {
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement, 'Planning')
    await expect(planning.getByRole('img', { name: 'Writing' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent('Writes Goals')
    await expect(planning.getByText('The Spec')).toBeVisible()
    await expect(planning.getByText('4 of 8 sections written')).toBeVisible()
  },
}

/** Planning between the Planner's turns: the line says what waits for the user. */
export const PlanningWaiting: Story = {
  args: {
    face: 'question',
    line: '5 questions wait for your answer',
    progress: { step: 'Your answers', detail: '2 answered · 5 to answer' },
  },
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement, 'Planning')
    await expect(planning.getByRole('img', { name: 'Waiting for your answer' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent('5 questions wait for your answer')
  },
}

/** Planning with what runs: the chips of the cold read and the Probes under the progress line. */
export const PlanningRunning: Story = {
  args: {
    face: 'reading',
    line: 'The cold read goes through the Spec',
    progress: { step: 'Cold read', detail: 'Reading the Spec' },
    running: (
      <LiveChip
        name="Probe #1"
        icon={<IconTerminal size="sm" />}
        state="running"
        startedAt={Date.now() - 84_000}
        endedAt={null}
        onPress={fn()}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(
      card(canvasElement, 'Planning').getByRole('button', { name: /Probe #1/ }),
    ).toBeVisible()
  },
}

/** Ready: the Spec is frozen and the build waits for the user to start it. */
export const Ready: Story = {
  args: {
    stage: 'Ready',
    face: 'done',
    line: 'Waits for you to start the build',
    progress: { step: 'Tasks', detail: '6 ready, 2 repositories' },
  },
  play: async ({ canvasElement }) => {
    const ready = card(canvasElement, 'Ready')
    await expect(ready.getByRole('status')).toHaveTextContent('Waits for you to start the build')
    await expect(ready.getByText('6 ready, 2 repositories')).toBeVisible()
  },
}

/** Building: the builder works on a task, the tasks counted under it. */
export const Building: Story = {
  args: {
    stage: 'Building',
    face: 'running',
    line: 'Builds T3, the front matter of an exported note',
    progress: { step: 'Tasks', detail: '2 of 6 done' },
  },
  play: async ({ canvasElement }) => {
    const building = card(canvasElement, 'Building')
    await expect(building.getByRole('status')).toHaveTextContent(/^Builds T3/)
    await expect(building.getByText('2 of 6 done')).toBeVisible()
  },
}

/** Long words on a narrow rail: the line wraps, the progress line keeps its step and truncates. */
export const LongText: Story = {
  args: {
    face: 'blocked',
    line: 'The Planner has given no sign for a while: its last turn read the export module of api, the attachments of web and the shared Markdown renderer',
    progress: {
      step: 'The Spec',
      detail: '4 of 8 sections written · Requirements waits on the answers to Q3, Q4 and Q5',
    },
  },
  play: async ({ canvasElement }) => {
    await expect(card(canvasElement, 'Planning').getByRole('status')).toHaveTextContent(
      /given no sign/,
    )
  },
}
