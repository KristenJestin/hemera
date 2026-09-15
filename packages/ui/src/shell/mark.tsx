import type { ReactNode } from 'react'

/**
 * The mark of Hemera — a placeholder, and said so out loud.
 *
 * Hemera is the day: a disc rising over a line. It is drawn here rather than taken from the
 * icon catalogue because it is not an icon — it is the name of the application, and it is the
 * one thing the chrome bar keeps when the sidebar folds down to its rail.
 *
 * It is drawn in `currentColor` and sized by the icon scale, like everything else in the bar,
 * so replacing it later is replacing this file and nothing around it.
 */
export function HemeraMark(): ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="size-icon-lg shrink-0 text-primary"
    >
      <circle cx="10" cy="8" r="4.5" fill="currentColor" />
      <path
        d="M2.5 15.5h15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  )
}
