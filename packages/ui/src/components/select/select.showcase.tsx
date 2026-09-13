import { useState } from 'react'

import { Stack } from '../../primitives/stack.tsx'
import { Select } from './select.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

function Choices() {
  const [value, setValue] = useState<'light' | 'dark'>('dark')
  return (
    <Stack gap="md" align="center">
      <Select label="Theme" size="sm" value={value} options={OPTIONS} onValueChange={setValue} />
      <Select label="Theme" value={value} options={OPTIONS} onValueChange={setValue} />
      <Select label="Theme" value={value} options={OPTIONS} disabled onValueChange={setValue} />
    </Stack>
  )
}

export const selectShowcase: ShowcaseEntry = {
  component: 'Select',
  cases: [{ name: 'sizes and states', render: () => <Choices /> }],
}
