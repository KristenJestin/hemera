import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconInfoCircle, IconRefresh } from '../../icons.ts'
import { Page, PageError, PageHeader } from '../page.tsx'
import { waitingOf } from './living-spec-model.ts'
import { BeforeDomains, ReadingChip } from './living-spec-parts.tsx'
import { Doubt, RequirementCard, RequirementSkeletons } from './living-spec-requirement.tsx'
import type { LivingDomain, LivingRequirement, LivingSpecPageProps } from './living-spec-types.ts'

/**
 * The living spec of a Project, domain by domain. The domains are a list down the left, the way the
 * settings list their sections; one domain is open beside it, with its actions at its head: what
 * is validated here is always one domain, the one in sight.
 *
 * A proposed requirement is a dashed outline with no card under it, its words in the quiet tone,
 * a pencil glyph before it and the agent's doubt under it: a draft, never a fact. A re-read puts
 * what it proposes beside what holds today, two columns. A requirement's history folds open under
 * it. The limit of what Hemera sees stands under the domain's head, beside Re-read.
 */
export function LivingSpecPage(props: LivingSpecPageProps): ReactNode {
  const { projectName, data, error } = props
  const names = Object.fromEntries((data?.domains ?? []).map((one) => [one.id, one.name]))
  const requirementCount = Object.values(data?.requirements ?? {}).reduce(
    (sum, list) => sum + list.filter((one) => !one.removed).length,
    0,
  )
  const domain = data?.domains.find((one) => one.id === props.opened) ?? data?.domains[0]
  return (
    <Page>
      <PageHeader
        lead={<ProjectMark name={projectName} />}
        title="Living spec"
        about={
          data === null || data.domains.length === 0
            ? undefined
            : `${String(data.domains.length)} domains · ${String(requirementCount)} requirements`
        }
        actions={
          data === null ? undefined : (
            <>
              <ReadingChip
                projectName={projectName}
                data={data}
                names={names}
                onReview={props.onOpenDomain}
                onRetry={props.onRead}
              />
              {data.domains.length > 0 && (
                <Menu
                  label="More about the living spec"
                  groups={[[{ label: 'Read the whole Project again', onSelect: props.onRead }]]}
                />
              )}
            </>
          )
        }
      />
      {data === null && error !== undefined && (
        <ErrorState
          title={`Hemera could not read the living spec of ${projectName}`}
          description={error}
          onRetry={props.onRetry}
        />
      )}
      {data === null && error === undefined && <LoadingDomains />}
      {data !== null && (
        <BeforeDomains
          projectName={projectName}
          data={data}
          onRead={props.onRead}
          onModels={props.onModels}
        />
      )}
      {data !== null && domain !== undefined && (
        <div className="flex min-w-0 items-start gap-8">
          <DomainList domains={data.domains} opened={domain.id} onOpen={props.onOpenDomain} />
          <DomainPane
            key={domain.id}
            projectName={projectName}
            domain={domain}
            requirements={data.requirements[domain.id]}
            rereading={data.runs[0]?.domainId === domain.id && data.runs[0].state === 'running'}
            props={props}
          />
        </div>
      )}
    </Page>
  )
}

const NAV = 'sticky top-0 flex w-settings-nav shrink-0 flex-col gap-0.5'

const ITEM =
  'flex min-h-control-md w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:tinted focus-ring hover-motion aria-[current=true]:bg-primary-muted aria-[current=true]:text-primary-muted-foreground'

const COUNT = 'ml-auto shrink-0 text-xs text-muted-foreground tabular-nums'

/** The first read is on its way: the list and a domain's head, as they will be. */
function LoadingDomains(): ReactNode {
  return (
    <div className="flex min-w-0 items-start gap-8">
      <nav aria-label="Domains" aria-busy="true" className={NAV}>
        {[0, 1, 2, 3].map((at) => (
          <span key={at} className={ITEM}>
            <Skeleton>Accounts and sign-in</Skeleton>
          </span>
        ))}
      </nav>
      <ul aria-busy="true" aria-label="Requirements" className="flex min-w-0 flex-1 flex-col gap-3">
        <RequirementSkeletons />
      </ul>
    </div>
  )
}

/** What a domain's line says to a screen reader after its name. */
function domainWords(domain: LivingDomain): string {
  const waits = domain.proposed + domain.pending
  return waits === 0 ? 'validated' : `${String(waits)} waiting for you`
}

function DomainList({
  domains,
  opened,
  onOpen,
}: {
  domains: readonly LivingDomain[]
  opened: string
  onOpen: (id: string) => void
}): ReactNode {
  return (
    <nav aria-label="Domains" className={NAV}>
      {domains.map((domain) => {
        const waits = domain.proposed + domain.pending
        return (
          <button
            key={domain.id}
            type="button"
            className={ITEM}
            aria-current={domain.id === opened}
            aria-label={`${domain.name}, ${domainWords(domain)}`}
            onClick={() => onOpen(domain.id)}
          >
            <StatusMark state={waits === 0 ? 'done' : 'waiting'} size="sm" />
            <span className="min-w-0 truncate">{domain.name}</span>
            <span className={COUNT}>{waits === 0 ? String(domain.validated) : String(waits)}</span>
          </button>
        )
      })}
    </nav>
  )
}

const LIMIT = 'flex items-start gap-1.5 text-xs text-muted-foreground'

function DomainPane({
  projectName,
  domain,
  requirements,
  rereading,
  props,
}: {
  projectName: string
  domain: LivingDomain
  /** Undefined: not read yet. */
  requirements: readonly LivingRequirement[] | undefined
  rereading: boolean
  props: LivingSpecPageProps
}): ReactNode {
  const { busy } = props
  const waiting = waitingOf(requirements ?? [])
  const working = busy === domain.id ? 'loading' : 'idle'
  return (
    <section aria-labelledby={`domain-${domain.id}`} className="flex min-w-0 flex-1 flex-col gap-5">
      <header className="flex flex-col gap-2">
        {/* The name keeps room for a few words and is cut short past them; when the line is too
            short for that and the actions, they go under it, never over it. */}
        <div className="flex min-h-control-md min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2
            id={`domain-${domain.id}`}
            className="min-w-0 grow basis-settings-name truncate text-lg font-semibold"
          >
            {domain.name}
          </h2>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {waiting.length > 0 && (
              <>
                <Tooltip
                  label={`The domain and the proposals in it become what ${projectName} does today`}
                >
                  <Button
                    variant="primary"
                    size="sm"
                    state={working}
                    onClick={() => props.onValidate(domain.id)}
                  >
                    Validate this domain
                  </Button>
                </Tooltip>
                <Tooltip label="The proposals go; what was validated stays">
                  <Button size="sm" state={working} onClick={() => props.onReject(domain.id)}>
                    Reject this domain
                  </Button>
                </Tooltip>
              </>
            )}
            {!rereading && (
              <Tooltip label="The agent reads the code of this domain again and proposes changes">
                <Button
                  variant="ghost"
                  size="sm"
                  state={working}
                  onClick={() => props.onReread(domain.id)}
                >
                  <IconRefresh size="sm" />
                  Re-read this domain
                </Button>
              </Tooltip>
            )}
          </span>
        </div>
        <p className="max-w-measure text-sm text-muted-foreground">{domain.summary}</p>
        {domain.uncertainty !== '' && domain.state === 'proposed' && (
          <Doubt text={domain.uncertainty} />
        )}
        <p className={LIMIT}>
          <IconInfoCircle size="sm" aria-hidden="true" />
          Hemera does not see behaviour changed outside a mission. If this domain changed by hand,
          re-read it.
        </p>
        {props.refused !== undefined && <PageError>{props.refused}</PageError>}
      </header>
      <ul
        className="flex flex-col gap-3"
        aria-label={`Requirements of ${domain.name}`}
        aria-busy={requirements === undefined}
      >
        {requirements === undefined ? (
          <RequirementSkeletons />
        ) : (
          requirements
            .filter((one) => !one.removed)
            .map((one) => (
              <li key={one.id}>
                <RequirementCard
                  requirement={one}
                  history={props.histories[one.id]}
                  busy={busy === one.id}
                  onHistory={props.onHistory}
                  onDrop={props.onDrop}
                  onOrigin={props.onOrigin}
                />
              </li>
            ))
        )}
      </ul>
    </section>
  )
}
