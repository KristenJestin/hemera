import { type ReactNode, useState } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import type { MarkState } from '../../components/status-mark/mark-legends.ts'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconChevronRight,
  IconExternalLink,
  IconGitBranch,
  IconGitCompare,
  IconHandStop,
  IconPackage,
  IconPlayerStop,
  IconRefresh,
  IconRocket,
  IconSend,
  IconTerminal,
  IconTestPipe,
} from '../../icons.ts'
import { CODE, Chevron, ID, QUIET, Unfolding } from '../../surfaces/review/review-parts.tsx'
import type {
  DeliveryWave,
  ForgeAction,
  RepositoryDelivery,
  RepositoryState,
  Step,
  StepKind,
} from './types.ts'

/**
 * The delivery as the Shipping page draws it: the waves in their order, each a frame of the
 * repositories that take part in it (a repository that does not take part is not drawn), one line
 * each — its mark, its name, its current step and what that step waits on — that unfolds to its
 * steps. A step is one line: its mark, its kind's glyph, its name, what it acts on, its outcome
 * with the forge's link; a CI step lists its checks with theirs; a failure says the forge's message
 * verbatim, masked, under its step, with Retry and what else the forge allows. A repository that
 * calls for the user (failed, waiting for a click) stands open; the others are folded.
 *
 * Each repository's line leads to its delivery view, a sheet over the page (open question 76,
 * settled by the mission frame: a stack): its steps again, each with its Journal lines.
 */

export interface DeliveryHandlers {
  onRetry: (repository: string, step: string) => void
  onForge: (repository: string, step: string, action: ForgeAction['id']) => void
  onOpenLink: (url: string) => void
  onOpenDelivery: (repository: string) => void
}

/** The mark of a repository: each state the status mark that means it everywhere else. */
export const REPOSITORY_MARK: Record<RepositoryState, MarkState> = {
  todo: 'todo',
  running: 'running',
  // Someone outside Hemera holds it: the dotted ring of what Hemera does not run, as the ball's.
  waiting: 'todo',
  needsYou: 'waiting',
  failed: 'failed',
  stopped: 'skipped',
  delivered: 'done',
}

export const REPOSITORY_WORDS: Record<RepositoryState, string> = {
  todo: 'Not started',
  running: 'Running',
  waiting: 'Waiting on someone',
  needsYou: 'Needs you',
  failed: 'Failed',
  stopped: 'Stopped',
  delivered: 'Delivered',
}

function stepGlyph(kind: StepKind): ReactNode {
  switch (kind) {
    case 'push':
      return <IconSend size="sm" />
    case 'pullRequest':
      return <IconGitCompare size="sm" />
    case 'merge':
      return <IconGitBranch size="sm" />
    case 'ci':
      return <IconTestPipe size="sm" />
    case 'bump':
    case 'version':
      return <IconPackage size="sm" />
    case 'remote':
      return <IconRocket size="sm" />
    case 'confirm':
      return <IconHandStop size="sm" />
    case 'command':
      return <IconTerminal size="sm" />
  }
}

/** The step a repository is at: the first not done, or its last once every one is. */
export function currentStep(delivery: RepositoryDelivery): Step | undefined {
  return delivery.steps.find((one) => one.state !== 'done') ?? delivery.steps.at(-1)
}

const calls = (state: RepositoryState): boolean => state === 'failed' || state === 'needsYou'

const ACTION_ICONS: Record<ForgeAction['id'], ReactNode> = {
  'rerun-failed': <IconRefresh size="sm" />,
  'stop-pipeline': <IconPlayerStop size="sm" />,
  approve: <IconHandStop size="sm" />,
}

/** A link to the forge, said by its icon, its target named for whoever cannot see it. */
function ForgeLink({
  url,
  label,
  onOpenLink,
}: {
  url: string
  label: string
  onOpenLink: (url: string) => void
}): ReactNode {
  return (
    <Tooltip label={label}>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label={label}
        icon={<IconExternalLink size="sm" />}
        onClick={() => onOpenLink(url)}
      />
    </Tooltip>
  )
}

/** A step's failure: the forge's words as they came, then Retry and what the forge allows. */
function Failure({
  repository,
  step,
  handlers,
}: {
  repository: string
  step: Step
  handlers: DeliveryHandlers
}): ReactNode {
  if (step.failure === undefined) return null
  return (
    <div className="flex flex-col gap-2 pt-1 pb-2">
      <pre className={CODE} aria-label={`What ${step.name} said`}>
        <code>{step.failure}</code>
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          aria-label={`Retry ${repository} · ${step.name}`}
          onClick={() => handlers.onRetry(repository, step.id)}
        >
          <IconRefresh size="sm" />
          Retry
        </Button>
        {(step.actions ?? []).map((action) => (
          <Button
            key={action.id}
            variant="secondary"
            size="sm"
            onClick={() => handlers.onForge(repository, step.id, action.id)}
          >
            {ACTION_ICONS[action.id]}
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** What a running step allows on the forge: stop its pipeline. */
function Running({
  repository,
  step,
  handlers,
}: {
  repository: string
  step: Step
  handlers: DeliveryHandlers
}): ReactNode {
  if (step.state !== 'running' || step.actions === undefined) return null
  return (
    <div className="flex flex-wrap gap-2 pb-2">
      {step.actions.map((action) => (
        <Button
          key={action.id}
          variant="ghost"
          size="sm"
          aria-label={`${action.label} of ${repository} · ${step.name}`}
          onClick={() => handlers.onForge(repository, step.id, action.id)}
        >
          {ACTION_ICONS[action.id]}
          {action.label}
        </Button>
      ))}
    </div>
  )
}

/** One step: its line, its checks, its failure; with `journal`, the lines it wrote. */
export function StepLine({
  repository,
  step,
  handlers,
  journal = false,
}: {
  repository: string
  step: Step
  handlers: DeliveryHandlers
  journal?: boolean | undefined
}): ReactNode {
  return (
    <li className="flex flex-col" aria-label={step.name}>
      <div className="flex min-h-control-md min-w-0 items-center gap-2 text-sm">
        <StatusMark state={step.state} size="sm" legend />
        <span aria-hidden="true" className="flex shrink-0 text-muted-foreground">
          {stepGlyph(step.kind)}
        </span>
        <span className="shrink-0 font-medium">{step.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={step.task}>
          {step.task}
        </span>
        {step.waits !== undefined && step.state !== 'done' && (
          <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
            {step.waits}
          </span>
        )}
        {step.outcome !== undefined && <span className={QUIET}>{step.outcome}</span>}
        {step.url !== undefined && (
          <ForgeLink
            url={step.url}
            label={`Open ${repository} · ${step.name} on the forge`}
            onOpenLink={handlers.onOpenLink}
          />
        )}
      </div>
      <div className="flex flex-col pl-6">
        {step.checks !== undefined && step.state !== 'todo' && (
          <ul aria-label={`Checks of ${repository} · ${step.name}`} className="flex flex-col pb-1">
            {step.checks.map((one) => (
              <li key={one.name} className="flex min-h-control-sm items-center gap-2 text-xs">
                <StatusMark state={one.state} size="sm" legend />
                <span className="min-w-0 flex-1 truncate">{one.name}</span>
                <ForgeLink
                  url={one.url}
                  label={`Open ${one.name} of ${repository} on the forge`}
                  onOpenLink={handlers.onOpenLink}
                />
              </li>
            ))}
          </ul>
        )}
        <Failure repository={repository} step={step} handlers={handlers} />
        <Running repository={repository} step={step} handlers={handlers} />
        {journal && step.journal !== undefined && (
          <ol aria-label={`Journal of ${step.name}`} className="flex flex-col gap-0.5 pb-2">
            {step.journal.map((line) => (
              <li key={`${line.at} ${line.text}`} className="flex min-w-0 gap-3 text-xs">
                <span className={ID}>{line.at}</span>
                <span className="min-w-0 text-muted-foreground break-words">{line.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  )
}

/** A repository in its wave: one line, open on its steps, its delivery view a press away. */
function RepositoryLine({
  delivery,
  wave,
  handlers,
}: {
  delivery: RepositoryDelivery
  wave: number
  handlers: DeliveryHandlers
}): ReactNode {
  const [open, setOpen] = useState(calls(delivery.state))
  const step = currentStep(delivery)
  const name = delivery.repository
  const summary =
    delivery.state === 'todo'
      ? `Not started · after wave ${String(wave - 1)}`
      : delivery.state === 'delivered'
        ? `Delivered · ${delivery.steps.findLast((one) => one.outcome !== undefined)?.outcome ?? ''}`
        : step === undefined
          ? ''
          : `${step.name} · ${step.waits ?? step.task}`
  return (
    <li className="flex flex-col" aria-label={name}>
      <div className="flex min-w-0 items-center pr-2 pl-4 hover:tinted hover-motion">
        <Legend label={REPOSITORY_WORDS[delivery.state]}>
          <span className="flex" data-repository-state={delivery.state}>
            <StatusMark state={REPOSITORY_MARK[delivery.state]} size="sm" />
          </span>
        </Legend>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${name}: ${summary}`}
          className="flex min-h-control-md min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm outline-none focus-ring"
          onClick={() => setOpen(!open)}
        >
          <Chevron open={open} />
          <span className="max-w-chip min-w-0 shrink-0 truncate font-mono text-xs" title={name}>
            {name}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
          {calls(delivery.state) && (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
          )}
        </button>
        <Tooltip label={`Open the delivery of ${name}`}>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={`Open the delivery of ${name}`}
            icon={<IconChevronRight size="sm" />}
            onClick={() => handlers.onOpenDelivery(name)}
          />
        </Tooltip>
      </div>
      <Unfolding open={open}>
        <ol aria-label={`Steps of ${name}`} className="flex flex-col pr-4 pb-2 pl-10">
          {delivery.steps.map((one) => (
            <StepLine key={one.id} repository={name} step={one} handlers={handlers} />
          ))}
        </ol>
      </Unfolding>
    </li>
  )
}

/** A wave: its number, how far it is, and its repositories. */
function Wave({ wave, handlers }: { wave: DeliveryWave; handlers: DeliveryHandlers }): ReactNode {
  const delivered = wave.repositories.filter((one) => one.state === 'delivered').length
  const label = `Wave ${String(wave.n)}`
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
        <span className="text-foreground">{label}</span>
        <span className="tabular-nums">{`${String(delivered)} of ${String(wave.repositories.length)} delivered`}</span>
      </h2>
      <Frame>
        <ul className="flex flex-col py-1">
          {wave.repositories.map((one) => (
            <RepositoryLine key={one.repository} delivery={one} wave={wave.n} handlers={handlers} />
          ))}
        </ul>
      </Frame>
    </section>
  )
}

/** The waves in their order. */
export function Waves({
  waves,
  handlers,
}: {
  waves: readonly DeliveryWave[]
  handlers: DeliveryHandlers
}): ReactNode {
  return (
    <div className="flex flex-col gap-5" aria-label="Delivery" role="group">
      {waves.map((wave) => (
        <Wave key={wave.n} wave={wave} handlers={handlers} />
      ))}
    </div>
  )
}

/** One repository's delivery, as its view over the page says it: its steps and their Journal. */
export function DeliveryView({
  delivery,
  wave,
  handlers,
}: {
  delivery: RepositoryDelivery
  wave: number
  handlers: DeliveryHandlers
}): ReactNode {
  const done = delivery.steps.filter((one) => one.state === 'done').length
  return (
    <div className="flex max-w-page flex-col gap-4 px-6 py-5">
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <StatusMark state={REPOSITORY_MARK[delivery.state]} size="sm" />
        <span className="font-medium">{REPOSITORY_WORDS[delivery.state]}</span>
        <span className="text-muted-foreground">
          {`Wave ${String(wave)} · ${String(done)} of ${String(delivery.steps.length)} steps`}
        </span>
      </p>
      <ol aria-label={`Steps of ${delivery.repository}`} className="flex flex-col">
        {delivery.steps.map((one) => (
          <StepLine
            key={one.id}
            repository={delivery.repository}
            step={one}
            handlers={handlers}
            journal
          />
        ))}
      </ol>
    </div>
  )
}
