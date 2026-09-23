import type { ReactNode } from 'react'

import { COMMAND_TYPE_ICONS } from '../activity/command-type.ts'
import { Badge, type BadgeProps } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { IconAlertTriangle, IconGitFork, IconPlayerStop } from '../icons.ts'
import type { PortConflict, Readiness, ServiceLine } from './services-model.ts'

/**
 * The services of a Workspace, or of the Project when several Workspaces run (D8-08, D8-09,
 * D8-10).
 *
 * A service is a `serve` run, whoever started it: the agent through its tool or the reader from a
 * panel, both are the same process and both are listed here. Two Workspaces running `dev` are two
 * instances, two rows in two folders, and stopping one leaves the other running — so each row
 * names its Workspace and its folder, and its Stop names both.
 *
 * An address is offered only once it has answered (D8-09): until then it is text beside the word
 * `starting`, since a link to a server that is not listening yet is a link to an error page. A
 * port another run already holds is said with its holder, because the fix is to go and stop that
 * one. Hemera assigns no port, so it does not pretend to know which of the two is wrong.
 */
const LIST = 'flex flex-col gap-2'

const ICON = 'flex shrink-0 self-start pt-0.5 text-muted-foreground'

const BODY = 'flex min-w-0 flex-1 flex-col gap-1'

const LINE = 'flex min-w-0 flex-wrap items-center gap-2'

const NAME = 'min-w-0 truncate text-sm font-medium text-foreground'

const FOLDER = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

const QUIET = 'text-xs text-muted-foreground'

const FAILURE = 'font-mono text-xs whitespace-pre-wrap text-destructive-muted-foreground'

const NOTE = 'text-sm text-muted-foreground'

/** The address as text: what is shown while it cannot be opened yet. */
const URL_TEXT = 'min-w-0 truncate font-mono text-xs text-foreground'

/** How a run is read at a glance: the state is the word, the tone only repeats it. */
const STATE: Record<ServiceLine['state'], { word: string; tone: NonNullable<BadgeProps['tone']> }> =
  {
    running: { word: 'Running', tone: 'info' },
    stopped: { word: 'Stopped', tone: 'neutral' },
    failed: { word: 'Failed', tone: 'destructive' },
  }

/** What each readiness says beside the address (D8-09). */
const READINESS: Record<Readiness, { word: string; tone: NonNullable<BadgeProps['tone']> }> = {
  starting: { word: 'starting', tone: 'info' },
  ready: { word: 'ready', tone: 'success' },
  unanswered: { word: 'No answer after a minute; still starting', tone: 'warning' },
}

const STARTED_BY: Record<ServiceLine['startedBy'], string> = {
  agent: 'Started by the agent',
  user: 'Started by you',
}

export interface ServiceListProps {
  /** The services, as the engine lists them. */
  services: readonly ServiceLine[]
  /** Stops the chosen instance, and only that one. */
  onStop?: ((id: string) => void) | undefined
  /** Opens an address that answered, which this surface cannot do. */
  onOpenUrl?: ((url: string) => void) | undefined
  /** Where the list sits; never how it looks. */
  className?: string | undefined
}

export function ServiceList({
  services,
  onStop,
  onOpenUrl,
  className,
}: ServiceListProps): ReactNode {
  const Serve = COMMAND_TYPE_ICONS.serve
  return (
    <Card
      className={className}
      title="Services"
      description="Every serve command running here, whoever started it."
    >
      {services.length === 0 ? (
        <p className={NOTE}>No service is running. A serve command shows here once it starts.</p>
      ) : (
        <ul className={LIST} aria-label="Services">
          {services.map((service) => {
            const state = STATE[service.state]
            return (
              <li key={service.id}>
                <CardRow>
                  <span className={ICON}>
                    <Serve size="sm" aria-hidden="true" />
                  </span>
                  <div className={BODY}>
                    <div className={LINE}>
                      <span className={NAME}>{service.name}</span>
                      <Badge tone="neutral" icon={<IconGitFork size="sm" aria-hidden="true" />}>
                        {service.workspace}
                      </Badge>
                      {service.scope === 'project' && <Badge tone="neutral">project</Badge>}
                      <Badge tone={state.tone}>{state.word}</Badge>
                      {service.portless === true && <Badge tone="neutral">via portless</Badge>}
                    </div>
                    <span className={FOLDER}>{service.folder}</span>
                    {service.url !== undefined && (
                      <ServiceUrl
                        url={service.url}
                        readiness={service.readiness}
                        onOpenUrl={onOpenUrl}
                      />
                    )}
                    {service.portConflict !== undefined && (
                      <Badge
                        tone="destructive"
                        icon={<IconAlertTriangle size="sm" aria-hidden="true" />}
                        className="self-start"
                      >
                        {conflictOf(service.portConflict)}
                      </Badge>
                    )}
                    {service.state === 'failed' && service.message !== undefined && (
                      <p className={FAILURE}>{service.message}</p>
                    )}
                    <span className={QUIET}>{STARTED_BY[service.startedBy]}</span>
                  </div>
                  {service.state === 'running' && onStop !== undefined && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0 self-start"
                      aria-label={`Stop ${service.name} in ${service.workspace}`}
                      onClick={() => onStop(service.id)}
                    >
                      <IconPlayerStop size="sm" aria-hidden="true" />
                      Stop
                    </Button>
                  )}
                </CardRow>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** A port conflict as one sentence naming its holder (D8-09). */
function conflictOf({ port, holderRun, holderWorkspace }: PortConflict): string {
  return `Port ${String(port)} is held by ${holderRun} in ${holderWorkspace}`
}

export interface ServiceUrlProps {
  url: string
  readiness?: Readiness | undefined
  /** Opens the address once it is ready; without it the address stays text. */
  onOpenUrl?: ((url: string) => void) | undefined
}

/**
 * A published address and its readiness, said the same way wherever a run shows one (D8-09).
 *
 * Only a `ready` address is a link: `starting` and `unanswered` are text, because nothing is
 * listening there yet.
 */
export function ServiceUrl({ url, readiness, onOpenUrl }: ServiceUrlProps): ReactNode {
  const said = readiness === undefined ? undefined : READINESS[readiness]
  return (
    <span className={LINE}>
      {readiness === 'ready' && onOpenUrl !== undefined ? (
        <Button variant="link" size="sm" className="min-w-0" onClick={() => onOpenUrl(url)}>
          {url}
        </Button>
      ) : (
        <span className={URL_TEXT}>{url}</span>
      )}
      {said !== undefined && <Badge tone={said.tone}>{said.word}</Badge>}
    </span>
  )
}
