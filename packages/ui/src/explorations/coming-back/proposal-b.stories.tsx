import type { Meta, StoryObj } from '@storybook/react-vite'

import { journeyOf } from './journey.tsx'
import { HomeB, MissionB, ProjectB } from './proposal-b.tsx'

/**
 * A mission on two lines with the causes written out, a rail for what is not a
 * mission, the stage as a track in the header, Home led by Since you left with what calls beside it.
 * The Project page, the mission frame and Home ("coming back"), on the shared journey.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Coming back/Two lines and a rail',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const journey = journeyOf({ Project: ProjectB, Mission: MissionB, Home: HomeB })

export const ProjectFilled: Story = journey.ProjectFilled
export const ProjectEmpty: Story = journey.ProjectEmpty
export const ProjectMany: Story = journey.ProjectMany
export const ProjectSearching: Story = journey.ProjectSearching
export const ProjectTriageReading: Story = journey.ProjectTriageReading
export const ProjectTriageBelongs: Story = journey.ProjectTriageBelongs
export const ProjectTriageSmall: Story = journey.ProjectTriageSmall
export const ProjectFocused: Story = journey.ProjectFocused
export const MissionPlanning: Story = journey.MissionPlanning
export const MissionBlockedByDependency: Story = journey.MissionBlockedByDependency
export const MissionBlockedByResource: Story = journey.MissionBlockedByResource
export const MissionReview: Story = journey.MissionReview
export const MissionWaiting: Story = journey.MissionWaiting
export const MissionOutdated: Story = journey.MissionOutdated
export const MissionCancelling: Story = journey.MissionCancelling
export const HomeMorning: Story = journey.HomeMorning
export const HomeNoQuestion: Story = journey.HomeNoQuestion
export const HomeEmpty: Story = journey.HomeEmpty
