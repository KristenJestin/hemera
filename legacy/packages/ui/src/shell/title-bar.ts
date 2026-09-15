/**
 * Whether the projects bar can stand in for the window title bar.
 *
 * Drawing the chrome ourselves needs three things from the renderer: a window without its
 * native frame, a region the window is dragged by, and the minimise, maximise and close
 * commands. GPUI carries all of them (`start_window_move`, `minimize_window`, `zoom_window`,
 * `remove_window`); what varies is whether the renderer in front of it exposes them.
 *
 * So the capabilities are read from the renderer at hand rather than written down here: a
 * frameless window whose buttons do nothing cannot be moved or closed, and that is a window
 * the user is locked inside of. When anything is missing the system title bar stays above
 * the projects bar, and what is missing is named.
 */

export interface ClientDecorations {
  /** The native frame can be removed. */
  framelessWindow: boolean
  /** A region the window can be dragged by. */
  dragRegion: boolean
  /** Minimise, maximise and close, driven by the application. */
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

/** The subset of the renderer this decision reads. Declared here, not imported, so the
 * design system stays testable against a renderer that exposes nothing. */
export interface WindowCommands {
  startWindowMove?: () => void
  minimizeWindow?: () => void
  zoomWindow?: () => void
  closeWindow?: () => void
}

/**
 * What the renderer at hand exposes.
 *
 * `framelessWindow` is the one capability that cannot be probed: hiding the native frame is
 * an option of the window that was already created, so it is stated by the application that
 * opened it.
 */
export function decorationsOf(
  renderer: WindowCommands | null | undefined,
  framelessWindow: boolean,
): ClientDecorations {
  const commands = renderer ?? {}
  return {
    framelessWindow,
    dragRegion: typeof commands.startWindowMove === 'function',
    windowButtons:
      typeof commands.minimizeWindow === 'function' &&
      typeof commands.zoomWindow === 'function' &&
      typeof commands.closeWindow === 'function',
  }
}
