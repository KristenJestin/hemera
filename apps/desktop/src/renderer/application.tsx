/**
 * The window of lot 0, wearing the design system of lot 1 (design D1-08).
 *
 * It is still not an interface: a drag strip beside the system's window buttons, a witness text
 * whose sharpness at a fractional scale is what lot 0 verifies, and one transition to measure.
 * What changed is that nothing here names a colour or a size any more, and the two controls it
 * has are components of the catalogue. The interface itself belongs to lot 2.
 */

import { MotionConfig, motion } from 'motion/react'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import type { MotionMeasure } from '@hemera/ipc'
import { Badge, Button, IconButton } from '@hemera/ui'
import { IconMoon, IconPlayerPlay, IconSun } from '@hemera/ui/icons'
import { useTransition } from '@hemera/ui/motion'

import { currentTheme, setThemePreference, subscribeToTheme } from './theme.ts'
import { usePixelRatio } from './use-pixel-ratio.ts'
import { measureFrames } from './witness.ts'

export function Application() {
  const ratio = usePixelRatio()
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => 'light' as const)
  const transition = useTransition()
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
    // The design system answers the reduced-motion preference in its own preset; `user` keeps
    // motion's own answer underneath, for any element that would forget the hook.
    <MotionConfig reducedMotion="user">
      <header className="title-bar flex items-center gap-4 px-4">
        <span className="font-medium">Hemera</span>
        <span className="text-muted-foreground">— drag this strip to move the window</span>
      </header>
      <main className="flex flex-col items-start gap-4 p-6 pt-16">
        <h1 className="text-2xl font-medium">Witness text</h1>
        <p>
          Read this line at 100% and at 150%, and compare the edges of the glyphs. Page pixel ratio:{' '}
          <output className="font-mono">{ratio}</output>.
        </p>
        <div className="no-drag flex items-center gap-2">
          <Button variant="primary" onClick={() => void play()}>
            <IconPlayerPlay size="sm" />
            Play the witness transition
          </Button>
          <IconButton
            variant="ghost"
            icon={theme === 'dark' ? <IconSun /> : <IconMoon />}
            aria-label={theme === 'dark' ? 'Use the light theme' : 'Use the dark theme'}
            onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
          />
        </div>
        <motion.section
          className="w-full rounded-lg border border-border bg-card p-4 will-change-transform"
          initial={false}
          animate={{ opacity: shown ? 1 : 0.15, y: shown ? 0 : 24 }}
          transition={transition}
        >
          <p>This panel slides and fades, and nothing else.</p>
        </motion.section>
        {measure !== null && (
          <Badge tone="info">
            {measure.frames} frames at {measure.refreshRate} Hz, longest frame{' '}
            {measure.longestFrame} ms
          </Badge>
        )}
      </main>
    </MotionConfig>
  )
}
