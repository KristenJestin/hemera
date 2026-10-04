/** Adding a Project in the window: its name, what is created, and where a refusal is said. */

import {
  InvalidFolder,
  InvalidProjectName,
  InvalidRepositoryPath,
  StorageFailed,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import { createRefusalOf, folderName, newProjectOf } from '../src/renderer/add-project.tsx'

const FOUND = [
  { path: 'api', chosen: true },
  { path: 'web', chosen: false },
  { path: 'services/billing', chosen: true, byHand: true },
]

describe('Adding a Project', () => {
  test('its name is its folder’s until another is written, on Linux and on Windows', () => {
    expect(folderName('/home/someone/work/acme/')).toBe('acme')
    expect(folderName('C:\\work\\Acme')).toBe('Acme')
    expect(folderName('')).toBe('')
  })

  test('the Project created takes the repositories ticked, found or added by hand', () => {
    expect(newProjectOf(' /work/acme ', ' Acme ', FOUND)).toEqual({
      name: 'Acme',
      mainCheckout: '/work/acme',
      repositories: ['api', 'services/billing'],
    })
  })

  test('a folder with nothing found and nothing added is a Project all the same', () => {
    expect(newProjectOf('/work/notes', 'notes', []).repositories).toEqual([])
  })

  test('a refusal is said where it concerns: the folder, the name, a path added by hand', () => {
    const folder = new InvalidFolder({ path: 'work', reason: 'it is not an absolute path' })
    expect(createRefusalOf(folder, FOUND)).toEqual({ folder: folder.message })
    const name = new InvalidProjectName({ name: '', reason: 'it is empty' })
    expect(createRefusalOf(name, FOUND)).toEqual({ name: name.message })
    const byHand = new InvalidRepositoryPath({
      path: 'services/billing',
      reason: 'it leaves the main checkout',
    })
    expect(createRefusalOf(byHand, FOUND)).toEqual({ byHand: byHand.message })
    const storage = new StorageFailed({ sentence: 'The data folder refused.' })
    expect(createRefusalOf(storage, FOUND)).toEqual({ foot: 'The data folder refused.' })
  })
})
