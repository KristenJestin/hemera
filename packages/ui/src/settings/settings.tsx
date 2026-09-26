import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { cn } from 'cn'
import { LayoutGroup, motion } from 'motion/react'
import { type ReactNode, useId } from 'react'

import { AgentsSection, type AgentsSectionProps } from './agents-section.tsx'
import { ClassifierSection, type ClassifierSectionProps } from './classifier-section.tsx'
import { Button } from '../components/button/button.tsx'
import { Card } from '../components/card/card.tsx'
import { List, ListItem } from '../components/list/list.tsx'
import {
  IconArchive,
  IconDeviceDesktop,
  IconFileText,
  IconFolderOpen,
  IconMoon,
  IconRestore,
  IconSun,
} from '../icons.ts'
import { arrival, useTransition } from '../motion.ts'
import type { ThemeChoice } from '../window.ts'

/**
 * The settings of the application: what the window wears, where its data lives, and what was
 * archived out of the bar (design D4-07).
 *
 * Nothing here is computed. The Profile block says what the engine reported, word for word —
 * a page that worked out how big a database is would be a page reading a file it must not
 * open — and the two buttons hand a closed choice back to the main process, never a path.
 */
const NOTE = 'text-sm text-muted-foreground'

/** The three choices, drawn as one control: a segment, and one of them is always on. */
const SEGMENT = 'inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1'

const CHOICE =
  'relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground'

const CHOICE_ON = 'text-foreground'

/**
 * The one fill of the segment, which slides from choice to choice.
 *
 * The same thing a tab strip does, and for the same reason: three fills that swap tell the eye
 * that something changed, one fill that travels tells it where it went. It is a sibling of the
 * control and never a child, or it would be measured inside two different boxes on the way
 * across and dip between them.
 */
const CHOICE_MARK = 'absolute inset-0 rounded-md bg-card shadow-sm'

const ROW = 'flex flex-col gap-3 text-sm'

const PAIR = 'flex flex-wrap items-baseline gap-x-6 gap-y-1'

/** As wide as the longest key, so every value starts on the same column. */
const KEY = 'w-sidebar-collapse shrink-0 text-sm text-muted-foreground'

const VALUE = 'min-w-0 truncate font-mono text-sm'

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <IconDeviceDesktop size="sm" /> },
  { value: 'light', label: 'Light', icon: <IconSun size="sm" /> },
  { value: 'dark', label: 'Dark', icon: <IconMoon size="sm" /> },
]

export interface AppearanceSectionProps {
  theme: ThemeChoice
  onThemeChange: (theme: ThemeChoice) => void
}

export function AppearanceSection({ theme, onThemeChange }: AppearanceSectionProps): ReactNode {
  const transition = useTransition(arrival)
  // Scoped to this segment: two of them on a page are not one control with a mark between them.
  const group = useId()
  return (
    <Card title="Appearance">
      <RadioGroup
        className={SEGMENT}
        aria-label="Theme"
        value={theme}
        onValueChange={(next) => {
          // SAFETY: the group only ever holds the three choices it renders, and `next` is the
          // one that was chosen; Base UI types a group's value as whatever was passed.
          onThemeChange(next as ThemeChoice)
        }}
      >
        <LayoutGroup id={group}>
          {THEMES.map((choice) => (
            <span key={choice.value} className="relative flex">
              {choice.value === theme && (
                <motion.span
                  layoutId={`${group}-theme`}
                  className={CHOICE_MARK}
                  transition={transition}
                />
              )}
              <Radio.Root
                value={choice.value}
                // A real `<button>`, which is what the hand presses; told so, Base UI leaves out
                // the attributes it would have had to add for something that only looks like one.
                nativeButton
                render={<button type="button" />}
                className={cn(CHOICE, choice.value === theme && CHOICE_ON)}
              >
                {choice.icon}
                {choice.label}
              </Radio.Root>
            </span>
          ))}
        </LayoutGroup>
      </RadioGroup>
      <p className={NOTE}>
        Followed by the frame, the window buttons and every native control, not only the page.
      </p>
    </Card>
  )
}

/** Where the data folder stands, as the engine reports it and in its own words. */
export interface ProfileFacts {
  /** The folder itself, which the interface calls the Profile. */
  directory: string
  /** The database file and how big it is, already written. */
  database: string
  lastMigration: string | null
  writtenByVersion: string | null
  /** How many backups there are and which is the last, already written. */
  backups: string | null
}

export interface ProfileSectionProps {
  facts: ProfileFacts
  onOpenFolder: () => void
  onOpenDiagnostic: () => void
}

export function ProfileSection({
  facts,
  onOpenFolder,
  onOpenDiagnostic,
}: ProfileSectionProps): ReactNode {
  return (
    <Card title="Profile">
      <dl className={ROW}>
        {(
          [
            ['Folder', facts.directory],
            ['Database', facts.database],
            ['Last migration', facts.lastMigration ?? 'none yet'],
            ['Written by', facts.writtenByVersion ?? 'nobody yet'],
            ['Backups', facts.backups ?? 'none taken yet'],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className={PAIR}>
            <dt className={KEY}>{key}</dt>
            <dd className={VALUE}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onOpenFolder}>
          <IconFolderOpen size="sm" />
          Open the folder
        </Button>
        <Button variant="secondary" size="sm" onClick={onOpenDiagnostic}>
          <IconFileText size="sm" />
          Open diagnostic.log
        </Button>
      </div>
    </Card>
  )
}

export interface ArchivedProject {
  id: string
  name: string
  /** When it was archived, already written for the platform. */
  archivedAt: string
}

export interface ArchivedProjectsProps {
  projects: ArchivedProject[]
  onRestore: (id: string) => void
}

/** What was taken out of the bar, and the one way back in. */
export function ArchivedProjects({ projects, onRestore }: ArchivedProjectsProps): ReactNode {
  return (
    <Card title="Archived Projects">
      {projects.length === 0 ? (
        <p className={NOTE}>No Project has been archived. Nothing is ever deleted.</p>
      ) : (
        <List label="Archived Projects">
          {projects.map((project) => (
            <ListItem
              key={project.id}
              icon={<IconArchive size="sm" />}
              title={project.name}
              description={`archived ${project.archivedAt}`}
              trailing={
                <Button variant="secondary" size="sm" onClick={() => onRestore(project.id)}>
                  <IconRestore size="sm" />
                  Restore
                </Button>
              }
            />
          ))}
        </List>
      )}
    </Card>
  )
}

export interface SettingsProps {
  /** What the window says it is: the product, its version and its channel. */
  subtitle: string
  /** What this machine has, and the one thing the reader can do about it (design D5-18). */
  agents: AgentsSectionProps
  /** Phase-0 stories supply controlled classifier fixtures; application wiring follows the UI gate. */
  classifier?: ClassifierSectionProps | undefined
  theme: ThemeChoice
  onThemeChange: (theme: ThemeChoice) => void
  facts: ProfileFacts
  onOpenFolder: () => void
  onOpenDiagnostic: () => void
  archived: ArchivedProject[]
  onRestore: (id: string) => void
}

export function Settings({
  subtitle,
  theme,
  onThemeChange,
  facts,
  onOpenFolder,
  onOpenDiagnostic,
  agents,
  classifier,
  archived,
  onRestore,
}: SettingsProps): ReactNode {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium">Settings</h1>
        <p className={NOTE}>{subtitle}</p>
      </div>
      <AppearanceSection theme={theme} onThemeChange={onThemeChange} />
      <ProfileSection
        facts={facts}
        onOpenFolder={onOpenFolder}
        onOpenDiagnostic={onOpenDiagnostic}
      />
      <AgentsSection {...agents} />
      {classifier !== undefined && <ClassifierSection {...classifier} />}
      <ArchivedProjects projects={archived} onRestore={onRestore} />
    </div>
  )
}
