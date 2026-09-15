import { Stack } from '#primitives/stack.tsx'
import { Badge } from '#components/badge/badge.tsx'
import { NavItem } from './nav-item.tsx'
import type { ShowcaseEntry } from '#components/showcase.ts'

export const navItemShowcase: ShowcaseEntry = {
  component: 'NavItem',
  cases: [
    {
      name: 'states',
      render: () => (
        <Stack direction="column" gap="2xs" style={{ width: 248 }}>
          <NavItem
            label="Selected session"
            iconName="message-square"
            selected
            onSelect={() => {}}
          />
          <NavItem label="Resting session" iconName="message-square" onSelect={() => {}} />
          <NavItem
            label="Disabled session"
            iconName="message-square"
            disabled
            onSelect={() => {}}
          />
          <NavItem
            label="With a badge"
            iconName="message-square"
            onSelect={() => {}}
            trailing={<Badge kind="count" count={4} />}
          />
        </Stack>
      ),
    },
  ],
}
