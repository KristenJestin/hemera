/**
 * Desktop entry point: opens the native GPUiX window of Hemera.
 *
 * The window reports its size before the platform has granted one, so the first sample is
 * discarded and the opening is announced on the first representative measurement.
 */

import { render, useWindowSize } from '@gpuix/react'
import { useEffect, useRef } from 'react'

import { t } from '../i18n/index.ts'
import { createWindowSizeGate } from '../platform/window-size.ts'

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

  return <div />
}

render(<Hemera />, { title: t('app.name') })
