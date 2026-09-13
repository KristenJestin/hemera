import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { Button } from './button.tsx'
import type { ButtonSize, ButtonTone } from './button.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

const TONES: ButtonTone[] = ['primary', 'secondary', 'ghost', 'danger']
const SIZES: ButtonSize[] = ['sm', 'md', 'lg']

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="column" gap="xs" align="start">
      <Text color="dim" scale="xs" weight="semibold">
        {label}
      </Text>
      <Stack gap="md" align="center">
        {children}
      </Stack>
    </Stack>
  )
}

export const buttonShowcase: ShowcaseEntry = {
  component: 'Button',
  cases: [
    {
      name: 'tones',
      render: () => (
        <Row label="tones">
          {TONES.map((tone) => (
            <Button key={tone} tone={tone} label={tone} onPress={() => {}} />
          ))}
        </Row>
      ),
    },
    {
      name: 'sizes',
      render: () => (
        <Row label="sizes">
          {SIZES.map((size) => (
            <Button key={size} size={size} tone="primary" label={size} onPress={() => {}} />
          ))}
        </Row>
      ),
    },
    {
      name: 'with an icon',
      render: () => (
        <Row label="with an icon">
          {SIZES.map((size) => (
            <Button key={size} size={size} iconName="plus" label="New project" onPress={() => {}} />
          ))}
        </Row>
      ),
    },
    {
      name: 'icon only',
      render: () => (
        <Row label="icon only">
          {SIZES.map((size) => (
            <Button
              key={size}
              size={size}
              iconName="plus"
              iconOnly
              label="New project"
              onPress={() => {}}
            />
          ))}
        </Row>
      ),
    },
    {
      name: 'loading and disabled',
      render: () => (
        <Row label="loading and disabled">
          <Button tone="primary" loading label="Saving" onPress={() => {}} />
          <Button tone="primary" disabled label="Disabled" onPress={() => {}} />
          <Button tone="secondary" disabled label="Disabled" onPress={() => {}} />
          <Button tone="danger" disabled label="Disabled" onPress={() => {}} />
        </Row>
      ),
    },
  ],
}
