import { LivingSpecPage } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'
import { useLivingSpec } from './use-living-spec.ts'

export interface LivingSpecRouteProps {
  link: Link
  engineReady: boolean
  projectId: string
  projectName: string
  actions: {
    /** Opens the mission that wrote a requirement, at its Spec. */
    openOrigin: (missionKey: string) => void
    /** Opens the Project's settings at the models by role. */
    openModels: () => void
  }
}

/** A Project's living spec: read from the engine, and the user's gestures sent back to it. */
export function LivingSpecRoute({
  link,
  engineReady,
  projectId,
  projectName,
  actions,
}: LivingSpecRouteProps): ReactNode {
  const [view, gestures] = useLivingSpec(link, engineReady, projectId)
  return (
    <LivingSpecPage
      projectName={projectName}
      {...view}
      onOpenDomain={gestures.openDomain}
      onHistory={gestures.history}
      onValidate={gestures.validate}
      onReject={gestures.reject}
      onDrop={gestures.drop}
      onReread={gestures.reread}
      onRead={gestures.read}
      // A mission that is gone has no key to open.
      onOrigin={(origin) => {
        if (origin.key !== null) actions.openOrigin(origin.key)
      }}
      onModels={actions.openModels}
      onRetry={gestures.retry}
    />
  )
}
