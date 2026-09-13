import { useState } from 'react'

import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { Button } from '../button/button.tsx'
import { DialogPanel } from './dialog-panel.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

function Decision() {
  const [open, setOpen] = useState(true)
  return (
    <Stack direction="column" gap="lg" align="start">
      <Button label="Open the panel" onPress={() => setOpen(true)} />
      <DialogPanel
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
      </DialogPanel>
    </Stack>
  )
}

export const dialogPanelShowcase: ShowcaseEntry = {
  component: 'DialogPanel',
  cases: [{ name: 'a decision with its buttons', render: () => <Decision /> }],
}
