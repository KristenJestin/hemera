import type { ReactNode } from 'react'

import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import { IconSettings } from '../../icons.ts'
import { ProjectSettings } from './project-settings.tsx'
import { fixtureBodyOf } from './settings-body-fixtures.tsx'
import { fixtureFormOf } from './settings-fixture-forms.tsx'
import { type SettingsFixtureProps, useFixtureState } from './settings-state-fixtures.ts'
import { LATER_SECTIONS, SECTIONS } from './settings-sections.tsx'
import {
  LONG_PATH,
  MAIN_CHECKOUT,
} from '../../blocks/project-settings/project-settings-fixtures.ts'

/**
 * A small machine around the settings of Acme, so a story walks what a user walks: a section
 * chosen, a dialog opened from a line, a draft written, saved or refused. Nothing here is an
 * engine: a story holds the state the renderer's hooks will hold.
 */
export function SettingsFixture(props: SettingsFixtureProps): ReactNode {
  const { dense = false, loading = false, empty = false, long = false, project = 'acme' } = props
  const state = useFixtureState(props)
  const name = project === 'hemera' ? 'Hemera' : 'Acme'

  const unreadable = state.repositories.filter((one) => one.unreadable !== undefined)
  // The later sections, exclusive resources among them, have no problem drawn in this fixture.
  const problems = new Map<string, string | undefined>(
    Object.entries({
      repositories:
        unreadable.length === 0
          ? undefined
          : `${unreadable.map((one) => one.path).join(', ')} cannot be read`,
      preparation: state.steps.some((one) => one.problem !== undefined)
        ? 'a source is missing'
        : undefined,
      services: state.runs.some((one) => one.kind === 'live' && one.state === 'failed')
        ? 'a service failed'
        : undefined,
    }),
  )
  const sections = [...SECTIONS, ...(dense ? LATER_SECTIONS : [])].map((one) => ({
    id: one.id,
    label: one.label,
    icon: one.icon,
    problem: problems.get(one.id),
  }))

  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={[
          { id: 'project', label: name, onPress: () => {} },
          { id: 'settings', label: 'Settings', icon: <IconSettings size="sm" /> },
        ]}
        controls={<SystemControls />}
      />
      <ProjectSettings
        setUp={props.setUp}
        name={name}
        mainCheckout={project === 'hemera' ? '~/work/hemera' : long ? LONG_PATH : MAIN_CHECKOUT}
        sections={sections}
        current={state.current}
        onSection={state.setCurrent}
        error={props.error}
        onRetry={() => {}}
        form={fixtureFormOf(state)}
        onCloseForm={state.close}
      >
        {fixtureBodyOf(state, { loading, empty, project }, sections)}
      </ProjectSettings>
    </main>
  )
}
