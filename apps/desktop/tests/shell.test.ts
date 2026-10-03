/** What the empty shell says about the engine, rendered to markup. */

import { DatabaseOpen, DatabaseRefused, type EngineStatus } from '@hemera/ipc'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { Shell } from '../src/renderer/shell.tsx'

const status = (database: EngineStatus['database']): EngineStatus => ({
  ready: true,
  version: '1.0.0',
  channel: 'dev',
  dataFolder: '/data',
  database,
})

const shown = (database: EngineStatus['database']) =>
  renderToStaticMarkup(
    createElement(Shell, {
      engine: { kind: 'ready', status: status(database) },
      onRelaunch: () => undefined,
    }),
  )

describe('The shell and the data folder', () => {
  test('a data folder the engine could not open is shown as its sentence', () => {
    const sentence =
      'This data folder was written by a newer version of Hemera and cannot be opened by this one.'
    expect(shown(DatabaseRefused.make({ sentence }))).toContain(`<p role="alert">${sentence}</p>`)
  })

  test('an open data folder says nothing', () => {
    const open = DatabaseOpen.make({
      lastMigration: null,
      writtenByVersion: '1.0.0',
      backups: { count: 0, latest: null },
      reconciliation: 'none',
    })
    expect(shown(open)).not.toContain('role="alert"')
  })
})
