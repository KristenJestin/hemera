/**
 * The ticket sections of a Project's settings: Tickets and Specs (the providers, then the Spec
 * settings) and Exclusive resources. This file only composes them; each part has its own file.
 */

import type { Command, Project } from '@hemera/ipc'
import type { SettingsForm } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'
import { ResourcesPart } from './resources-section.tsx'
import { SpecSettingsPart } from './spec-settings.tsx'
import { ProvidersPart } from './ticket-providers.tsx'

export const TICKET_SECTIONS = ['tickets', 'resources'] as const
export type TicketSectionId = (typeof TICKET_SECTIONS)[number]

export const isTicketSection = (id: string): id is TicketSectionId =>
  TICKET_SECTIONS.some((one) => one === id)

export interface TicketSectionProps {
  section: TicketSectionId
  link: Link
  engineReady: boolean
  projectId: string
  project: Project | null
  catalogue: ReadonlyArray<Command>
  /** Shows a dialog over the page, or closes it with null. */
  show: (form: SettingsForm | null) => void
  copy: (text: string) => void
}

/** A ticket section: the providers then the Spec settings, or the exclusive resources. */
export function TicketSection({
  section,
  link,
  engineReady,
  projectId,
  project,
  catalogue,
  show,
  copy,
}: TicketSectionProps): ReactNode {
  if (section === 'resources') {
    return (
      <ResourcesPart
        link={link}
        engineReady={engineReady}
        projectId={projectId}
        catalogue={catalogue}
        show={show}
      />
    )
  }
  return (
    <>
      <ProvidersPart
        link={link}
        engineReady={engineReady}
        projectId={projectId}
        project={project}
        show={show}
        copy={copy}
      />
      <SpecSettingsPart
        link={link}
        engineReady={engineReady}
        projectId={projectId}
        project={project}
      />
    </>
  )
}
