import { Stack } from '../../primitives/stack.tsx'
import { Button } from './button.tsx'
import type { ButtonSize, ButtonTone } from './button.tsx'
import type { ShowcaseEntry } from '../showcase.ts'

const TONES: ButtonTone[] = ['primary', 'secondary', 'ghost', 'danger']
const SIZES: ButtonSize[] = ['sm', 'md', 'lg']

function Row({ children }: { children: React.ReactNode }) {
  return (
    <Stack gap="md" align="center">
      {children}
    </Stack>
  )
}

export const buttonShowcase: ShowcaseEntry = {
  component: 'Button',
  cases: [
    {
      name: 'tones',
      render: () => (
        <Row>
          {TONES.map((tone) => (
            <Button key={tone} tone={tone} label={tone} onPress={() => {}} />
          ))}
        </Row>
      ),
    },
    {
      name: 'sizes',
      render: () => (
        <Row>
          {SIZES.map((size) => (
            <Button key={size} size={size} tone="primary" label={size} onPress={() => {}} />
          ))}
        </Row>
      ),
    },
    {
      name: 'with an icon',
      render: () => (
        <Row>
          {SIZES.map((size) => (
            <Button key={size} size={size} iconName="plus" label="New project" onPress={() => {}} />
          ))}
        </Row>
      ),
    },
    {
      name: 'icon only',
      render: () => (
        <Row>
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
        <Row>
          <Button tone="primary" loading label="Saving" onPress={() => {}} />
          <Button tone="primary" disabled label="Disabled" onPress={() => {}} />
          <Button tone="secondary" disabled label="Disabled" onPress={() => {}} />
          <Button tone="danger" disabled label="Disabled" onPress={() => {}} />
        </Row>
      ),
    },
  ],
}
