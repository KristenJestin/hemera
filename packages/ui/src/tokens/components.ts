/**
 * Layer 3 of the token system: the dimensions the catalogue and the window shell agree on.
 *
 * Every value comes from a scale of layer 1 or from a measurement normalised once in
 * design.md (D12a). Components read these instead of writing a number.
 */

import { iconSize, space } from './primitives.ts'

/** Interactive control geometry. */
export const control = {
  height: { sm: 28, md: 32, lg: 40 },
  /** How far a pressed control travels, in pixels. */
  pressTravel: 1,
  paddingX: { sm: space.md, md: space.lg, lg: space.xl },
} as const

/** A navigation entry or a session list row. */
export const row = {
  height: 32,
} as const

/** Icon sizes, from the closed scale. */
export const icon = {
  size: iconSize,
} as const

/** Thickness of a separator rule. */
export const rule = {
  thickness: 1,
} as const

/** Count, status and mission markers. */
export const badge = {
  /** A count is a tight pill; a label needs room for its text. */
  height: { count: 16, label: 20 },
  minWidth: 16,
} as const

/** Session status dot. */
export const dot = {
  size: 8,
} as const

/** Window shell geometry. */
export const shell = {
  topbar: { height: 44 },
  // Collapsed, the sidebar is gone rather than narrow: its rows have no icon-only form.
  sidebar: { width: 248, minWidth: 180, maxWidth: 420, collapsedWidth: 0 },
  /** `size` is what the pointer grabs, `rule` what is painted. */
  gutter: { size: 6, rule: 1 },
} as const

/** An overlay anchored to its trigger: menu, tooltip. */
export const overlay = {
  /** How far it rises as it appears, in pixels. */
  entryOffset: 4,
} as const

/** A decision panel laid over the window. */
export const dialog = {
  width: 520,
  /** How far the panel rises as it appears, in pixels. */
  entryOffset: space.md,
} as const

/** Painted state of a control the caller disabled. */
export const state = {
  disabledOpacity: 0.45,
} as const

/** Reading width of the content area. */
export const content = {
  maxWidth: 980,
} as const
