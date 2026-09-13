import { Stack } from '../../primitives/stack.tsx'
import { EmptyState } from './empty-state.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

export const emptyStateShowcase: ShowcaseEntry = {
  component: 'EmptyState',
  cases: [
    {
      name: 'with and without a way out',
      render: () => (
        <Stack direction="column" gap="lg" style={{ width: 420 }}>
          <EmptyState
            iconName="inbox"
            title="No session yet"
            description="Create a session to start working in this project."
            actionLabel="New session"
            onAction={() => {}}
          />
          <EmptyState
            iconName="folder"
            title="No project"
            description="Open a folder to create your first project."
          />
        </Stack>
      ),
    },
  ],
}
