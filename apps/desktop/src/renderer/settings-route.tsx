import { type ReactNode, useCallback, useState } from 'react'

import { AgentSection } from './agent-sections.tsx'
import type { Link } from './link.ts'
import { SettingsPage, type SettingsTools } from './settings-page.tsx'
import { type SetupLaunches, useSetupOffer } from './setup-task.tsx'
import { TicketSection } from './ticket-sections.tsx'
import { useTicketProblem } from './ticket-providers.tsx'
import { useSettings } from './use-settings.ts'

interface ProjectSettingsRouteProps {
  link: Link
  engineReady: boolean
  /** The Project whose settings are shown. */
  projectId: string
  /** The section the route names, if it names one. */
  section: string | undefined
  tools: SettingsTools
  launches: SetupLaunches
  /** The Project's setup was launched from here: the window goes to the Project's page. */
  onSetUpLaunched: () => void
}

/** A Project's settings, with what they read from the engine: the page of `SettingsPage`. */
export function ProjectSettingsRoute({
  link,
  engineReady,
  projectId,
  section,
  tools,
  launches,
  onSetUpLaunched,
}: ProjectSettingsRouteProps): ReactNode {
  const ticketProblem = useTicketProblem(link, engineReady, projectId)
  /** What is wrong in the Delivery rules, said by their glyph in the list. */
  const [deliveryProblem, setDeliveryProblem] = useState<string | undefined>(undefined)
  const onDeliveryProblem = useCallback(
    (problem: string | undefined) => setDeliveryProblem(problem),
    [],
  )
  const [settingsData, settings] = useSettings(link, engineReady, projectId)
  /** How many times the Project's models by role were changed in its settings. */
  const [roleChanges, setRoleChanges] = useState(0)
  // Read each time the settings show, change Project or models by role.
  const offer = useSetupOffer(link, engineReady, projectId, `${projectId} ${String(roleChanges)}`)
  const launch = launches.of(projectId)
  const problems = new Map<string, string>()
  if (ticketProblem !== undefined) problems.set('tickets', ticketProblem)
  if (deliveryProblem !== undefined) problems.set('delivery', deliveryProblem)
  const catalogue = settingsData.catalogue.kind === 'ready' ? settingsData.catalogue.value : []
  return (
    <SettingsPage
      data={settingsData}
      settings={settings}
      tools={tools}
      section={section}
      problems={problems}
      ticketSection={(id, showForm) => (
        <TicketSection
          section={id}
          link={link}
          engineReady={engineReady}
          projectId={projectId}
          project={settingsData.project.kind === 'ready' ? settingsData.project.project : null}
          catalogue={catalogue}
          show={showForm}
          copy={tools.copy}
          // A section the route names was opened by a link: a need's, a notification's.
          linked={section === id}
          onProblem={onDeliveryProblem}
        />
      )}
      setUp={{
        // Launched, the setup is a task on the Project's page: the window goes there.
        onStart: () => {
          void launches.start(projectId).then((started) => {
            if (started) onSetUpLaunched()
          })
        },
        starting: launch.starting,
        unavailable: offer?.unavailable !== undefined,
        refused: offer?.unavailable ?? launch.refused,
      }}
      agentSection={(id, showForm) => (
        <AgentSection
          section={id}
          link={link}
          engineReady={engineReady}
          projectId={projectId}
          catalogue={catalogue}
          show={showForm}
          onRolesChanged={() => setRoleChanges((before) => before + 1)}
        />
      )}
    />
  )
}
