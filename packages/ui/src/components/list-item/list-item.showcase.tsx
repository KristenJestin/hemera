import { Stack } from '#primitives/stack.tsx'
import { Badge } from '#components/badge/badge.tsx'
import { ListItem } from './list-item.tsx'
import type { ShowcaseEntry } from '#components/showcase.ts'

export const listItemShowcase: ShowcaseEntry = {
  component: 'ListItem',
  cases: [
    {
      name: 'states',
      render: () => (
        <Stack direction="column" gap="2xs" style={{ width: 248 }}>
          <ListItem label="Selected row" selected onSelect={() => {}} />
          <ListItem label="Resting row" onSelect={() => {}} />
          <ListItem label="Disabled row" disabled onSelect={() => {}} />
          <ListItem
            label="With a badge"
            onSelect={() => {}}
            trailing={<Badge kind="status" status="ok" label="live" />}
          />
        </Stack>
      ),
    },
  ],
}
