import type { ThemePreference } from '@hemera/ipc'
import { Select } from '@hemera/ui'
import type { ReactNode } from 'react'

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export interface AppSettingsProps {
  /** The theme chosen; null while the engine has not said. */
  theme: ThemePreference | null
  onTheme: (theme: ThemePreference) => void
}

/**
 * The application's settings, for now one choice: the theme, the system's or one of the two.
 * Plain and small until these settings get their own design.
 */
export function AppSettings({ theme, onTheme }: AppSettingsProps): ReactNode {
  return (
    <div className="flex max-w-xs flex-col gap-1 px-8">
      <span className="text-sm font-medium" aria-hidden="true">
        Theme
      </span>
      <Select<ThemePreference>
        label="Theme"
        className="w-full"
        value={theme ?? undefined}
        onValueChange={onTheme}
        items={THEMES}
      />
    </div>
  )
}
