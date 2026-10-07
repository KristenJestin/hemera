import type { ReactNode } from 'react'

import { IconButton } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import {
  type ModelChoice,
  ModelPicker,
  type PickerAgent,
} from '../../components/model-picker/model-picker.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconX } from '../../icons.ts'
import { Section, SectionRefusal } from './parts.tsx'

/**
 * The model each role runs on in a Project, over the application's: one row per role, its name and
 * its trigger. A role the Project overrides shows its own model, and the × that takes it back to the
 * application's; a role without override shows the application's model in the quiet tone, under
 * "App default", so what will run is always read on the row — as an empty Workspaces field shows
 * its default.
 *
 * The trigger is the model picker's: it opens on the role's model, with "Use the default" at the
 * head of the list, which is the × of the row said another way.
 */
export interface ProjectRoleModel {
  role: string
  /** The Project's own model for the role, or null for none. */
  override: ModelChoice | null
  /** The application's model for the role, which applies without an override. */
  appDefault: ModelChoice
}

const RULE = 'border-b border-border last:border-b-0'

const ROW = 'flex min-h-control-lg min-w-0 items-center gap-3 px-4 py-2'

const NAME = 'flex w-settings-name min-w-0 shrink-0 flex-col text-sm'

const DETAIL = 'truncate text-xs text-muted-foreground'

const END = 'flex min-w-0 flex-1 items-center justify-end gap-1'

/** The room the × takes, held on every row so the triggers line up. */
const RESET_ROOM = 'flex size-control-sm shrink-0 items-center justify-center'

export interface RoleModelsSectionProps {
  roles: readonly ProjectRoleModel[]
  /** The agents this machine has, and their models: what the picker offers. */
  agents: readonly PickerAgent[]
  loading?: boolean | undefined
  /** A role's new model, or null to take it back to the application's. */
  onChange: (role: string, choice: ModelChoice | null) => void
  onFavourite: (agent: string, model: string, favourite: boolean) => void
  onHide: (agent: string, model: string, hidden: boolean) => void
  /** A change the engine refused, in words: the rows stand as the engine keeps them. */
  error?: string | undefined
}

function RoleRow({
  model,
  agents,
  onChange,
  onFavourite,
  onHide,
}: {
  model: ProjectRoleModel
  agents: readonly PickerAgent[]
  onChange: (choice: ModelChoice | null) => void
  onFavourite: RoleModelsSectionProps['onFavourite']
  onHide: RoleModelsSectionProps['onHide']
}): ReactNode {
  const own = model.override !== null
  return (
    <li className={RULE} data-role={model.role}>
      <div className={ROW}>
        <span className={NAME}>
          <span className="truncate">{model.role}</span>
          {!own && <span className={DETAIL}>App default</span>}
        </span>
        <span className={END}>
          <ModelPicker
            label={`Model of ${model.role}`}
            agents={agents}
            value={model.override}
            fallback={model.appDefault}
            onChange={onChange}
            onFavourite={onFavourite}
            onHide={onHide}
          />
          <span className={RESET_ROOM}>
            {own && (
              <Tooltip label="Back to the app default">
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconX size="sm" />}
                  aria-label={`Back to the app default for ${model.role}`}
                  onClick={() => onChange(null)}
                />
              </Tooltip>
            )}
          </span>
        </span>
      </div>
    </li>
  )
}

function RoleRowSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <div className={ROW}>
        <span className={NAME}>
          <Skeleton>Reviewer</Skeleton>
        </span>
        <span className={END}>
          <Skeleton shape="block">
            <span className="flex h-control-sm text-sm">Sonnet · medium</span>
          </Skeleton>
          <span className={RESET_ROOM} />
        </span>
      </div>
    </li>
  )
}

export function RoleModelsSection({
  roles,
  agents,
  loading = false,
  onChange,
  onFavourite,
  onHide,
  error,
}: RoleModelsSectionProps): ReactNode {
  return (
    <Section label="Models by role">
      <SectionHead title="Models by role" />
      <SectionRefusal error={error} />
      <Frame>
        <ul aria-label="Models by role" aria-busy={loading} className="flex flex-col">
          {loading ? (
            <>
              <RoleRowSkeleton />
              <RoleRowSkeleton />
              <RoleRowSkeleton />
              <RoleRowSkeleton />
            </>
          ) : (
            roles.map((model) => (
              <RoleRow
                key={model.role}
                model={model}
                agents={agents}
                onChange={(choice) => onChange(model.role, choice)}
                onFavourite={onFavourite}
                onHide={onHide}
              />
            ))
          )}
        </ul>
      </Frame>
    </Section>
  )
}
