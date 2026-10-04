import type { ReactNode } from 'react'

/**
 * The window: what every page of 1.0 lives in.
 *
 * Two regions and one idea. The sidebar down the left is drawn on the page surface, the quiet
 * one; the content is a sheet laid on it, the strongest surface of the theme, a line around it
 * and its top-left corner rounded where it meets the sidebar. What is read all day is the sheet;
 * the chrome is where the eye goes to leave it.
 *
 * The window is frameless and has no title bar of its own: the sidebar's head and the sheet's
 * header are its top edge, and both are the drag zone. The system's own controls are drawn over
 * the end of the sheet's header by the window — Window Controls Overlay — which leaves them
 * their room.
 *
 * Overlays — the engine's state while it starts or after it stops, the notifications — are drawn
 * over the sheet and never over the chrome: the chrome stays reachable, the content is what the
 * state is about.
 */
const WINDOW = 'flex h-screen w-full overflow-hidden bg-surface-page text-foreground'

const SHEET =
  'relative mt-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-lg border-t border-l border-border bg-surface-content'

/** What the sheet holds under its header: the page, which scrolls on its own. */
const PAGE = 'relative flex min-h-0 flex-1 flex-col'

const SCROLL = 'flex min-h-0 flex-1 flex-col overflow-auto'

export interface WindowShellProps {
  sidebar: ReactNode
  /** The line across the top of the sheet: the fold, where you are, the page's actions. */
  header: ReactNode
  /** What is drawn over the page: an engine veil, the notifications. */
  overlay?: ReactNode
  children: ReactNode
}

export function WindowShell({ sidebar, header, overlay, children }: WindowShellProps): ReactNode {
  return (
    <div className={WINDOW}>
      {sidebar}
      <main className={SHEET}>
        {header}
        <div className={PAGE}>
          <div className={SCROLL}>{children}</div>
          {overlay}
        </div>
      </main>
    </div>
  )
}
