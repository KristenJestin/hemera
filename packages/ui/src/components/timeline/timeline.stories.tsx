import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import {
  IconDeviceDesktop,
  IconPlugConnected,
  IconRobot,
  IconSparkles,
  IconUser,
} from '../../icons.ts'
import { Badge } from '../badge/badge.tsx'
import { Button } from '../button/button.tsx'
import { Timeline, TimelineSection, TimelineStop } from './timeline.tsx'

/**
 * What happened, one stop at a time (design D4-05, D4-07).
 *
 * The Journal draws one, the Activity frame of the Home draws a shorter one, and the thread of
 * a Session will draw a third.
 */
const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Components/Timeline',
  component: TimelineStop,
  parameters: { layout: 'padded' },
  args: {
    marker: '#61',
    quiet: false,
    tone: 'primary',
    children: (
      <>
        <Badge tone="info">project</Badge>
        Repository ./sources/api added
      </>
    ),
    meta: (
      <>
        <span>10:41</span>
        <span className="flex items-center gap-1">
          <IconUser size="sm" />
          by you
        </span>
      </>
    ),
  },
  argTypes: {
    marker: { control: 'text', description: 'What identifies the stop where a reader quotes it.' },
    quiet: { control: 'boolean', description: 'Whether the engine did it rather than the user.' },
    tone: {
      control: 'inline-radio',
      options: ['primary', 'info', 'success', 'warning', 'neutral', 'define'],
      description: 'What the stop is about, in the tone the dot is filled with.',
    },
    children: { control: false, description: 'What the stop is about.' },
    meta: { control: false, description: 'Where and when and by whom.' },
  },
  render: (args) => (
    <Timeline label="What happened">
      <TimelineStop {...args} />
    </Timeline>
  ),
} satisfies Meta<typeof TimelineStop>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** A run of stops, named by day, with what the engine did told apart from what the user did. */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Timeline label="Journal">
      <TimelineSection name="Today">
        <TimelineStop
          marker="#61"
          meta={
            <>
              <span>10:41</span>
              <Button variant="link" size="sm" onClick={fn()}>
                Project settings
              </Button>
              <span className="flex items-center gap-1">
                <IconUser size="sm" />
                by you
              </span>
            </>
          }
        >
          <Badge tone="info">project</Badge>
          Repository ./sources/api added
        </TimelineStop>
        <TimelineStop
          marker="#59"
          quiet
          meta={
            <>
              <span>09:10</span>
              <span>by Hemera</span>
            </>
          }
        >
          <Badge tone="neutral">profile</Badge>
          Profile opened by 0.4.0-beta.3
        </TimelineStop>
      </TimelineSection>

      <TimelineSection name="Yesterday">
        <TimelineStop
          marker="#56"
          meta={
            <>
              <span>11:02</span>
              <span className="flex items-center gap-1">
                <IconUser size="sm" />
                by you
              </span>
            </>
          }
        >
          <Badge tone="info">project</Badge>
          Project created
        </TimelineStop>
      </TimelineSection>
    </Timeline>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Three stops and two days: a day is a heading over a run, never one of the things listed.
    expect(canvas.getAllByRole('listitem')).toHaveLength(3)
    expect(canvas.getByText('Today')).toBeInTheDocument()
    expect(canvas.getByText('Yesterday')).toBeInTheDocument()
  },
}

/** A stop with nothing under it: what happened, and no room taken for what is not said. */
export const States: Story = {
  args: { meta: undefined, marker: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Repository ./sources/api added')).toBeInTheDocument()
    expect(canvas.queryByText('10:41')).toBeNull()
  },
}

/**
 * Every tone a stop can wear, the define one included: a Spec's steps are drawn in the colour of
 * the define mission, told apart from a Project's and a Session's (lot 19).
 */
export const Tones: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Timeline label="Tones">
      <TimelineStop tone="primary">Session started</TimelineStop>
      <TimelineStop tone="info">Project created</TimelineStop>
      <TimelineStop tone="success">Build finished</TimelineStop>
      <TimelineStop tone="warning">Migration held back</TimelineStop>
      <TimelineStop tone="neutral">Hemera started</TimelineStop>
      <TimelineStop tone="define">Spec ATL-7 created</TimelineStop>
    </Timeline>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const stop = canvas.getByText('Spec ATL-7 created').closest('[role="listitem"]')
    const dot = stop?.querySelector('[aria-hidden="true"] > span')
    await expect(dot).toHaveClass('bg-mission-define')
    expect(canvas.getAllByRole('listitem')).toHaveLength(6)
  },
}

/** The three entries every candidate is drawn with, so only the drawing differs. */
/**
 * Who acted, as the head of a line. The timeline knows nothing of actors — it draws whatever
 * it is handed — so the story names them, exactly as the Journal does with its own.
 */
const BY = {
  you: { icon: <IconUser size="sm" />, name: 'you' },
  hemera: { icon: <IconSparkles size="sm" />, name: 'Hemera' },
  agent: { icon: <IconRobot size="sm" />, name: 'an agent' },
  mcp: { icon: <IconPlugConnected size="sm" />, name: 'MCP' },
  system: { icon: <IconDeviceDesktop size="sm" />, name: 'the system' },
} as const

function By({ who }: { who: keyof typeof BY }) {
  return (
    <span className="flex items-center text-muted-foreground">
      {BY[who].icon}
      <span className="sr-only">by {BY[who].name}</span>
    </span>
  )
}

/**
 * Three days of one Project, in the order they happened.
 *
 * Everything that can write to a Journal writes to this one: a machine starting, Hemera
 * migrating itself, the user setting the Project up, an agent working inside a Session, and a
 * client reading over MCP. It is a run long enough to have a shape — which is what a candidate
 * has to be judged on, since every one of them looks fine on three lines.
 */
function Sample() {
  return (
    <>
      <TimelineSection name="12 September">
        <TimelineStop marker={<By who="system" />} tone="neutral" quiet meta={<span>08:12</span>}>
          Hemera started
        </TimelineStop>
        <TimelineStop marker={<By who="hemera" />} tone="neutral" quiet meta={<span>08:12</span>}>
          Profile opened by 0.4.0-beta.1
        </TimelineStop>
        <TimelineStop marker={<By who="you" />} tone="info" meta={<span>09:04</span>}>
          Project “Atlas” created
        </TimelineStop>
        <TimelineStop marker={<By who="you" />} tone="info" meta={<span>09:06</span>}>
          Main Workspace set to ~/Projects/atlas
        </TimelineStop>
      </TimelineSection>

      <TimelineSection name="Yesterday">
        <TimelineStop marker={<By who="you" />} tone="info" meta={<span>10:41</span>}>
          Repository ./sources/api added
        </TimelineStop>
        <TimelineStop marker={<By who="you" />} tone="info" meta={<span>10:42</span>}>
          Repository ./sources/front added
        </TimelineStop>
        <TimelineStop marker={<By who="hemera" />} tone="neutral" quiet meta={<span>18:29</span>}>
          Profile backed up before 20260918_projects_and_journal
        </TimelineStop>
        <TimelineStop marker={<By who="hemera" />} tone="neutral" quiet meta={<span>18:29</span>}>
          Profile migrated to 20260918_projects_and_journal
        </TimelineStop>
      </TimelineSection>

      <TimelineSection name="Today">
        <TimelineStop marker={<By who="system" />} tone="neutral" quiet meta={<span>08:58</span>}>
          Hemera started
        </TimelineStop>
        <TimelineStop marker={<By who="you" />} tone="primary" meta={<span>13:40</span>}>
          Session “Untitled” started in main
        </TimelineStop>
        <TimelineStop
          marker={<By who="agent" />}
          tone="primary"
          quiet
          meta={<span>13:44 · 6 files</span>}
        >
          Read sources/api/src/invoices/export.service.ts
        </TimelineStop>
        <TimelineStop marker={<By who="agent" />} tone="primary" quiet meta={<span>13:52</span>}>
          Proposed a change to export.service.ts
        </TimelineStop>
        <TimelineStop marker={<By who="you" />} tone="primary" meta={<span>13:58</span>}>
          Session renamed “Untitled” → “CSV invoice export”
        </TimelineStop>
        <TimelineStop marker={<By who="mcp" />} tone="info" quiet meta={<span>14:20</span>}>
          Project settings read by a connected client
        </TimelineStop>
        <TimelineStop marker={<By who="you" />} tone="define" meta={<span>15:30</span>}>
          Spec ATL-7 “Export invoices as CSV” created
        </TimelineStop>
        <TimelineStop marker={<By who="agent" />} tone="define" quiet meta={<span>16:12</span>}>
          Phase shape finished
        </TimelineStop>
      </TimelineSection>
    </>
  )
}

/** A shorter run, for the story that only needs a few stops. */

/**
 * Three days of one Project, in the order they happened.
 *
 * Everything that can write to a Journal writes to this one: a machine starting, Hemera
 * migrating itself, the user setting the Project up, an agent reading and proposing inside a
 * Session, and a client reading over MCP. A run this long is the only thing a timeline can
 * honestly be judged on — days that break the rail, entries of very different lengths, runs of
 * the same actor, and quiet entries between loud ones.
 */
export const ARealRun: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Timeline label="Three days of Atlas">
      <Sample />
    </Timeline>
  ),
}
