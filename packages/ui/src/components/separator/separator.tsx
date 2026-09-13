/** A one pixel rule between two groups. */

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Box } from '../../primitives/box.tsx'
import { rule as ruleToken } from '../../tokens/components.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useSeparator } from './use-separator.ts'

export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical'
  style?: Style
  testId?: string
}

export function Separator({ orientation = 'horizontal', style, testId }: SeparatorProps) {
  const theme = useTheme()
  const behaviour = useSeparator({ orientation })
  const rule: Style =
    behaviour.orientation === 'horizontal'
      ? { height: ruleToken.thickness, width: '100%', backgroundColor: theme.colors.line }
      : { width: ruleToken.thickness, height: '100%', backgroundColor: theme.colors.line }

  return <Box style={mergeStyle(rule, style)} {...(testId === undefined ? {} : { testId })} />
}
