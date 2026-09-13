/**
 * Desktop entry point: opens the native GPUiX window of Hemera.
 *
 * The embedded fonts are registered first: the renderer reads its font list once, when the
 * text system starts. The window then reports its size before the platform has granted one,
 * so the opening is announced on the first representative measurement.
 */

import { EMBEDDED_FONTS } from '@hemera/ui'
import { addFonts, render, useWindowSize } from '@gpuix/react'
import { useEffect, useRef } from 'react'

import { t } from '../i18n/index.ts'
import { resolveChannel } from '../platform/channel.ts'
import {
  embeddedFontsDirectory,
  missingFontDiagnostic,
  registerEmbeddedFonts,
} from '../platform/fonts.ts'
import { createWindowSizeGate } from '../platform/window-size.ts'
import { routeOrDefault } from '../ui/navigation.ts'
import { ShowcasePage } from '../ui/showcase/showcase-page.tsx'
import { windowTitleOf } from './window-title.ts'

function Hemera() {
  const size = useWindowSize()
  const gate = useRef(createWindowSizeGate())
  const announced = useRef(false)

  useEffect(() => {
    if (announced.current) return
    const measured = gate.current.accept(size)
    if (measured === null) return
    announced.current = true
    console.log(`window opened ${measured.width}x${measured.height}`)
  }, [size])

  // Until the session screens land, the development package opens on the catalogue.
  return <ShowcasePage />
}

// A run started from the sources is a development run, whatever a package might say.
const channel = resolveChannel({ packaged: 'dev', env: process.env, development: true })
const route = routeOrDefault('showcase', channel)

const fonts = registerEmbeddedFonts(embeddedFontsDirectory(), addFonts)
const diagnostic = missingFontDiagnostic(fonts)
if (diagnostic !== null) console.error(diagnostic)
console.log(`fonts registered ${fonts.registered.length}/${EMBEDDED_FONTS.length}`)
console.log(`channel ${channel}, route ${route}`)

render(<Hemera />, { title: windowTitleOf(t('app.name'), channel) })
