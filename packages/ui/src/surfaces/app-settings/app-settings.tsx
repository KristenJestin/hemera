import type { ReactNode } from 'react'

import {
  IconAdjustments,
  IconBell,
  IconBug,
  IconDatabase,
  IconPalette,
  IconShieldLock,
  IconTerminal,
} from '../../icons.ts'
import { SettingsPage, type SettingsSection } from '../settings/settings-page.tsx'

/**
 * The application's settings: one page, its sections down the left, the one chosen beside them —
 * the same page as a Project's settings. A need or a notification about a setting opens its
 * section with the focus on its heading (`focus`), so the keyboard starts where the eye is led.
 * A section with something wrong in it — an agent missing, a key refused — carries its glyph in the
 * list. Archive is not here (open question 72).
 */
export type AppSection =
  | 'appearance'
  | 'agents'
  | 'models'
  | 'hemera-auto'
  | 'notifications'
  | 'profile'
  | 'developer'

const SECTIONS: readonly (Omit<SettingsSection, 'problem'> & { id: AppSection })[] = [
  { id: 'appearance', label: 'Appearance', icon: <IconPalette size="sm" /> },
  { id: 'agents', label: 'Agents', icon: <IconTerminal size="sm" /> },
  { id: 'models', label: 'Models by role', icon: <IconAdjustments size="sm" /> },
  { id: 'hemera-auto', label: 'Hemera Auto', icon: <IconShieldLock size="sm" /> },
  { id: 'notifications', label: 'Notifications & sounds', icon: <IconBell size="sm" /> },
  { id: 'profile', label: 'Profile', icon: <IconDatabase size="sm" /> },
  { id: 'developer', label: 'Developer', icon: <IconBug size="sm" /> },
]

export interface AppSettingsProps {
  current: AppSection
  onSection: (section: AppSection) => void
  /** What is wrong in a section, in words, by section. */
  problems?: Partial<Record<AppSection, string>> | undefined
  /** Whether the section was opened by a link: its heading takes the focus. */
  focus?: boolean | undefined
  /** The section chosen. */
  children: ReactNode
}

/** Gives the focus to the first heading of the section a link opened. */
const focusHeading = (node: HTMLDivElement | null): void => {
  const heading = node?.querySelector<HTMLElement>('h2, h3')
  if (heading === null || heading === undefined) return
  heading.tabIndex = -1
  heading.focus()
}

export function AppSettings({
  current,
  onSection,
  problems = {},
  focus = false,
  children,
}: AppSettingsProps): ReactNode {
  return (
    <SettingsPage
      title="Settings"
      label="Settings of Hemera"
      sections={SECTIONS.map((section) => ({ ...section, problem: problems[section.id] }))}
      current={current}
      onSection={(id) => {
        const chosen = SECTIONS.find((section) => section.id === id)
        if (chosen !== undefined) onSection(chosen.id)
      }}
      onCloseForm={() => undefined}
    >
      <div key={current} ref={focus ? focusHeading : undefined} className="flex flex-col gap-8">
        {children}
      </div>
    </SettingsPage>
  )
}
