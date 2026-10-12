import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { StageCard } from '../../blocks/mission/stage-card.tsx'
import { QuestionCard } from '../../blocks/planning/question-card.tsx'
import type { PlanningHandlers } from '../../blocks/planning/planning-types.ts'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Input, Textarea } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconBook2,
  IconChecklist,
  IconCopy,
  IconExternalLink,
  IconEye,
  IconGitBranch,
  IconGitCompare,
  IconHelpCircle,
  IconMessages,
  IconPhoto,
  IconPlayerPlay,
  IconRefresh,
  IconSend,
  IconTerminal,
  IconTestPipe,
  IconX,
} from '../../icons.ts'
import {
  CODE,
  Calls,
  Chevron,
  Fold,
  ID,
  LINE,
  MONO,
  PROSE,
  QUIET,
  ROW,
  Unfolding,
  plural,
} from './parts.tsx'
import type {
  Check,
  Proof,
  PullRequest,
  ReviewMoment,
  Round,
  Service,
  TeamComment,
} from './types.ts'

/**
 * The Review page's rail, top to bottom: what happens (the stage card, and Ship's re-runs while
 * it goes), what waits for the user (For you: the round's questions, the proofs to verify by hand,
 * the team's comments), then the rest, one quiet line each and folded — the services first, since
 * Review is where the user tests live, then the pull requests, the proofs, the checks, the
 * automatic review, the documentation and the changes. A line that calls wears the warning dot and
 * may stand open; nothing else does.
 */

export interface RailHandlers {
  onService: (name: string, action: 'start' | 'stop' | 'restart' | 'remove') => void
  onVerify: (id: string, verdict: { validated: boolean; reason?: string }) => void
  onTeam: (id: string, action: 'round' | 'dismiss', take: string) => void
  onPull: (repository: string, action: 'retry' | 'check') => void
  onOpenDiff: (where: string) => void
  onOpenLink: (url: string) => void
  onCopy: (text: string) => void
  question: Pick<
    PlanningHandlers,
    | 'onAnswer'
    | 'onWaitOnSomeone'
    | 'onCopyDraft'
    | 'onAcceptProposed'
    | 'onDismissProposed'
    | 'onDiscuss'
  >
}

// --- What happens ---------------------------------------------------------------------------

/** The stage card, the same as every stage's: the face, the line, where Review stands. */
export function ReviewCard({
  moment,
  loading,
}: {
  moment: ReviewMoment
  loading: boolean
}): ReactNode {
  return (
    <StageCard
      stage="Review"
      face={loading ? 'loading' : moment.face}
      line={loading ? 'Reading where Review stands' : moment.now}
      progress={loading ? { step: 'Review', detail: 'reading the proofs' } : moment.progress}
    />
  )
}

/** What Ship re-runs before it pushes, one line each, a red one with the end of its output. */
export function Reruns({ moment }: { moment: ReviewMoment }): ReactNode {
  if (moment.shipping === undefined) return null
  return (
    <Frame>
      <ul aria-label="Re-run before pushing" className="flex flex-col py-1">
        {moment.shipping.reruns.map((rerun) => (
          <li key={rerun.id} className="flex flex-col">
            <div className={ROW}>
              <StatusMark state={rerun.state} size="sm" legend />
              <span className="min-w-0 flex-1 truncate">{rerun.what}</span>
            </div>
            {rerun.tail !== undefined && (
              <pre className={cn(CODE, 'mx-4 mb-2 ml-10')}>
                <code>{rerun.tail.join('\n')}</code>
              </pre>
            )}
          </li>
        ))}
      </ul>
    </Frame>
  )
}

// --- For you --------------------------------------------------------------------------------

/** A proof verified by hand: its line, then how to verify it, Validate, or Refuse with a reason. */
function ProofToVerify({
  proof,
  onVerify,
}: {
  proof: Proof
  onVerify: RailHandlers['onVerify']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [refusing, setRefusing] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <span className="flex shrink-0 text-muted-foreground">
          <IconEye size="sm" />
        </span>
        <span className={ID}>{proof.id}</span>
        <span className="min-w-0 flex-1 truncate">{proof.title}</span>
        <Calls />
      </button>
      <Unfolding open={open}>
        <div className="flex flex-col gap-2 pr-4 pb-3 pl-10">
          <p className={PROSE}>{proof.steps}</p>
          {refusing ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (reason.trim() === '') return
                onVerify(proof.id, { validated: false, reason: reason.trim() })
              }}
            >
              <Input
                label={`Why ${proof.id} is refused`}
                size="sm"
                value={reason}
                onValueChange={setReason}
                placeholder="What you saw instead"
              />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm">
                  Refuse
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRefusing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                aria-label={`Validate ${proof.id}`}
                onClick={() => onVerify(proof.id, { validated: true })}
              >
                Validate
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Refuse ${proof.id}`}
                onClick={() => setRefusing(true)}
              >
                Refuse
              </Button>
            </div>
          )}
        </div>
      </Unfolding>
    </li>
  )
}

/**
 * A comment of the team: who, where, what — then, open, the agent's reading, the reply it drafted
 * (which stays here: the user copies it and answers on the forge), the user's own take, and what
 * to do with it: add it to the round, dismiss it, or open it on the forge.
 */
function TeamLine({
  comment,
  forge,
  names,
  handlers,
}: {
  comment: TeamComment
  forge: string
  names: readonly string[]
  handlers: RailHandlers
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [take, setTake] = useState(comment.take ?? '')
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <LetterAvatar name={comment.author} others={names} />
        <span className="shrink-0 font-medium">{comment.author}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{comment.text}</span>
        <Calls />
      </button>
      <Unfolding open={open}>
        <div className="flex flex-col gap-3 pr-4 pb-3 pl-10">
          <span className={cn(MONO, 'break-all whitespace-normal')}>{comment.anchor}</span>
          <p className={PROSE}>{comment.text}</p>
          <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
            <span className="text-xs font-medium text-muted-foreground">The agent reads it as</span>
            <p className={PROSE}>{comment.reading}</p>
          </div>
          <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              A reply drafted for you · stays here
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={`Copy the reply to ${comment.id}`}
                icon={<IconCopy size="sm" />}
                onClick={() => handlers.onCopy(comment.draft)}
              />
            </span>
            <p className={PROSE}>{comment.draft}</p>
          </div>
          <Textarea
            label={`My take on ${comment.id}`}
            rows={2}
            placeholder="It weighs more than the agent’s reading"
            value={take}
            onValueChange={setTake}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              aria-label={`Add ${comment.id} to the round`}
              onClick={() => handlers.onTeam(comment.id, 'round', take.trim())}
            >
              <IconSend size="sm" />
              Add to the round
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Dismiss ${comment.id}`}
              onClick={() => handlers.onTeam(comment.id, 'dismiss', take.trim())}
            >
              Dismiss
            </Button>
            <Button
              variant="link"
              size="sm"
              aria-label={`Open ${comment.id} on ${forge}`}
              onClick={() => handlers.onOpenLink(comment.url)}
            >
              <IconExternalLink size="sm" />
              {`Open on ${forge}`}
            </Button>
          </div>
        </div>
      </Unfolding>
    </li>
  )
}

/** The round's questions, wave by wave: only the open wave here; the answered ones are in the round. */
function RoundQuestions({
  round,
  handlers,
}: {
  round: Round
  handlers: RailHandlers['question']
}): ReactNode {
  const wave = round.waves.find((one) =>
    one.questions.some((question) => question.state === 'open'),
  )
  if (wave === undefined) return null
  const left = wave.questions.filter((question) => question.state === 'open')
  return (
    <Fold
      glyph={<IconHelpCircle size="sm" />}
      title={`Round ${String(round.n)} · questions`}
      detail={`${String(left.length)} to answer · wave ${String(wave.n)} of ${String(round.waves.length)}`}
      calls
      initiallyOpen
    >
      <div className="flex flex-col gap-3 px-4 pb-3">
        {left.map((question) => (
          <QuestionCard
            key={question.id}
            question={question}
            discussed={false}
            mentionables={[]}
            {...handlers}
          />
        ))}
      </div>
    </Fold>
  )
}

/** For you: what waits for the user, the questions first; one line each, opened on demand. */
export function ForYou({
  moment,
  handlers,
}: {
  moment: ReviewMoment
  handlers: RailHandlers
}): ReactNode {
  const grilling = moment.rounds.find((one) => one.state === 'grilling')
  const toVerify = moment.proofs.filter((one) => one.state === 'toVerify')
  const team = moment.team.filter((one) => one.state === 'new')
  const names = moment.team.map((one) => one.author)
  if (grilling === undefined && toVerify.length === 0 && team.length === 0) return null
  return (
    <section aria-label="For you" className="flex flex-col gap-2">
      <h2 className="px-4 text-xs font-medium text-muted-foreground">For you</h2>
      <Frame>
        <div className="flex flex-col py-1">
          {grilling !== undefined && (
            <RoundQuestions round={grilling} handlers={handlers.question} />
          )}
          {toVerify.length > 0 && (
            <ul aria-label="To verify by hand" className="flex flex-col">
              {toVerify.map((proof) => (
                <ProofToVerify key={proof.id} proof={proof} onVerify={handlers.onVerify} />
              ))}
            </ul>
          )}
          {team.length > 0 && (
            <ul aria-label="The team’s comments" className="flex flex-col">
              {team.map((comment) => (
                <TeamLine
                  key={comment.id}
                  comment={comment}
                  forge={moment.forge ?? 'the forge'}
                  names={names}
                  handlers={handlers}
                />
              ))}
            </ul>
          )}
        </div>
      </Frame>
    </section>
  )
}

// --- The rest -------------------------------------------------------------------------------

const SERVICE_MARK: Record<Service['state'], MarkState> = {
  running: 'running',
  starting: 'running',
  stopped: 'idle',
  failed: 'failed',
}

function servicesWords(services: readonly Service[]): string {
  const running = services.filter((one) => one.state === 'running').map((one) => one.name)
  const failed = services.filter((one) => one.state === 'failed').map((one) => one.name)
  const parts = [
    ...(running.length > 0 ? [`${running.join(', ')} running`] : []),
    ...(failed.length > 0 ? [`${failed.join(', ')} failed`] : []),
  ]
  return parts.length > 0 ? parts.join(' · ') : `${String(services.length)} to start`
}

/**
 * The services, one row each: its mark; its address while it runs, to open or to copy, or its
 * command; Restart while it runs, Start otherwise; and its ×, which stops a running one — a
 * running service is never removed — and removes one that does not run. A failed one says why.
 */
function Services({
  services,
  handlers,
}: {
  services: readonly Service[]
  handlers: RailHandlers
}): ReactNode {
  return (
    <Fold
      glyph={<IconTerminal size="sm" />}
      title="Services"
      detail={servicesWords(services)}
      calls={services.some((one) => one.state === 'failed')}
    >
      <ul aria-label="Services" className="flex flex-col pb-1 pl-6">
        {services.map((service) => {
          const runs = service.state === 'running' || service.state === 'starting'
          return (
            <li key={service.name} className="flex flex-col">
              <div className={cn(ROW, 'gap-1.5 pr-2')}>
                <StatusMark state={SERVICE_MARK[service.state]} size="sm" legend />
                <span className="shrink-0 font-medium">{service.name}</span>
                {runs && service.url !== undefined ? (
                  <>
                    <a
                      href={service.url}
                      className="min-w-0 flex-1 truncate rounded-sm font-mono text-xs text-primary-muted-foreground outline-none hover:text-primary focus-ring"
                      onClick={(event) => {
                        event.preventDefault()
                        handlers.onOpenLink(service.url ?? '')
                      }}
                    >
                      {service.url}
                    </a>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label={`Copy the address of ${service.name}`}
                      icon={<IconCopy size="sm" />}
                      onClick={() => handlers.onCopy(service.url ?? '')}
                    />
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label={`Restart ${service.name}`}
                      icon={<IconRefresh size="sm" />}
                      onClick={() => handlers.onService(service.name, 'restart')}
                    />
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                      {service.line}
                    </span>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label={`Start ${service.name}`}
                      icon={<IconPlayerPlay size="sm" />}
                      onClick={() => handlers.onService(service.name, 'start')}
                    />
                  </>
                )}
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={runs ? `Stop ${service.name}` : `Remove ${service.name}`}
                  icon={<IconX size="sm" />}
                  onClick={() => handlers.onService(service.name, runs ? 'stop' : 'remove')}
                />
              </div>
              {service.error !== undefined && (
                <p className="pr-4 pb-1.5 pl-10 text-xs text-destructive-muted-foreground">
                  {service.error}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </Fold>
  )
}

const PULL_MARK: Record<PullRequest['state'], MarkState> = {
  click: 'waiting',
  running: 'running',
  open: 'done',
  failed: 'failed',
  signedOut: 'blocked',
  merged: 'done',
}

const PULL_LEGEND: Record<PullRequest['state'], string> = {
  click: 'Waits for your click',
  running: 'Being pushed',
  open: 'Open',
  failed: 'Failed',
  signedOut: 'The forge’s CLI is signed out',
  merged: 'Merged',
}

const CI_WORDS: Record<MarkState, string> = {
  done: 'green',
  running: 'running',
  failed: 'red',
  todo: 'not started',
  waiting: 'waiting',
  blocked: 'blocked',
  skipped: 'skipped',
  idle: 'not started',
}

/** What a pull request's line says beside its name, where it stands. */
function pullWords(pull: PullRequest, forge: string): string {
  switch (pull.state) {
    case 'click':
      return 'Waits for your click'
    case 'running':
      return pull.step ?? 'pushing'
    case 'signedOut':
      return `${forge}’s CLI is signed out`
    case 'failed':
      return 'The push failed'
    case 'open':
    case 'merged':
      return pull.approvals === undefined
        ? ''
        : `${String(pull.approvals.given)} of ${String(pull.approvals.needed)} approvals`
  }
}

function pullsWords(pulls: readonly PullRequest[]): string {
  const open = pulls.filter((one) => one.state === 'open').length
  const failed = pulls.filter((one) => one.state === 'failed').map((one) => one.repository)
  const click = pulls.filter((one) => one.state === 'click').map((one) => one.repository)
  const parts = [
    `${String(open)} of ${String(pulls.length)} open`,
    ...(failed.length > 0 ? [`${failed.join(', ')} failed`] : []),
    ...(click.length > 0 ? [`${click.join(', ')} waits for you`] : []),
  ]
  return parts.join(' · ')
}

/** A pull request on its lines: where it stands, and what it says or offers there. */
function PullLine({
  pull,
  forge,
  handlers,
}: {
  pull: PullRequest
  forge: 'GitHub' | 'Bitbucket'
  handlers: RailHandlers
}): ReactNode {
  const images = pull.images
  return (
    <li className="flex flex-col gap-1 px-4 py-1.5 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Legend label={PULL_LEGEND[pull.state]}>
          <StatusMark state={PULL_MARK[pull.state]} size="sm" />
        </Legend>
        {pull.state === 'open' && pull.url !== undefined && pull.number !== undefined ? (
          <a
            href={pull.url}
            className="shrink-0 rounded-sm font-medium text-primary-muted-foreground outline-none hover:text-primary focus-ring"
            onClick={(event) => {
              event.preventDefault()
              handlers.onOpenLink(pull.url ?? '')
            }}
          >
            {`${pull.repository} #${String(pull.number)}`}
          </a>
        ) : (
          <span className="shrink-0 font-medium">{pull.repository}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {pullWords(pull, forge)}
        </span>
        {pull.ci !== undefined && (
          <Legend label={`CI: ${CI_WORDS[pull.ci]}`}>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              CI
              <StatusMark state={pull.ci} size="sm" />
            </span>
          </Legend>
        )}
        {pull.state === 'failed' && (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Retry ${pull.repository}`}
            onClick={() => handlers.onPull(pull.repository, 'retry')}
          >
            Retry
          </Button>
        )}
        {pull.state === 'signedOut' && (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Check ${pull.repository} again`}
            onClick={() => handlers.onPull(pull.repository, 'check')}
          >
            Check again
          </Button>
        )}
      </div>
      {pull.message !== undefined && (
        <pre className={cn(CODE, 'ml-6')}>
          <code>{pull.message}</code>
        </pre>
      )}
      {pull.command !== undefined && (
        <pre className={cn(CODE, 'ml-6')}>
          <code>{pull.command}</code>
        </pre>
      )}
      {pull.reviewers !== undefined && pull.reviewers.length > 0 && (
        <p className="ml-6 text-xs break-words text-muted-foreground">
          {`Reviewers · ${pull.reviewers.join(', ')}`}
        </p>
      )}
      {images !== undefined && images.names.length > 0 && (
        <Legend label={images.names.join(', ')}>
          <span className="ml-6 flex items-center gap-1 text-xs text-muted-foreground">
            <IconPhoto size="sm" />
            {forge === 'GitHub' && images.published
              ? `${plural(images.names.length, 'image', 'images')} published`
              : `${plural(images.names.length, 'image', 'images')} listed by name`}
          </span>
        </Legend>
      )}
    </li>
  )
}

const TEAM_MARK: Record<TeamComment['state'], MarkState> = {
  new: 'waiting',
  inRound: 'running',
  dismissed: 'skipped',
  resolved: 'done',
}

function PullRequests({
  pulls,
  forge,
  handlers,
}: {
  pulls: readonly PullRequest[]
  forge: 'GitHub' | 'Bitbucket'
  handlers: RailHandlers
}): ReactNode {
  if (pulls.length === 0) return null
  return (
    <Fold
      glyph={<IconGitBranch size="sm" />}
      title="Pull requests"
      detail={pullsWords(pulls)}
      calls={pulls.some((one) => one.state === 'failed' || one.state === 'click')}
    >
      <ul aria-label="Pull requests" className="flex flex-col pb-1 pl-6">
        {pulls.map((pull) => (
          <PullLine key={pull.repository} pull={pull} forge={forge} handlers={handlers} />
        ))}
      </ul>
    </Fold>
  )
}

/** The team's comments no longer waiting: resolved on the forge, added to a round, dismissed. */
function TeamSettled({
  team,
  forge,
  handlers,
}: {
  team: readonly TeamComment[]
  forge: string
  handlers: RailHandlers
}): ReactNode {
  const settled = team.filter((one) => one.state !== 'new')
  if (settled.length === 0) return null
  const resolved = settled.filter((one) => one.state === 'resolved').length
  return (
    <Fold
      glyph={<IconMessages size="sm" />}
      title="Team comments"
      detail={[
        ...(resolved > 0 ? [`${String(resolved)} resolved on ${forge}`] : []),
        ...(settled.length > resolved ? [`${String(settled.length - resolved)} taken`] : []),
      ].join(' · ')}
    >
      <ul aria-label="Team comments" className="flex flex-col pb-1 pl-6">
        {settled.map((comment) => (
          <li key={comment.id} className={ROW}>
            <StatusMark state={TEAM_MARK[comment.state]} size="sm" legend />
            <span className="shrink-0 font-medium">{comment.author}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{comment.text}</span>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={`Open ${comment.id} on ${forge}`}
              icon={<IconExternalLink size="sm" />}
              onClick={() => handlers.onOpenLink(comment.url)}
            />
          </li>
        ))}
      </ul>
    </Fold>
  )
}

/** A proof verified by hand, in words and as a mark. */
const HAND: Record<'toVerify' | 'validated' | 'refused', readonly [string, MarkState]> = {
  toVerify: ['To verify by hand', 'waiting'],
  validated: ['Validated by you', 'done'],
  refused: ['Refused by you', 'failed'],
}

/** A scenario's proof as marks: its red, then its green; or verified by hand, by the user. */
function ProofMarks({ proof }: { proof: Proof }): ReactNode {
  if (proof.how === 'hand') {
    const [legend, state] =
      HAND[proof.state === 'validated' || proof.state === 'refused' ? proof.state : 'toVerify']
    return (
      <Legend label={legend}>
        <span className="flex items-center gap-0.5">
          <span className="flex text-muted-foreground">
            <IconEye size="sm" />
          </span>
          <StatusMark state={state} size="sm" />
        </span>
      </Legend>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Legend label={`Red at ${proof.redAt ?? ''}`}>
        <StatusMark state="failed" size="sm" />
      </Legend>
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        →
      </span>
      <Legend label={proof.state === 'green' ? `Green at ${proof.greenAt ?? ''}` : 'Not green'}>
        <StatusMark state={proof.state === 'green' ? 'done' : 'todo'} size="sm" />
      </Legend>
    </span>
  )
}

/** The redo mark: a change made outside Hemera touches it, and Ship runs it again. */
function Redo(): ReactNode {
  return (
    <Legend label="To re-run at Ship: changed outside Hemera">
      <span className="flex text-warning">
        <IconRefresh size="sm" />
      </span>
    </Legend>
  )
}

function Proofs({ proofs }: { proofs: readonly Proof[] }): ReactNode {
  const tests = proofs.filter((one) => one.how === 'test')
  const green = tests.filter((one) => one.state === 'green').length
  const hand = proofs.filter((one) => one.how === 'hand')
  const toVerify = hand.filter((one) => one.state === 'toVerify').length
  const refused = hand.filter((one) => one.state === 'refused').length
  return (
    <Fold
      glyph={<IconTestPipe size="sm" />}
      title="Proofs"
      detail={[
        `${String(green)} of ${String(tests.length)} green`,
        ...(toVerify > 0 ? [`${String(toVerify)} to verify by hand`] : []),
        ...(refused > 0 ? [`${String(refused)} refused`] : []),
      ].join(' · ')}
      calls={refused > 0}
    >
      <ul aria-label="Proofs" className="flex flex-col pb-1 pl-6">
        {proofs.map((proof) => (
          <li key={proof.id} className="flex flex-col">
            <div className={cn(ROW, 'min-h-control-sm py-0.5')}>
              <ProofMarks proof={proof} />
              <span className={ID}>{proof.id}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{proof.title}</span>
              {proof.redo === true && <Redo />}
            </div>
            {proof.reason !== undefined && (
              <p className="pr-4 pb-1 pl-12 text-xs break-words text-destructive-muted-foreground">
                {proof.reason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Fold>
  )
}

/** The final checks, in full: open on entering Review, on a failure, or when one is to redo. */
function Checks({ checks, open }: { checks: readonly Check[]; open: boolean }): ReactNode {
  const failed = checks.filter((one) => one.state === 'failed')
  const done = checks.filter((one) => one.state === 'done').length
  return (
    <Fold
      glyph={<IconChecklist size="sm" />}
      title="Checks"
      detail={
        failed.length > 0
          ? failed.map((one) => `${one.repository} · ${one.name} failed`).join(', ')
          : `final · ${String(done)} of ${String(checks.length)} green`
      }
      calls={failed.length > 0}
      initiallyOpen={open || failed.length > 0}
    >
      <ul aria-label="Checks" className="flex flex-col pb-1 pl-6">
        {checks.map((check) => (
          <li
            key={`${check.repository}-${check.name}`}
            className={cn(ROW, 'min-h-control-sm py-0.5')}
          >
            <StatusMark state={check.state} size="sm" legend />
            <span className="min-w-0 flex-1 truncate">{`${check.repository} · ${check.name}`}</span>
            {check.redo === true && <Redo />}
            <span className={QUIET}>{check.after}</span>
          </li>
        ))}
      </ul>
    </Fold>
  )
}

const SEVERITY: Record<'blocking' | 'warning' | 'suggestion', string> = {
  blocking: 'text-destructive-muted-foreground',
  warning: 'text-warning-muted-foreground',
  suggestion: 'text-muted-foreground',
}

/**
 * What the automatic review saw, and what changed after it: the special tasks, which only the
 * checks cover; then each finding, and its fate.
 */
function AutomaticReview({ moment }: { moment: ReviewMoment }): ReactNode {
  return (
    <Fold
      glyph={<IconEye size="sm" />}
      title="Automatic review"
      detail={`${plural(moment.findings.length, 'finding', 'findings')} · ${String(moment.after.length)} changed after`}
    >
      <ul aria-label="Automatic review" className="flex flex-col gap-1 pb-2 pl-6">
        <li className="flex flex-col gap-0.5 px-4 py-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">It saw</span>
          <span className="break-words">{moment.saw}</span>
        </li>
        {moment.after.map((after) => (
          <li key={after.id} className="flex flex-col gap-0.5 px-4 py-1 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <Legend label="Covered by the checks only">
                <span className="flex text-warning">
                  <IconChecklist size="sm" />
                </span>
              </Legend>
              <span className={ID}>{after.id}</span>
              <span className="min-w-0 flex-1 truncate">{after.text}</span>
            </span>
            <span className={cn(MONO, 'pl-6')}>{after.files.join(' · ')}</span>
          </li>
        ))}
        {moment.findings.map((finding) => (
          <li key={finding.id} className="flex flex-col gap-0.5 px-4 py-1 text-sm">
            <span className="flex min-w-0 items-start gap-2">
              <Legend label={`${finding.severity} · ${finding.by}`}>
                <span className={cn('flex pt-0.5', SEVERITY[finding.severity])}>
                  <IconAlertTriangle size="sm" />
                </span>
              </Legend>
              <span className={ID}>{finding.id}</span>
              <span className="min-w-0 flex-1 break-words">{finding.text}</span>
            </span>
            <span className="pl-6 text-xs text-muted-foreground">{finding.fate}</span>
          </li>
        ))}
      </ul>
    </Fold>
  )
}

function Documentation({ reason }: { reason: string | undefined }): ReactNode {
  return (
    <Fold
      glyph={<IconBook2 size="sm" />}
      title="Documentation"
      detail={reason === undefined ? 'updated' : 'No change'}
    >
      <p className={cn(PROSE, 'px-4 pb-2 pl-10 text-muted-foreground')}>
        {reason ?? 'The documenter updated the pages the change touches.'}
      </p>
    </Fold>
  )
}

/** The changes per repository with their diff; a repository changed outside Hemera opens it and calls. */
function Changes({
  changes,
  onOpenDiff,
}: {
  changes: ReviewMoment['changes']
  onOpenDiff: (where: string) => void
}): ReactNode {
  const added = changes.reduce((sum, change) => sum + change.added, 0)
  const deleted = changes.reduce((sum, change) => sum + change.deleted, 0)
  const outside = changes.filter((change) => change.outside !== undefined)
  return (
    <Fold
      glyph={<IconGitCompare size="sm" />}
      title="Changes"
      detail={
        outside.length > 0
          ? `${outside.map((change) => change.repository).join(', ')} changed outside Hemera`
          : `${plural(changes.length, 'repository', 'repositories')} · +${String(added)} −${String(deleted)}`
      }
      calls={outside.length > 0}
      initiallyOpen={outside.length > 0}
    >
      <ul aria-label="Changes" className="flex flex-col pb-1 pl-6">
        {changes.map((change) => (
          <li key={change.repository} className="flex flex-col">
            <div className={ROW}>
              <span className="w-0 min-w-0 flex-1 truncate font-mono text-xs">
                {change.repository}
              </span>
              {change.outside !== undefined && (
                <Legend label={`${change.repository} changed outside Hemera`}>
                  <span className="flex text-warning">
                    <IconAlertTriangle size="sm" />
                  </span>
                </Legend>
              )}
              <span className={QUIET}>{plural(change.files, 'file', 'files')}</span>
              <span className="shrink-0 text-xs text-success-muted-foreground tabular-nums">{`+${String(change.added)}`}</span>
              <span className="shrink-0 text-xs text-destructive-muted-foreground tabular-nums">{`−${String(change.deleted)}`}</span>
              <Button
                variant="link"
                size="sm"
                aria-label={`Diff of ${change.repository}`}
                onClick={() => onOpenDiff(change.repository)}
              >
                Diff
              </Button>
            </div>
            {change.outside?.map((path) => (
              <span key={path} className={cn(MONO, 'pr-4 pb-0.5 pl-8')}>
                {path}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </Fold>
  )
}

/** The rest, one quiet line each. */
export function TheRest({
  moment,
  handlers,
}: {
  moment: ReviewMoment
  handlers: RailHandlers
}): ReactNode {
  return (
    <section aria-label="The rest" className="flex flex-col">
      <Services services={moment.services} handlers={handlers} />
      {moment.forge !== null && (
        <PullRequests pulls={moment.pulls} forge={moment.forge} handlers={handlers} />
      )}
      <TeamSettled team={moment.team} forge={moment.forge ?? 'the forge'} handlers={handlers} />
      <Proofs proofs={moment.proofs} />
      <Checks
        checks={moment.checks}
        open={moment.round === 0 || moment.checks.some((one) => one.redo === true)}
      />
      <AutomaticReview moment={moment} />
      <Documentation reason={moment.noDocChange} />
      <Changes changes={moment.changes} onOpenDiff={handlers.onOpenDiff} />
    </section>
  )
}
