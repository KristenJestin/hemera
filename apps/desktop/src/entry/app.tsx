/**
 * The application itself, from the instance lock to the first window.
 *
 * It is imported by `main.tsx` rather than started directly: loading it is what loads the
 * renderer addon, and a machine missing a system library fails there, before anything of this
 * file runs.
 *
 * The embedded fonts are registered first: the renderer reads its font list once, when the
 * text system starts. The profile is then opened before the window, so a second instance is
 * refused before it can paint anything, and the window reports its size on the first
 * representative measurement.
 */

import { EMBEDDED_FONTS, ThemeProvider } from '@hemera/ui'
import { addFonts, render, useGpuix, useWindowSize, windowBackend } from '@gpuix/react'
import { useEffect, useRef } from 'react'

import { t } from '../i18n/index.ts'
import { missingFontDiagnostic, registerEmbeddedFonts } from '../platform/fonts.ts'
import { embeddedFontLocator } from '../platform/embedded-fonts.ts'
import { folderProblem, openInstance } from '../platform/workspace.ts'
import { packagingOf } from '../platform/packaging.ts'
import { createWindowSizeGate } from '../platform/window-size.ts'
import { routeOrDefault } from '../ui/navigation.ts'
import { SessionsPage } from '../ui/sessions/sessions-page.tsx'
import { useSessions } from '../ui/sessions/use-sessions.ts'
import { ShowcasePage } from '../ui/showcase/showcase-page.tsx'
import type { Route } from '../ui/navigation.ts'
import type { StoreContext } from '@hemera/runtime'
import { windowTitleOf } from './window-title.ts'

interface HemeraProps {
  route: Route
  context: StoreContext
}

/**
 * The window is opened without its native frame, so the projects bar is the title bar.
 *
 * The decision is not taken here: the shell reads what the renderer actually exposes and
 * falls back to the system bar when anything is missing, so a renderer without the window
 * commands never leaves a window that cannot be moved or closed.
 */
const FRAMELESS_WINDOW = true

function Hemera({ route, context }: HemeraProps) {
  const size = useWindowSize()
  const { renderer } = useGpuix()
  const gate = useRef(createWindowSizeGate())
  const announced = useRef(false)
  const model = useSessions({ context, inspectFolder: folderProblem, now: Date.now })

  useEffect(() => {
    if (announced.current) return
    const measured = gate.current.accept(size)
    if (measured === null) return
    announced.current = true
    // The backend is announced beside the size, on its own line: the headless client answers
    // with the nominal size it was asked for, so the measurement alone does not say a window
    // was opened, and only the name of the backend that opened it does.
    console.log(`window backend ${windowBackend()}`)
    console.log(`window opened ${measured.width}x${measured.height}`)
  }, [size])

  if (route === 'showcase') return <ShowcasePage />
  return (
    <ThemeProvider name={model.theme} onThemeChange={model.setTheme}>
      <SessionsPage
        model={model}
        framelessWindow={FRAMELESS_WINDOW}
        {...(renderer === null ? {} : { windowCommands: renderer })}
      />
    </ThemeProvider>
  )
}

const instance = openInstance(packagingOf())
if ('kind' in instance) {
  console.error(`another instance already owns this profile (pid ${instance.owner.pid})`)
  process.exit(1)
}

const route = routeOrDefault('sessions', instance.channel)

const fonts = registerEmbeddedFonts(embeddedFontLocator, addFonts)
const diagnostic = missingFontDiagnostic(fonts)
if (diagnostic !== null) console.error(diagnostic)
console.log(`fonts registered ${fonts.registered.length}/${EMBEDDED_FONTS.length}`)
console.log(`channel ${instance.channel}, route ${route}, profile ${instance.directory}`)

render(<Hemera route={route} context={instance.context} />, {
  title: windowTitleOf(t('app.name'), instance.channel),
  titlebarTransparent: FRAMELESS_WINDOW,
})
