import { useState } from 'react'

import { Stack } from '../../primitives/stack.tsx'
import { Input } from './input.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

function Fields() {
  const [value, setValue] = useState('')
  return (
    <Stack direction="column" gap="md" align="start">
      <Input
        value={value}
        onValueChange={setValue}
        placeholder="Project name"
        aria-label="Project name"
        size="sm"
      />
      <Input
        value={value}
        onValueChange={setValue}
        placeholder="Project name"
        aria-label="Project name"
      />
      <Input value={value} onValueChange={setValue} invalid aria-label="Project name" />
      <Input value="Locked" onValueChange={() => {}} disabled aria-label="Project name" />
    </Stack>
  )
}

export const inputShowcase: ShowcaseEntry = {
  component: 'Input',
  cases: [{ name: 'sizes and states', render: () => <Fields /> }],
}
