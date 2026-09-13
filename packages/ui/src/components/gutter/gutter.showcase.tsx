import { useState } from 'react'

import { Box } from '../../primitives/box.tsx'
import { Text } from '../../primitives/text.tsx'
import { shell } from '../../tokens/components.ts'
import { Gutter } from './gutter.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

function Split() {
  const [size, setSize] = useState<number>(shell.sidebar.width)
  return (
    <Box style={{ display: 'flex', flexDirection: 'row', height: 180 }}>
      <Box style={{ display: 'flex', width: size }}>
        <Text color="muted" scale="md">
          Sidebar
        </Text>
      </Box>
      <Gutter
        label="Sidebar width"
        size={size}
        onSizeChange={setSize}
        min={shell.sidebar.minWidth}
        max={shell.sidebar.maxWidth}
        defaultSize={shell.sidebar.width}
      />
      <Box style={{ display: 'flex', flexGrow: 1 }}>
        <Text color="muted" scale="md">
          Content
        </Text>
      </Box>
    </Box>
  )
}

export const gutterShowcase: ShowcaseEntry = {
  component: 'Gutter',
  cases: [{ name: 'resizable split', render: () => <Split /> }],
}
