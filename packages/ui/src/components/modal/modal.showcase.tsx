import { useState } from 'react'

import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { Button } from '../button/button.tsx'
import { Modal } from './modal.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

function Decision() {
  const [open, setOpen] = useState(false)
  return (
    <Stack direction="column" gap="lg" align="start">
      <Button label="Open the decision" onPress={() => setOpen(true)} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Archive this session?"
        actions={
          <>
            <Button label="Cancel" onPress={() => setOpen(false)} />
            <Button label="Archive" tone="primary" onPress={() => setOpen(false)} />
          </>
        }
      >
        <Text color="muted" scale="md">
          The session leaves the current list and stays readable among the archived ones.
        </Text>
      </Modal>
    </Stack>
  )
}

export const modalShowcase: ShowcaseEntry = {
  component: 'Modal',
  cases: [{ name: 'a decision over the window', render: () => <Decision /> }],
}
