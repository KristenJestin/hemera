/**
 * The decisions the session screen asks for: adding a project, configuring it, renaming a
 * session.
 *
 * The renderer has no real modal, so each panel takes the main area while it is open. Each one
 * reports whether the profile accepted the change: a refusal keeps the panel open with what
 * the user typed, and never presents a refused change as saved.
 */

import { Button, DialogPanel, Input, Select, Stack, Text, Textarea, space } from '@hemera/ui'
import type { ThemeName } from '@hemera/ui'
import type { ProjectConfiguration } from '@hemera/runtime'
import { useState } from 'react'

import { t } from '../../i18n/index.ts'

/** Turns the typed block into the declared locations, an empty block meaning the root. */
export function locationsOf(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
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
    <DialogPanel testId="new-project-dialog" open onClose={onClose} title={t('project.new')}>
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
      <Stack gap="md" align="center" justify="end">
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
      </Stack>
    </DialogPanel>
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
  const [block, setBlock] = useState(configuration.repositories.join('\n'))

  const save = () => {
    if (onSave({ name, repositories: locationsOf(block) })) onClose()
  }

  return (
    <DialogPanel testId="settings-dialog" open onClose={onClose} title={t('settings')}>
      <Field label={t('settings.theme')}>
        <Select
          testId="settings-theme"
          value={theme}
          options={THEME_OPTIONS}
          onValueChange={onThemeChange}
          label={t('settings.theme')}
        />
      </Field>
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
        <Textarea
          testId="settings-repositories"
          value={block}
          onValueChange={setBlock}
          minRows={3}
          maxRows={8}
          placeholder={t('project.settings.repositories.placeholder')}
          aria-label={t('project.settings.repositories')}
        />
        <Text color="dim" scale="sm">
          {t('project.settings.repositories.hint')}
        </Text>
      </Field>
      <Stack gap="md" align="center" justify="end">
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
      </Stack>
    </DialogPanel>
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
    <DialogPanel testId="rename-dialog" open onClose={onClose} title={t('session.rename.title')}>
      <Field label={t('session.rename.field')}>
        <Input
          testId="rename-title"
          value={next}
          onValueChange={setNext}
          onSubmit={rename}
          aria-label={t('session.rename.field')}
        />
      </Field>
      <Stack gap="md" align="center" justify="end">
        <Button testId="rename-cancel" label={t('action.cancel')} tone="ghost" onPress={onClose} />
        <Button
          testId="rename-confirm"
          label={t('session.rename.confirm')}
          tone="primary"
          onPress={rename}
        />
      </Stack>
    </DialogPanel>
  )
}
