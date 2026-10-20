/**
 * The page the gestures of the delivery rules are drawn in: Acme's settings at Delivery rules,
 * whose section holds the frames a story gives it — the section's own frames, or one redrawn with
 * the gesture — and the dialog a story opens over it.
 */
import type { ReactNode } from 'react'

import { Section, SectionRefusal } from '../../blocks/project-settings/parts.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { IconBook2, IconChecklist, IconGitMerge } from '../../icons.ts'
import {
  ProjectSettings,
  type SettingsForm,
} from '../../surfaces/project-settings/project-settings.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-sections.tsx'

export interface GesturePageProps {
  /** The dialog open over the page, or none. */
  form?: SettingsForm | null | undefined
  onCloseForm?: (() => void) | undefined
  /** What the section's head says the engine refused, in words. */
  refused?: string | undefined
  /** Whether the section's entry carries the glyph of rules refused. */
  problem?: boolean | undefined
  /** What stands under the frames, at the section's foot. */
  foot?: ReactNode
  /** The frames of the section. */
  children: ReactNode
}

export function GesturePage({
  form = null,
  onCloseForm = () => {},
  refused,
  problem = false,
  foot,
  children,
}: GesturePageProps): ReactNode {
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ProjectSettings
        name="Acme"
        mainCheckout="~/work/acme"
        sections={[
          ...SECTIONS,
          { id: 'checks', label: 'Checks', icon: <IconChecklist size="sm" /> },
          { id: 'documentation', label: 'Documentation', icon: <IconBook2 size="sm" /> },
          {
            id: 'delivery',
            label: 'Delivery rules',
            icon: <IconGitMerge size="sm" />,
            problem: problem || refused !== undefined ? 'rules refused' : undefined,
          },
        ]}
        current="delivery"
        onSection={() => {}}
        onRetry={() => {}}
        form={form}
        onCloseForm={onCloseForm}
      >
        <Section label="Delivery rules">
          <SectionHead title="Delivery rules" />
          <SectionRefusal error={refused} />
          {children}
          {foot}
        </Section>
      </ProjectSettings>
    </main>
  )
}
