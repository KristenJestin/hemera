import type { ThemePreference } from '@hemera/ipc'
import { useEffect, useState } from 'react'

import type { Link } from './link.ts'

/** The theme the user chose, null until main has answered; choosing one writes it to main. */
export function useThemePreference(
  link: Link,
  engineReady: boolean,
): [ThemePreference | null, (chosen: ThemePreference) => void] {
  const [theme, setTheme] = useState<ThemePreference | null>(null)
  useEffect(() => {
    if (!engineReady) return
    link.preferences().then(
      (preferences) => setTheme(preferences.theme),
      () => undefined,
    )
  }, [link, engineReady])
  const choose = (chosen: ThemePreference): void => {
    setTheme(chosen)
    void link.writePreferences({ theme: chosen }).catch(() => undefined)
  }
  return [theme, choose]
}
