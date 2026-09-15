import { Stack } from '#primitives/stack.tsx'
import { Kbd } from './kbd.tsx'
import type { ShowcaseEntry } from '#components/showcase.ts'

export const kbdShowcase: ShowcaseEntry = {
  component: 'Kbd',
  cases: [
    {
      name: 'single key',
      render: () => (
        <Stack gap="md">
          <Kbd combination="enter" />
          <Kbd combination="escape" />
          <Kbd combination="tab" />
        </Stack>
      ),
    },
    {
      name: 'combination',
      render: () => (
        <Stack gap="md">
          <Kbd combination="shift+tab" />
          <Kbd combination="control+shift+p" />
        </Stack>
      ),
    },
  ],
}
