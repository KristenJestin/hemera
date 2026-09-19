import type { ReactNode } from 'react'

import { Settings, type ArchivedProject, type ProfileFacts } from '@hemera/ui'
import type { ThemeChoice } from '@hemera/ui/window'

/** The settings of the application (design D4-07): composed, and bound to its callbacks. */
export function SettingsPage({
  subtitle,
  theme,
  onThemeChange,
  facts,
  onOpenFolder,
  onOpenDiagnostic,
  archived,
  onRestore,
}: {
  subtitle: string
  theme: ThemeChoice
  onThemeChange: (theme: ThemeChoice) => void
  facts: ProfileFacts
  onOpenFolder: () => void
  onOpenDiagnostic: () => void
  archived: ArchivedProject[]
  onRestore: (id: string) => void
}): ReactNode {
  return (
    <Settings
      subtitle={subtitle}
      theme={theme}
      onThemeChange={onThemeChange}
      facts={facts}
      onOpenFolder={onOpenFolder}
      onOpenDiagnostic={onOpenDiagnostic}
      archived={archived}
      onRestore={onRestore}
    />
  )
}
