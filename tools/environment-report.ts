#!/usr/bin/env node
/**
 * Environment report of the target this machine is (design D0-07).
 *
 * The report is produced by the application itself, because only a running Electron knows
 * what its GPU process decided and what each display is scaled at. This tool starts it, reads
 * what it says, and files it. What it cannot read it leaves as the application reported it:
 * a report is an observation, never a plausible reconstruction.
 *
 *   node tools/environment-report.ts            print the report of this machine
 *   node tools/environment-report.ts --write    also file it under reports/<target>/
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch } from 'node:os'
import { join, resolve } from 'node:path'

import { environmentReportSchema, type EnvironmentReport } from '@hemera/ipc'

/** Where a report is filed: one folder per target, one pair of files per run. */
export function reportPath(reportsRoot: string, report: EnvironmentReport, date: Date): string {
  const day = date.toISOString().slice(0, 19).replaceAll(':', '-')
  return join(reportsRoot, `${report.platform}-${arch()}`, day)
}

function line(label: string, value: string): string {
  return `| ${label} | ${value} |`
}

export function renderReport(report: EnvironmentReport): string {
  const lines = [
    `# Environment — ${report.platform}`,
    '',
    `Produced at ${report.producedAt}.`,
    '',
    '## System',
    '',
    '| | |',
    '|---|---|',
    line('OS version', report.osVersion),
    line('Distribution', report.distribution ?? '—'),
    line('Graphics session', report.graphics.session),
    line('Compositor', report.graphics.compositor ?? '—'),
    line('GPU process backend', report.graphics.gpuBackend ?? '—'),
    line('GPU adapter', report.graphics.device ?? '—'),
    line('Electron', report.versions.electron),
    line('Chromium', report.versions.chrome),
    line('Node', report.versions.node),
    '',
    '## Displays',
    '',
    '| Id | Size | Scale | Refresh | Primary |',
    '|---|---|---|---|---|',
    ...report.displays.map(
      (display) =>
        `| ${display.id} | ${display.width}×${display.height} | ${display.scaleFactor} | ${display.refreshRate} Hz | ${display.primary ? 'yes' : 'no'} |`,
    ),
    '',
    '## GPU',
    '',
    '| Feature | State |',
    '|---|---|',
    ...Object.entries(report.graphics.features).map(([feature, state]) => line(feature, state)),
    '',
    '## Motion',
    '',
    report.motion === null
      ? 'The witness transition was not measured during this run.'
      : `${report.motion.frames} frames at ${report.motion.refreshRate} Hz, longest frame ${report.motion.longestFrame} ms.`,
    '',
    '## Not verified by this report',
    '',
    ...(report.notVerified.length === 0
      ? ['Nothing: this report speaks for every target of the lot.']
      : report.notVerified.map((limit) => `- ${limit}`)),
    '',
  ]
  return lines.join('\n')
}

/** Starts the application in reporting mode and reads what it answered. */
export function readReportFrom(application: string, binary: string): EnvironmentReport {
  // A terminal opened inside an Electron based editor exports ELECTRON_RUN_AS_NODE, and the
  // binary would then start as a plain Node process with no window and no GPU to report on.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env
  const result = spawnSync(binary, [application, '--report'], {
    encoding: 'utf8',
    env: environment,
  })
  if (result.status !== 0) {
    throw new Error(`the application refused to report: ${result.stderr.trim()}`)
  }
  return environmentReportSchema.parse(JSON.parse(result.stdout))
}

if (import.meta.main) {
  const repository = resolve(import.meta.dirname, '..')
  const application = join(repository, 'apps', 'desktop')
  // The binary belongs to the application, not to the root: it is asked of the package that
  // installed it, so there is one pinned Electron in the repository and not two.
  const fromApplication = createRequire(join(application, 'package.json'))
  // Outside Electron the module is the path of the binary; its typing is written for the inside.
  const binary: string = fromApplication('electron')

  const report = readReportFrom(application, binary)
  console.log(renderReport(report))

  if (process.argv.includes('--write')) {
    const path = reportPath(join(repository, 'reports'), report, new Date())
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(`${path}.json`, `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(`${path}.md`, renderReport(report))
    console.log(`written ${path}.json and ${path}.md`)
  }
}
