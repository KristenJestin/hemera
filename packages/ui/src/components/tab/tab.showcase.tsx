import { Stack } from '../../primitives/stack.tsx'
import { Tab } from './tab.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

export const tabShowcase: ShowcaseEntry = {
  component: 'Tab',
  cases: [
    {
      name: 'active and resting',
      render: () => (
        <Stack gap="md">
          <Tab label="Hemera" dotColor="primary" active onSelect={() => {}} />
          <Tab label="Atlas" dotColor="ok" onSelect={() => {}} />
          <Tab label="Archive" dotColor="missionFree" disabled onSelect={() => {}} />
        </Stack>
      ),
    },
    {
      name: 'with a counter',
      render: () => (
        <Stack gap="md">
          <Tab label="Hemera" dotColor="primary" active count={3} onSelect={() => {}} />
          <Tab label="Atlas" dotColor="ok" count={128} onSelect={() => {}} />
        </Stack>
      ),
    },
  ],
}
