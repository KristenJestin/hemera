import { Stack } from '../../primitives/stack.tsx'
import { Badge } from './badge.tsx'
import type { BadgeMission, BadgeStatus } from './use-badge.ts'
import type { ShowcaseEntry } from '../showcase.ts'

const STATUSES: BadgeStatus[] = ['ok', 'warn', 'bad', 'info']
const MISSIONS: BadgeMission[] = ['define', 'build', 'free']

export const badgeShowcase: ShowcaseEntry = {
  component: 'Badge',
  cases: [
    {
      name: 'counts',
      render: () => (
        <Stack gap="md">
          <Badge kind="count" count={1} />
          <Badge kind="count" count={12} />
          <Badge kind="count" count={250} />
        </Stack>
      ),
    },
    {
      name: 'statuses',
      render: () => (
        <Stack gap="md">
          {STATUSES.map((status) => (
            <Badge key={status} kind="status" status={status} label={status} />
          ))}
        </Stack>
      ),
    },
    {
      name: 'missions',
      render: () => (
        <Stack gap="md">
          {MISSIONS.map((mission) => (
            <Badge key={mission} kind="tag" mission={mission} label={mission} />
          ))}
        </Stack>
      ),
    },
  ],
}
