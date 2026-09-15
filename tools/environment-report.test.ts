import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import type { EnvironmentReport } from '@hemera/ipc'

import { renderReport, reportPath } from './environment-report.ts'

const windowsReport: EnvironmentReport = {
  platform: 'windows',
  osVersion: 'Windows 11 Pro (10.0.26200)',
  distribution: null,
  graphics: {
    session: 'win32',
    compositor: null,
    gpuBackend: null,
    device: 'NVIDIA GeForce RTX 3070 Ti',
    features: { gpu_compositing: 'enabled', rasterization: 'enabled' },
  },
  displays: [
    { id: 1, width: 1920, height: 1080, scaleFactor: 1.5, refreshRate: 165, primary: true },
  ],
  versions: { electron: '44.3.0', chrome: '152.0.7977.78', node: '24.20.0' },
  motion: null,
  notVerified: ['linux/wayland: not verified by this report'],
  producedAt: '2026-09-15T11:00:00.000Z',
}

describe('Rapport Windows', () => {
  test('the report names the system, each display, the GPU state and the three versions', () => {
    const table = renderReport(windowsReport)
    expect(table).toContain('Windows 11 Pro (10.0.26200)')
    expect(table).toContain('1920×1080')
    expect(table).toContain('1.5')
    expect(table).toContain('165 Hz')
    expect(table).toContain('NVIDIA GeForce RTX 3070 Ti')
    expect(table).toContain('gpu_compositing')
    expect(table).toContain('44.3.0')
    expect(table).toContain('152.0.7977.78')
    expect(table).toContain('24.20.0')
  })

  test('it says out loud which target it does not speak for', () => {
    expect(renderReport(windowsReport)).toContain('linux/wayland: not verified by this report')
  })

  test('a report that verified everything says so rather than leaving the section empty', () => {
    const complete = renderReport({ ...windowsReport, notVerified: [] })
    expect(complete).toContain('speaks for every target')
  })

  test('a run that did not measure the transition says so instead of inventing a number', () => {
    expect(renderReport(windowsReport)).toContain('was not measured during this run')
    const measured = renderReport({
      ...windowsReport,
      motion: { refreshRate: 165, frames: 200, longestFrame: 9.2 },
    })
    expect(measured).toContain('200 frames at 165 Hz, longest frame 9.2 ms')
  })

  test('a report is filed under its own target, one pair of files per run', () => {
    const path = reportPath('reports', windowsReport, new Date('2026-09-15T11:00:00.000Z'))
    expect(path.startsWith(join('reports', 'windows-'))).toBe(true)
    expect(path.endsWith('2026-09-15T11-00-00')).toBe(true)
  })
})

describe('Rapport Linux', () => {
  test('a Linux report carries the distribution, the session and the compositor', () => {
    const table = renderReport({
      ...windowsReport,
      platform: 'linux',
      distribution: 'Arch Linux',
      graphics: {
        session: 'wayland',
        compositor: 'Hyprland',
        gpuBackend: 'wayland',
        device: 'AMD Radeon Graphics',
        features: { gpu_compositing: 'enabled' },
      },
      notVerified: ['windows: not verified by this report'],
    })
    expect(table).toContain('Arch Linux')
    expect(table).toContain('wayland')
    expect(table).toContain('Hyprland')
    expect(table).toContain('windows: not verified by this report')
  })
})
