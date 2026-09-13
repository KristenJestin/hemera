/**
 * Desktop entry point: opens the native GPUiX window of Hemera.
 *
 * The embedded fonts are registered first: the renderer reads its font list once, when the
 * text system starts. The profile is then opened before the window, so a second instance is
 * refused before it can paint anything, and the window reports its size on the first
 * representative measurement.
 */

import { EMBEDDED_FONTS } from '@hemera/ui'
import { addFonts, render, useWindowSize } from '@gpuix/react'
import { useEffect, useRef } from 'react'

import { t } from '../i18n/index.ts'
import {
  embeddedFontsDirectory,
  missingFontDiagnostic,
  registerEmbeddedFonts,
} from '../platform/fonts.ts'
import { folderProblem, openInstance } from '../platform/workspace.ts'
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

function Hemera({ route, context }: HemeraProps) {
  const size = useWindowSize()
  const gate = useRef(createWindowSizeGate())
  const announced = useRef(false)
  const model = useSessions({ context, inspectFolder: folderProblem, now: Date.now })

  useEffect(() => {
    if (announced.current) return
    const measured = gate.current.accept(size)
    if (measured === null) return
    announced.current = true
    console.log(`window opened ${measured.width}x${measured.height}`)
  }, [size])

  return route === 'showcase' ? <ShowcasePage /> : <SessionsPage model={model} />
}

// A run started from the sources is a development run, whatever a package might say.
const instance = openInstance({ packaged: 'dev', development: true })
if ('kind' in instance) {
  console.error(`another instance already owns this profile (pid ${instance.owner.pid})`)
  process.exit(1)
}

const route = routeOrDefault('sessions', instance.channel)

const fonts = registerEmbeddedFonts(embeddedFontsDirectory(), addFonts)
const diagnostic = missingFontDiagnostic(fonts)
if (diagnostic !== null) console.error(diagnostic)
console.log(`fonts registered ${fonts.registered.length}/${EMBEDDED_FONTS.length}`)
console.log(`channel ${instance.channel}, route ${route}, profile ${instance.directory}`)

render(<Hemera route={route} context={instance.context} />, {
  title: windowTitleOf(t('app.name'), instance.channel),
})
