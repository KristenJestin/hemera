/**
 * The renderer can report a window size before the platform window has been granted one.
 * Such a sample carries no usable dimension, and taking it for the real size shrinks a
 * persisted layout at every launch, so it is refused until real dimensions arrive.
 *
 * On Windows the first sample already carries the granted size; the guard is what keeps the
 * Linux case, where the first sample precedes it, from rewriting the stored layout.
 */

export interface WindowSize {
  width: number
  height: number
}

export interface WindowSizeGate {
  /** The size to use, or null while no representative measurement has arrived. */
  accept(size: WindowSize): WindowSize | null
  /** The last representative measurement, or null while none has arrived. */
  readonly representative: WindowSize | null
}

export function createWindowSizeGate(): WindowSizeGate {
  let representative: WindowSize | null = null
  return {
    accept(size: WindowSize): WindowSize | null {
      if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return representative
      if (size.width <= 0 || size.height <= 0) return representative
      representative = size
      return representative
    },
    get representative(): WindowSize | null {
      return representative
    },
  }
}
