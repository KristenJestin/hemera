import type { ReactNode } from 'react'

import { SettingsPage, type SettingsForm } from '../settings/settings-page.tsx'
import { type AppSection, SECTIONS } from './app-sections.tsx'

export interface AppSettingsProps {
  current: AppSection
  onSection: (section: AppSection) => void
  /** What is wrong in a section, in words, by section. */
  problems?: Partial<Record<AppSection, string>> | undefined
  /** Whether the section was opened by a link: its heading takes the focus. */
  focus?: boolean | undefined
  /** The form open over the page, in the settings' dialog: the Jev key's. */
  form?: SettingsForm | null | undefined
  onCloseForm?: (() => void) | undefined
  /** The section chosen. */
  children: ReactNode
}

/**
 * Gives the focus to the first heading of the section a link opened, once it is drawn: a section
 * still being read draws its heading later, and the focus waits for it.
 */
const focusHeading = (node: HTMLDivElement | null): (() => void) | undefined => {
  if (node === null) return undefined
  const focused = (): boolean => {
    const heading = node.querySelector<HTMLElement>('h2, h3')
    if (heading === null) return false
    heading.tabIndex = -1
    heading.focus()
    return true
  }
  if (focused()) return undefined
  const watching = new MutationObserver(() => {
    if (focused()) watching.disconnect()
  })
  watching.observe(node, { childList: true, subtree: true })
  return () => watching.disconnect()
}

export function AppSettings({
  current,
  onSection,
  problems = {},
  focus = false,
  form = null,
  onCloseForm = () => undefined,
  children,
}: AppSettingsProps): ReactNode {
  return (
    <SettingsPage
      title="Settings"
      label="Settings of Hemera"
      sections={SECTIONS.map((section) => ({ ...section, problem: problems[section.id] }))}
      current={current}
      onSection={(id) => {
        const chosen = SECTIONS.find((section) => section.id === id)
        if (chosen !== undefined) onSection(chosen.id)
      }}
      form={form}
      onCloseForm={onCloseForm}
    >
      <div key={current} ref={focus ? focusHeading : undefined} className="flex flex-col gap-8">
        {children}
      </div>
    </SettingsPage>
  )
}
