/**
 * The pixel ratio of the display the window is on, as it changes.
 *
 * Read once, it says where the window started. The lot asks what happens when the window
 * crosses onto a display scaled differently, so it is re-read: a `resolution` media query
 * matches exactly one ratio, and stops matching the moment that ratio changes.
 */

import { useEffect, useState } from 'react'

export function usePixelRatio(): number {
  const [ratio, setRatio] = useState(window.devicePixelRatio)

  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`)
    const reread = (): void => {
      setRatio(window.devicePixelRatio)
    }
    query.addEventListener('change', reread)
    return () => {
      query.removeEventListener('change', reread)
    }
  }, [ratio])

  return ratio
}
