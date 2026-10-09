import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Input } from '../../components/field/field.tsx'
import { Select } from '../../components/select/select.tsx'
import { Tabs } from '../../components/tabs/tabs.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconBrandGithub,
  IconBrandJira,
  IconCheck,
  IconCopy,
  IconLock,
  IconRefresh,
  IconSettings,
  IconShieldCheck,
  IconWorld,
} from '../../icons.ts'
import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import {
  ProjectSettings,
  type SettingsForm,
  type SettingsSection,
} from '../../surfaces/project-settings/project-settings.tsx'
import {
  COMMANDS,
  type ExclusiveResource,
  type JiraDeployment,
  type JiraTokenStatus,
  LANGUAGES,
  SYNC_INTERVALS,
  type TicketProvider,
  troubled,
} from './ticket-settings-fixtures.ts'

/**
 * What the two proposals of the ticket and Spec settings share: the Project settings page around
 * them, a provider's mark and its state as a glyph, the command that fixes it, the Jira token's
 * field, and the forms that add a provider or declare a resource.
 */

/** What the user can do in these sections; both proposals offer the same gestures. */
export interface TicketSettingsActions {
  onAddGithub: () => void
  onAddJira: () => void
  onCheckAgain: (providerId: string) => void
  onRemoveProvider: (providerId: string) => void
  onSaveToken: (providerId: string) => void
  onRemoveToken: (providerId: string) => void
  onCopy: (line: string) => void
  onSpecMode: (mode: string) => void
  onSyncInterval: (minutes: string) => void
  onLanguage: (language: string) => void
  onPrefix: (prefix: string) => void
  onSaveResource: () => void
}

/** The Project settings page, under the window's header, `Acme › Settings`. */
export function SettingsWindow({
  sections,
  current,
  onSection,
  form,
  onCloseForm,
  children,
}: {
  sections: readonly SettingsSection[]
  current: string
  onSection: (id: string) => void
  form?: SettingsForm | null | undefined
  onCloseForm?: (() => void) | undefined
  children: ReactNode
}): ReactNode {
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={[
          { id: 'project', label: 'Acme', onPress: () => {} },
          { id: 'settings', label: 'Settings', icon: <IconSettings size="sm" /> },
        ]}
        controls={<SystemControls />}
      />
      <ProjectSettings
        name="Acme"
        mainCheckout="~/work/acme"
        sections={sections}
        current={current}
        onSection={onSection}
        onRetry={() => {}}
        form={form ?? null}
        onCloseForm={onCloseForm ?? (() => {})}
      >
        {children}
      </ProjectSettings>
    </main>
  )
}

/** A provider's mark: GitHub's or Jira's. */
export function ProviderMark({ kind }: { kind: TicketProvider['kind'] }): ReactNode {
  return kind === 'github' ? <IconBrandGithub size="sm" /> : <IconBrandJira size="sm" />
}

/** A provider's state as one glyph, its words in its tooltip. */
export function StatusGlyph({ provider }: { provider: TicketProvider }): ReactNode {
  if (provider.status.state === 'unreachable') {
    return (
      <span className="flex text-destructive">
        <Legend label={`Unreachable ${provider.unreachableSince ?? ''}`.trim()}>
          <IconAlertTriangle size="sm" />
        </Legend>
      </span>
    )
  }
  if (provider.token === 'storage-unavailable') {
    return (
      <span className="flex text-warning">
        <Legend label="No protected storage on this system">
          <IconLock size="sm" />
        </Legend>
      </span>
    )
  }
  if (troubled(provider)) {
    return (
      <span className="flex text-warning">
        <Legend label={provider.status.sentence}>
          <IconAlertTriangle size="sm" />
        </Legend>
      </span>
    )
  }
  return (
    <span className="flex text-success">
      <Legend label="Ready">
        <IconCheck size="sm" />
      </Legend>
    </span>
  )
}

const LINE =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md border border-border bg-surface-rim pr-1 pl-3 font-mono text-xs'

/** The command that fixes a provider, as the user runs it in their own terminal, and Copy. */
export function FixCommand({
  line,
  onCopy,
}: {
  line: string
  onCopy: (line: string) => void
}): ReactNode {
  return (
    <div className={LINE}>
      <span className="min-w-0 flex-1 truncate">{line}</span>
      <Tooltip label="Copy the command">
        <IconButton
          variant="ghost"
          size="sm"
          icon={<IconCopy size="sm" />}
          aria-label={`Copy ${line}`}
          onClick={() => onCopy(line)}
        />
      </Tooltip>
    </div>
  )
}

/** Check again: the provider's state now. */
export function CheckAgain({ onPress }: { onPress: () => void }): ReactNode {
  return (
    <Button size="sm" onClick={onPress}>
      <IconRefresh size="sm" />
      Check again
    </Button>
  )
}

const TOKEN_WORDS: Record<JiraTokenStatus, string> = {
  missing: 'No token saved',
  saved: 'Token saved in the system keyring',
  invalid: 'Jira refused the saved token',
  'storage-unavailable': 'No protected storage on this system',
}

/**
 * A Jira token's field. It takes a token and from then on shows only where it stands: saved,
 * refused, or impossible to keep; never the token. Replace opens the field again.
 */
export function TokenField({
  status,
  deployment,
  replacing = false,
  onSave,
  onRemove,
  onReplace,
}: {
  status: JiraTokenStatus
  deployment: JiraDeployment
  replacing?: boolean | undefined
  onSave: () => void
  onRemove: () => void
  onReplace?: (() => void) | undefined
}): ReactNode {
  const label = deployment === 'cloud' ? 'API token' : 'Personal access token'
  if (status === 'storage-unavailable') {
    return (
      <p className="flex items-start gap-1.5 text-sm text-warning-muted-foreground" role="status">
        <span className="flex pt-0.5 text-warning">
          <IconLock size="sm" aria-hidden="true" />
        </span>
        {TOKEN_WORDS[status]}: Hemera keeps no token it cannot protect.
      </p>
    )
  }
  if (status === 'missing' || replacing) {
    return (
      <Input
        label={label}
        secret
        placeholder="Paste the token"
        action={
          <Button variant="primary" onClick={onSave}>
            Save
          </Button>
        }
      />
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-h-control-md min-w-0 items-center gap-2">
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 text-sm',
            status === 'saved' ? 'text-muted-foreground' : 'text-destructive-muted-foreground',
          )}
        >
          <span className={cn('flex', status === 'saved' ? 'text-success' : 'text-destructive')}>
            {status === 'saved' ? (
              <IconShieldCheck size="sm" aria-hidden="true" />
            ) : (
              <IconAlertTriangle size="sm" aria-hidden="true" />
            )}
          </span>
          {TOKEN_WORDS[status]}
        </span>
        <Button size="sm" onClick={onReplace}>
          Replace
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  )
}

/** The GitHub form: the host, and the repositories proposed from the Project's remotes. */
export function GithubFields(): ReactNode {
  return (
    <>
      <Input label="Host" icon={<IconWorld size="sm" />} defaultValue="github.com" />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Repositories it reads issues from</legend>
        <Checkbox checked onCheckedChange={() => {}} label="acme/api" description="origin of api" />
        <Checkbox checked onCheckedChange={() => {}} label="acme/web" description="origin of web" />
        <Checkbox
          checked={false}
          onCheckedChange={() => {}}
          label="acme/shared"
          description="origin of shared"
        />
      </fieldset>
      <Input label="Another repository" placeholder="owner/repository" />
    </>
  )
}

/**
 * The Jira form, Cloud or Data Center: the site (its deployment preselected from what the site
 * says, confirmed here), the account email for Cloud, the project keys, and the token.
 */
export function JiraFields({
  deployment,
  onDeployment,
}: {
  deployment: JiraDeployment
  onDeployment: (deployment: JiraDeployment) => void
}): ReactNode {
  const cloud = (
    <div className="flex flex-col gap-4 pt-3">
      <Input
        label="Site"
        icon={<IconWorld size="sm" />}
        defaultValue="https://acme.atlassian.net"
      />
      <Input label="Account email" defaultValue="dev@acme.example" />
      <Input label="Project keys" defaultValue="SHOP" description="Separated by commas." />
      <TokenField status="missing" deployment="cloud" onSave={() => {}} onRemove={() => {}} />
    </div>
  )
  const datacenter = (
    <div className="flex flex-col gap-4 pt-3">
      <Input label="Site" icon={<IconWorld size="sm" />} defaultValue="https://jira.acme.example" />
      <Input label="Project keys" defaultValue="SHOP, OPS" description="Separated by commas." />
      <TokenField status="missing" deployment="datacenter" onSave={() => {}} onRemove={() => {}} />
    </div>
  )
  return (
    <Tabs
      label="Jira deployment"
      value={deployment}
      onValueChange={onDeployment}
      items={[
        { value: 'cloud', label: 'Cloud', panel: cloud },
        { value: 'datacenter', label: 'Data Center', panel: datacenter },
      ]}
    />
  )
}

/** The Spec language, the sync interval and the key prefix, as fields. */
export function SpecLanguage({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): ReactNode {
  return (
    <Select
      label="Spec language"
      items={LANGUAGES.map((one) => ({ value: one.value, label: one.label }))}
      value={value}
      onValueChange={onChange}
    />
  )
}

export function SyncInterval({
  value,
  onChange,
}: {
  value: number
  onChange: (v: string) => void
}): ReactNode {
  return (
    <Select
      label="Check linked tickets"
      items={SYNC_INTERVALS.map((one) => ({ value: one.value, label: one.label }))}
      value={String(value)}
      onValueChange={onChange}
    />
  )
}

export function KeyPrefix({
  value,
  refused,
  onChange,
}: {
  value: string
  refused?: string | undefined
  onChange: (v: string) => void
}): ReactNode {
  return (
    <Input
      label="Key prefix"
      value={value}
      onValueChange={onChange}
      error={refused}
      description={`Only the next missions change: ${value}-13 and after. ACME-12 keeps its key.`}
    />
  )
}

/** The form of a resource: its name, what it is, the commands that use it, and its restore. */
export function ResourceFields({ resource }: { resource: ExclusiveResource }): ReactNode {
  return (
    <>
      <Input label="Name" defaultValue={resource.name} />
      <Input label="What it is" defaultValue={resource.description} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Commands that use it</legend>
        {COMMANDS.map((command) => (
          <Checkbox
            key={command.id}
            checked={resource.uses.includes(command.id)}
            onCheckedChange={() => {}}
            label={command.name}
            description={command.line}
          />
        ))}
      </fieldset>
      <Select
        label="Restore command"
        items={[
          { value: 'none', label: 'None: a need opens at the start' },
          ...COMMANDS.map((one) => ({ value: one.id, label: one.name })),
        ]}
        value={resource.resetCommandId ?? 'none'}
      />
      <p className="text-xs text-muted-foreground">
        Only these commands are protected: a line an agent writes, a Chat’s command or one you run
        in your own terminal is not recognised.
      </p>
    </>
  )
}
