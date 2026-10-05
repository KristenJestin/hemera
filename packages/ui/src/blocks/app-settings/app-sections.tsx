import type { ReactNode } from 'react'

import { AlertDialog } from '../../components/alert-dialog/alert-dialog.tsx'
import { Button } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconCloudDownload,
  IconCopy,
  IconFolder,
  IconShieldLock,
} from '../../icons.ts'

/**
 * The sections of the application's settings: Appearance, Agents, Models by role, Hemera Auto,
 * Notifications & sounds, Profile, Developer. Each is its head above a frame of rows; a row is what
 * it sets on the left and its value or its control on the right. States are glyphs with their
 * legend, never a sentence; what cannot be done is not drawn.
 */

const ROW =
  'flex min-h-control-lg min-w-0 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0'
const NAME = 'min-w-0 flex-1 text-sm'
const DETAIL = 'block truncate text-xs text-muted-foreground'
const VALUE = 'flex min-w-0 shrink-0 items-center gap-2 text-sm'
const MONO = 'min-w-0 truncate font-mono text-xs'

/** A row: what it sets, under it a detail, and its value or control at the end. */
function Row({
  name,
  detail,
  children,
}: {
  name: ReactNode
  detail?: ReactNode
  children?: ReactNode
}): ReactNode {
  return (
    <div className={ROW}>
      <span className={NAME}>
        {name}
        {detail !== undefined && <span className={DETAIL}>{detail}</span>}
      </span>
      {children !== undefined && <span className={VALUE}>{children}</span>}
    </div>
  )
}

/** A section: its head, focusable when a link leads to it, above its frame of rows. */
function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <SectionHead title={title} />
      <Frame>{children}</Frame>
    </section>
  )
}

/** A state as its mark, its words in the legend. */
function Mark({ state, label }: { state: MarkState; label: string }): ReactNode {
  return (
    <Legend label={label}>
      <span className="inline-flex" aria-hidden="true">
        <StatusMark state={state} size="sm" />
      </span>
    </Legend>
  )
}

/** A command to type, with the button that copies it. */
function Command({ line, onCopy }: { line: string; onCopy: () => void }): ReactNode {
  return (
    <>
      <code className={MONO}>{line}</code>
      <Button size="sm" variant="ghost" aria-label={`Copy ${line}`} onClick={onCopy}>
        <IconCopy size="sm" aria-hidden="true" />
      </Button>
    </>
  )
}

// --- Appearance --------------------------------------------------------------------------------

export type Theme = 'system' | 'light' | 'dark'
export type Density = 'comfortable' | 'compact'

export interface AppearanceProps {
  theme: Theme
  density: Density
  language: string
  languages: readonly string[]
  onTheme: (theme: Theme) => void
  onDensity: (density: Density) => void
  onLanguage: (language: string) => void
}

export function AppearanceSection(props: AppearanceProps): ReactNode {
  return (
    <Section title="Appearance">
      <Row name="Theme">
        <Select<Theme>
          label="Theme"
          value={props.theme}
          onValueChange={props.onTheme}
          items={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Row>
      <Row name="Density">
        <Select<Density>
          label="Density"
          value={props.density}
          onValueChange={props.onDensity}
          items={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Row>
      <Row name="Interface language">
        <Select<string>
          label="Interface language"
          value={props.language}
          onValueChange={props.onLanguage}
          items={props.languages.map((language) => ({ value: language, label: language }))}
        />
      </Row>
    </Section>
  )
}

// --- Agents ------------------------------------------------------------------------------------

export type AgentRowState =
  | {
      installed: true
      version: string
      signedIn: boolean
      signIn: string
      /** The tool that installed it (`vp`, `npm`, `brew`…), or nothing when Hemera cannot tell. */
      installer?: string | undefined
      /**
       * The newer version published, if any: Hemera reads it by itself, so the row says the agent
       * is out of date before anyone asks. Updated in place only when the installer is known.
       */
      update?: string | undefined
      /** Why bare mode is refused on this system, or nothing when it is qualified. */
      bareRefused?: string | undefined
    }
  | { installed: false; install: string }

export interface AgentRow {
  name: string
  state: AgentRowState
}

export interface AgentsProps {
  agents: readonly AgentRow[]
  checking?: boolean | undefined
  onCheck: () => void
  onUpdate: (agent: string) => void
  onCopy: (line: string) => void
}

function AgentValue({
  agent,
  onUpdate,
  onCopy,
}: {
  agent: AgentRow
  onUpdate: (agent: string) => void
  onCopy: (line: string) => void
}): ReactNode {
  const { state } = agent
  if (!state.installed) return <Command line={state.install} onCopy={() => onCopy(state.install)} />
  return (
    <>
      {state.bareRefused !== undefined && (
        <Legend label={`Not qualified bare: ${state.bareRefused}`}>
          <span className="inline-flex text-destructive-muted-foreground" aria-hidden="true">
            <IconAlertTriangle size="sm" />
          </span>
        </Legend>
      )}
      {state.signedIn ? (
        <Mark state="done" label="Signed in" />
      ) : (
        <Command line={state.signIn} onCopy={() => onCopy(state.signIn)} />
      )}
      {state.update !== undefined && (
        <Legend
          label={
            state.installer === undefined
              ? `Out of date: ${state.update} is out. Update it with the tool that installed it.`
              : `Out of date: ${state.update} is out`
          }
        >
          <span className="inline-flex text-warning" aria-hidden="true">
            <IconCloudDownload size="sm" />
          </span>
        </Legend>
      )}
      {state.update !== undefined && state.installer !== undefined && (
        <Button size="sm" onClick={() => onUpdate(agent.name)}>
          Update to {state.update}
        </Button>
      )}
    </>
  )
}

export function AgentsSection({
  agents,
  checking,
  onCheck,
  onUpdate,
  onCopy,
}: AgentsProps): ReactNode {
  return (
    <section aria-label="Agents" className="flex flex-col gap-3">
      <SectionHead
        title="Agents"
        actions={
          <Button variant="link" state={checking === true ? 'loading' : 'idle'} onClick={onCheck}>
            Check for updates
          </Button>
        }
      />
      <Frame>
        {agents.map((agent) => (
          <Row
            key={agent.name}
            name={agent.name}
            detail={
              agent.state.installed
                ? [agent.state.version, agent.state.installer].filter(Boolean).join(' · ')
                : 'Not installed'
            }
          >
            <AgentValue agent={agent} onUpdate={onUpdate} onCopy={onCopy} />
          </Row>
        ))}
      </Frame>
    </section>
  )
}

// --- Models by role ----------------------------------------------------------------------------

export interface RoleModel {
  role: string
  /** `Claude Code · Sonnet · medium`. */
  model: string
}

export interface ModelsProps {
  roles: readonly RoleModel[]
  /** Opens the model picker (#47's component) for a role. */
  onPick: (role: string) => void
}

export function ModelsSection({ roles, onPick }: ModelsProps): ReactNode {
  return (
    <Section title="Models by role">
      {roles.map((one) => (
        <Row key={one.role} name={one.role}>
          <Button
            size="sm"
            aria-label={`Model of ${one.role}: ${one.model}`}
            onClick={() => onPick(one.role)}
          >
            {one.model}
            <IconChevronDown size="sm" aria-hidden="true" />
          </Button>
        </Row>
      ))}
    </Section>
  )
}

// --- Hemera Auto -------------------------------------------------------------------------------

export type JevKey = 'missing' | 'saved' | 'invalid' | 'unavailable'

export interface HemeraAutoProps {
  jevKey: JevKey
  /** Linux only, once: the Secret Service is not running, so the key cannot be stored. */
  secretService?: boolean | undefined
  /** The date consent was given, or nothing. */
  consent?: string | undefined
  onKey: () => void
  onConsent: () => void
}

const KEY_STATES: Record<JevKey, { mark: MarkState; label: string }> = {
  missing: { mark: 'todo', label: 'No key' },
  saved: { mark: 'done', label: 'Key stored by the system' },
  invalid: { mark: 'failed', label: 'Key refused by Jev' },
  unavailable: { mark: 'blocked', label: 'The system’s key storage is not available' },
}

export function HemeraAutoSection({
  jevKey,
  secretService,
  consent,
  onKey,
  onConsent,
}: HemeraAutoProps): ReactNode {
  const state = KEY_STATES[jevKey]
  const judges = jevKey === 'saved' && consent !== undefined
  return (
    <section aria-label="Hemera Auto" className="flex flex-col gap-3">
      <SectionHead
        title="Hemera Auto"
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconShieldLock size="sm" aria-hidden="true" />
            Jev · by TypeSafe AI
          </span>
        }
      />
      <Frame>
        <Row
          name="Jev key"
          detail={
            secretService === true
              ? 'Start the Secret Service (gnome-keyring or KWallet) to store it'
              : undefined
          }
        >
          {jevKey === 'saved' && <code className={MONO}>••••••••••••</code>}
          <Mark state={state.mark} label={state.label} />
          {jevKey !== 'unavailable' && (
            <Button size="sm" onClick={onKey}>
              {jevKey === 'missing' ? 'Add a key' : 'Replace'}
            </Button>
          )}
        </Row>
        <Row name="Consent" detail={consent}>
          {consent === undefined ? (
            jevKey === 'saved' && (
              <Button size="sm" onClick={onConsent}>
                Give consent
              </Button>
            )
          ) : (
            <Mark state="done" label="Consent given" />
          )}
        </Row>
        <Row name="Who judges">{judges ? 'Jev, then you' : 'You'}</Row>
        <Row name="Strictness">Strict</Row>
      </Frame>
    </section>
  )
}

// --- Notifications & sounds --------------------------------------------------------------------

export interface Toggle {
  id: string
  label: string
  on: boolean
}

export interface NotificationsProps {
  events: readonly Toggle[]
  sounds: readonly Toggle[]
  onEvent: (id: string, on: boolean) => void
  onSound: (id: string, on: boolean) => void
}

export function NotificationsSection({
  events,
  sounds,
  onEvent,
  onSound,
}: NotificationsProps): ReactNode {
  return (
    <>
      <Section title="Notifications">
        {events.map((event) => (
          <div key={event.id} className={ROW}>
            <Checkbox
              label={event.label}
              checked={event.on}
              onCheckedChange={(on) => onEvent(event.id, on)}
            />
          </div>
        ))}
      </Section>
      <Section title="Sounds">
        {sounds.map((sound) => (
          <div key={sound.id} className={ROW}>
            <Checkbox
              label={sound.label}
              checked={sound.on}
              onCheckedChange={(on) => onSound(sound.id, on)}
            />
          </div>
        ))}
      </Section>
    </>
  )
}

// --- Profile -----------------------------------------------------------------------------------

export interface ProfileProps {
  dataFolder: string
  /** `12, the last at 08:12`. */
  backups: string
  backingUp?: boolean | undefined
  agentLanguage: string
  languages: readonly string[]
  onShowFolder: () => void
  onBackUp: () => void
  onRestore: () => void
  onAgentLanguage: (language: string) => void
}

export function ProfileSection(props: ProfileProps): ReactNode {
  return (
    <Section title="Profile">
      <Row name="Data folder" detail={<span className="font-mono">{props.dataFolder}</span>}>
        <Button size="sm" variant="ghost" onClick={props.onShowFolder}>
          <IconFolder size="sm" aria-hidden="true" />
          Show
        </Button>
      </Row>
      <Row name="Automatic backups" detail={props.backups}>
        <Button
          size="sm"
          state={props.backingUp === true ? 'loading' : 'idle'}
          onClick={props.onBackUp}
        >
          Back up now
        </Button>
        <AlertDialog
          title="Restore a backup?"
          description="Hemera restarts on the backup chosen; what changed since it was taken is set aside in the data folder."
          confirmLabel="Restore"
          tone="destructive"
          onConfirm={props.onRestore}
          trigger={<Button size="sm">Restore…</Button>}
        />
      </Row>
      <Row name="Language the agents speak to you">
        <Select<string>
          label="Language the agents speak to you"
          value={props.agentLanguage}
          onValueChange={props.onAgentLanguage}
          items={props.languages.map((language) => ({ value: language, label: language }))}
        />
      </Row>
    </Section>
  )
}

// --- Developer ---------------------------------------------------------------------------------

export interface Decision {
  id: string
  call: string
  /** What Hemera Auto decided: let it run, or asked. */
  verdict: 'ran' | 'asked'
  when: string
}

export interface DeveloperProps {
  threads: boolean
  tester: boolean
  findings: number
  trace: boolean
  decisions: readonly Decision[]
  diagnosticFolder: string
  maxAgeDays: number
  maxTotalMegabytes: number
  onThreads: (on: boolean) => void
  onTester: (on: boolean) => void
  onFindings: () => void
  onTrace: (on: boolean) => void
  onShowDiagnostics: () => void
}

export function DeveloperSection(props: DeveloperProps): ReactNode {
  return (
    <>
      <Section title="Developer">
        <div className={ROW}>
          <Checkbox
            label="Show the sessions’ threads"
            checked={props.threads}
            onCheckedChange={props.onThreads}
          />
        </div>
        <div className={ROW}>
          <Checkbox label="Tester mode" checked={props.tester} onCheckedChange={props.onTester} />
          {props.tester && props.findings > 0 && (
            <Button size="sm" variant="link" className="ml-auto" onClick={props.onFindings}>
              {props.findings} findings
            </Button>
          )}
        </div>
        <div className={ROW}>
          <Checkbox label="ACP trace" checked={props.trace} onCheckedChange={props.onTrace} />
        </div>
        <Row
          name="Diagnostic folder"
          detail={<span className="font-mono">{props.diagnosticFolder}</span>}
        >
          <Button size="sm" variant="ghost" onClick={props.onShowDiagnostics}>
            <IconFolder size="sm" aria-hidden="true" />
            Show
          </Button>
        </Row>
        <Row name="Diagnostics kept">
          {props.maxAgeDays} days, {props.maxTotalMegabytes} MB
        </Row>
      </Section>
      <Section title="Hemera Auto decisions">
        {props.decisions.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No decision yet.</p>
        ) : (
          props.decisions.map((decision) => (
            <Row
              key={decision.id}
              name={<code className={MONO}>{decision.call}</code>}
              detail={decision.when}
            >
              {decision.verdict === 'ran' ? (
                <Legend label="Let it run">
                  <span className="inline-flex text-muted-foreground" aria-hidden="true">
                    <IconCheck size="sm" />
                  </span>
                </Legend>
              ) : (
                <Mark state="waiting" label="Asked you" />
              )}
            </Row>
          ))
        )}
      </Section>
    </>
  )
}
