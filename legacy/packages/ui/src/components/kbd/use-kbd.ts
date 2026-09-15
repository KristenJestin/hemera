/** Behaviour of a keyboard hint: it splits a combination into the keys it names. */

export interface UseKbdOptions {
  /** A key, or a combination written with `+`, such as `shift+tab`. */
  combination: string
}

export interface KbdBehaviour {
  keys: string[]
}

export function useKbd({ combination }: UseKbdOptions): KbdBehaviour {
  return {
    keys: combination
      .split('+')
      .map((key) => key.trim())
      .filter((key) => key.length > 0),
  }
}
