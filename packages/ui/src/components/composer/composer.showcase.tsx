import { useState } from 'react'

import { Stack } from '../../primitives/stack.tsx'
import { shell } from '../../tokens/components.ts'
import { Button } from '../button/button.tsx'
import { Select } from '../select/select.tsx'
import { Composer } from './composer.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

const MISSIONS = [{ value: 'free', label: 'Free' }] as const

function Draft({ disabled = false }: { disabled?: boolean }) {
  const [draft, setDraft] = useState('')
  return (
    <Composer
      draft={draft}
      onDraftChange={setDraft}
      onSend={() => setDraft('')}
      disabled={disabled}
      placeholder="Message Hemera"
      aria-label="Message"
      toolbar={
        <Select
          label="Mission"
          value="free"
          options={MISSIONS}
          size="sm"
          onValueChange={() => {}}
        />
      }
      footer={<Button label="Send" tone="primary" size="sm" onPress={() => setDraft('')} />}
    />
  )
}

export const composerShowcase: ShowcaseEntry = {
  component: 'Composer',
  cases: [
    {
      name: 'resting and disabled',
      render: () => (
        <Stack direction="column" gap="lg" style={{ width: shell.sidebar.maxWidth }}>
          <Draft />
          <Draft disabled />
        </Stack>
      ),
    },
  ],
}
