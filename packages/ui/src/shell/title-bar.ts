/**
 * Whether the projects bar can stand in for the window title bar.
 *
 * Drawing the chrome ourselves needs three things from the renderer: a window without its
 * native frame, a region the window is dragged by, and the minimise, maximise and close
 * buttons. The renderer hides the native title bar, but exposes neither the drag region nor
 * the window buttons to the application, even though GPUI itself carries
 * `start_window_move`, `minimize_window`, `zoom_window` and `window_controls`.
 *
 * With a frameless window the user could neither move nor close it, so the fallback applies:
 * the system title bar stays above the projects bar and the gap is recorded, naming the
 * capability that is missing.
 */

export interface ClientDecorations {
  /** The native frame can be removed. */
  framelessWindow: boolean
  /** A region the window can be dragged by. */
  dragRegion: boolean
  /** Minimise, maximise and close, drawn by the application. */
  windowButtons: boolean
}

export type TitleBarMode =
  /** The projects bar is the title bar. */
  | 'projects-bar'
  /** The system title bar stays above the projects bar. */
  | 'native'

export interface TitleBarDecision {
  mode: TitleBarMode
  /** Capabilities the renderer does not expose, named for the fork patch request. */
  missing: (keyof ClientDecorations)[]
}

/** What the renderer exposes on the target it was measured on. */
export function decideTitleBar(decorations: ClientDecorations): TitleBarDecision {
  const missing = (Object.keys(decorations) as (keyof ClientDecorations)[]).filter(
    (capability) => !decorations[capability],
  )
  return { mode: missing.length === 0 ? 'projects-bar' : 'native', missing }
}

/**
 * What GPUiX 0.7.0-hemera.1 exposes, as observed on Windows.
 *
 * Linux stays unmeasured: a result on one target is never carried to another.
 */
export const OBSERVED_DECORATIONS: ClientDecorations = {
  framelessWindow: true,
  dragRegion: false,
  windowButtons: false,
}
