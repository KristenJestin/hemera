import {
  IconAdjustments,
  IconBook2,
  IconChecklist,
  IconDatabase,
  IconFileText,
  IconGauge,
  IconGitBranch,
  IconListNumbers,
  IconPlayerPlay,
  IconSettings,
  IconStack2,
  IconTerminal,
  IconVariable,
} from '../../icons.ts'
import type { SettingsSection } from './project-settings.tsx'

export type SectionId =
  | 'repositories'
  | 'workspaces'
  | 'commands'
  | 'preparation'
  | 'variables'
  | 'services'
  | 'models'
  | 'budget'
  | 'instructions'

export const SECTIONS: readonly SettingsSection[] = [
  { id: 'repositories', label: 'Repositories', icon: <IconGitBranch size="sm" /> },
  { id: 'workspaces', label: 'Workspaces', icon: <IconStack2 size="sm" /> },
  { id: 'commands', label: 'Commands', icon: <IconTerminal size="sm" /> },
  { id: 'preparation', label: 'Preparation', icon: <IconListNumbers size="sm" /> },
  { id: 'variables', label: 'Variables', icon: <IconVariable size="sm" /> },
  { id: 'services', label: 'Services', icon: <IconPlayerPlay size="sm" /> },
  { id: 'models', label: 'Models by role', icon: <IconAdjustments size="sm" /> },
  { id: 'budget', label: 'Cap and budget', icon: <IconGauge size="sm" /> },
  { id: 'instructions', label: 'Instructions', icon: <IconFileText size="sm" /> },
]

/** The sections later slices add to the same frame: fourteen in all. */
export const LATER_SECTIONS: readonly SettingsSection[] = [
  { id: 'tickets', label: 'Tickets and Specs', icon: <IconStack2 size="sm" /> },
  { id: 'resources', label: 'Exclusive resources', icon: <IconDatabase size="sm" /> },
  { id: 'checks', label: 'Checks', icon: <IconChecklist size="sm" /> },
  { id: 'documentation', label: 'Documentation', icon: <IconBook2 size="sm" /> },
  { id: 'delivery', label: 'Delivery rules', icon: <IconSettings size="sm" /> },
]
