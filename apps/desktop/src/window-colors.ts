/**
 * The few values the window is made of before there is a design system.
 *
 * The main process needs them to paint the frame and the system's window buttons, the
 * renderer needs them to paint the page, and they have to be the same value or the first
 * image of a cold start shows the seam. Lot 1 replaces this file with the tokens of the
 * design system; until then it is the only place in the application that names a colour.
 */

export const WINDOW_BACKGROUND = '#12141a'
export const WINDOW_FOREGROUND = '#e7e9f0'

/** Height of the overlay the system draws its window buttons in, in pixels. */
export const TITLE_BAR_HEIGHT = 40
