import { Stack } from '#primitives/stack.tsx'
import { shell } from '#tokens/components.ts'
import { TimelineItem } from './timeline-item.tsx'
import type { ShowcaseEntry } from '#components/showcase.ts'

const AT = new Date(2026, 8, 13, 14, 5)

export const timelineItemShowcase: ShowcaseEntry = {
  component: 'TimelineItem',
  cases: [
    {
      name: 'entries',
      render: () => (
        <Stack direction="column" style={{ width: shell.sidebar.maxWidth }}>
          <TimelineItem message="Project created" at={AT} now={AT} dotColor="ok" />
          <TimelineItem message="Session opened" at={AT} now={AT} mission="free" />
          <TimelineItem message="Message recorded" at={AT} now={AT} dotColor="primary" />
        </Stack>
      ),
    },
  ],
}
