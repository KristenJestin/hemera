import { type ReactNode, useEffect, useState } from 'react'

import { COMMAND_TYPE_ICONS } from '../activity/command-type.ts'
import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { IconCheck, IconPencil, IconPlus, IconX } from '../icons.ts'
import { CheckDialog, WHEN_LABELS, whereLabel } from './check-dialog.tsx'
import type { CheckLine, CommandLine, RepositoryLine } from './model.ts'

/**
 * The checks of a Project's build (D10-06): what Hemera runs to judge the agent's work, the Build
 * section of the Project's settings.
 *
 * A row says what the check is called, what it runs — a command of the catalogue, with its type,
 * or a line of the user's — where and when it runs, the number its output has to show, and the
 * files its `{files}` stands for. Every addition and every edit is a dialog, as for the commands.
 *
 * Checks are optional. With none, every task of a build is done, not verified, and the card says
 * so. A Project with none is proposed some from the types of its catalogue's commands (scenario
 * "Defaults come from the catalogue"): they are shown as proposals, which can be edited or taken
 * out one by one, and nothing is saved until "Use these checks" — or "Discard", which proposes
 * nothing more.
 */

const NOTE = 'text-sm text-muted-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const NAME = 'shrink-0 text-sm font-medium text-foreground'

const LINE = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

const CLUSTER = 'flex shrink-0 flex-wrap items-center justify-end gap-1'

const PROPOSED =
  'flex flex-col gap-3 rounded-lg border border-dashed border-primary/40 bg-primary-muted/40 p-3'

const PROPOSED_HEAD = 'flex flex-col gap-0.5'

const PROPOSED_TITLE = 'text-sm font-medium text-foreground'

/** No proposal: one array for every render, so the proposals are not taken again each time. */
const NONE: readonly CheckLine[] = []

export interface BuildChecksProps {
  /** The checks the Project has saved. */
  checks: readonly CheckLine[]
  /** Checks proposed from the catalogue's types while none is saved; nothing of them is saved. */
  proposed?: readonly CheckLine[] | undefined
  /** The catalogue, which a check runs a command of. */
  commands: readonly CommandLine[]
  /** The Project's repositories, one of which a check may run in. */
  repositories: readonly RepositoryLine[]
  /** Adds a check; answers the refusal to show in the dialog, or null. */
  onAdd: (check: CheckLine) => Promise<string | null>
  /** Rewrites a check, found by its id; answers like `onAdd`. */
  onUpdate: (check: CheckLine) => Promise<string | null>
  onRemove: (id: string) => void
  /** Saves the proposals as they stand, edits included; answers the refusal to show, or null. */
  onAcceptProposed: (checks: CheckLine[]) => Promise<string | null>
  /** Puts the proposals away: nothing is saved, and nothing is proposed again. */
  onDiscardProposed: () => void
}

/** One check on its row: its name, what it runs, and where, when and what it expects as badges. */
function CheckRow({
  check,
  commands,
  repositories,
  onEdit,
  onRemove,
  removeLabel,
}: {
  check: CheckLine
  commands: readonly CommandLine[]
  repositories: readonly RepositoryLine[]
  onEdit: () => void
  onRemove: () => void
  /** What the removal is called: a saved check is removed, a proposal is left out. */
  removeLabel: string
}): ReactNode {
  const command = commands.find((one) => one.id === check.commandId)
  const TypeIcon = command === undefined ? undefined : COMMAND_TYPE_ICONS[command.type]
  return (
    <CardRow>
      <span className={NAME}>{check.name}</span>
      <span className={LINE}>{command === undefined ? (check.line ?? '') : command.command}</span>
      <span className={CLUSTER}>
        {command !== undefined && TypeIcon !== undefined && (
          <Badge tone="neutral" icon={<TypeIcon size="sm" aria-hidden="true" />}>
            {command.name}
          </Badge>
        )}
        <Badge tone="neutral">{whereLabel(check, repositories)}</Badge>
        <Badge tone="info">{WHEN_LABELS[check.when]}</Badge>
        {check.expect !== null && (
          <Badge tone="neutral">{`at least ${String(check.expect.minimum)}`}</Badge>
        )}
        {check.files !== null && <Badge tone="neutral">{`{files} · ${check.files}`}</Badge>}
      </span>
      <IconButton
        variant="ghost"
        size="sm"
        icon={<IconPencil size="sm" />}
        aria-label={`Edit ${check.name}`}
        onClick={onEdit}
      />
      <IconButton
        variant="ghost"
        size="sm"
        icon={<IconX size="sm" />}
        aria-label={`${removeLabel} ${check.name}`}
        onClick={onRemove}
      />
    </CardRow>
  )
}

export function BuildChecks({
  checks,
  proposed = NONE,
  commands,
  repositories,
  onAdd,
  onUpdate,
  onRemove,
  onAcceptProposed,
  onDiscardProposed,
}: BuildChecksProps): ReactNode {
  // The proposals as the user edits them: nothing of them reaches the engine before "Use these
  // checks". Taken again from what the engine proposes whenever it proposes something else.
  const [proposals, setProposals] = useState<CheckLine[]>([...proposed])
  useEffect(() => setProposals([...proposed]), [proposed])
  /**
   * What the dialog edits: a saved check, a proposal, or nothing when it adds one. Kept while the
   * dialog closes, so it does not change its title on its way out.
   */
  const [editing, setEditing] = useState<{ check: CheckLine; proposal: boolean } | null>(null)
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)

  const openOn = (check: CheckLine | null, proposal = false) => {
    setEditing(check === null ? null : { check, proposal })
    setOpen(true)
  }

  const submit = async (check: CheckLine): Promise<string | null> => {
    if (editing?.proposal === true) {
      const was = editing.check.id
      setProposals((now) => now.map((one) => (one.id === was ? check : one)))
      return null
    }
    return editing === null ? await onAdd(check) : await onUpdate(check)
  }

  const accept = async () => {
    setAccepting(true)
    setRefusal(await onAcceptProposed(proposals))
    setAccepting(false)
  }

  const showing = checks.length === 0 && proposals.length > 0
  // The names a check may not take: the other proposals for a proposal, the saved checks else.
  const names = (editing?.proposal === true ? proposals : checks).map((one) => one.name)

  return (
    <Card
      title="Checks"
      description="What Hemera runs to judge the agent's work, and where and when. The agent never runs them."
      actions={
        <Button variant="secondary" size="sm" onClick={() => openOn(null)}>
          <IconPlus size="sm" />
          Add check
        </Button>
      }
    >
      {checks.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Checks">
          {checks.map((check) => (
            <li key={check.id}>
              <CheckRow
                check={check}
                commands={commands}
                repositories={repositories}
                onEdit={() => openOn(check)}
                onRemove={() => onRemove(check.id)}
                removeLabel="Remove"
              />
            </li>
          ))}
        </ul>
      ) : showing ? (
        <section aria-label="Proposed checks" className={PROPOSED}>
          <div className={PROPOSED_HEAD}>
            <h3 className={PROPOSED_TITLE}>Proposed from your commands</h3>
            <p className={NOTE}>
              Read from the types of the catalogue's commands. Nothing is saved until you use them.
            </p>
          </div>
          <ul className="flex flex-col gap-2" aria-label="Proposed checks">
            {proposals.map((check) => (
              <li key={check.id}>
                <CheckRow
                  check={check}
                  commands={commands}
                  repositories={repositories}
                  onEdit={() => openOn(check, true)}
                  onRemove={() => setProposals((now) => now.filter((one) => one.id !== check.id))}
                  removeLabel="Leave out"
                />
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              state={accepting ? 'loading' : 'idle'}
              onClick={() => void accept()}
            >
              <IconCheck size="sm" />
              Use these checks
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setProposals([])
                onDiscardProposed()
              }}
            >
              Discard
            </Button>
          </div>
        </section>
      ) : (
        <p className={NOTE}>
          No check is set, so every task of a build is done, not verified: nothing judges the
          agent's work. Add one, from the catalogue or as a line of yours.
        </p>
      )}
      {refusal !== null && (
        <p role="alert" className={REFUSAL}>
          {refusal}
        </p>
      )}

      <CheckDialog
        open={open}
        onOpenChange={setOpen}
        check={editing?.check ?? null}
        commands={commands}
        repositories={repositories}
        takenNames={names}
        onSubmit={submit}
      />
    </Card>
  )
}
