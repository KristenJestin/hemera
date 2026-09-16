/**
 * The window of lot 2: the shell, composed with fixtures (design D2-01).
 *
 * There is still no data behind any of it. The Projects, the Sessions and every empty state
 * come from `fixtures.ts`, the four things the shell remembers live in a store in memory, and
 * the keyboard comes from the one table in `shortcuts.ts`. What lot 3 and lot 4 replace is
 * those three files; the shell itself never learns where any of it came from.
 *
 * The witness transition of lot 0 is still here, and it is now the one the lot measures: the
 * fold of the sidebar, which is the only dimension of the layout this application animates and
 * the one the frame counter has to keep honest (design D2-09).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import type { MotionMeasure } from '@hemera/ipc'
import { Dialog, JOURNAL_ENTRY, PROJECT_SETTINGS_ENTRY, Shell } from '@hemera/ui'

import { EMPTY, PROJECT_FIXTURES, sessionsOf } from './fixtures.ts'
import {
  persistWidthOnRelease,
  selectEntry,
  selectProject,
  selectProjectByRank,
  setCollapsed,
  setWidth,
  shellState,
  subscribeToShell,
  toggleCollapsed,
} from './shell-store.ts'
import { type ShortcutAction, keysOf, useShellShortcuts } from './shortcuts.ts'
import {
  nextThemePreference,
  setThemePreference,
  subscribeToTheme,
  themePreference,
} from './theme.ts'
import { measureFrames } from './witness.ts'

/** The panel a keystroke opens on an empty room, named after the lot that furnishes it. */
type Placeholder = 'command' | 'settings' | null

export function Application() {
  const shell = useSyncExternalStore(subscribeToShell, shellState, shellState)
  // The preference and not the resolved theme: the one control cycles through what the user
  // chose, and `system` is a choice no colour can be read back from. What the page wears is put
  // on `<html>` by the theme store itself, which is subscribed to here all the same — that is
  // what keeps the page following the desktop while the choice is `system`.
  const preference = useSyncExternalStore(
    subscribeToTheme,
    themePreference,
    () => 'system' as const,
  )
  const [placeholder, setPlaceholder] = useState<Placeholder>(null)

  const run = useCallback((action: ShortcutAction) => {
    if (action.kind === 'sidebar') {
      toggleCollapsed()
      return
    }
    if (action.kind === 'command') {
      setPlaceholder('command')
      return
    }
    if (action.kind === 'settings') {
      setPlaceholder('settings')
      return
    }
    selectProjectByRank(action.rank)
  }, [])

  useShellShortcuts(run)

  /**
   * The same act the button performs, offered to whatever drives the window from outside: the
   * report run and the end-to-end suite fold the sidebar exactly as a hand does, and count.
   *
   * The counter is started a frame before the fold on purpose. Counted from the same tick as
   * the act, the first frame of *any* animation — a transform exactly as much as a width —
   * lands on two periods of a 165 Hz display, because that frame carries React's commit and
   * the round trip that asked for it. What the lot has to keep honest is the fold, so the
   * fold is what the window counts.
   */
  const play = useCallback(async (): Promise<MotionMeasure> => {
    const counted = measureFrames()
    await new Promise(requestAnimationFrame)
    toggleCollapsed()
    return await counted
  }, [])

  useEffect(() => {
    window.hemeraWitness = { play }
  }, [play])

  // A width is written down when the hand lets go of it, not while it is being dragged.
  useEffect(persistWidthOnRelease, [])

  const sessions = sessionsOf(shell.activeProjectId)
  const session = sessions.find((one) => one.id === shell.activeEntryId)

  return (
    <Shell
      projects={PROJECT_FIXTURES}
      activeProjectId={shell.activeProjectId}
      onSelectProject={selectProject}
      onAddProject={() => setPlaceholder('command')}
      notifications={<p className="text-muted-foreground">{EMPTY.notifications}</p>}
      onOpenSettings={() => setPlaceholder('settings')}
      sessions={sessions}
      activeEntryId={shell.activeEntryId}
      onSelectEntry={selectEntry}
      onOpenCommand={() => setPlaceholder('command')}
      commandShortcut={keysOf('command')}
      collapseShortcut={keysOf('sidebar')}
      theme={preference}
      onToggleTheme={() => setThemePreference(nextThemePreference(preference))}
      collapsed={shell.collapsed}
      onCollapsedChange={setCollapsed}
      width={shell.width}
      onWidthChange={setWidth}
    >
      <section className="flex flex-col gap-2 p-6">
        <h1 className="text-2xl font-medium">{session?.title ?? headingOf(shell.activeEntryId)}</h1>
        <p className="text-muted-foreground">
          {emptyOf(shell.activeEntryId, session !== undefined)}
        </p>
      </section>
      <Dialog
        title={placeholder === 'settings' ? 'Settings' : 'Command'}
        description={placeholder === 'settings' ? EMPTY.settings : EMPTY.command}
        open={placeholder !== null}
        onOpenChange={(open) => {
          if (!open) setPlaceholder(null)
        }}
      />
    </Shell>
  )
}

/** What the content area is titled when the entry is one of the places rather than a Session. */
function headingOf(entryId: string): string {
  if (entryId === JOURNAL_ENTRY) return 'Journal'
  if (entryId === PROJECT_SETTINGS_ENTRY) return 'Project settings'
  return 'Home'
}

/** What it says underneath, which always names the lot that will fill it. */
function emptyOf(entryId: string, isSession: boolean): string {
  if (isSession) return EMPTY.sessions
  if (entryId === JOURNAL_ENTRY) return EMPTY.journal
  if (entryId === PROJECT_SETTINGS_ENTRY) return EMPTY.projectSettings
  return EMPTY.home
}
