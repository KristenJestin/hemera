/**
 * A Project, from a window that has never had one to one that has been archived (design D4-03).
 *
 * This spec runs on a data folder of its own, emptied before the run, so the first thing it
 * sees is a real first launch: no tab, no sidebar, and one thing to do. Everything after that
 * is done the way a hand does it — the Dialog, the settings, the buttons — and read back from
 * what the window shows, never from what the suite believes it asked for.
 *
 * Each suite is named after the scenario of `specs/project-workspaces/spec.md` it covers.
 *
 * The folder of `main` is typed rather than chosen, because the picker is the system's own
 * window and nothing here can press a button in it. That is exactly why the field accepts a
 * path: a Project can be created before its sources exist, and the picker is a convenience.
 *
 * What is *not* here is a restart of the application. The service drives one instance per spec
 * file and has no way to close it and start it again — `reloadSession` ends the session and
 * never hands another one back — and a second start on the same data folder steps aside, which
 * is what `data.e2e.ts` claims and checks. What a restart would prove is proven twice over all
 * the same: the page is loaded again below, and everything the window then shows has been read
 * from the data folder rather than kept in it, and the Project the window was last looking at
 * is written and read back by the engine's own suite.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { browser, expect } from '@wdio/globals'

import { e2eDataOf } from '../wdio.conf.ts'
import { active, addProject, fill, hasTab, openSettings, press, ringBell, shows } from './hand.ts'

/** Somewhere for a Project to point at, made by this spec and removed with it. */
const SOURCES = mkdtempSync(join(tmpdir(), 'hemera-e2e-sources-'))

/** The data folder this spec runs on, named after it exactly as the run named it. */
const E2E_DATA = e2eDataOf('projects.e2e.ts')

after(() => {
  rmSync(SOURCES, { recursive: true, force: true })
})

describe('Aucun Projet au démarrage', () => {
  it('shows no tab, no sidebar, and the one thing there is to do', async () => {
    const empty = await browser.execute(() => ({
      sidebar: document.querySelector('aside') !== null,
      tabs: document.querySelectorAll('header [aria-current="page"]').length,
      offered: (document.body.textContent ?? '').includes('Create your first Project'),
    }))

    expect(empty.sidebar).toBe(false)
    expect(empty.tabs).toBe(0)
    expect(empty.offered).toBe(true)
  })
})

describe('Premier Projet créé', () => {
  it('puts the tab in the bar, makes it active, and shows the Home of that Project', async () => {
    await press('Create your first Project')
    await fill('Name', 'Atlas')
    await fill('Folder of the main Workspace', SOURCES)
    await press('Create Project')
    await browser.pause(600)

    expect(await hasTab('Atlas')).toBe(true)
    // The sidebar is drawn now, and it says the Project has nothing in it yet.
    const shell = await browser.execute(() => ({
      sidebar: document.querySelector('aside') !== null,
      active: document.querySelector('header [aria-current="page"]')?.textContent?.trim() ?? '',
    }))
    expect(shell.sidebar).toBe(true)
    expect(shell.active).toContain('Atlas')
  })

  it('wrote it down, which is what the Journal of that Project says', async () => {
    await press('Journal')
    await browser.pause(400)

    expect(await shows('Project “Atlas” created')).toBe(true)
  })
})

describe('Édition durable', () => {
  it('keeps a new name, and the page is the one that says so', async () => {
    await press('Project settings')
    await fill('Name', 'Atlas II')
    await press('Save')
    await browser.pause(600)

    expect(await hasTab('Atlas II')).toBe(true)
  })

  it('survives the page being loaded again, because it was written and not remembered', async () => {
    await browser.refresh()
    await browser.pause(1200)

    // Not a restart of the application — the engine is the same process — but everything the
    // window shows has been read again from the data folder rather than kept in the page.
    expect(await hasTab('Atlas II')).toBe(true)
  })
})

describe('Deux emplacements déclarés', () => {
  it('keeps both, in the order they were added', async () => {
    await press('Project settings')
    await fill('Add a path', './sources/api')
    await press('Add a path')
    await browser.pause(400)
    await fill('Add a path', './sources/front')
    await press('Add a path')
    await browser.pause(400)

    expect(await shows('./sources/api')).toBe(true)
    expect(await shows('./sources/front')).toBe(true)
  })

  it('refuses one that climbs out of the root, and says why', async () => {
    await fill('Add a path', '../elsewhere')
    await press('Add a path')
    await browser.pause(400)

    // Refused by the field, before anything is asked of anybody: the three rules a path is
    // refused by are rules a form can check, and a refusal that took a round trip to the engine
    // to say "that climbs out" is a refusal that arrives after the next character was typed.
    expect(await shows('climbs out of the Workspace')).toBe(true)
    // And the list is left exactly as it was: two locations, not three.
    const declared = await browser.execute(
      () => (document.body.textContent ?? '').match(/\.\/sources\//g)?.length ?? 0,
    )
    expect(declared).toBe(2)
  })
})

/**
 * A second Project, and a bell with nothing in it.
 *
 * The scenario « Ligne d'un autre Projet » is not playable here, and that is the behaviour and
 * not a gap in the suite: what the user did themselves is written down already seen, and in
 * this lot everything that is written is theirs. The bell fills when something else writes —
 * an agent, a Session — which is HEM-57. Choosing a line and landing on the Project it belongs
 * to is covered where there is something to choose: `notifications.stories.tsx`.
 */
describe('Rien à voir', () => {
  it('rings on nothing at all, having watched every one of them happen', async () => {
    await addProject('Notes', SOURCES)
    expect(await hasTab('Notes')).toBe(true)

    await press('Atlas II')
    expect(await active()).toContain('Atlas II')

    const rung = await ringBell()
    expect(rung).toBe('Notifications')
    expect(await shows('Nothing to see')).toBe(true)

    // Closed again, so the panel is not left over the page the next suite presses on.
    await browser.keys(['\uE00C'])
    await browser.pause(300)
  })
})

/** Archiving asks first, so the walk is: the button, then the answer. */
async function archive(name: string): Promise<void> {
  await press(name)
  await press('Project settings')
  await press(`Archive ${name}`)
  await press('Archive it')
  await browser.pause(800)
}

describe('Archivé puis restauré', () => {
  it('takes the tab away and gives it back, with the other one left alone', async () => {
    await archive('Notes')

    expect(await hasTab('Notes')).toBe(false)
    expect(await hasTab('Atlas II')).toBe(true)

    await openSettings()
    await press('Restore')
    await browser.pause(800)

    expect(await hasTab('Notes')).toBe(true)
    // And it is gone from the archived, which is the list it was restored from.
    expect(await shows('No Project has been archived')).toBe(true)
  })
})

describe('Archiver le seul Projet', () => {
  it('takes the window back to its first launch, and the settings list what was archived', async () => {
    await archive('Notes')
    await archive('Atlas II')

    expect(await shows('Create your first Project')).toBe(true)
    expect(await hasTab('Atlas II')).toBe(false)
    expect(await hasTab('Notes')).toBe(false)

    await openSettings()
    expect(await shows('Atlas II')).toBe(true)
    expect(await shows('Notes')).toBe(true)
  })
})

describe('Ouvrir le dossier', () => {
  it('asks the system for the data folder, and for nothing the page chose', async () => {
    // The system's own call is the one thing stood in for, and only so that a run does not open
    // a file manager on the machine it happens on. What is under test is above it: which path
    // the application hands over, which is the folder the main process was started on and never
    // one the page picked.
    const opened = await browser.electron.mock('shell', 'openPath')

    await openSettings()
    await press('Open the folder')
    await browser.pause(400)

    // Asked for rather than read: what a mock holds is fetched from the main process, and a
    // call made after the last fetch is not there until the next one.
    await opened.update()
    expect(opened.mock.calls).toEqual([[E2E_DATA]])

    await opened.mockRestore()
  })
})
