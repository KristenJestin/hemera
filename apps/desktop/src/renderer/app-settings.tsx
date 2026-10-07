/**
 * The application's settings (#50): #46's page, its sections down the left, the one chosen beside
 * them, each read from the engine when it is shown and written back through the link. What has
 * no engine yet (the density, the interface's language, the sessions' threads, the ACP trace, the
 * key's entry, opening a folder or the findings) is not drawn, as the maintainer asked.
 */

import {
  SOUNDS,
  SOUND_STYLES,
  type AgentState,
  type AutomaticBackups,
  type DiagnosticsRetention,
  type HemeraAutoStatus,
  type ModelMark,
  type NotificationSettings,
  type PermissionDecision,
  type Preferences,
  type RoleModels,
  type Sound,
  type SoundStyle,
  type TesterFinding,
  type ThemePreference,
} from '@hemera/ipc'
import {
  AgentsSection,
  AppearanceSection,
  AppSettings,
  DeveloperSection,
  HemeraAutoSection,
  ModelsSection,
  NotificationsSection,
  FormFoot,
  JevKeyForm,
  ProfileSection,
  type AppSection,
  type RowErrors,
  type SettingsForm,
} from '@hemera/ui'
import { IconShieldLock } from '@hemera/ui/icons'
import { type ReactNode, useEffect, useState } from 'react'

import {
  agentRowsOf,
  appRolesOf,
  backupsSaid,
  decisionsOf,
  jevKeyOf,
  judgeSaid,
  keyWritten,
  notificationsOf,
  restoreChosen,
  writing,
} from './app-settings-data.ts'
import { pickerAgentsOf, settingOfChoice } from './chat-items.ts'
import type { Link } from './link.ts'
import { refusedOf, Unread, useRead, valueOf } from './use-read.tsx'

export interface AppSettingsTools {
  copy: (text: string) => void
  chooseFolder: () => Promise<string | null>
  showLog: () => void
}

export interface AppSettingsPageProps {
  link: Link
  engineReady: boolean
  section: AppSection
  onSection: (section: AppSection) => void
  /** The theme chosen; null while the engine has not said. */
  theme: ThemePreference | null
  onTheme: (theme: ThemePreference) => void
  dataFolder: string
  tools: AppSettingsTools
  /** Whether a link opened the section: its heading takes the focus once it is drawn. */
  focus?: boolean | undefined
}

type Part = Pick<AppSettingsPageProps, 'link' | 'engineReady' | 'dataFolder' | 'tools'> & {
  /** Opens the Jev key's dialog over the page; `written` hears each status the engine answers. */
  openKey: (stored: boolean, written: (status: HemeraAutoStatus) => void) => void
}

/** The refusals of a section's rows, and how a write changes them. */
function useRowErrors(): [RowErrors, (change: (before: RowErrors) => RowErrors) => void] {
  const [errors, setErrors] = useState<RowErrors>({})
  return [errors, setErrors]
}

const readAgents = (link: Link) => link.agents()
const readRoles = (link: Link) => link.roleModels(null)
const readMarks = (link: Link) => link.modelMarks()
const readHemeraAuto = (link: Link) => link.hemeraAuto()
const readNotifications = (link: Link) => link.notificationSettings()
const readBackups = (link: Link) => link.backups()
const readPreferences = (link: Link) => link.preferences()
const readRetention = (link: Link) => link.retention()
const readFindings = (link: Link) => link.testerFindings()

const isSound = (id: string): id is Sound => SOUNDS.some((sound) => sound === id)
const isStyle = (id: string): id is SoundStyle => SOUND_STYLES.some((style) => style === id)

function AgentsPart({ link, engineReady, tools }: Part): ReactNode {
  const [read, setAgents, reread] = useRead<ReadonlyArray<AgentState>>(
    link,
    engineReady,
    readAgents,
  )
  const [checking, setChecking] = useState(false)
  const [errors, setErrors] = useRowErrors()
  /** A check for updates refused: it has no row of its own. */
  const [head, setHead] = useRowErrors()
  const agents = valueOf(read)
  if (read.kind === 'failed') {
    return <Unread title="The agents" sentence={read.sentence} onRetry={reread} />
  }
  return (
    <AgentsSection
      agents={agentRowsOf(agents ?? [])}
      loading={agents === null}
      checking={checking}
      error={head['check']}
      errors={errors}
      onCheck={() => {
        setChecking(true)
        const asked = link.checkAgentUpdates()
        writing(asked, 'check', 'The registries could not be asked', setHead, setAgents)
        const done = (): void => setChecking(false)
        asked.then(done, done)
      }}
      onUpdate={(name) => {
        const agent = agents?.find((one) => one.label === name)
        if (agent === undefined) return
        writing(
          link.updateAgent(agent.id),
          agent.label,
          `${agent.label} could not be updated`,
          setErrors,
          reread,
        )
      }}
      onCopy={tools.copy}
    />
  )
}

function ModelsPart({ link, engineReady }: Part): ReactNode {
  const [rolesRead, , rereadRoles] = useRead<ReadonlyArray<RoleModels>>(
    link,
    engineReady,
    readRoles,
  )
  const [agentsRead, , rereadAgents] = useRead<ReadonlyArray<AgentState>>(
    link,
    engineReady,
    readAgents,
  )
  const [marksRead, , rereadMarks] = useRead<ReadonlyArray<ModelMark>>(link, engineReady, readMarks)
  const [errors, setErrors] = useRowErrors()
  /** A model's mark refused: it has no row of its own. */
  const [head, setHead] = useRowErrors()
  const refused = refusedOf([rolesRead, agentsRead, marksRead])
  if (refused !== null) {
    return (
      <Unread
        title="The models by role"
        sentence={refused}
        onRetry={() => {
          rereadRoles()
          rereadAgents()
          rereadMarks()
        }}
      />
    )
  }
  const roles = valueOf(rolesRead)
  const agents = valueOf(agentsRead)
  const marks = valueOf(marksRead)
  const mark = (agentId: string, model: string, change: Partial<ModelMark>): void => {
    const agent = agents?.find((one) => one.id === agentId)
    if (agent === undefined) return
    const before = marks?.find((one) => one.agent === agentId && one.model === model)
    writing(
      link.markModel({
        agent: agent.id,
        model,
        favourite: change.favourite ?? before?.favourite ?? false,
        hidden: change.hidden ?? before?.hidden ?? false,
      }),
      'mark',
      'The model could not be marked',
      setHead,
      rereadMarks,
    )
  }
  return (
    <ModelsSection
      roles={appRolesOf(roles ?? [])}
      agents={pickerAgentsOf(agents ?? [], marks ?? [], {
        agent: 'claude',
        model: null,
        effort: null,
      })}
      error={head['mark']}
      errors={errors}
      onChange={(displayName, choice) => {
        const role = roles?.find((one) => one.displayName === displayName)
        const agent = agents?.find((one) => one.id === choice.agent)
        if (role === undefined || agent === undefined) return
        writing(
          link.setAppRoleModel(role.role, settingOfChoice(agent.id, choice)),
          role.displayName,
          'The model could not be changed',
          setErrors,
          rereadRoles,
        )
      }}
      onFavourite={(agent, model, favourite) => mark(agent, model, { favourite })}
      onHide={(agent, model, hidden) => mark(agent, model, { hidden })}
    />
  )
}

function HemeraAutoPart({ link, engineReady, openKey }: Part): ReactNode {
  const [read, setStatus, reread] = useRead<HemeraAutoStatus>(link, engineReady, readHemeraAuto)
  const [errors, setErrors] = useRowErrors()
  if (read.kind === 'failed') {
    return <Unread title="Hemera Auto" sentence={read.sentence} onRetry={reread} />
  }
  const status = valueOf(read)
  return (
    <HemeraAutoSection
      loading={status === null}
      jevKey={jevKeyOf(status?.key ?? 'missing')}
      secretService={status !== null && status.missing !== null}
      consent={status?.consent === true ? 'Given' : undefined}
      judge={status === null ? undefined : judgeSaid(status.judge)}
      errors={{ consent: errors['consent'] }}
      onKey={() => openKey(status?.key === 'saved' || status?.key === 'invalid', setStatus)}
      onConsent={() => {
        writing(
          link.setConsent(true),
          'consent',
          'The consent could not be kept',
          setErrors,
          reread,
        )
      }}
    />
  )
}

function NotificationsPart({ link, engineReady }: Part): ReactNode {
  const [read, setSettings, reread] = useRead<NotificationSettings>(
    link,
    engineReady,
    readNotifications,
  )
  const [previewing, setPreviewing] = useState<string | undefined>(undefined)
  const [errors, setErrors] = useRowErrors()
  if (read.kind === 'failed') {
    return <Unread title="Notifications & sounds" sentence={read.sentence} onRetry={reread} />
  }
  const settings = valueOf(read)
  if (settings === null) return null
  const shown = notificationsOf(settings)
  return (
    <NotificationsSection
      // The section's `style` is the sound style chosen, not a CSS style: given whole.
      {...shown}
      previewing={previewing}
      errors={errors}
      onEvent={(id, on) => {
        writing(
          link.setNotificationKind(id, on),
          id,
          'This notification could not be changed',
          setErrors,
          setSettings,
        )
      }}
      onSound={(id, on) => {
        if (!isSound(id)) return
        writing(
          link.setNotificationSound(id, on),
          id,
          'This sound could not be changed',
          setErrors,
          setSettings,
        )
      }}
      onStyle={(id) => {
        if (!isStyle(id)) return
        writing(
          link.setSoundStyle(id),
          'style',
          'This style could not be chosen',
          setErrors,
          setSettings,
        )
      }}
      onPreview={(id) => {
        if (!isSound(id)) return
        setPreviewing(id)
        const asked = link.previewSound(settings.style, id)
        writing(asked, id, 'This sound could not be played', setErrors)
        const done = (): void => setPreviewing(undefined)
        asked.then(done, done)
      }}
    />
  )
}

function ProfilePart({ link, engineReady, dataFolder, tools }: Part): ReactNode {
  const [backupsRead, , rereadBackups] = useRead<AutomaticBackups>(link, engineReady, readBackups)
  const [preferencesRead, , rereadPreferences] = useRead<Preferences>(
    link,
    engineReady,
    readPreferences,
  )
  const [backingUp, setBackingUp] = useState(false)
  const [errors, setErrors] = useRowErrors()
  const refused = refusedOf([backupsRead, preferencesRead])
  if (refused !== null) {
    return (
      <Unread
        title="The profile"
        sentence={refused}
        onRetry={() => {
          rereadBackups()
          rereadPreferences()
        }}
      />
    )
  }
  const backups = valueOf(backupsRead)
  const language = valueOf(preferencesRead)?.userLanguage ?? 'en'
  /** A folder chosen, then what is done with it; a folder that could not be chosen is said. */
  const inFolder = (then: (folder: string) => void): void => {
    tools.chooseFolder().then(
      (folder) => {
        if (folder !== null) then(folder)
      },
      (failure: Error) =>
        setErrors((before) => ({
          ...before,
          backups: `No folder could be chosen: ${failure.message}`,
        })),
    )
  }
  return (
    <ProfileSection
      dataFolder={dataFolder}
      backups={backups === null ? '' : backupsSaid(backups)}
      backingUp={backingUp}
      agentLanguage={language}
      languages={[...new Set([language, 'en', 'fr', 'de', 'es'])]}
      errors={{ backups: errors['backups'], language: errors['language'] }}
      onBackUp={() =>
        inFolder((folder) => {
          setBackingUp(true)
          const asked = link.backUp(folder)
          writing(asked, 'backups', 'No backup was made', setErrors)
          const done = (): void => {
            setBackingUp(false)
            rereadBackups()
          }
          asked.then(done, done)
        })
      }
      onRestore={() => {
        restoreChosen(tools.chooseFolder, link.restoreProfile).then(
          (refusal) =>
            setErrors((before) => ({
              ...before,
              backups: refusal === undefined ? undefined : `Nothing was restored: ${refusal}`,
            })),
          (failure: Error) =>
            setErrors((before) => ({
              ...before,
              backups: `No folder could be chosen: ${failure.message}`,
            })),
        )
      }}
      onAgentLanguage={(chosen) => {
        writing(
          link.writePreferences({ userLanguage: chosen }),
          'language',
          'The language could not be kept',
          setErrors,
          rereadPreferences,
        )
      }}
    />
  )
}

/** The decisions heard since the section opened, the newest first, a hundred at most. */
function useDecisions(link: Link, engineReady: boolean): ReadonlyArray<PermissionDecision> {
  const [decisions, setDecisions] = useState<ReadonlyArray<PermissionDecision>>([])
  useEffect(() => {
    if (!engineReady) return undefined
    return link.onDecisions(
      (decision) => setDecisions((before) => [decision, ...before].slice(0, 100)),
      // The list says what it heard; a stream that ends leaves it as it stands.
      () => undefined,
    )
  }, [link, engineReady])
  return decisions
}

function DeveloperPart({ link, engineReady, tools }: Part): ReactNode {
  const [retentionRead, , rereadRetention] = useRead<DiagnosticsRetention>(
    link,
    engineReady,
    readRetention,
  )
  const [findingsRead, , rereadFindings] = useRead<ReadonlyArray<TesterFinding>>(
    link,
    engineReady,
    readFindings,
  )
  const [preferencesRead, , rereadPreferences] = useRead<Preferences>(
    link,
    engineReady,
    readPreferences,
  )
  const decisions = useDecisions(link, engineReady)
  const [errors, setErrors] = useRowErrors()
  const refused = refusedOf([retentionRead, findingsRead, preferencesRead])
  if (refused !== null) {
    return (
      <Unread
        title="The developer settings"
        sentence={refused}
        onRetry={() => {
          rereadRetention()
          rereadFindings()
          rereadPreferences()
        }}
      />
    )
  }
  const retention = valueOf(retentionRead)
  return (
    <DeveloperSection
      threads={false}
      tester={valueOf(preferencesRead)?.testerMode ?? false}
      findings={valueOf(findingsRead)?.length ?? 0}
      trace={false}
      decisions={decisionsOf(decisions)}
      diagnosticFolder={retention?.folder ?? ''}
      maxAgeDays={retention?.maxAgeDays ?? 0}
      maxTotalMegabytes={retention?.maxTotalMegabytes ?? 0}
      errors={{ tester: errors['tester'] }}
      onTester={(on) => {
        writing(
          link.writePreferences({ testerMode: on }),
          'tester',
          'The tester mode could not be changed',
          setErrors,
          rereadPreferences,
        )
      }}
      onShowDiagnostics={tools.showLog}
    />
  )
}

function SectionBody(props: AppSettingsPageProps & Pick<Part, 'openKey'>): ReactNode {
  switch (props.section) {
    case 'appearance':
      return (
        <AppearanceSection
          theme={props.theme ?? 'system'}
          density="comfortable"
          language="English"
          languages={['English']}
          onTheme={props.onTheme}
        />
      )
    case 'agents':
      return <AgentsPart {...props} />
    case 'models':
      return <ModelsPart {...props} />
    case 'hemera-auto':
      return <HemeraAutoPart {...props} />
    case 'notifications':
      return <NotificationsPart {...props} />
    case 'profile':
      return <ProfilePart {...props} />
    case 'developer':
      return <DeveloperPart {...props} />
  }
}

/** The Jev key's dialog: what is typed (never shown back), and where its save stands. */
interface KeyDialog {
  readonly stored: boolean
  readonly draft: string
  readonly saving: boolean
  readonly refused: string | undefined
  readonly written: (status: HemeraAutoStatus) => void
}

/** The key's dialog over the page: a key typed, saved, replaced or removed, a refusal said. */
function useKeyDialog(link: Link): [SettingsForm | null, () => void, Part['openKey']] {
  const [dialog, setDialog] = useState<KeyDialog | null>(null)
  const close = (): void => setDialog(null)
  const answered = (asked: ReturnType<typeof keyWritten>): void => {
    setDialog((before) =>
      before === null ? null : { ...before, saving: true, refused: undefined },
    )
    void asked.then((outcome) => {
      if (outcome.status !== null) dialog?.written(outcome.status)
      setDialog((before) =>
        outcome.kind === 'done' || before === null
          ? null
          : { ...before, saving: false, refused: outcome.sentence },
      )
    })
  }
  const save = (): void => {
    if (dialog === null || dialog.saving || dialog.draft.trim() === '') return
    answered(keyWritten(link.saveJevKey(dialog.draft.trim()), 'saved'))
  }
  const form: SettingsForm | null =
    dialog === null
      ? null
      : {
          title: dialog.stored ? 'Replace the Jev key' : 'Add a Jev key',
          icon: <IconShieldLock size="sm" />,
          body: (
            <JevKeyForm
              value={dialog.draft}
              onChange={(draft) =>
                setDialog((before) => (before === null ? null : { ...before, draft }))
              }
              onSave={save}
            />
          ),
          footer: (
            <FormFoot
              refused={dialog.refused}
              remove={dialog.stored ? 'Remove the key' : undefined}
              onRemove={() => {
                if (!dialog.saving) answered(keyWritten(link.removeJevKey(), 'missing'))
              }}
              saving={dialog.saving}
              onSave={save}
              onCancel={close}
            />
          ),
        }
  return [
    form,
    close,
    (stored, written) =>
      setDialog({ stored, draft: '', saving: false, refused: undefined, written }),
  ]
}

export function AppSettingsPage(props: AppSettingsPageProps): ReactNode {
  const [keyForm, closeKey, openKey] = useKeyDialog(props.link)
  return (
    <AppSettings
      current={props.section}
      onSection={props.onSection}
      focus={props.focus}
      form={keyForm}
      onCloseForm={closeKey}
    >
      {/* The section shown, for a need's link to read where it led; it takes no room. */}
      <div className="contents" data-settings-section={props.section}>
        <SectionBody {...props} openKey={openKey} />
      </div>
    </AppSettings>
  )
}
