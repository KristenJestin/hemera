import type { ReactNode } from 'react'

import { AlertDialog } from '../../components/alert-dialog/alert-dialog.tsx'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import {
  type ModelChoice,
  ModelPicker,
  type PickerAgent,
} from '../../components/model-picker/model-picker.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconCheck,
  IconCloudDownload,
  IconCopy,
  IconFolder,
  IconPlayerPlay,
  IconShieldLock,
} from '../../icons.ts'

/**
 * The sections of the application's settings: Appearance, Agents, Models by role, Hemera Auto,
 * Notifications & sounds, Profile, Developer. Each is its head above a frame of rows; a row is what
 * it sets on the left and its value or its control on the right. States are glyphs with their
 * legend, never a sentence; what cannot be done is not drawn. What the engine refused is said in
 * words on the row it was asked from (`errors`, by row), or under the head for what has no row.
 */

const ROW =
  'flex min-h-control-lg min-w-0 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0'
const NAME = 'min-w-0 flex-1 text-sm'
const DETAIL = 'block truncate text-xs text-muted-foreground'
const VALUE = 'flex min-w-0 shrink-0 items-center gap-2 text-sm'
const MONO = 'min-w-0 truncate font-mono text-xs'
const REFUSED = 'block text-xs text-destructive-muted-foreground'
/** A refusal on a row whose name is its control: between the control and what ends the row. */
const REFUSED_BESIDE = 'min-w-0 flex-1 text-xs text-destructive-muted-foreground'

/** What the engine refused, in words, by the row it was asked from. */
export type RowErrors = Readonly<Partial<Record<string, string>>>

/** A row: what it sets, under it a detail, and its value or control at the end. */
export function Row({
  name,
  detail,
  error,
  children,
}: {
  name: ReactNode
  detail?: ReactNode
  /** What the engine refused on this row, in words. */
  error?: string | undefined
  children?: ReactNode
}): ReactNode {
  return (
    <div className={ROW}>
      <span className={NAME}>
        {name}
        {detail !== undefined && <span className={DETAIL}>{detail}</span>}
        {error !== undefined && (
          <span role="alert" className={REFUSED}>
            {error}
          </span>
        )}
      </span>
      {children !== undefined && <span className={VALUE}>{children}</span>}
    </div>
  )
}

/** What the engine refused of what has no row, in words, under the section's head. */
function Refused({ error }: { error: string | undefined }): ReactNode {
  if (error === undefined) return null
  return (
    <p role="alert" className="text-sm text-destructive-muted-foreground">
      {error}
    </p>
  )
}

/** A refusal on a row whose name is its control (a box to tick). */
function RefusedBeside({ error }: { error: string | undefined }): ReactNode {
  if (error === undefined) return null
  return (
    <span role="alert" className={REFUSED_BESIDE}>
      {error}
    </span>
  )
}

/** A section: its head, focusable when a link leads to it, above its frame of rows. */
function Section({
  title,
  error,
  children,
}: {
  title: string
  error?: string | undefined
  children: ReactNode
}): ReactNode {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <SectionHead title={title} />
      <Refused error={error} />
      <Frame>{children}</Frame>
    </section>
  )
}

/** A state as its mark, its words in the legend. */
export function Mark({ state, label }: { state: MarkState; label: string }): ReactNode {
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
  /** Left out until the density can be kept: its row is then not drawn. */
  onDensity?: ((density: Density) => void) | undefined
  /** Left out until the interface speaks another language: its row is then not drawn. */
  onLanguage?: ((language: string) => void) | undefined
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
      {props.onDensity !== undefined && (
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
      )}
      {props.onLanguage !== undefined && (
        <Row name="Interface language">
          <Select<string>
            label="Interface language"
            value={props.language}
            onValueChange={props.onLanguage}
            items={props.languages.map((language) => ({ value: language, label: language }))}
          />
        </Row>
      )}
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
  /** What the section is called: Agents, or Agents on this machine where Hemera is first opened. */
  title?: string | undefined
  agents: readonly AgentRow[]
  /** Whether Hemera is still looking for the agents: the rows' own shape. */
  loading?: boolean | undefined
  checking?: boolean | undefined
  /** A check for updates refused, in words. */
  error?: string | undefined
  /** An update refused, by the agent's name. */
  errors?: RowErrors | undefined
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

/** An agent's row on its way: its name, its version, and a command's room. */
function AgentSkeleton(): ReactNode {
  return (
    <div className={ROW} aria-hidden="true" data-row-skeleton="">
      <span className={NAME}>
        <Skeleton>Claude Code</Skeleton>
        <span className={DETAIL}>
          <Skeleton>2.1.280 · npm</Skeleton>
        </span>
      </span>
      <span className={VALUE}>
        <Skeleton>
          <code className={MONO}>claude /login</code>
        </Skeleton>
      </span>
    </div>
  )
}

export function AgentsSection({
  title = 'Agents',
  agents,
  loading = false,
  checking,
  error,
  errors = {},
  onCheck,
  onUpdate,
  onCopy,
}: AgentsProps): ReactNode {
  return (
    <section aria-label={title} aria-busy={loading} className="flex flex-col gap-3">
      <SectionHead
        title={title}
        actions={
          loading ? undefined : (
            <Button variant="link" state={checking === true ? 'loading' : 'idle'} onClick={onCheck}>
              Check for updates
            </Button>
          )
        }
      />
      <Refused error={error} />
      <Frame>
        {loading && (
          <>
            <AgentSkeleton />
            <AgentSkeleton />
            <AgentSkeleton />
          </>
        )}
        {!loading &&
          agents.map((agent) => (
            <Row
              key={agent.name}
              name={agent.name}
              detail={
                agent.state.installed
                  ? [agent.state.version, agent.state.installer].filter(Boolean).join(' · ')
                  : 'Not installed'
              }
              error={errors[agent.name]}
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
  /**
   * The application's model for the role; null where the application leaves it on Hemera's own
   * default, which shows no model. The last level: there is no default above it to offer.
   */
  model: ModelChoice | null
}

export interface ModelsProps {
  roles: readonly RoleModel[]
  /** The agents this machine has, and their models: what the picker offers. */
  agents: readonly PickerAgent[]
  /** A model's mark refused, in words. */
  error?: string | undefined
  /** A role's model refused, by the role. */
  errors?: RowErrors | undefined
  onChange: (role: string, choice: ModelChoice) => void
  onFavourite: (agent: string, model: string, favourite: boolean) => void
  onHide: (agent: string, model: string, hidden: boolean) => void
}

export function ModelsSection({
  roles,
  agents,
  error,
  errors = {},
  onChange,
  onFavourite,
  onHide,
}: ModelsProps): ReactNode {
  return (
    <Section title="Models by role" error={error}>
      {roles.map((one) => (
        <Row key={one.role} name={one.role} error={errors[one.role]}>
          <ModelPicker
            label={`Model of ${one.role}`}
            agents={agents}
            value={one.model}
            onChange={(choice) => {
              // The application's level inherits nothing, so the picker offers no default here.
              if (choice !== null) onChange(one.role, choice)
            }}
            onFavourite={onFavourite}
            onHide={onHide}
          />
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
  /** Opens where a key is typed; left out, Add a key and Replace are not drawn. */
  onKey?: (() => void) | undefined
  onConsent: () => void
  /** What the engine refused, on the key's row and on the consent's. */
  errors?: { readonly key?: string | undefined; readonly consent?: string | undefined } | undefined
  /** Whether the key's state is still being read: the rows' shape, never a state not yet known. */
  loading?: boolean | undefined
  /** Who judges now, as the engine says it: `Hemera Auto (Jev)`, `Hemera asks`. */
  judge?: string | undefined
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
  errors = {},
  loading = false,
  judge,
}: HemeraAutoProps): ReactNode {
  const state = KEY_STATES[jevKey]
  const judges = jevKey === 'saved' && consent !== undefined
  return (
    <section aria-label="Hemera Auto" aria-busy={loading} className="flex flex-col gap-3">
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
          error={errors.key}
        >
          {loading ? (
            <Skeleton>
              <code className={MONO}>••••••••••••</code>
            </Skeleton>
          ) : (
            <>
              {jevKey === 'saved' && <code className={MONO}>••••••••••••</code>}
              <Mark state={state.mark} label={state.label} />
            </>
          )}
          {!loading && jevKey !== 'unavailable' && onKey !== undefined && (
            <Button size="sm" onClick={onKey}>
              {jevKey === 'missing' ? 'Add a key' : 'Replace'}
            </Button>
          )}
        </Row>
        <Row name="Consent" detail={consent} error={errors.consent}>
          {loading ? (
            <Skeleton>Consent given</Skeleton>
          ) : consent === undefined ? (
            jevKey === 'saved' && (
              <Button size="sm" onClick={onConsent}>
                Give consent
              </Button>
            )
          ) : (
            <Mark state="done" label="Consent given" />
          )}
        </Row>
        <Row name="Who judges">
          {loading ? (
            <Skeleton>Hemera asks</Skeleton>
          ) : (
            (judge ?? (judges ? 'Jev, then you' : 'You'))
          )}
        </Row>
        <Row name="Strictness">Strict</Row>
      </Frame>
    </section>
  )
}

export interface JevKeyFormProps {
  /** What is typed, held by the caller and never shown back. */
  value: string
  onChange: (value: string) => void
  /** Enter, as the foot's Save. */
  onSave: () => void
}

/**
 * The body of the key's dialog: one field, masked as it is typed. The key goes from here to the
 * system's storage; nothing shows it again.
 */
export function JevKeyForm({ value, onChange, onSave }: JevKeyFormProps): ReactNode {
  return (
    <Input
      label="Jev key"
      secret
      value={value}
      description="Sealed by the system as soon as it is saved; Hemera never shows it again."
      onValueChange={onChange}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSave()
      }}
    />
  )
}

// --- Notifications & sounds --------------------------------------------------------------------

export interface Toggle {
  id: string
  label: string
  on: boolean
}

/** A sound style, and its name. */
export interface SoundStyleChoice {
  id: string
  label: string
}

export interface NotificationsProps {
  events: readonly Toggle[]
  sounds: readonly Toggle[]
  /** The sound style chosen, among `styles`. */
  style: string
  styles: readonly SoundStyleChoice[]
  /** The sound being previewed, while it plays. */
  previewing?: string | undefined
  onEvent: (id: string, on: boolean) => void
  onSound: (id: string, on: boolean) => void
  onStyle: (id: string) => void
  /** Plays a sound once, in the style chosen. */
  onPreview: (id: string) => void
  /** What the engine refused, by the id of the event or of the sound, or `style`. */
  errors?: RowErrors | undefined
}

export function NotificationsSection({
  events,
  sounds,
  style,
  styles,
  previewing,
  onEvent,
  onSound,
  onStyle,
  onPreview,
  errors = {},
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
            <RefusedBeside error={errors[event.id]} />
          </div>
        ))}
      </Section>
      <Section title="Sounds">
        <Row name="Sound style" error={errors['style']}>
          <Select<string>
            label="Sound style"
            value={style}
            onValueChange={onStyle}
            items={styles.map((one) => ({ value: one.id, label: one.label }))}
          />
        </Row>
        {sounds.map((sound) => (
          <div key={sound.id} className={ROW}>
            <Checkbox
              label={sound.label}
              checked={sound.on}
              onCheckedChange={(on) => onSound(sound.id, on)}
            />
            <RefusedBeside error={errors[sound.id]} />
            <span className="ml-auto inline-flex shrink-0">
              <Tooltip label="Play">
                <IconButton
                  variant="ghost"
                  size="sm"
                  state={previewing === sound.id ? 'loading' : 'idle'}
                  icon={<IconPlayerPlay size="sm" />}
                  aria-label={`Play ${sound.label}`}
                  onClick={() => onPreview(sound.id)}
                />
              </Tooltip>
            </span>
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
  /** Opens the data folder; left out, Show is not drawn. */
  onShowFolder?: (() => void) | undefined
  onBackUp: () => void
  onRestore: () => void
  onAgentLanguage: (language: string) => void
  /** What the engine refused, on the backups' row and on the language's. */
  errors?:
    | { readonly backups?: string | undefined; readonly language?: string | undefined }
    | undefined
}

export function ProfileSection(props: ProfileProps): ReactNode {
  return (
    <Section title="Profile">
      <Row name="Data folder" detail={<span className="font-mono">{props.dataFolder}</span>}>
        {props.onShowFolder !== undefined && (
          <Button size="sm" variant="ghost" onClick={props.onShowFolder}>
            <IconFolder size="sm" aria-hidden="true" />
            Show
          </Button>
        )}
      </Row>
      <Row name="Automatic backups" detail={props.backups} error={props.errors?.backups}>
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
      <Row name="Language the agents speak to you" error={props.errors?.language}>
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
  /** Left out until the threads can be shown: the box is then not drawn. */
  onThreads?: ((on: boolean) => void) | undefined
  onTester: (on: boolean) => void
  /** Opens the findings; left out, their count is not a link. */
  onFindings?: (() => void) | undefined
  /** Left out until the trace is a preference: the box is then not drawn. */
  onTrace?: ((on: boolean) => void) | undefined
  onShowDiagnostics: () => void
  /** What the engine refused, on the tester mode's row. */
  errors?: { readonly tester?: string | undefined } | undefined
}

export function DeveloperSection(props: DeveloperProps): ReactNode {
  return (
    <>
      <Section title="Developer">
        {props.onThreads !== undefined && (
          <div className={ROW}>
            <Checkbox
              label="Show the sessions’ threads"
              checked={props.threads}
              onCheckedChange={props.onThreads}
            />
          </div>
        )}
        <div className={ROW}>
          <Checkbox label="Tester mode" checked={props.tester} onCheckedChange={props.onTester} />
          <RefusedBeside error={props.errors?.tester} />
          {props.tester && props.findings > 0 && props.onFindings !== undefined && (
            <Button size="sm" variant="link" className="ml-auto" onClick={props.onFindings}>
              {props.findings} findings
            </Button>
          )}
        </div>
        {props.onTrace !== undefined && (
          <div className={ROW}>
            <Checkbox label="ACP trace" checked={props.trace} onCheckedChange={props.onTrace} />
          </div>
        )}
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
