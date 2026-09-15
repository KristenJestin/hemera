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
import { useEffect, useRef, useState } from 'react'

import * as m from '#paraglide/messages.js'
import { missingFontDiagnostic, registerEmbeddedFonts } from '#platform/fonts.ts'
import { embeddedFontLocator } from '#platform/embedded-fonts.ts'
import { folderProblem, openInstance } from '#platform/workspace.ts'
import { packagingOf } from '#platform/packaging.ts'
import { createWindowSizeGate } from '#platform/window-size.ts'
import { canReach, routeFromArguments } from '#ui/navigation.ts'
import { SessionsPage } from '#ui/sessions/sessions-page.tsx'
import { useSessions } from '#ui/sessions/use-sessions.ts'
import { ShowcasePage } from '#ui/showcase/showcase-page.tsx'
import type { Route } from '#ui/navigation.ts'
import { openDiagnosticLog } from '@hemera/runtime'
import type { Channel, StoreContext } from '@hemera/runtime'
import { windowTitleOf } from './window-title.ts'

interface HemeraProps {
  route: Route
  channel: Channel
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

function Hemera({ route, channel, context }: HemeraProps) {
  const size = useWindowSize()
  const { renderer } = useGpuix()
  // The window holds one route at a time, and the demonstration is reachable from the
  // sessions only where the channel exposes it: a prod package offers no way in at all.
  const [current, setCurrent] = useState<Route>(route)
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
    log.info(`window backend ${windowBackend()}`)
    log.info(`window opened ${measured.width}x${measured.height}`)
  }, [size])

  if (current === 'showcase') return <ShowcasePage onClose={() => setCurrent('sessions')} />
  return (
    <ThemeProvider name={model.theme} onThemeChange={model.setTheme}>
      <SessionsPage
        model={model}
        framelessWindow={FRAMELESS_WINDOW}
        {...(renderer === null ? {} : { windowCommands: renderer })}
        {...(canReach('showcase', channel) ? { onOpenShowcase: () => setCurrent('showcase') } : {})}
      />
    </ThemeProvider>
  )
}

const instance = openInstance(packagingOf())
if ('kind' in instance) {
  console.error(`another instance already owns this profile (pid ${instance.owner.pid})`)
  process.exit(1)
}

const route = routeFromArguments(Bun.argv, instance.channel)

// Every diagnostic of the start goes to the profile as well as to the console: a package
// started from a desktop icon has no console, so what is only printed is lost.
const log = openDiagnosticLog({ directory: instance.directory })

const fonts = registerEmbeddedFonts(embeddedFontLocator, addFonts)
const diagnostic = missingFontDiagnostic(fonts)
if (diagnostic !== null) log.error(diagnostic)
log.info(`fonts registered ${fonts.registered.length}/${EMBEDDED_FONTS.length}`)
log.info(`channel ${instance.channel}, route ${route}, profile ${instance.directory}`)

render(<Hemera route={route} channel={instance.channel} context={instance.context} />, {
  title: windowTitleOf(m.app_name(), instance.channel),
  titlebarTransparent: FRAMELESS_WINDOW,
})
