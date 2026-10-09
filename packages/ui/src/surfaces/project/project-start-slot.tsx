import { type ReactNode, use } from 'react'

import { Input } from '../../components/field/field.tsx'
import { Kbd } from '../../components/kbd/kbd.tsx'
import { IconSearch } from '../../icons.ts'
import { MissionField } from './project-page.tsx'

/**
 * The place of the start field in the stories and in the window's fixtures: a field of the
 * design system, named as the real one is, that takes the page's ref so a task leaving the page
 * hands the focus to it. The real field, its results and its triage are drawn by the start slot.
 */
export function ProjectStartSlot({ name }: { name: string }): ReactNode {
  const field = use(MissionField)
  return (
    <Input
      label={`Start a mission in ${name}`}
      icon={<IconSearch size="sm" />}
      placeholder="A ticket, an idea…"
      trailing={<Kbd keys="Ctrl+K" />}
      inputRef={field ?? undefined}
    />
  )
}
