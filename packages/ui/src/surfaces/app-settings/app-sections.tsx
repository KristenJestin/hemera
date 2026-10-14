import {
  IconAdjustments,
  IconBell,
  IconBug,
  IconDatabase,
  IconPalette,
  IconShieldLock,
  IconTerminal,
} from '../../icons.ts'
import { type SettingsSection } from '../settings/settings-page.tsx'

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

export const SECTIONS: readonly (Omit<SettingsSection, 'problem'> & { id: AppSection })[] = [
  { id: 'appearance', label: 'Appearance', icon: <IconPalette size="sm" /> },
  { id: 'agents', label: 'Agents', icon: <IconTerminal size="sm" /> },
  { id: 'models', label: 'Models by role', icon: <IconAdjustments size="sm" /> },
  { id: 'hemera-auto', label: 'Hemera Auto', icon: <IconShieldLock size="sm" /> },
  { id: 'notifications', label: 'Notifications & sounds', icon: <IconBell size="sm" /> },
  { id: 'profile', label: 'Profile', icon: <IconDatabase size="sm" /> },
  { id: 'developer', label: 'Developer', icon: <IconBug size="sm" /> },
]

/** Each section's name, as a link to it says it: "Open Settings › Models by role". */
export const APP_SECTIONS: ReadonlyMap<AppSection, string> = new Map(
  SECTIONS.map((section) => [section.id, section.label]),
)
