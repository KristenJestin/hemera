import { Stack } from '#primitives/stack.tsx'
import { IconButton } from './icon-button.tsx'
import type { ShowcaseEntry } from '#components/showcase.ts'

export const iconButtonShowcase: ShowcaseEntry = {
  component: 'IconButton',
  cases: [
    {
      name: 'tones and sizes',
      render: () => (
        <Stack gap="md">
          <IconButton name="plus" label="New project" tone="ghost" size="sm" onPress={() => {}} />
          <IconButton name="plus" label="New project" tone="ghost" size="md" onPress={() => {}} />
          <IconButton
            name="settings"
            label="Settings"
            tone="secondary"
            size="sm"
            onPress={() => {}}
          />
          <IconButton
            name="settings"
            label="Settings"
            tone="secondary"
            size="md"
            onPress={() => {}}
          />
        </Stack>
      ),
    },
    {
      name: 'disabled',
      render: () => (
        <Stack gap="md">
          <IconButton name="archive" label="Archive" disabled onPress={() => {}} />
          <IconButton name="archive" label="Archive" tone="secondary" disabled onPress={() => {}} />
        </Stack>
      ),
    },
  ],
}
