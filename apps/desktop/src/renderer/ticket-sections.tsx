/**
 * The ticket sections of a Project's settings, and the others drawn by their own hooks: Tickets
 * and Specs (the providers, then the Spec settings), Exclusive resources, Checks and
 * Documentation. This file only composes them; each part has its own file.
 */

import type { Command, Project } from '@hemera/ipc'
import type { SettingsForm } from '@hemera/ui'
import type { ReactNode } from 'react'

import { ChecksPart, DocRecipesPart } from './checks-sections.tsx'
import { DeliveryPart } from './delivery-section.tsx'
import type { Link } from './link.ts'
import { ResourcesPart } from './resources-section.tsx'
import { SpecSettingsPart } from './spec-settings.tsx'
import { ProvidersPart } from './ticket-providers.tsx'

export const TICKET_SECTIONS = [
  'tickets',
  'resources',
  'checks',
  'documentation',
  'delivery',
] as const
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
  /** Opened by a link: a need about a forge's command line opens the Delivery rules. */
  linked: boolean
  /** What is wrong in the Delivery rules, for their glyph in the list. */
  onProblem: (problem: string | undefined) => void
}

/**
 * A ticket section: the providers then the Spec settings; or the exclusive resources, the checks
 * or the doc recipes.
 */
export function TicketSection({
  section,
  link,
  engineReady,
  projectId,
  project,
  catalogue,
  show,
  copy,
  linked,
  onProblem,
}: TicketSectionProps): ReactNode {
  if (section === 'delivery') {
    return (
      <DeliveryPart
        link={link}
        engineReady={engineReady}
        projectId={projectId}
        project={project}
        catalogue={catalogue}
        show={show}
        copy={copy}
        linked={linked}
        onProblem={onProblem}
      />
    )
  }
  if (section === 'checks') {
    return (
      <ChecksPart
        link={link}
        engineReady={engineReady}
        projectId={projectId}
        project={project}
        catalogue={catalogue}
        show={show}
      />
    )
  }
  if (section === 'documentation') {
    return (
      <DocRecipesPart
        link={link}
        engineReady={engineReady}
        projectId={projectId}
        project={project}
        show={show}
      />
    )
  }
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
