import { createContext, useContext } from 'react'
import type { RefObject } from 'react'

/**
 * Where the popups of the application are drawn.
 *
 * Base UI sends every popup to `<body>` unless it is told otherwise, and `<body>` is outside the
 * window's shell: a menu would be drawn under the shell's own stacking context and take its
 * colours from whatever `<html>` wears. The shell names one root at its end, and this context is
 * how every popup finds it without each caller passing the same ref down.
 *
 * A component rendered outside a shell reads nothing here and keeps Base UI's own default, which
 * is what a story and a test want.
 */
export type OverlayContainer = RefObject<HTMLDivElement | null> | undefined

// `undefined` and not `null`: Base UI reads `null` as "do not portal at all", where what a
// component outside a shell wants is Base UI's own default, which is `<body>`.
const Container = createContext<OverlayContainer>(undefined)

export const OverlayContainerProvider = Container.Provider

export function useOverlayContainer(): OverlayContainer {
  return useContext(Container)
}
