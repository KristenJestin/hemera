/** Behaviour of a separator: it has none, and the hook records that it is decorative. */

export interface UseSeparatorOptions {
  orientation?: 'horizontal' | 'vertical'
}

export interface SeparatorBehaviour {
  orientation: 'horizontal' | 'vertical'
  /** A separator carries no action and never takes the focus. */
  interactive: false
}

export function useSeparator({
  orientation = 'horizontal',
}: UseSeparatorOptions = {}): SeparatorBehaviour {
  return { orientation, interactive: false }
}
