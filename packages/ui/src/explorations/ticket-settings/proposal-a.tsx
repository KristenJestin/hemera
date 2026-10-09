import { type ReactNode, useState } from 'react'

import { FormFoot, Section } from '../../blocks/project-settings/parts.tsx'
import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { IconChevronRight, IconDatabase, IconFileText, IconPlug, IconPlus } from '../../icons.ts'
import { SECTIONS } from '../../surfaces/project-settings/settings-fixtures.tsx'
import type { SettingsForm } from '../../surfaces/project-settings/project-settings.tsx'
import {
  type ExclusiveResource,
  type JiraDeployment,
  SPEC_MODES,
  type SpecMode,
  type TicketProvider,
  type TicketSettingsData,
  commandName,
  problemOf,
  providerName,
  scopeOf,
  troubled,
} from './ticket-settings-fixtures.ts'
import {
  CheckAgain,
  FixCommand,
  GithubFields,
  JiraFields,
  KeyPrefix,
  ProviderMark,
  ResourceFields,
  SettingsWindow,
  SpecLanguage,
  StatusGlyph,
  SyncInterval,
  type TicketSettingsActions,
  TokenField,
} from './ticket-settings-parts.tsx'

/** A form open over the page here. */
export type FormA =
  | { kind: 'provider'; id: string }
  | { kind: 'github' }
  | { kind: 'jira'; deployment: JiraDeployment }
  | { kind: 'resource'; id: string }

export interface TicketSettingsAProps extends TicketSettingsActions {
  data: TicketSettingsData
  /** The section shown first. */
  section?: 'tickets' | 'resources' | undefined
  /** The form open first. */
  form?: FormA | undefined
  /** The refusal of the last removal of a provider, in words. */
  removalRefused?: string | undefined
}

/**
 * The ticket and Spec settings, rows and dialogs, the way the base sections are written. Two sections join the
 * list: Tickets and Specs, and Exclusive resources. Each provider is one line — its mark, its
 * host, what it covers, its state as one glyph — and pressing it opens its dialog, where its
 * sentence, the command that fixes it, Check again, the Jira token and Remove are. The Spec
 * settings are four fields in one frame under the providers: the mode as a choice with what it
 * does under it, the language, the interval of the sync with its last check, and the prefix.
 */
export function TicketSettingsA(props: TicketSettingsAProps): ReactNode {
  const { data } = props
  const [current, setCurrent] = useState<string>(props.section ?? 'tickets')
  const [form, setForm] = useState<FormA | null>(props.form ?? null)
  const [deployment, setDeployment] = useState<JiraDeployment>(
    props.form?.kind === 'jira' ? props.form.deployment : 'cloud',
  )
  const sections = [
    ...SECTIONS,
    {
      id: 'tickets',
      label: 'Tickets and Specs',
      icon: <IconPlug size="sm" />,
      problem: problemOf(data.providers),
    },
    { id: 'resources', label: 'Exclusive resources', icon: <IconDatabase size="sm" /> },
  ]
  const close = (): void => setForm(null)
  const dialog = ((): SettingsForm | null => {
    if (form === null) return null
    if (form.kind === 'github') {
      return {
        title: 'Add GitHub',
        icon: <ProviderMark kind="github" />,
        body: <GithubFields />,
        footer: <FormFoot save="Add" onSave={props.onAddGithub} onCancel={close} />,
      }
    }
    if (form.kind === 'jira') {
      return {
        title: 'Add Jira',
        icon: <ProviderMark kind="jira" />,
        body: <JiraFields deployment={deployment} onDeployment={setDeployment} />,
        footer: <FormFoot save="Add" onSave={props.onAddJira} onCancel={close} />,
      }
    }
    if (form.kind === 'resource') {
      const resource = data.resources.find((one) => one.id === form.id)
      if (resource === undefined) return null
      return {
        title: resource.name,
        icon: <IconDatabase size="sm" />,
        body: <ResourceFields resource={resource} />,
        footer: (
          <FormFoot
            remove={`Remove ${resource.name}`}
            onRemove={() => {}}
            onSave={props.onSaveResource}
            onCancel={close}
          />
        ),
      }
    }
    const provider = data.providers.find((one) => one.id === form.id)
    if (provider === undefined) return null
    return {
      title: providerName(provider),
      icon: <ProviderMark kind={provider.kind} />,
      body: <ProviderDialogBody provider={provider} {...props} />,
      footer: (
        <FormFoot
          refused={props.removalRefused}
          remove="Remove this provider"
          onRemove={() => props.onRemoveProvider(provider.id)}
          onSave={close}
          onCancel={close}
        />
      ),
    }
  })()
  const label = sections.find((one) => one.id === current)?.label ?? current
  const body = ((): ReactNode => {
    switch (current) {
      case 'tickets':
        return (
          <>
            <ProvidersA
              providers={data.providers}
              onOpen={(id) => setForm({ kind: 'provider', id })}
              onAdd={(kind) =>
                setForm(
                  kind === 'github' ? { kind: 'github' } : { kind: 'jira', deployment: 'cloud' },
                )
              }
            />
            <SpecA {...props} />
          </>
        )
      case 'resources':
        return (
          <ResourcesA
            resources={data.resources}
            onOpen={(id) => setForm({ kind: 'resource', id })}
          />
        )
      default:
        return (
          <Section label={label}>
            <SectionHead title={label} />
          </Section>
        )
    }
  })()
  return (
    <SettingsWindow
      sections={sections}
      current={current}
      onSection={setCurrent}
      form={dialog}
      onCloseForm={close}
    >
      {body}
    </SettingsWindow>
  )
}

const RULE = 'border-b border-border last:border-b-0'

const ROW = 'flex min-w-0 items-center gap-1 border-b border-border pl-2 last:border-b-0'

const OPEN =
  'flex min-h-control-lg w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const NAME = 'flex w-settings-name min-w-0 shrink-0 items-center gap-2 font-medium'

const SCOPE = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

const AFTER = 'ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground'

function AddMenu({ onAdd }: { onAdd: (kind: 'github' | 'jira') => void }): ReactNode {
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

function ProvidersA({
  providers,
  onOpen,
  onAdd,
}: {
  providers: readonly TicketProvider[]
  onOpen: (id: string) => void
  onAdd: (kind: 'github' | 'jira') => void
}): ReactNode {
  return (
    <Section label="Ticket providers">
      <SectionHead
        title="Ticket providers"
        count={providers.length}
        actions={<AddMenu onAdd={onAdd} />}
      />
      <Frame>
        {providers.length === 0 ? (
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
                  <StatusGlyph provider={provider} />
                </span>
                <button type="button" className={OPEN} onClick={() => onOpen(provider.id)}>
                  <span className={NAME}>
                    <span className="flex shrink-0 text-muted-foreground">
                      <ProviderMark kind={provider.kind} />
                    </span>
                    <span className="truncate">{provider.host}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={SCOPE}>{scopeOf(provider)}</span>
                    {troubled(provider) && (
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
    </Section>
  )
}

function ProviderDialogBody({
  provider,
  onCheckAgain,
  onCopy,
  onSaveToken,
  onRemoveToken,
}: { provider: TicketProvider } & TicketSettingsActions): ReactNode {
  const [replacing, setReplacing] = useState(false)
  const { status } = provider
  return (
    <>
      <div className="flex items-start gap-2 text-sm">
        <StatusGlyph provider={provider} />
        <span className="min-w-0">{status.sentence}</span>
      </div>
      {status.fix !== null && <FixCommand line={status.fix} onCopy={onCopy} />}
      {status.state !== 'ready' && (
        <div>
          <CheckAgain onPress={() => onCheckAgain(provider.id)} />
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">
          {provider.kind === 'github' ? 'Repositories' : 'Project keys'}
        </dt>
        <dd className="min-w-0 font-mono text-xs break-all">{scopeOf(provider)}</dd>
        {provider.jira !== null && (
          <>
            <dt className="text-muted-foreground">Deployment</dt>
            <dd>{provider.jira.deployment === 'cloud' ? 'Cloud' : 'Data Center'}</dd>
            {provider.jira.email !== null && (
              <>
                <dt className="text-muted-foreground">Account email</dt>
                <dd className="min-w-0 break-all">{provider.jira.email}</dd>
              </>
            )}
          </>
        )}
      </dl>
      {provider.kind === 'jira' && provider.token !== undefined && provider.jira !== null && (
        <TokenField
          status={provider.token}
          deployment={provider.jira.deployment}
          replacing={replacing}
          onReplace={() => setReplacing(true)}
          onSave={() => onSaveToken(provider.id)}
          onRemove={() => onRemoveToken(provider.id)}
        />
      )}
    </>
  )
}

/** The remote mode is not offered until it can be used. */
const OFFERED_MODES = SPEC_MODES.filter((one) => one.value !== 'remote')

function SpecA({
  data,
  onSpecMode,
  onLanguage,
  onSyncInterval,
  onPrefix,
}: { data: TicketSettingsData } & TicketSettingsActions): ReactNode {
  const [mode, setMode] = useState<SpecMode>(data.specMode)
  const [prefix, setPrefix] = useState(data.prefix)
  const chosen = SPEC_MODES.find((one) => one.value === mode)
  return (
    <Section label="Specs">
      <SectionHead title="Specs" />
      <Frame>
        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-1.5">
            <Select
              label="Where Specs live"
              mark={<IconFileText size="sm" />}
              items={OFFERED_MODES.map((one) => ({ value: one.value, label: one.label }))}
              value={mode}
              onValueChange={(value) => {
                setMode(value)
                onSpecMode(value)
              }}
            />
            <p className="max-w-measure text-xs text-muted-foreground">{chosen?.does}</p>
          </div>
          <SpecLanguage value={data.specLanguage} onChange={onLanguage} />
          {mode !== 'local' && (
            <div className="flex flex-col gap-1.5">
              <SyncInterval value={data.syncInterval} onChange={onSyncInterval} />
              <p className="text-xs text-muted-foreground">
                {data.lastCheck === null ? 'Not checked yet' : `Last checked at ${data.lastCheck}`}
              </p>
            </div>
          )}
          <KeyPrefix
            value={prefix}
            refused={data.prefixRefused}
            onChange={(value) => {
              setPrefix(value)
              onPrefix(value)
            }}
          />
        </div>
      </Frame>
    </Section>
  )
}

function ResourcesA({
  resources,
  onOpen,
}: {
  resources: readonly ExclusiveResource[]
  onOpen: (id: string) => void
}): ReactNode {
  return (
    <Section label="Exclusive resources">
      <SectionHead
        title="Exclusive resources"
        count={resources.length}
        actions={
          <Button size="sm">
            <IconPlus size="sm" />
            Add a resource
          </Button>
        }
      />
      <Frame>
        {resources.length === 0 ? (
          <Empty
            icon={<IconDatabase />}
            title="No exclusive resource"
            description="A resource two missions must not use at once: a shared database, a sandbox account."
          />
        ) : (
          <ul aria-label="Exclusive resources" className="flex flex-col p-1">
            {resources.map((resource) => (
              <li key={resource.id} className={RULE}>
                <button type="button" className={OPEN} onClick={() => onOpen(resource.id)}>
                  <span className={NAME}>
                    <span className="flex shrink-0 text-muted-foreground">
                      <IconDatabase size="sm" />
                    </span>
                    <span className="truncate">{resource.name}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {resource.uses.map(commandName).join(', ')}
                    {resource.resetCommandId === null
                      ? ' · no restore: a need opens at the start'
                      : ` · restored by ${commandName(resource.resetCommandId)}`}
                  </span>
                  <span className={AFTER}>
                    {resource.holder !== null && (
                      <span className="text-foreground">
                        held by {resource.holder.missionKey} since {resource.holder.since}
                        {resource.queue.length > 0 && `, ${resource.queue.join(', ')} waits`}
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
      <p className="max-w-measure text-xs text-muted-foreground">
        Only the commands declared on a resource are protected. A change applies to the missions
        launched after it.
      </p>
    </Section>
  )
}
