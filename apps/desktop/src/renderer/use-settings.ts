import { useEffect, useState } from 'react'

import type { Link } from './link.ts'
import {
  LOADING_SETTINGS,
  followSettings,
  type Settings,
  type SettingsData,
} from './settings-data.ts'

/**
 * The settings of the Project whose settings page is shown, once the engine has answered, and
 * what the page asks of them; nothing is followed while no settings page is shown.
 */
export function useSettings(
  link: Link,
  engineReady: boolean,
  projectId: string | null,
): [SettingsData, Settings | null] {
  const [data, setData] = useState<SettingsData>(LOADING_SETTINGS)
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    if (!engineReady || projectId === null) return undefined
    const followed = followSettings(link, projectId, setData)
    setSettings(followed)
    return () => {
      followed.stop()
      setSettings(null)
      setData(LOADING_SETTINGS)
    }
  }, [link, engineReady, projectId])
  return [data, settings]
}
