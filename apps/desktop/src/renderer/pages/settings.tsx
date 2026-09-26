import type { ReactNode } from 'react'

import {
  Settings,
  type AgentsSectionProps,
  type ArchivedProject,
  type ProfileFacts,
} from '@hemera/ui'
import type { ThemeChoice } from '@hemera/ui/window'

/** The settings of the application (design D4-07): composed, and bound to its callbacks. */
export function SettingsPage({
  subtitle,
  theme,
  onThemeChange,
  facts,
  onOpenFolder,
  onOpenDiagnostic,
  agents,
  archived,
  onRestore,
  acpTrace,
  onAcpTraceChange,
}: {
  subtitle: string
  theme: ThemeChoice
  onThemeChange: (theme: ThemeChoice) => void
  facts: ProfileFacts
  onOpenFolder: () => void
  onOpenDiagnostic: () => void
  /** What this machine has, and the one thing the reader can do about it. */
  agents: AgentsSectionProps
  archived: ArchivedProject[]
  onRestore: (id: string) => void
  /** Whether the ACP trace of each Session is written (#131), and the switch that says so. */
  acpTrace: boolean
  onAcpTraceChange: (on: boolean) => void
}): ReactNode {
  return (
    <Settings
      subtitle={subtitle}
      theme={theme}
      onThemeChange={onThemeChange}
      facts={facts}
      onOpenFolder={onOpenFolder}
      onOpenDiagnostic={onOpenDiagnostic}
      agents={agents}
      archived={archived}
      onRestore={onRestore}
      acpTrace={acpTrace}
      onAcpTraceChange={onAcpTraceChange}
    />
  )
}
