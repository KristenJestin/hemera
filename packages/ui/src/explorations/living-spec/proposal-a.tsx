import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconHistory,
  IconInfoCircle,
  IconPencil,
  IconRefresh,
  IconX,
} from '../../icons.ts'
import {
  HISTORY,
  type LivingDomain,
  type LivingRequirement,
  originWords,
  waitingOf,
} from './living-spec-fixtures.ts'
import {
  BeforeDomains,
  History,
  type LivingSpecViewProps,
  ReadingChip,
  Scenarios,
  LivingSpecWindow,
} from './living-spec-parts.tsx'

/**
 * The living spec, domain by domain. The domains are a list down the left, the way the settings list
 * their sections; one domain is open beside it, with its actions at its head: what is validated
 * here is always one domain, the one in sight.
 *
 * A proposed requirement is a dashed outline with no card under it, its words in the quiet tone,
 * a pencil glyph before it and the agent's doubt under it: a draft, never a fact. A re-read puts
 * what it proposes beside what holds today, two columns. A requirement's history folds open under
 * it. The limit of what Hemera sees stands under the domain's head, beside Re-read.
 */
export function LivingSpecA(props: LivingSpecViewProps): ReactNode {
  const { data } = props
  const [opened, setOpened] = useState(props.opened ?? data.domains[0]?.id ?? '')
  const names = Object.fromEntries(data.domains.map((one) => [one.id, one.name]))
  const domain = data.domains.find((one) => one.id === opened) ?? data.domains[0]
  const requirementCount = Object.values(data.requirements).reduce(
    (sum, list) => sum + list.filter((one) => !one.removed).length,
    0,
  )
  return (
    <LivingSpecWindow
      about={
        data.domains.length === 0
          ? undefined
          : `${String(data.domains.length)} domains · ${String(requirementCount)} requirements`
      }
      actions={
        <>
          <ReadingChip data={data} names={names} />
          {data.domains.length > 0 && (
            <Menu
              label="More about the living spec"
              groups={[[{ label: 'Read the whole Project again', onSelect: props.onRead }]]}
            />
          )}
        </>
      }
    >
      <BeforeDomains data={data} onRead={props.onRead} onModels={props.onModels} />
      {domain !== undefined && (
        <div className="flex min-w-0 items-start gap-8">
          <DomainList domains={data.domains} opened={domain.id} onOpen={setOpened} />
          <DomainPane
            key={domain.id}
            domain={domain}
            requirements={data.requirements[domain.id] ?? []}
            history={props.history}
            rereading={data.runs[0]?.domainId === domain.id && data.runs[0].state === 'running'}
            onValidate={props.onValidate}
            onReject={props.onReject}
            onReread={props.onReread}
            onDrop={props.onDrop}
            onOrigin={props.onOrigin}
          />
        </div>
      )}
    </LivingSpecWindow>
  )
}

const NAV = 'sticky top-0 flex w-settings-nav shrink-0 flex-col gap-0.5'

const ITEM =
  'flex min-h-control-md w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:tinted focus-ring hover-motion aria-[current=true]:bg-primary-muted aria-[current=true]:text-primary-muted-foreground'

const COUNT = 'ml-auto shrink-0 text-xs text-muted-foreground tabular-nums'

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
  domain,
  requirements,
  history,
  rereading,
  onValidate,
  onReject,
  onReread,
  onDrop,
  onOrigin,
}: {
  domain: LivingDomain
  requirements: readonly LivingRequirement[]
  history: string | undefined
  rereading: boolean
} & Pick<
  LivingSpecViewProps,
  'onValidate' | 'onReject' | 'onReread' | 'onDrop' | 'onOrigin'
>): ReactNode {
  const waiting = waitingOf(requirements)
  const live = requirements.filter((one) => !one.removed)
  return (
    <section aria-labelledby={`domain-${domain.id}`} className="flex min-w-0 flex-1 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex min-h-control-md min-w-0 items-center gap-3">
          <h2 id={`domain-${domain.id}`} className="min-w-0 truncate text-lg font-semibold">
            {domain.name}
          </h2>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {waiting.length > 0 && (
              <>
                <Tooltip label="The domain and the proposals in it become what Acme does today">
                  <Button variant="primary" size="sm" onClick={() => onValidate(domain.id)}>
                    Validate this domain
                  </Button>
                </Tooltip>
                <Tooltip label="The proposals go; what was validated stays">
                  <Button size="sm" onClick={() => onReject(domain.id)}>
                    Reject this domain
                  </Button>
                </Tooltip>
              </>
            )}
            {!rereading && (
              <Tooltip label="The agent reads the code of this domain again and proposes changes">
                <Button variant="ghost" size="sm" onClick={() => onReread(domain.id)}>
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
      </header>
      <ul className="flex flex-col gap-3" aria-label={`Requirements of ${domain.name}`}>
        {live.map((one) => (
          <li key={one.id}>
            <RequirementA
              requirement={one}
              historyOpen={history === one.id}
              onDrop={() => onDrop(one.id)}
              onOrigin={onOrigin}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The agent's doubt, in its own words, in the warning tone. */
function Doubt({ text }: { text: string }): ReactNode {
  return (
    <p className="flex max-w-measure items-start gap-1.5 text-xs text-warning-muted-foreground">
      <span className="flex pt-0.5 text-warning">
        <IconAlertTriangle size="sm" aria-hidden="true" />
      </span>
      <span>
        <span className="sr-only">The agent is not sure: </span>
        {text}
      </span>
    </p>
  )
}

const VALIDATED = 'flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4'

/** A draft: a dashed outline in the warning tone, nothing under it, its words quiet. */
const PROPOSED =
  'flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-warning p-4 text-muted-foreground'

const ID = 'font-mono text-xs text-muted-foreground'

const TEXT = 'max-w-measure text-sm text-pretty'

function Origin({
  requirement,
  onOrigin,
}: {
  requirement: LivingRequirement
  onOrigin: (missionId: string) => void
}): ReactNode {
  const { origin } = requirement
  if (origin === null) return <span className="text-xs text-muted-foreground">bootstrap</span>
  return (
    <Button variant="link" size="sm" onClick={() => onOrigin(origin.missionId)}>
      {originWords(origin)}
    </Button>
  )
}

function RequirementA({
  requirement,
  historyOpen,
  onDrop,
  onOrigin,
}: {
  requirement: LivingRequirement
  historyOpen: boolean
  onDrop: () => void
  onOrigin: (missionId: string) => void
}): ReactNode {
  const [open, setOpen] = useState(historyOpen)
  const proposed = requirement.state === 'proposed'
  const { pending } = requirement
  const head = (
    <div className="flex min-w-0 items-center gap-2">
      {proposed && (
        <span className="flex text-warning">
          <Legend label="Proposed by the agent, not validated">
            <IconPencil size="sm" />
          </Legend>
        </span>
      )}
      <span className={ID}>{requirement.id}</span>
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        ·
      </span>
      <Origin requirement={requirement} onOrigin={onOrigin} />
      <span className="ml-auto flex items-center gap-1">
        {proposed ? (
          <Tooltip label="Drop this proposed requirement">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconX size="sm" />}
              aria-label={`Drop ${requirement.id}`}
              onClick={onDrop}
            />
          </Tooltip>
        ) : (
          <Tooltip label="History">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconHistory size="sm" />}
              aria-label={`History of ${requirement.id}`}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            />
          </Tooltip>
        )}
      </span>
    </div>
  )
  const body = (
    <>
      <p className={cn(TEXT, pending?.kind === 'obsolete' && 'line-through')}>{requirement.text}</p>
      <Scenarios scenarios={requirement.scenarios} />
      {proposed && requirement.uncertainty !== '' && <Doubt text={requirement.uncertainty} />}
      {open && (
        <div className="border-t border-border pt-3">
          <History changes={HISTORY} onOrigin={onOrigin} />
        </div>
      )}
    </>
  )
  if (pending === null) {
    return (
      <article
        className={proposed ? PROPOSED : VALIDATED}
        aria-label={`${requirement.id}, ${proposed ? 'proposed' : 'validated'}`}
      >
        {head}
        {body}
      </article>
    )
  }
  // A re-read's proposal stands beside what holds today: two columns, the draft on the right.
  return (
    <div
      className="grid min-w-0 grid-cols-2 gap-3"
      aria-label={`${requirement.id}, a change proposed`}
      role="group"
    >
      <article className={VALIDATED} aria-label="Today">
        <span className="text-xs font-medium text-muted-foreground">Today</span>
        {head}
        {body}
      </article>
      <article className={PROPOSED} aria-label="Proposed">
        <span className="flex items-center gap-1.5 text-xs font-medium text-warning-muted-foreground">
          <IconPencil size="sm" aria-hidden="true" />
          {pending.kind === 'replace' ? 'Proposed instead' : 'Proposed for removal'}
        </span>
        {pending.kind === 'replace' ? (
          <>
            <p className={TEXT}>{pending.text}</p>
            <Scenarios scenarios={pending.scenarios} />
            {pending.uncertainty !== '' && <Doubt text={pending.uncertainty} />}
          </>
        ) : (
          <p className={TEXT}>{pending.reason}</p>
        )}
      </article>
    </div>
  )
}
