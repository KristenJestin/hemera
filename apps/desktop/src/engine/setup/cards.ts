/**
 * The setup agent's cards (#44): checked as the settings would check them, stored one per change
 * in one batch, and applied at the user's click through the very use cases the Project settings
 * call, so the engine refuses what the settings refuse, with their reason.
 *
 * - A call holding one change the settings would refuse is refused whole, with that reason, and
 *   nothing is stored.
 * - Accept applies one card; what only the disk or Git can say then (a remote that is not there)
 *   is the use case's to refuse, and keeps the card pending with its reason.
 * - Decline changes nothing. A decided card is never decided again.
 * - Accept all goes in the order proposed and stops at the first refusal.
 * - A card keeps its title, change and details masked; a change masking altered is held whole in
 *   memory, as a variable's value is, and refused at the click once an engine stopped.
 */

import {
  DEFAULT_BASE_BRANCH,
  MASK,
  type SetupCardState,
  type SetupChange,
  type SetupDetail,
  type SetupProposal,
  SETUP_CARD_STATES,
  SetupChange as SetupChangeSchema,
  VALUE_FORGOTTEN,
  checkedTemplate,
  maskedJson,
  setupChangeDetails,
  setupChangeTitle,
  variableKey,
} from '@hemera/core/domain'
import {
  type Command,
  type CommandDraft,
  type Project,
  type RecipeStepDraft,
  UnknownRemote,
  UnknownSetupCard,
} from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Option, Predicate, Result, Schema, Stream } from 'effect'

import { join } from 'node:path'

import { checkedCommand, listCommands, saveCommand } from '../catalogue.ts'
import { DomainEvents } from '../domain-events.ts'
import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { addRepository, checkedPath, getProject, setBaseBranch, setRemote } from '../projects.ts'
import { checkedStep, getRecipe, saveRecipe } from '../recipe.ts'
import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { setupCards } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { listVariables, setVariable } from '../variables.ts'
import { SetupValues } from './values.ts'

export interface SetupCard {
  readonly id: string
  readonly projectId: string
  readonly sessionId: string
  readonly batch: string
  readonly change: SetupChange
  readonly title: string
  readonly details: ReadonlyArray<SetupDetail>
  readonly state: SetupCardState
  readonly refusal: string | null
  readonly createdAt: string
  readonly decidedAt: string | null
}

const readChange = Schema.decodeUnknownOption(Schema.fromJsonString(SetupChangeSchema))
const Details = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
)
const readDetails = Schema.decodeUnknownOption(Details)

type Row = typeof setupCards.$inferSelect

const cardOf = (row: Row): SetupCard | null =>
  Option.match(readChange(row.change), {
    onNone: () => null,
    onSome: (change) => ({
      id: row.id,
      projectId: row.projectId,
      sessionId: row.sessionId,
      batch: row.batch,
      change,
      title: row.title,
      details: Option.getOrElse(readDetails(row.details), () => []),
      state: SETUP_CARD_STATES.find((one) => one === row.state) ?? 'pending',
      refusal: row.refusal,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    }),
  })

/** A Project's cards: the pending ones first, then the decided ones; each in the order proposed. */
export const cardsOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(setupCards)
      .where(eq(setupCards.projectId, projectId))
      .orderBy(asc(setupCards.createdAt), asc(setupCards.position))
      .pipe(Effect.mapError(refusedWhile('reading the setup cards')))
    const cards = rows.flatMap((row) => {
      const card = cardOf(row)
      return card === null ? [] : [card]
    })
    return [
      ...cards.filter((card) => card.state === 'pending'),
      ...cards.filter((card) => card.state !== 'pending'),
    ]
  })

// ---------------------------------------------------------------------------------------------
// Checking a call as the settings would.

/** What the settings would write of a proposed command, or why they would not. */
const commandDraft = (
  project: Project,
  change: Extract<SetupProposal, { readonly kind: 'command' }>,
) => {
  const repository =
    change.repository === undefined
      ? null
      : project.repositories.find((one) => one.path === change.repository)
  if (repository === undefined) {
    return Result.fail(`its repository ${change.repository ?? ''} is not declared in this Project`)
  }
  const draft: CommandDraft = {
    name: change.name,
    type: change.type,
    line: change.line,
    lineWindows: change.lineWindows ?? null,
    lineLinux: change.lineLinux ?? null,
    repositoryId: repository?.id ?? null,
    folder: change.folder ?? null,
    scope: 'workspace',
    portless: false,
    portlessName: null,
    check: change.check ?? false,
    atOpen: change.atOpen ?? false,
    askBeforeRunning: change.askBeforeRunning ?? false,
    readOnly: change.readOnly ?? false,
    writeGlobs: change.writeGlobs ?? [],
  }
  return Result.succeed(draft)
}

/** What the settings would write of a proposed step, or why they would not. */
const stepDraft = (
  project: Project,
  commands: ReadonlyArray<Pick<Command, 'id' | 'name'>>,
  change: Extract<SetupProposal, { readonly kind: 'step' }>,
) => {
  const repository =
    change.repository === undefined
      ? null
      : project.repositories.find((one) => one.path === change.repository)
  if (repository === undefined) {
    return Result.fail(`its repository ${change.repository ?? ''} is not declared in this Project`)
  }
  const command =
    change.command === undefined ? null : commands.find((one) => one.name === change.command)
  if (command === undefined) {
    return Result.fail(`no command of the catalogue is named ${change.command ?? ''}`)
  }
  const draft: RecipeStepDraft = {
    kind: change.step,
    repositoryId: repository?.id ?? null,
    path: change.path ?? null,
    commandId: command?.id ?? null,
    line: change.line ?? null,
  }
  return Result.succeed(draft)
}

/**
 * The setup as it will stand once what waits is accepted: the Project with the repositories its
 * pending cards and the call's earlier changes declare, and the catalogue with their commands.
 */
interface Planned {
  readonly project: Project
  readonly commands: ReadonlyArray<Pick<Command, 'id' | 'name'>>
}

/** What a proposed repository or command adds to the setup as it will stand. */
const plannedWith = (planned: Planned, change: SetupChange): Planned => {
  switch (change.kind) {
    case 'repository': {
      if (planned.project.repositories.some((one) => one.path === change.path)) return planned
      const repository = {
        id: `proposed:${change.path}`,
        projectId: planned.project.id,
        path: change.path,
        includedByDefault: true,
        remote: change.remote ?? null,
        baseBranch: change.baseBranch ?? DEFAULT_BASE_BRANCH,
        lastFetchedAt: null,
      }
      const repositories = [...planned.project.repositories, repository]
      return { ...planned, project: { ...planned.project, repositories } }
    }
    case 'command':
      return planned.commands.some((one) => one.name === change.name)
        ? planned
        : {
            ...planned,
            commands: [...planned.commands, { id: `proposed:${change.name}`, name: change.name }],
          }
    default:
      return planned
  }
}

/**
 * The first thing the settings would refuse of a change, as their sentence; null when none. A
 * repository is checked against the Project as it stands, a command or a step against the setup
 * as it will stand.
 */
const refusalOf = (project: Project, planned: Planned, change: SetupProposal, position: number) =>
  Effect.gen(function* () {
    const said = (failure: { readonly message: string }) => failure.message
    switch (change.kind) {
      case 'repository': {
        const checked = yield* checkedPath(project.mainCheckout, change.path).pipe(Effect.result)
        if (Result.isFailure(checked)) return said(checked.failure)
        return project.repositories.some((one) => one.path === checked.success)
          ? `${change.path} is already a repository of this Project`
          : null
      }
      case 'command': {
        const draft = commandDraft(planned.project, change)
        if (Result.isFailure(draft)) return draft.failure
        const checked = yield* checkedCommand(planned.project, draft.success).pipe(Effect.result)
        return Result.isFailure(checked) ? said(checked.failure) : null
      }
      case 'step': {
        const draft = stepDraft(planned.project, planned.commands, change)
        if (Result.isFailure(draft)) return draft.failure
        const checked = yield* checkedStep(planned.project, draft.success, position).pipe(
          Effect.result,
        )
        return Result.isFailure(checked) ? said(checked.failure) : null
      }
      case 'variable': {
        const key = variableKey(change.name)
        if (Result.isFailure(key)) return key.failure.message
        const template = checkedTemplate(change.value)
        return Result.isFailure(template) ? template.failure.message : null
      }
    }
  })

/** A proposal as its card keeps it: a variable without its value, and whether it replaces. */
const changeOf = (
  commands: ReadonlyArray<Command>,
  variables: ReadonlyArray<string>,
  proposal: SetupProposal,
): SetupChange => {
  switch (proposal.kind) {
    case 'variable':
      return { kind: 'variable', name: proposal.name, replaces: variables.includes(proposal.name) }
    case 'command':
      return { ...proposal, replaces: commands.some((one) => one.name === proposal.name) }
    default:
      return proposal
  }
}

/** A call refused whole, with the settings' reason for the change it names. */
export class ProposalRefused extends Schema.TaggedError<ProposalRefused>()('ProposalRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

/** A change as two cards compare it, whatever the order of its fields. */
const sameChange = (one: Schema.JsonObject, other: Schema.JsonObject): boolean =>
  JSON.stringify(one, Object.keys(one).toSorted()) ===
  JSON.stringify(other, Object.keys(other).toSorted())

/**
 * Checks a whole call as the settings would, against the setup as it will stand once the pending
 * cards are accepted, then stores one card per change in one batch, the values of its variables
 * held in memory only. A change a pending card already proposes (a variable: with the same value)
 * is not stored again. Answers the cards, the ones already pending said so.
 */
export const propose = (
  projectId: string,
  sessionId: string,
  proposals: ReadonlyArray<SetupProposal>,
) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const commands = yield* listCommands(projectId)
    const variables = (yield* listVariables({ projectId, workspaceId: null })).map((one) => one.key)
    const secrets = yield* Secrets
    const values = yield* SetupValues
    const pending = (yield* cardsOf(projectId)).filter((card) => card.state === 'pending')
    let planned: Planned = { project, commands }
    for (const card of pending) planned = plannedWith(planned, card.change)
    let steps =
      (yield* getRecipe(projectId)).length +
      pending.filter((card) => card.change.kind === 'step').length
    for (const proposal of proposals) {
      if (proposal.kind === 'step') steps += 1
      const refused = yield* refusalOf(project, planned, proposal, steps)
      if (refused !== null) {
        const title = setupChangeTitle(changeOf(commands, variables, proposal))
        return yield* new ProposalRefused({ reason: `${title}: ${refused}` })
      }
      planned = plannedWith(planned, changeOf(commands, variables, proposal))
    }
    const batch = crypto.randomUUID()
    const at = new Date().toISOString()
    const proposed = yield* Effect.forEach(proposals, (proposal, position) =>
      Effect.gen(function* () {
        const change = changeOf(commands, variables, proposal)
        const card = {
          id: crypto.randomUUID(),
          projectId,
          sessionId,
          batch,
          position,
          change,
          title: setupChangeTitle(change),
          state: 'pending',
          refusal: null,
          createdAt: at,
          decidedAt: null,
        }
        for (const one of pending) {
          if (!sameChange(one.change, secrets.maskRecord(change))) continue
          if (proposal.kind !== 'variable' || (yield* values.valueOf(one.id)) === proposal.value) {
            return { card, waits: one }
          }
        }
        // The values stay in memory, under their card's id; the cards never hold one.
        if (proposal.kind === 'variable') yield* values.hold(card.id, proposal.value)
        return { card, waits: null }
      }),
    )
    const written = proposed.flatMap((one) => (one.waits === null ? [one.card] : []))
    // A card keeps its change masked; a change masking altered is held whole in memory instead.
    const rows = yield* Effect.forEach(written, ({ change, ...row }) =>
      Effect.gen(function* () {
        const masked = maskedJson(secrets.maskRecord(change))
        if (masked !== JSON.stringify(change)) yield* values.holdChange(row.id, change)
        const details = setupChangeDetails(change).map((detail) => ({
          label: detail.label,
          value: secrets.mask(detail.value),
        }))
        return {
          ...row,
          change: masked,
          title: secrets.mask(row.title),
          details: JSON.stringify(details),
        }
      }),
    )
    if (rows.length > 0) {
      yield* mutate('storing the setup cards', (transaction) =>
        transaction
          .insert(setupCards)
          .values(rows)
          .pipe(
            Effect.mapError(refusedWhile('storing the setup cards')),
            Effect.as({
              result: undefined,
              events: [setupEvent('setup.proposed', projectId, { batch })],
            }),
          ),
      )
    }
    return proposed.map(({ card, waits }) =>
      waits === null
        ? { id: card.id, title: card.title, already: false }
        : { id: waits.id, title: waits.title, already: true },
    )
  })

const setupEvent = (
  type: string,
  projectId: string,
  payload: Record<string, string>,
  byUser = false,
): NewEvent => ({
  type,
  entityKind: 'project',
  entityId: projectId,
  source: byUser ? 'ui' : 'system',
  author: byUser ? 'human' : 'agent',
  payload: { projectId, ...payload },
})

// ---------------------------------------------------------------------------------------------
// Deciding.

const rowOf = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(setupCards)
      .where(eq(setupCards.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a setup card')))
    if (row === undefined) return yield* new UnknownSetupCard({ id })
    return row
  })

/**
 * What a command or a step needs that only a pending card proposes (its repository, the command
 * it runs), as the refusal at the click says it; null when nothing it needs waits.
 */
const waitingOn = (card: SetupCard, project: Project, change: SetupChange) =>
  Effect.gen(function* () {
    if (change.kind !== 'command' && change.kind !== 'step') return null
    const pending = (yield* cardsOf(card.projectId)).filter(
      (one) => one.state === 'pending' && one.id !== card.id,
    )
    const repository = change.repository
    if (
      repository !== undefined &&
      !project.repositories.some((one) => one.path === repository) &&
      pending.some((one) => one.change.kind === 'repository' && one.change.path === repository)
    ) {
      return `its repository ${repository} is still a proposal: accept it first`
    }
    if (change.kind !== 'step' || change.command === undefined) return null
    const command = change.command
    const commands = yield* listCommands(project.id)
    return !commands.some((one) => one.name === command) &&
      pending.some((one) => one.change.kind === 'command' && one.change.name === command)
      ? `the command ${command} is still a proposal: accept it first`
      : null
  })

/** Applies a change through the settings' own use cases; the use case's refusal, in words. */
const apply = (card: SetupCard) =>
  Effect.gen(function* () {
    // A change its card keeps masked is applied as held; forgotten by a stopped engine, refused.
    const held = yield* SetupValues.use((values) => values.changeOf(card.id))
    if (held === null && JSON.stringify(card.change).includes(MASK)) {
      return yield* new ProposalRefused({ reason: VALUE_FORGOTTEN })
    }
    const change = held ?? card.change
    const project = yield* getProject(card.projectId)
    const waits = yield* waitingOn(card, project, change)
    if (waits !== null) return yield* new ProposalRefused({ reason: waits })
    switch (change.kind) {
      case 'repository': {
        // The remote is Git's to confirm before anything is declared, so a refusal changes nothing.
        if (change.remote !== undefined) {
          const remotes = yield* Git.use((git) =>
            git.remotes(join(project.mainCheckout, change.path)),
          )
          if (!remotes.some((remote) => remote.name === change.remote)) {
            return yield* new UnknownRemote({ name: change.remote })
          }
        }
        // Declared already, by the user or by a click that got halfway: what is missing is done.
        const path = yield* checkedPath(project.mainCheckout, change.path)
        const declared = project.repositories.find((one) => one.path === path)
        const after =
          declared === undefined
            ? yield* addRepository({ projectId: project.id, version: project.version, path })
            : project
        const added = after.repositories.find((one) => one.path === path)
        if (added === undefined) return
        let version = after.version
        if (change.remote !== undefined && added.remote !== change.remote) {
          version = (yield* setRemote({ id: added.id, version, remote: change.remote })).version
        }
        if (change.baseBranch !== undefined && added.baseBranch !== change.baseBranch) {
          yield* setBaseBranch({ id: added.id, version, branch: change.baseBranch })
        }
        return
      }
      case 'command': {
        const draft = commandDraft(project, change)
        if (Result.isFailure(draft)) return yield* new ProposalRefused({ reason: draft.failure })
        const existing = (yield* listCommands(project.id)).find((one) => one.name === change.name)
        yield* saveCommand({
          projectId: project.id,
          id: existing?.id ?? null,
          command: draft.success,
        })
        return
      }
      case 'step': {
        const commands = yield* listCommands(project.id)
        const draft = stepDraft(project, commands, change)
        if (Result.isFailure(draft)) return yield* new ProposalRefused({ reason: draft.failure })
        const steps = yield* getRecipe(project.id)
        yield* saveRecipe({
          projectId: project.id,
          version: project.version,
          steps: [
            ...steps.map((step): RecipeStepDraft => ({
              kind: step.kind,
              repositoryId: step.repositoryId,
              path: step.path,
              commandId: step.commandId,
              line: step.line,
            })),
            draft.success,
          ],
        })
        return
      }
      case 'variable': {
        const value = yield* SetupValues.use((values) => values.valueOf(card.id))
        if (value === null) return yield* new ProposalRefused({ reason: VALUE_FORGOTTEN })
        yield* setVariable({ projectId: project.id, workspaceId: null, key: change.name, value })
        return
      }
    }
  })

/** A decided card, written once: a second decision finds it decided and changes nothing. */
const decided = (card: SetupCard, state: 'accepted' | 'declined') =>
  mutate('deciding a setup card', (transaction) =>
    transaction
      .update(setupCards)
      .set({ state, refusal: null, decidedAt: new Date().toISOString() })
      .where(and(eq(setupCards.id, card.id), eq(setupCards.state, 'pending')))
      .returning({ id: setupCards.id })
      .pipe(
        Effect.mapError(refusedWhile('deciding a setup card')),
        Effect.map((rows) => ({
          result: rows.length > 0,
          events:
            rows.length === 0
              ? []
              : [
                  setupEvent(
                    `setup.${state}`,
                    card.projectId,
                    {
                      card: card.id,
                      sentence: `the user ${state} the agent's proposal: ${card.title.charAt(0).toLowerCase()}${card.title.slice(1)}`,
                    },
                    true,
                  ),
                ],
        })),
      ),
  )

/** The refusal the last click met, kept on the pending card. */
const refusedAtClick = (card: SetupCard, reason: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    yield* mutate('keeping a setup card’s refusal', (transaction) =>
      transaction
        .update(setupCards)
        .set({ refusal: secrets.mask(reason) })
        .where(and(eq(setupCards.id, card.id), eq(setupCards.state, 'pending')))
        .pipe(
          Effect.mapError(refusedWhile('keeping a setup card’s refusal')),
          Effect.as({
            result: undefined,
            events: [setupEvent('setup.refused', card.projectId, { card: card.id })],
          }),
        ),
    )
  })

const cardNamed = (id: string) =>
  Effect.gen(function* () {
    const card = cardOf(yield* rowOf(id))
    if (card === null) return yield* new UnknownSetupCard({ id })
    return card
  })

/** A card's decision, one at a time in its Project: read again inside, it is decided once. */
const decidingOn = <A, E, R>(id: string, decision: (card: SetupCard) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { projectId } = yield* cardNamed(id)
    const deciding = yield* SetupValues.use((values) => Effect.succeed(values.deciding(projectId)))
    return yield* deciding(Effect.flatMap(cardNamed(id), decision))
  })

/** Accepts a pending card, its Project's decisions held: applied, then decided. */
const accepted = (card: SetupCard) =>
  Effect.gen(function* () {
    if (card.state !== 'pending') return card
    const applied = yield* apply(card).pipe(Effect.result)
    if (Result.isFailure(applied)) {
      yield* refusedAtClick(card, applied.failure.message)
      return yield* cardNamed(card.id)
    }
    yield* decided(card, 'accepted')
    yield* SetupValues.use((values) => values.forget(card.id))
    return yield* cardNamed(card.id)
  })

/**
 * Accepts a card: applied through the settings' use case, then decided. Refused at the click, it
 * stays pending with the use case's reason. Answers the card as it now stands.
 */
export const acceptCard = (id: string) => decidingOn(id, accepted)

/** Declines a card: nothing changes, and its value is let go of. */
export const declineCard = (id: string) =>
  decidingOn(id, (card) =>
    Effect.gen(function* () {
      if (card.state !== 'pending') return card
      yield* decided(card, 'declined')
      yield* SetupValues.use((values) => values.forget(card.id))
      return yield* cardNamed(id)
    }),
  )

/**
 * Accepts every pending card of a Project in the order proposed, stopping at the first refusal:
 * what came before is accepted, the refused card and what follows stay pending.
 */
export const acceptAll = (projectId: string) =>
  Effect.gen(function* () {
    const deciding = yield* SetupValues.use((values) => Effect.succeed(values.deciding(projectId)))
    return yield* deciding(
      Effect.gen(function* () {
        const pending = (yield* cardsOf(projectId)).filter((card) => card.state === 'pending')
        for (const card of pending) {
          // Listed a moment ago, under the same hold: a card that is not there now is a defect.
          const after = yield* accepted(card).pipe(Effect.catchTag('UnknownSetupCard', Effect.die))
          if (after.state === 'pending') break
        }
        return yield* cardsOf(projectId)
      }),
    )
  })

/** The Projects whose cards or setup session changed, as committed. */
export const setupChanges = Stream.unwrap(
  Effect.map(
    DomainEvents.use((events) => events.subscribe),
    (committed) =>
      committed.pipe(
        Stream.filter(
          (event) =>
            event.type.startsWith('setup.') ||
            (event.entityKind === 'session' && event.payload.role === 'setup'),
        ),
        Stream.map((event) => ({
          projectId: Predicate.isString(event.payload.projectId) ? event.payload.projectId : '',
        })),
      ),
  ),
)
