import type { ReactNode } from 'react'

import { Empty } from '../../components/empty/empty.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { IconBrandGithub, IconBrandJira, IconChevronRight, IconPlug } from '../../icons.ts'
import { Section, SectionRefusal } from './parts.tsx'
import { ProviderGlyph, providerTroubled } from './provider-forms.tsx'

export * from './provider-forms.tsx'

/** The ticket providers a Project reads: GitHub or Jira. */
export type ProviderKind = 'github' | 'jira'

/** Where a provider stands: configured, or what is missing, or ready. */
export type ProviderState =
  | 'configured'
  | 'missing_cli'
  | 'not_authenticated'
  | 'unreachable'
  | 'ready'

/** Whether a Jira token is kept: never its value. */
export type JiraTokenView = 'missing' | 'saved' | 'invalid' | 'storage-unavailable'

/** A provider as its line and its dialog show it. */
export interface ProviderView {
  id: string
  kind: ProviderKind
  host: string
  /** What it covers: `acme/api, acme/web` or `SHOP, OPS`. */
  scope: string
  /** Null: being read. `sentence` is the trouble in words, `fix` the command that mends it. */
  status: { state: ProviderState; sentence: string; fix: string | null } | null
  /** `since 08:12`, or null. */
  unreachableSince: string | null
  token?: JiraTokenView | undefined
}

/** The props of the providers list. */
export interface TicketProvidersProps {
  /** Null: the list is on its way. */
  providers: readonly ProviderView[] | null
  error?: string | undefined
  onOpen: (id: string) => void
  onAdd: (kind: ProviderKind) => void
}

/** A provider's name as its dialog and the settings say it: `GitHub · github.com`. */
export function providerTitle(provider: ProviderView): string {
  return provider.kind === 'github' ? `GitHub · ${provider.host}` : `Jira · ${provider.host}`
}

/** What is wrong in the providers, in a few words, for the glyph in the list of sections. */
export function providerProblem(providers: readonly ProviderView[]): string | undefined {
  const one = providers.find(providerTroubled)
  return one === undefined ? undefined : `${providerTitle(one)} needs you`
}

/** The brand mark of a provider. */
export function ProviderMark({ kind }: { kind: ProviderKind }): ReactNode {
  return kind === 'github' ? <IconBrandGithub size="sm" /> : <IconBrandJira size="sm" />
}

const ROW = 'flex min-w-0 items-center gap-1 border-b border-border pl-2 last:border-b-0'

const OPEN =
  'flex min-h-control-lg w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const NAME = 'flex w-settings-name min-w-0 shrink-0 items-center gap-2 font-medium'

const SCOPE = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

const AFTER = 'ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground'

/** Add as a menu: GitHub, Jira. */
function AddMenu({ onAdd }: { onAdd: (kind: ProviderKind) => void }): ReactNode {
  return (
    <Menu
      label="Add a provider"
      groups={[
        [
          {
            label: 'GitHub',
            icon: <ProviderMark kind="github" />,
            onSelect: () => onAdd('github'),
          },
          { label: 'Jira', icon: <ProviderMark kind="jira" />, onSelect: () => onAdd('jira') },
        ],
      ]}
    />
  )
}

/** The rows' own shape while the list is on its way. */
function ProvidersLoading(): ReactNode {
  return (
    <ul aria-label="Ticket providers" aria-busy="true" className="flex flex-col p-1">
      {['one', 'two'].map((key) => (
        <li key={key} data-row-skeleton="" className={ROW}>
          <span className="flex w-6 shrink-0 justify-center">
            <Skeleton shape="block">
              <IconBrandGithub size="sm" />
            </Skeleton>
          </span>
          <span className="flex min-h-control-lg min-w-0 flex-1 items-center gap-3 px-3 py-2 text-sm">
            <span className={NAME}>
              <Skeleton>github.com</Skeleton>
            </span>
            <span className="min-w-0 flex-1 font-mono text-xs">
              <Skeleton>acme/api, acme/web</Skeleton>
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The providers section of "Tickets and Specs": a line per provider, and Add. */
export function TicketProviders({
  providers,
  error,
  onOpen,
  onAdd,
}: TicketProvidersProps): ReactNode {
  return (
    <Section label="Ticket providers">
      <SectionHead
        title="Ticket providers"
        count={providers?.length}
        actions={<AddMenu onAdd={onAdd} />}
      />
      <SectionRefusal error={error} />
      {(error === undefined || providers === null || providers.length > 0) && (
        <Frame>
          {providers === null ? (
            <ProvidersLoading />
          ) : providers.length === 0 ? (
            <Empty
              icon={<IconPlug />}
              title="No ticket provider"
              description="Missions start from what you write. Add GitHub or Jira to start one from a ticket."
            />
          ) : (
            <ul aria-label="Ticket providers" className="flex flex-col p-1">
              {providers.map((provider) => (
                <li key={provider.id} className={ROW}>
                  {/* The glyph is beside the line, not in it: its legend is a control of its own. */}
                  <span className="flex w-6 shrink-0 justify-center">
                    <ProviderGlyph provider={provider} />
                  </span>
                  <button type="button" className={OPEN} onClick={() => onOpen(provider.id)}>
                    <span className={NAME}>
                      <span className="flex shrink-0 text-muted-foreground">
                        <ProviderMark kind={provider.kind} />
                      </span>
                      <span className="truncate">{provider.host}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={SCOPE}>{provider.scope}</span>
                      {providerTroubled(provider) && provider.status !== null && (
                        <span className="truncate text-xs text-muted-foreground">
                          {provider.status.sentence}
                        </span>
                      )}
                    </span>
                    <span className={AFTER}>
                      {provider.unreachableSince !== null && (
                        <span className="text-destructive-muted-foreground">
                          unreachable {provider.unreachableSince}
                        </span>
                      )}
                      <IconChevronRight size="sm" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Frame>
      )}
    </Section>
  )
}
