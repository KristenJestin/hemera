import { Stack } from '../../primitives/stack.tsx'
import { Notice } from './notice.tsx'
import type { NoticeTone } from './use-notice.ts'
import type { ShowcaseEntry } from '../showcase.ts'

const TONES: NoticeTone[] = ['info', 'warn', 'error', 'success']

export const noticeShowcase: ShowcaseEntry = {
  component: 'Notice',
  cases: [
    {
      name: 'tones',
      render: () => (
        <Stack direction="column" gap="md" align="start" style={{ width: 420 }}>
          {TONES.map((tone) => (
            <Notice key={tone} tone={tone} message={`This is a ${tone} notice.`} />
          ))}
        </Stack>
      ),
    },
  ],
}
