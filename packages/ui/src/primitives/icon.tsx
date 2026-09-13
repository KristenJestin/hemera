/**
 * An icon of the catalogue.
 *
 * The renderer paints an icon as a monochrome sprite recoloured from the element's `color`,
 * so an icon without a resolved colour paints nothing. The colour is therefore always taken
 * from a role, defaulting to the surrounding text role rather than left unset.
 */

import { mergeStyle, withoutUndefined } from '../lib/style.ts'
import type { Style } from '../lib/style.ts'
import { ICONS } from '../icons/catalog.ts'
import type { IconName } from '../icons/catalog.ts'
import { iconSize } from '../tokens/primitives.ts'
import type { ThemeColors } from '../tokens/semantic.ts'
import { useTheme } from '../theme/provider.tsx'

export type IconSize = keyof typeof iconSize

export interface IconProps {
  name: IconName
  size?: IconSize
  /** Role the colour comes from; it matches the text it sits with. */
  color?: keyof ThemeColors
  /** Clockwise rotation in degrees, painted by the sprite transform. */
  rotate?: number
  style?: Style
  testId?: string
}

export function Icon({ name, size = 'sm', color = 'text', rotate, style, testId }: IconProps) {
  const theme = useTheme()
  const painted: Style = {
    width: iconSize[size],
    height: iconSize[size],
    flexShrink: 0,
    color: theme.colors[color],
  }
  return (
    <svg
      {...withoutUndefined({
        source: ICONS[name],
        rotate,
        style: mergeStyle(painted, style),
        testId,
      })}
    />
  )
}
