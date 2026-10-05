import type { ReactNode } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconChevronDown, IconX } from '../../icons.ts'
import { Section } from './parts.tsx'

/**
 * The model each role runs on in a Project, over the application's: one row per role, its name and
 * its trigger. A role the Project overrides shows its own model, and the × that takes it back to the
 * application's; a role without override shows the application's model in the quiet tone, under
 * "App default", so what will run is always read on the row — as an empty Workspaces field shows
 * its default.
 *
 * The trigger is the slot of the model picker: pressing it opens the picker for that role. Until
 * the picker is built it is a plain button that says the model.
 */
export interface ProjectRoleModel {
  role: string
  /** The Project's own model for the role — `Codex · gpt-5.5 · medium` — or null for none. */
  override: string | null
  /** The application's model for the role, which applies without an override. */
  appDefault: string
}

const RULE = 'border-b border-border last:border-b-0'

const ROW = 'flex min-h-control-lg min-w-0 items-center gap-3 px-4 py-2'

const NAME = 'flex w-settings-name min-w-0 shrink-0 flex-col text-sm'

const DETAIL = 'truncate text-xs text-muted-foreground'

const END = 'flex min-w-0 flex-1 items-center justify-end gap-1'

const QUIET = 'min-w-0 truncate text-muted-foreground'

const OWN = 'min-w-0 truncate'

/** The trigger's room: as wide as a model's name, never wider than the row allows. */
const TRIGGER = 'min-w-0 max-w-full'

/** The room the × takes, held on every row so the triggers line up. */
const RESET_ROOM = 'flex size-control-sm shrink-0 items-center justify-center'

export interface RoleModelsSectionProps {
  roles: readonly ProjectRoleModel[]
  loading?: boolean | undefined
  /** Opens the model picker for a role. */
  onPick: (role: string) => void
  /** Takes a role back to the application's model. */
  onReset: (role: string) => void
  /**
   * Open question 62, while it is open: what a role without override shows — the application's
   * model in the quiet tone (`model`), or the words "App default" alone (`word`).
   */
  showsDefault?: 'model' | 'word' | undefined
}

function RoleRow({
  model,
  onPick,
  onReset,
  showsDefault,
}: {
  model: ProjectRoleModel
  onPick: () => void
  onReset: () => void
  showsDefault: 'model' | 'word'
}): ReactNode {
  const own = model.override !== null
  const word = !own && showsDefault === 'word'
  return (
    <li className={RULE} data-role={model.role}>
      <div className={ROW}>
        <span className={NAME}>
          <span className="truncate">{model.role}</span>
          {!own && !word && <span className={DETAIL}>App default</span>}
        </span>
        <span className={END}>
          <Button
            size="sm"
            className={TRIGGER}
            aria-label={
              own
                ? `Model of ${model.role}: ${model.override ?? ''}`
                : `Model of ${model.role}: app default, ${model.appDefault}`
            }
            onClick={onPick}
          >
            <span className={own ? OWN : QUIET}>
              {word ? 'App default' : (model.override ?? model.appDefault)}
            </span>
            <IconChevronDown size="sm" aria-hidden="true" />
          </Button>
          <span className={RESET_ROOM}>
            {own && (
              <Tooltip label="Back to the app default">
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconX size="sm" />}
                  aria-label={`Back to the app default for ${model.role}`}
                  onClick={onReset}
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
            <span className="flex h-control-sm text-sm">Claude Code · Sonnet · medium</span>
          </Skeleton>
          <span className={RESET_ROOM} />
        </span>
      </div>
    </li>
  )
}

export function RoleModelsSection({
  roles,
  loading = false,
  onPick,
  onReset,
  showsDefault = 'model',
}: RoleModelsSectionProps): ReactNode {
  return (
    <Section label="Models by role">
      <SectionHead title="Models by role" />
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
                onPick={() => onPick(model.role)}
                onReset={() => onReset(model.role)}
                showsDefault={showsDefault}
              />
            ))
          )}
        </ul>
      </Frame>
    </Section>
  )
}
