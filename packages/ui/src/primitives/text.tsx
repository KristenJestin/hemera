/**
 * A run of text.
 *
 * The renderer paints nothing for a text node without a colour, and it does not nest text
 * nodes: both are refused here rather than left to produce an empty frame.
 */

import { createContext, useContext } from 'react'

import { mergeStyle, withoutUndefined } from '../lib/style.ts'
import type { Style } from '../lib/style.ts'
import { fontFamily, fontSize, fontWeight, lineHeight } from '../tokens/primitives.ts'
import type { ThemeColors } from '../tokens/semantic.ts'
import { useTheme } from '../theme/provider.tsx'

export type TextScale = keyof typeof fontSize
export type TextWeight = keyof typeof fontWeight
export type TextFamily = keyof typeof fontFamily
/** A text colour is named by its role; a literal is refused by the type. */
export type TextColor = keyof ThemeColors

export interface TextProps {
  /** Role the colour comes from. Required: the renderer paints nothing without it. */
  color: TextColor
  scale?: TextScale
  weight?: TextWeight
  family?: TextFamily
  /** Single line, clipped with an ellipsis when it does not fit. */
  truncate?: boolean
  style?: Style
  children: string | number
  testId?: string
}

const InsideText = createContext(false)

export function Text({
  color,
  scale = 'base',
  weight = 'regular',
  family = 'sans',
  truncate = false,
  style,
  children,
  testId,
}: TextProps) {
  if (useContext(InsideText)) {
    throw new Error('Text cannot nest inside another Text: the renderer paints one run per node')
  }
  const theme = useTheme()
  const typography: Style = {
    color: theme.colors[color],
    fontSize: fontSize[scale],
    lineHeight: lineHeight[scale],
    fontWeight: fontWeight[weight],
    fontFamily: fontFamily[family],
    ...(truncate ? { whiteSpace: 'nowrap', textOverflow: 'ellipsis' } : {}),
  }
  return (
    <InsideText.Provider value={true}>
      <text {...withoutUndefined({ style: mergeStyle(typography, style), testId })}>
        {children}
      </text>
    </InsideText.Provider>
  )
}
