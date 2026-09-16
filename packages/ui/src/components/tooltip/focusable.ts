import type { ReactElement } from 'react'

/**
 * What a tooltip is allowed to hang on (design D2-04).
 *
 * A tooltip that only answers the pointer is a tooltip half the users never see, so it belongs
 * to something the keyboard can land on. React's JSX types erase the tag of an element —
 * `<div />` and `<button />` are both `ReactElement<any, any>` — so the refusal cannot be
 * written in the type of the prop, and it is made by name instead, at the first render.
 */
export const UNFOCUSABLE = [
  'div',
  'span',
  'p',
  'li',
  'ul',
  'section',
  'header',
  'footer',
  'img',
  'svg',
]

/** The tag a tooltip refuses to hang on, or nothing when the element is one it accepts. */
export function refusedTag(type: ReactElement['type']): string | null {
  return UNFOCUSABLE.find((tag) => tag === type) ?? null
}
