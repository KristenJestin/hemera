/**
 * The section's own frames, drawn as the app draws them, for the stories whose gesture changes
 * another frame or a dialog: each takes the rules and does nothing on its lines.
 */
import type { ReactNode } from 'react'

import type {
  DeliveryRefusals,
  DeliveryRules,
  Preset,
} from '../../blocks/project-settings/delivery-model.ts'
import { End, PullRequests, Waves } from '../../blocks/project-settings/delivery-rules.tsx'

const nothing = (): void => {}

export function SamePullRequests({
  rules,
  refusals = {},
}: {
  rules: DeliveryRules
  refusals?: DeliveryRefusals | undefined
}): ReactNode {
  return (
    <PullRequests
      rules={rules.pullRequests}
      refusals={refusals}
      onOpen={nothing}
      onToggle={nothing}
    />
  )
}

export function SameWaves({
  rules,
  open = [],
  onPreset = nothing,
}: {
  rules: DeliveryRules
  open?: readonly string[] | undefined
  onPreset?: ((repository: string, preset: Preset) => void) | undefined
}): ReactNode {
  return (
    <Waves
      rules={rules}
      refusals={{}}
      checking={[]}
      initiallyOpen={open}
      onOpen={nothing}
      onPreset={onPreset}
      onPutBack={nothing}
      onReset={nothing}
      onCheckAgain={nothing}
      onCopy={nothing}
      onAcceptDependency={nothing}
    />
  )
}

export function SameEnd({ rules }: { rules: DeliveryRules }): ReactNode {
  return <End cleanup={rules.cleanup} onOpen={nothing} onRemoveCleanup={nothing} />
}
