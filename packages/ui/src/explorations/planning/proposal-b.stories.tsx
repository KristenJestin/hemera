import type { Meta, StoryObj } from '@storybook/react-vite'

import { journeyOf } from './journey.tsx'
import { PlanningB } from './proposal-b.tsx'

/**
 * What calls for the user leads, at full width: the refusal, what changed, the waves, a discussion unfolding under its question, the findings, the dependencies; the Spec is an outline in the rail and opens as a view, and takes the column when nothing calls.
 * The Planning page of a mission, inside the mission frame of "Two lines and a rail", on the
 * shared journey.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Planning/B · What to settle first',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const journey = journeyOf({ Planning: PlanningB })

export const PlannerWriting: Story = journey.PlannerWriting
export const WaveWaiting: Story = journey.WaveWaiting
export const Answering: Story = journey.Answering
export const AnsweringByKeyboard: Story = journey.AnsweringByKeyboard
export const DiscussionOpen: Story = journey.DiscussionOpen
export const ProbeRunning: Story = journey.ProbeRunning
export const ProbeNotReproduced: Story = journey.ProbeNotReproduced
export const ColdReadRunning: Story = journey.ColdReadRunning
export const ColdReadFindings: Story = journey.ColdReadFindings
export const ColdReadFailed: Story = journey.ColdReadFailed
export const DependencyProposed: Story = journey.DependencyProposed
export const ChangedSinceLastRead: Story = journey.ChangedSinceLastRead
export const Vision: Story = journey.Vision
export const ReadyToFreeze: Story = journey.ReadyToFreeze
export const FreezeRefused: Story = journey.FreezeRefused
export const Frozen: Story = journey.Frozen
export const Outdated: Story = journey.Outdated
export const LongText: Story = journey.LongText
