import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Input } from '../../components/field/field.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { Tabs } from '../../components/tabs/tabs.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconLock,
  IconRefresh,
  IconShieldCheck,
  IconWorld,
} from '../../icons.ts'
import type { JiraTokenView, ProviderView } from './ticket-providers.tsx'

/**
 * What the dialogs of the ticket providers are made of: a provider's state as one glyph, the
 * command that fixes it, the Jira token's field, and the forms that add a GitHub or a Jira
 * provider. A token is taken here and handed on once; it is never given back to the field.
 */

/** Jira Cloud (REST v3, an account email and an API token) or Data Center (a personal access token). */
export type ProviderDeployment = 'cloud' | 'datacenter'

/** Whether something of a provider waits on the user: its state is not ready, or its token is not saved. */
export function providerTroubled(provider: ProviderView): boolean {
  return (
    (provider.status !== null && provider.status.state !== 'ready') ||
    (provider.token !== undefined && provider.token !== 'saved')
  )
}

/** A provider's state as one glyph, its words in its legend; a skeleton while it is read. */
export function ProviderGlyph({ provider }: { provider: ProviderView }): ReactNode {
  const { status } = provider
  if (status === null) {
    return (
      <Skeleton shape="block">
        <IconCheck size="sm" />
      </Skeleton>
    )
  }
  if (status.state === 'unreachable') {
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
  if (providerTroubled(provider)) {
    return (
      <span className="flex text-warning">
        <Legend label={status.sentence}>
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
function FixCommand({ line, onCopy }: { line: string; onCopy: (line: string) => void }): ReactNode {
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

export interface ProviderDetailsProps {
  provider: ProviderView
  /** A Jira provider's deployment and account email, which its line does not carry. */
  jira?: { deployment: ProviderDeployment; email: string | null } | undefined
  /** Whether Check again is being answered. */
  checking?: boolean | undefined
  onCheckAgain: () => void
  onCopy: (line: string) => void
  /** What replaces the read-only repositories of a GitHub provider: its form. */
  edit?: ReactNode
  /** The token field of a Jira provider. */
  token?: ReactNode
}

/**
 * A provider's dialog: its sentence, the command that fixes it with Copy, Check again, what it
 * covers and, for Jira, its deployment, its account and its token.
 */
export function ProviderDetails({
  provider,
  jira,
  checking = false,
  onCheckAgain,
  onCopy,
  edit,
  token,
}: ProviderDetailsProps): ReactNode {
  const { status } = provider
  return (
    <>
      {status !== null && (
        <div className="flex items-start gap-2 text-sm">
          <ProviderGlyph provider={provider} />
          <span className="min-w-0">{status.sentence}</span>
        </div>
      )}
      {status?.fix != null && <FixCommand line={status.fix} onCopy={onCopy} />}
      {status !== null && status.state !== 'ready' && (
        <div>
          <Button size="sm" state={checking ? 'loading' : 'idle'} onClick={onCheckAgain}>
            <IconRefresh size="sm" />
            Check again
          </Button>
        </div>
      )}
      {edit ?? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">
            {provider.kind === 'github' ? 'Repositories' : 'Project keys'}
          </dt>
          <dd className="min-w-0 font-mono text-xs break-all">{provider.scope}</dd>
          {jira !== undefined && (
            <>
              <dt className="text-muted-foreground">Deployment</dt>
              <dd>{jira.deployment === 'cloud' ? 'Cloud' : 'Data Center'}</dd>
              {jira.email !== null && (
                <>
                  <dt className="text-muted-foreground">Account email</dt>
                  <dd className="min-w-0 break-all">{jira.email}</dd>
                </>
              )}
            </>
          )}
        </dl>
      )}
      {token}
    </>
  )
}

const TOKEN_WORDS: Record<JiraTokenView, string> = {
  missing: 'No token saved',
  saved: 'Token saved in the system keyring',
  invalid: 'Jira refused the saved token',
  'storage-unavailable': 'No protected storage on this system',
}

export interface TokenFieldProps {
  status: JiraTokenView
  deployment?: ProviderDeployment | undefined
  /** Whether the token just given is being checked and kept. */
  saving?: boolean | undefined
  /** Why the last token was refused, in words. */
  refused?: string | undefined
  /** Hands the token over once; the field is empty from then on. */
  onSave: (token: string) => void
  onRemove: () => void
}

/**
 * A Jira token's field. It takes a token, hands it on and clears itself; from then on it shows
 * only where the token stands: saved, refused, or impossible to keep; never the token. Replace
 * opens the field again.
 */
export function TokenField({
  status,
  deployment = 'cloud',
  saving = false,
  refused,
  onSave,
  onRemove,
}: TokenFieldProps): ReactNode {
  const [typed, setTyped] = useState('')
  const [replacing, setReplacing] = useState(false)
  const label = deployment === 'cloud' ? 'API token' : 'Personal access token'
  const give = (): void => {
    if (typed === '') return
    onSave(typed)
    setTyped('')
    setReplacing(false)
  }
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
        value={typed}
        onValueChange={setTyped}
        error={refused}
        onKeyDown={(event) => {
          if (event.key === 'Enter') give()
        }}
        action={
          <Button variant="primary" state={saving ? 'loading' : 'idle'} onClick={give}>
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
        <Button size="sm" onClick={() => setReplacing(true)}>
          Replace
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  )
}

/** A GitHub provider as the form holds it. */
export interface GithubDraft {
  host: string
  repositories: readonly string[]
}

export interface GithubFormProps {
  draft: GithubDraft
  onChange: (draft: GithubDraft) => void
  /** The repositories of the Project whose remote points to the host, proposed, never recorded. */
  proposed: readonly string[]
}

const REPOSITORY = /^[^/\s]+\/[^/\s]+$/

/** The GitHub form: the host, and the repositories proposed from the Project's remotes, editable. */
export function GithubForm({ draft, onChange, proposed }: GithubFormProps): ReactNode {
  const [another, setAnother] = useState('')
  const [refused, setRefused] = useState<string | undefined>(undefined)
  const listed = [...proposed, ...draft.repositories.filter((one) => !proposed.includes(one))]
  const toggle = (name: string, on: boolean): void =>
    onChange({
      ...draft,
      repositories: on
        ? [...draft.repositories.filter((one) => one !== name), name]
        : draft.repositories.filter((one) => one !== name),
    })
  const add = (): void => {
    const name = another.trim()
    if (name === '') {
      setRefused(undefined)
      return
    }
    if (!REPOSITORY.test(name)) {
      setRefused('Write it as owner/repository.')
      return
    }
    setRefused(undefined)
    setAnother('')
    toggle(name, true)
  }
  return (
    <>
      <Input
        label="Host"
        icon={<IconWorld size="sm" />}
        value={draft.host}
        onValueChange={(host) => onChange({ ...draft, host })}
      />
      {listed.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Repositories it reads issues from</legend>
          {listed.map((name) => (
            <Checkbox
              key={name}
              checked={draft.repositories.includes(name)}
              onCheckedChange={(on) => toggle(name, on)}
              label={name}
            />
          ))}
        </fieldset>
      )}
      <Input
        label="Another repository"
        placeholder="owner/repository"
        value={another}
        onValueChange={setAnother}
        error={refused}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === 'Enter') add()
        }}
      />
    </>
  )
}

/** A Jira provider as the form holds it; the project keys are the text typed, split on commas on save. */
export interface JiraDraft {
  site: string
  deployment: ProviderDeployment
  email: string
  projectKeys: string
}

export interface JiraFormProps {
  draft: JiraDraft
  onChange: (draft: JiraDraft) => void
  /** The token field, drawn under the other fields of the tab chosen. */
  token: ReactNode
}

/**
 * The Jira form, Cloud or Data Center: the site (its deployment preselected from what the site
 * says, confirmed here by the tab), the account email for Cloud, the project keys, and the token.
 */
export function JiraForm({ draft, onChange, token }: JiraFormProps): ReactNode {
  const fields = (deployment: ProviderDeployment): ReactNode => (
    <div className="flex flex-col gap-4 pt-3">
      <Input
        label="Site"
        icon={<IconWorld size="sm" />}
        value={draft.site}
        onValueChange={(site) => onChange({ ...draft, site })}
      />
      {deployment === 'cloud' && (
        <Input
          label="Account email"
          value={draft.email}
          onValueChange={(email) => onChange({ ...draft, email })}
        />
      )}
      <Input
        label="Project keys"
        description="Separated by commas."
        value={draft.projectKeys}
        onValueChange={(projectKeys) => onChange({ ...draft, projectKeys })}
      />
      {token}
    </div>
  )
  return (
    <Tabs
      label="Jira deployment"
      value={draft.deployment}
      onValueChange={(deployment) => onChange({ ...draft, deployment })}
      items={[
        { value: 'cloud', label: 'Cloud', panel: fields('cloud') },
        { value: 'datacenter', label: 'Data Center', panel: fields('datacenter') },
      ]}
    />
  )
}
