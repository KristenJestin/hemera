import { useState } from 'react'

import { Stack } from '#primitives/stack.tsx'
import { Textarea } from './textarea.tsx'
import type { ShowcaseEntry } from '#components/showcase.ts'

function Fields() {
  const [value, setValue] = useState('')
  return (
    <Stack direction="column" gap="md" align="start" style={{ width: 420 }}>
      <Textarea value={value} onValueChange={setValue} placeholder="Message" aria-label="Message" />
      <Textarea
        value={value}
        onValueChange={setValue}
        onSubmit={() => {}}
        placeholder="Message that submits"
        aria-label="Message"
      />
      <Textarea value="Locked" onValueChange={() => {}} disabled aria-label="Message" />
    </Stack>
  )
}

export const textareaShowcase: ShowcaseEntry = {
  component: 'Textarea',
  cases: [{ name: 'states', render: () => <Fields /> }],
}
