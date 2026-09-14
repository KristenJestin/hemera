/**
 * The decisions the session screen asks for: adding a project, configuring it, renaming a
 * session.
 *
 * Each one is laid over the window and reports whether the profile accepted the change: a
 * refusal keeps the panel open with what the user typed, and never presents a refused change
 * as saved.
 */

import { Button, IconButton, Input, Modal, Select, Separator, Stack, Text, space } from '@hemera/ui'
import type { ThemeName } from '@hemera/ui'
import type { ProjectConfiguration } from '@hemera/runtime'
import { useState } from 'react'

import { t } from '../../i18n/index.ts'

/** Keeps the locations that name something, an empty list meaning the workspace root. */
export function locationsOf(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0)
}

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps) {
  return (
    <Stack direction="column" gap="sm" style={{ paddingBottom: space.lg }}>
      <Text color="muted" scale="sm">
        {label}
      </Text>
      {children}
    </Stack>
  )
}

export interface NewProjectDialogProps {
  onClose: () => void
  onCreate: (input: { name: string; path: string }) => boolean
}

export function NewProjectDialog({ onClose, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')

  // Hemera never creates a folder in the user's place: the path must already exist.
  const create = () => {
    if (onCreate({ name, path })) onClose()
  }

  return (
    <Modal
      testId="new-project-dialog"
      open
      onClose={onClose}
      title={t('project.new')}
      actions={
        <>
          <Button
            testId="new-project-cancel"
            label={t('action.cancel')}
            tone="ghost"
            onPress={onClose}
          />
          <Button
            testId="new-project-confirm"
            label={t('project.new.confirm')}
            tone="primary"
            onPress={create}
          />
        </>
      }
    >
      <Field label={t('project.new.name')}>
        <Input
          testId="new-project-name"
          value={name}
          onValueChange={setName}
          placeholder={t('project.new.name.placeholder')}
          aria-label={t('project.new.name')}
        />
      </Field>
      <Field label={t('project.new.path')}>
        <Input
          testId="new-project-path"
          value={path}
          onValueChange={setPath}
          onSubmit={create}
          placeholder={t('project.new.path.placeholder')}
          aria-label={t('project.new.path')}
        />
      </Field>
    </Modal>
  )
}

/**
 * Themes the settings offer.
 *
 * There is no `system` choice: the renderer exposes no operating-system appearance
 * preference, and a choice that cannot be honoured is not offered.
 */
export const THEME_OPTIONS: readonly { value: ThemeName; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

interface RepositoryListProps {
  locations: string[]
  onChange: (locations: string[]) => void
}

/**
 * The repositories of a workspace, one entry per line of the list.
 *
 * A block of text would make the user manage the line breaks of a list the application is
 * perfectly able to manage itself, and the renderer eats `Enter` inside a field anyway.
 */
function RepositoryList({ locations, onChange }: RepositoryListProps) {
  const replace = (index: number, value: string) =>
    onChange(locations.map((location, at) => (at === index ? value : location)))

  return (
    <Stack direction="column" gap="sm">
      {locations.map((location, index) => (
        // The list is ordered and its entries are edited in place, so the index is the
        // identity here: two entries can carry the same text while one is being typed.
        <Stack key={index} gap="sm" align="center">
          <Input
            testId={`settings-repository-${index}`}
            value={location}
            onValueChange={(value) => replace(index, value)}
            placeholder={t('project.settings.repositories.placeholder')}
            aria-label={t('project.settings.repositories')}
            style={{ flexGrow: 1 }}
          />
          <IconButton
            testId={`settings-repository-remove-${index}`}
            name="trash-2"
            label={t('project.settings.repositories.remove')}
            size="sm"
            onPress={() => onChange(locations.filter((_, at) => at !== index))}
          />
        </Stack>
      ))}
      <Stack>
        <Button
          testId="settings-repository-add"
          label={t('project.settings.repositories.add')}
          tone="ghost"
          size="sm"
          iconName="plus"
          onPress={() => onChange([...locations, ''])}
        />
      </Stack>
    </Stack>
  )
}

export interface SettingsDialogProps {
  configuration: ProjectConfiguration
  path: string | null
  theme: ThemeName
  onThemeChange: (theme: ThemeName) => void
  onClose: () => void
  onSave: (input: { name: string; repositories: string[] }) => boolean
}

export function SettingsDialog({
  configuration,
  path,
  theme,
  onThemeChange,
  onClose,
  onSave,
}: SettingsDialogProps) {
  const [name, setName] = useState(configuration.name)
  const [locations, setLocations] = useState<string[]>(configuration.repositories)

  const save = () => {
    if (onSave({ name, repositories: locationsOf(locations) })) onClose()
  }

  return (
    <Modal
      testId="settings-dialog"
      open
      onClose={onClose}
      title={t('settings')}
      actions={
        <>
          <Button
            testId="settings-cancel"
            label={t('action.cancel')}
            tone="ghost"
            onPress={onClose}
          />
          <Button
            testId="settings-save"
            label={t('project.settings.save')}
            tone="primary"
            onPress={save}
          />
        </>
      }
    >
      {/* The appearance belongs to the application, not to a project: it is shown apart so
          that saving the project never reads as saving the theme. */}
      <Text color="dim" scale="sm" weight="semibold">
        {t('settings.application')}
      </Text>
      <Stack direction="column" style={{ paddingTop: space.md }}>
        <Field label={t('settings.theme')}>
          <Select
            testId="settings-theme"
            value={theme}
            options={THEME_OPTIONS}
            onValueChange={onThemeChange}
            label={t('settings.theme')}
          />
        </Field>
      </Stack>

      <Separator />

      <Stack direction="column" style={{ paddingTop: space.lg }}>
        <Text color="dim" scale="sm" weight="semibold" style={{ paddingBottom: space.md }}>
          {t('settings.project')}
        </Text>
        <Field label={t('project.settings.name')}>
          <Input
            testId="settings-name"
            value={name}
            onValueChange={setName}
            aria-label={t('project.settings.name')}
          />
        </Field>
        <Field label={t('project.folder')}>
          <Text color="dim" scale="sm" family="mono" testId="settings-path">
            {path ?? ''}
          </Text>
        </Field>
        <Field label={t('project.settings.repositories')}>
          <RepositoryList locations={locations} onChange={setLocations} />
          <Text color="dim" scale="sm">
            {t('project.settings.repositories.hint')}
          </Text>
        </Field>
      </Stack>
    </Modal>
  )
}

export interface RenameSessionDialogProps {
  title: string
  onClose: () => void
  onRename: (title: string) => boolean
}

export function RenameSessionDialog({ title, onClose, onRename }: RenameSessionDialogProps) {
  const [next, setNext] = useState(title)

  const rename = () => {
    if (onRename(next)) onClose()
  }

  return (
    <Modal
      testId="rename-dialog"
      open
      onClose={onClose}
      title={t('session.rename.title')}
      actions={
        <>
          <Button
            testId="rename-cancel"
            label={t('action.cancel')}
            tone="ghost"
            onPress={onClose}
          />
          <Button
            testId="rename-confirm"
            label={t('session.rename.confirm')}
            tone="primary"
            onPress={rename}
          />
        </>
      }
    >
      <Field label={t('session.rename.field')}>
        <Input
          testId="rename-title"
          value={next}
          onValueChange={setNext}
          onSubmit={rename}
          aria-label={t('session.rename.field')}
        />
      </Field>
    </Modal>
  )
}
