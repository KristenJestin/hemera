import { Text } from '../../primitives/text.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Card } from './card.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

export const cardShowcase: ShowcaseEntry = {
  component: 'Card',
  cases: [
    {
      name: 'with a counter and an action',
      render: () => (
        <Stack direction="column" gap="lg" style={{ width: 420 }}>
          <Card title="Sessions" count={3} actionLabel="See all" onAction={() => {}}>
            <Text color="muted" scale="md">
              Three sessions are open in this project.
            </Text>
          </Card>
          <Card title="Journal">
            <Text color="muted" scale="md">
              Nothing recorded yet.
            </Text>
          </Card>
        </Stack>
      ),
    },
  ],
}
