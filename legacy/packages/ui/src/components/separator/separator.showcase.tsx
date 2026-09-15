import { Box } from '#primitives/box.tsx'
import { Stack } from '#primitives/stack.tsx'
import { Text } from '#primitives/text.tsx'
import { Separator } from './separator.tsx'
import type { ShowcaseEntry } from '#components/showcase.ts'

export const separatorShowcase: ShowcaseEntry = {
  component: 'Separator',
  cases: [
    {
      name: 'horizontal',
      render: () => (
        <Stack direction="column" gap="md" style={{ width: 248 }}>
          <Text color="text">Above</Text>
          <Separator />
          <Text color="text">Below</Text>
        </Stack>
      ),
    },
    {
      name: 'vertical',
      render: () => (
        <Box style={{ display: 'flex', flexDirection: 'row', gap: 12, height: 32 }}>
          <Text color="text">Left</Text>
          <Separator orientation="vertical" />
          <Text color="text">Right</Text>
        </Box>
      ),
    },
  ],
}
