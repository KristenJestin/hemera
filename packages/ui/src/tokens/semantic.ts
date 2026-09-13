/**
 * Layer 2 of the token system: the roles components read.
 *
 * A semantic token names a use, never a colour. `Theme` is the contract both themes satisfy:
 * adding a key to one theme without the other fails the typecheck before anything runs.
 */

import type { Shadow } from './primitives.ts'

/** Colour roles, identical in every theme. */
export interface ThemeColors {
  /** Window background, projects bar, sidebar. */
  bg: string
  /** Card, panel, overlay, selected row. */
  surface: string
  /** Inset content area, quiet hover. */
  surface2: string
  /** Group frame, segment track, neutral counter. */
  surface3: string
  /** Standard border, separator. */
  line: string
  /** Stronger border: field, secondary button, overlay. */
  line2: string
  /** Primary text. */
  text: string
  /** Secondary text, navigation label at rest. */
  muted: string
  /** Tertiary text, placeholder, icon at rest. */
  dim: string

  /** Primary fill, active accent. */
  primary: string
  /** Hover of a primary fill. */
  primaryStrong: string
  /** Soft accent background. */
  primarySoft: string
  /** Stronger soft accent background. */
  primarySoft2: string
  /** The one focus ring. */
  primaryRing: string
  /** Text and links on a soft accent background. */
  primaryText: string
  /** Text and icons on a primary fill. */
  onPrimary: string

  /** Success, running session. */
  ok: string
  okSoft: string
  /** Waiting, warning. */
  warn: string
  warnSoft: string
  /** Error, alert counter. */
  bad: string
  badSoft: string
  /** Neutral information. */
  info: string
  infoSoft: string

  /** Mission `define` (lot 2). */
  missionDefine: string
  missionDefineSoft: string
  /** Mission `build` (lot 3). */
  missionBuild: string
  missionBuildSoft: string
  /** Mission `free`, the only one of lot 1. */
  missionFree: string
  missionFreeSoft: string

  /** Veil behind a dialog panel. */
  scrim: string
  /** Press tint painted over a fill. */
  pressTint: string
  /** Background of a tip or floating notification. */
  tooltipBg: string
  /** Text of a tip or floating notification. */
  tooltipText: string
}

/** Elevation roles, identical in every theme. */
export interface ThemeShadows {
  /** Elevation of a control or a card. */
  sm: Shadow
  /** Anchored panel, menu. */
  md: Shadow
  /** Dialog panel, palette. */
  lg: Shadow
}

/** The contract both themes satisfy. */
export interface Theme {
  name: ThemeName
  colors: ThemeColors
  shadows: ThemeShadows
}

export type ThemeName = 'light' | 'dark'

/** Every colour role, used by the checks that compare the two themes. */
export const COLOR_ROLES: readonly (keyof ThemeColors)[] = [
  'bg',
  'surface',
  'surface2',
  'surface3',
  'line',
  'line2',
  'text',
  'muted',
  'dim',
  'primary',
  'primaryStrong',
  'primarySoft',
  'primarySoft2',
  'primaryRing',
  'primaryText',
  'onPrimary',
  'ok',
  'okSoft',
  'warn',
  'warnSoft',
  'bad',
  'badSoft',
  'info',
  'infoSoft',
  'missionDefine',
  'missionDefineSoft',
  'missionBuild',
  'missionBuildSoft',
  'missionFree',
  'missionFreeSoft',
  'scrim',
  'pressTint',
  'tooltipBg',
  'tooltipText',
]
