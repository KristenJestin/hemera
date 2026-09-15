/**
 * The window of lot 0: a drag strip beside the system's window buttons, a witness text whose
 * sharpness at a fractional scale is what the lot verifies, and one transition to measure.
 * The interface itself belongs to lots 1 and 2.
 */

import { MotionConfig, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'

import type { MotionMeasure } from '@hemera/ipc'

import { calmSpring } from './motion.ts'
import { usePixelRatio } from './use-pixel-ratio.ts'
import { measureFrames } from './witness.ts'

export function Application() {
  const ratio = usePixelRatio()
  const [shown, setShown] = useState(false)
  const [measure, setMeasure] = useState<MotionMeasure | null>(null)

  const play = useCallback(async (): Promise<MotionMeasure> => {
    setShown((previous) => !previous)
    const measured = await measureFrames()
    setMeasure(measured)
    return measured
  }, [])

  // The same act the button performs, offered to whatever drives the window from outside:
  // the report run and the end-to-end suite trigger the transition exactly as a hand does.
  useEffect(() => {
    window.hemeraWitness = { play }
  }, [play])

  return (
    <MotionConfig reducedMotion="user">
      <header className="title-bar">
        <span>Hemera</span>
        <span>— drag this strip to move the window</span>
      </header>
      <main className="page">
        <h1>Witness text</h1>
        <p>
          Read this line at 100% and at 150%, and compare the edges of the glyphs. Page pixel ratio:{' '}
          <output className="ratio">{ratio}</output>.
        </p>
        <button className="no-drag" type="button" onClick={() => void play()}>
          Play the witness transition
        </button>
        <motion.section
          className="witness"
          initial={false}
          animate={{ opacity: shown ? 1 : 0.15, y: shown ? 0 : 24 }}
          transition={calmSpring}
        >
          <p>This panel slides and fades, and nothing else.</p>
        </motion.section>
        {measure !== null && (
          <p className="measure">
            {measure.frames} frames at {measure.refreshRate} Hz, longest frame{' '}
            {measure.longestFrame} ms.
          </p>
        )}
      </main>
    </MotionConfig>
  )
}
