/**
 * The setup agent (#44), on the engine as it starts, with the fake agent of #32 behind the
 * starter, never a real agent: a Project folder that is no repository and holds one nobody
 * declared ("no repository in main"); proposals as cards, nothing changed before a click; one card
 * accepted, then the rest; Accept all stopping at the first refusal; a call refused whole with the
 * settings' reason; a variable's value held in memory only, hidden from every record, and refused
 * at the click once an engine stopped; the cap and one setup at a time; a model that cannot be had
 * giving the Project a need.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PermissionAnswer, VALUE_FORGOTTEN, sensitivePlace } from '@hemera/core/domain'
import { Effect, Predicate, References, type Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { AcpTraces } from '../src/engine/agents/trace.ts'
import { setProjectLimits } from '../src/engine/budget.ts'
import { answerNeed, listNeeds, retryNeed } from '../src/engine/needs.ts'
import { addRepository, createProject, getProject } from '../src/engine/projects.ts'
import { setRoleSetting } from '../src/engine/sessions/cascade.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { threadOf } from '../src/engine/sessions/thread.ts'
import { acceptAll, acceptCard, cardsOf, declineCard } from '../src/engine/setup/cards.ts'
import { Setup } from '../src/engine/setup/service.ts'
import { TRACES_FOLDER } from '../src/main/diagnostic.ts'
import { listCommands } from '../src/engine/catalogue.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { domainEvents, permissionRequests } from '../src/engine/storage/schema.ts'
import { listVariables } from '../src/engine/variables.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { held, sessionsEngine, until, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('setup'))
  work = realpathSync.native(temporaryFolder('setup-work'))
})
afterEach(removeFolders)

/** A value that must appear nowhere but in the variable it ends up in. */
const SECRET = 'acme-default-9f3c2e'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })

/** A repository with one commit and the remote `origin`. */
const repositoryAt = (folder: string) => {
  mkdirSync(folder, { recursive: true })
  git(folder, 'init', '-q', '-b', 'main')
  writeFileSync(join(folder, 'README.md'), '# web\n')
  git(folder, 'add', '.')
  git(
    folder,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.invalid',
    'commit',
    '-q',
    '-m',
    'one',
  )
  git(folder, 'remote', 'add', 'origin', 'https://example.invalid/acme/web.git')
}

/** Acme, its folder no repository, holding `web` and `shared` that nobody declared. */
const acme = Effect.suspend(() =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    repositoryAt(join(main, 'web'))
    repositoryAt(join(main, 'shared'))
    const project = yield* createProject({ name: 'Acme', mainCheckout: main, repositories: [] })
    return { project, main }
  }),
)

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

/** The setup agent's turn, scripted: what it reads and proposes. */
const proposing = (...changes: ReadonlyArray<ReadonlyArray<Schema.JsonObject>>): FakeScript => ({
  steps: [
    uses('toolu_read', 'setup_read', {}),
    ...changes.map((batch, at) =>
      uses(`toolu_propose_${String(at)}`, 'setup_propose', { changes: batch }),
    ),
    { does: 'says', text: 'I proposed the setup.' },
  ],
})

/** Starts the setup and waits for its turn to end. */
const setUp = (projectId: string) =>
  Effect.gen(function* () {
    const session = yield* Setup.use((setup) => setup.start(projectId))
    yield* until(
      Effect.map(
        Setup.use((setup) => setup.standing(projectId)),
        (standing) => standing.state === 'done',
      ),
    )
    return session
  })

describe('The test case: a repository nobody declared', () => {
  test('setup_read says "no repository in main"; the agent proposes the repository; accepting declares it', async () => {
    const { world, run } = sessionsEngine(data, () =>
      proposing([{ kind: 'repository', path: 'web', remote: 'origin', baseBranch: 'main' }]),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const [card] = yield* cardsOf(project.id)
          if (card === undefined) return yield* Effect.die(new Error('no card'))
          const before = yield* getProject(project.id)
          const accepted = yield* acceptCard(card.id)
          return { before, card, accepted, after: yield* getProject(project.id) }
        }),
      ),
    )
    // The setup ends its session once the card is stored, which can stop the fake agent before it
    // records the proposal's answer: the proposal is checked on the card below, not on the agent.
    const [read] = world.agents[0]?.answers.toolAnswers ?? []
    expect(read?.text).toContain(
      'no repository in main: the Project folder is not a Git repository and no repository is declared',
    )
    expect(seen.before.repositories).toEqual([])
    expect(seen.card).toMatchObject({ state: 'pending', title: 'Declare the repository web' })
    expect(seen.accepted.state).toBe('accepted')
    expect(seen.after.repositories.map((one) => [one.path, one.remote, one.baseBranch])).toEqual([
      ['web', 'origin', 'main'],
    ])
  })
})

describe('Every change is a proposal the user accepts', () => {
  test('nothing changes before a click; one card accepted, then the rest with Accept all; a declined card stays declined', async () => {
    const { run } = sessionsEngine(data, () =>
      proposing(
        [
          { kind: 'repository', path: 'web' },
          { kind: 'repository', path: 'shared' },
        ],
        [{ kind: 'variable', name: 'ACME_REGION', value: 'eu-west' }],
      ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const cards = yield* cardsOf(project.id)
          const untouched = yield* getProject(project.id)
          const [web, shared, region] = cards
          if (web === undefined || shared === undefined || region === undefined) {
            return yield* Effect.die(new Error('three cards'))
          }
          yield* acceptCard(web.id)
          yield* declineCard(shared.id)
          const all = yield* acceptAll(project.id)
          const again = yield* acceptCard(shared.id)
          return {
            cards,
            untouched,
            all,
            again,
            project: yield* getProject(project.id),
            variables: yield* listVariables({ projectId: project.id, workspaceId: null }),
          }
        }),
      ),
    )
    expect(new Set(seen.cards.map((card) => card.batch)).size).toBe(2)
    expect(seen.untouched.repositories).toEqual([])
    expect(seen.all.map((card) => [card.title, card.state])).toEqual([
      ['Declare the repository web', 'accepted'],
      ['Declare the repository shared', 'declined'],
      ['Set the variable ACME_REGION', 'accepted'],
    ])
    expect(seen.again.state).toBe('declined')
    expect(seen.project.repositories.map((one) => one.path)).toEqual(['web'])
    expect(seen.variables.map((one) => one.key)).toEqual(['ACME_REGION'])
  })

  test('Accept all stops at the first refusal: what came before is accepted, the refused card and what follows stay pending', async () => {
    const { run } = sessionsEngine(data, () =>
      proposing([
        { kind: 'repository', path: 'web' },
        { kind: 'repository', path: 'shared', remote: 'nowhere' },
        { kind: 'variable', name: 'ACME_REGION', value: 'eu-west' },
      ]),
    )
    const all = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          return yield* acceptAll(project.id)
        }),
      ),
    )
    expect(all.map((card) => [card.title, card.state])).toEqual([
      ['Declare the repository shared', 'pending'],
      ['Set the variable ACME_REGION', 'pending'],
      ['Declare the repository web', 'accepted'],
    ])
    expect(all[0]?.refusal).toContain('nowhere')
  })

  test('a call with one change the settings refuse is refused whole, with their reason', async () => {
    const { world, run } = sessionsEngine(data, () =>
      proposing([
        { kind: 'repository', path: 'web' },
        { kind: 'repository', path: '../elsewhere' },
      ]),
    )
    const cards = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          return yield* cardsOf(project.id)
        }),
      ),
    )
    const proposed = world.agents[0]?.answers.toolAnswers[1]
    expect(proposed?.text).toMatch(
      /^refused: the whole call, for Declare the repository \.\.\/elsewhere: .*leaves the main checkout/,
    )
    expect(cards).toEqual([])
  })
})

describe('A batch is checked against the setup as it will stand', () => {
  test('with no repository in main, a command and a step for a repository proposed earlier in the run are cards, and Accept all applies them', async () => {
    const { world, run } = sessionsEngine(data, () =>
      proposing(
        [{ kind: 'repository', path: 'web' }],
        [{ kind: 'command', name: 'web: test', type: 'test', line: 'npm test', repository: 'web' }],
        [
          { kind: 'repository', path: 'shared' },
          { kind: 'step', step: 'run', repository: 'shared', command: 'web: test' },
        ],
      ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const cards = yield* cardsOf(project.id)
          const all = yield* acceptAll(project.id)
          return { cards, all, commands: yield* listCommands(project.id) }
        }),
      ),
    )
    const answers = world.agents[0]?.answers.toolAnswers.map((one) => one.text) ?? []
    expect(answers.filter((text) => text.startsWith('refused'))).toEqual([])
    expect(seen.cards.map((card) => card.title)).toEqual([
      'Declare the repository web',
      'Add the command web: test',
      'Declare the repository shared',
      'Add a preparation step that runs web: test',
    ])
    expect(seen.all.map((card) => card.state)).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'accepted',
    ])
    expect(seen.commands.map((one) => one.name)).toEqual(['web: test'])
  })

  test('a command accepted while its repository card waits is refused at the click, and accepted once the repository is', async () => {
    const { run } = sessionsEngine(data, () =>
      proposing(
        [{ kind: 'repository', path: 'web' }],
        [{ kind: 'command', name: 'web: test', type: 'test', line: 'npm test', repository: 'web' }],
      ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const [web, command] = yield* cardsOf(project.id)
          if (web === undefined || command === undefined) {
            return yield* Effect.die(new Error('two cards'))
          }
          const early = yield* acceptCard(command.id)
          yield* acceptCard(web.id)
          return { early, later: yield* acceptCard(command.id) }
        }),
      ),
    )
    expect(seen.early).toMatchObject({
      state: 'pending',
      refusal: 'its repository web is still a proposal: accept it first',
    })
    expect(seen.later.state).toBe('accepted')
  })

  test('a second run proposing the same changes adds no duplicate of a pending card, and Accept all goes through', async () => {
    const { world, run } = sessionsEngine(data, () =>
      proposing(
        [{ kind: 'repository', path: 'web' }],
        [{ kind: 'command', name: 'web: test', type: 'test', line: 'npm test', repository: 'web' }],
        [{ kind: 'variable', name: 'ACME_REGION', value: 'eu-west-1' }],
      ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          yield* setUp(project.id)
          const cards = yield* cardsOf(project.id)
          return { cards, all: yield* acceptAll(project.id) }
        }),
      ),
    )
    expect(seen.cards.map((card) => card.title)).toEqual([
      'Declare the repository web',
      'Add the command web: test',
      'Set the variable ACME_REGION',
    ])
    expect(seen.all.map((card) => card.state)).toEqual(['accepted', 'accepted', 'accepted'])
    const second = world.agents[1]?.answers.toolAnswers[1]?.text
    expect(second).toContain('already proposed')
  })
})

/** Every file under a folder, as text, to look for a value in. */
const everything = (folder: string): string =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name)).toString('latin1'))
    .join('\n')

describe('A variable’s value is hidden', () => {
  test('it is in no file of the data folder, no card, no thread; after a restart its card is refused at the click', async () => {
    const first = sessionsEngine(data, () =>
      proposing([{ kind: 'variable', name: 'ACME_TOKEN', value: SECRET }]),
    )
    const seen = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const session = yield* setUp(project.id)
          const [card] = yield* cardsOf(project.id)
          const thread = yield* threadOf(session.id)
          return { projectId: project.id, card, thread }
        }),
      ),
    )
    expect(JSON.stringify(seen.card)).not.toContain(SECRET)
    expect(JSON.stringify(seen.thread)).not.toContain(SECRET)
    expect(
      first.world.agents[0]?.answers.toolAnswers.map((one) => one.text).join('\n'),
    ).not.toContain(SECRET)
    expect(everything(data)).not.toContain(SECRET)
    const after = await sessionsEngine(data, () => proposing()).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const [card] = yield* cardsOf(seen.projectId)
          if (card === undefined) return yield* Effect.die(new Error('no card'))
          return yield* acceptCard(card.id)
        }),
      ),
    )
    expect(after).toMatchObject({ state: 'pending', refusal: VALUE_FORGOTTEN })
  })

  test('a call refused for a change of a kind it does not know still hides its value', async () => {
    const { world, run } = sessionsEngine(data, () =>
      proposing([{ kind: 'workspace_create', name: 'scratch', value: SECRET }]),
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
        }),
      ),
    )
    const proposed = world.agents[0]?.answers.toolAnswers[1]
    expect(proposed?.text).toMatch(/^refused: the arguments of setup_propose do not read/)
    expect(proposed?.text).not.toContain(SECRET)
    expect(everything(data)).not.toContain(SECRET)
  })
})

/** A token recognised by its shape alone, as a command line may carry it. */
const TOKEN = 'ghp_acmeNotARealToken000001'

describe('A credential in a proposed command is masked on its card', () => {
  test('its change and details hold no token, no table holds it in clear, and accepting saves the line as proposed', async () => {
    const line = `node deploy.js --auth ${TOKEN}`
    const { run } = sessionsEngine(data, () =>
      proposing([{ kind: 'command', name: 'deploy', type: 'build', line }]),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const [card] = yield* cardsOf(project.id)
          if (card === undefined) return yield* Effect.die(new Error('no card'))
          const stored = everything(data)
          const accepted = yield* acceptCard(card.id)
          return { card, stored, accepted, commands: yield* listCommands(project.id) }
        }),
      ),
    )
    expect(JSON.stringify(seen.card)).not.toContain(TOKEN)
    expect(seen.card.change).toMatchObject({ line: 'node deploy.js --auth •••' })
    expect(seen.card.details).toContainEqual({ label: 'Line', value: 'node deploy.js --auth •••' })
    expect(seen.stored).not.toContain(TOKEN)
    expect(seen.accepted.state).toBe('accepted')
    expect(seen.commands.map((one) => one.line)).toEqual([line])
  })

  test('after a restart, a card whose change was masked is refused at the click rather than saved masked', async () => {
    const first = sessionsEngine(data, () =>
      proposing([
        { kind: 'command', name: 'deploy', type: 'build', line: `node deploy.js ${TOKEN}` },
      ]),
    )
    const projectId = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          return project.id
        }),
      ),
    )
    const after = await sessionsEngine(data, () => proposing()).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const [card] = yield* cardsOf(projectId)
          if (card === undefined) return yield* Effect.die(new Error('no card'))
          return { card: yield* acceptCard(card.id), commands: yield* listCommands(projectId) }
        }),
      ),
    )
    expect(after.card).toMatchObject({ state: 'pending', refusal: VALUE_FORGOTTEN })
    expect(after.commands).toEqual([])
  })
})

describe('A refused step is named by its place in the recipe', () => {
  test('the proposals before it that are not steps do not count', async () => {
    const { world, run } = sessionsEngine(data, () =>
      proposing([
        { kind: 'variable', name: 'ACME_REGION', value: 'eu-west' },
        { kind: 'step', step: 'copy' },
      ]),
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
        }),
      ),
    )
    const proposed = world.agents[0]?.answers.toolAnswers[1]
    expect(proposed?.text).toContain('Step 1 of the recipe is refused')
  })
})

describe('The setup session', () => {
  test('one at a time per Project: a second request while one runs is refused', async () => {
    const hold = held()
    const { run } = sessionsEngine(data, () => ({ ...proposing(), between: () => hold.promise }))
    const busy = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* Setup.use((setup) => setup.start(project.id))
          const refused = yield* Setup.use((setup) => setup.start(project.id)).pipe(Effect.flip)
          hold.release()
          return refused
        }),
      ),
    )
    expect(Predicate.isTagged(busy, 'SetupBusy')).toBe(true)
    expect(busy.message).toBe('A setup proposal is already being made for this Project.')
  })

  test('a read held for the user keeps the session until its result came back and it proposed', async () => {
    const { run } = sessionsEngine(data, () => ({
      turns: [
        [
          uses('toolu_env', 'fs_read', { path: 'web/.env' }),
          { does: 'says', text: 'I wait for the .env file.' },
        ],
      ],
      steps: [
        uses('toolu_propose', 'setup_propose', {
          changes: [{ kind: 'variable', name: 'ACME_REGION', value: 'eu-west' }],
        }),
        { does: 'says', text: 'I proposed the variable.' },
      ],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          writeFileSync(join(main, 'web', '.env'), 'ACME_REGION=eu-west\n')
          const session = yield* Setup.use((setup) => setup.start(project.id))
          yield* until(Effect.map(listNeeds, (groups) => groups.length === 1))
          const [group] = yield* listNeeds
          const need = group?.needs[0]
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          yield* answerNeed({
            id: need.id,
            key: 'allow',
            answer: PermissionAnswer.make({ choice: 'allow-once' }),
          })
          yield* until(
            Effect.map(
              Setup.use((setup) => setup.standing(project.id)),
              (one) => one.state === 'done',
            ),
          )
          return { session, cards: yield* cardsOf(project.id) }
        }),
      ),
    )
    // Ended before the result came back, it would have proposed nothing: the card is its proof.
    expect(seen.cards.map((card) => [card.title, card.sessionId])).toEqual([
      ['Set the variable ACME_REGION', seen.session.id],
    ])
  })

  test('a model that cannot be had gives the Project a need, not a mission one', async () => {
    const { run } = sessionsEngine(data, () => ({
      configOptions: [
        {
          id: 'model',
          name: 'model',
          category: 'model',
          type: 'select',
          currentValue: 'large',
          options: [{ value: 'large', name: 'large' }],
        },
      ],
      steps: [{ does: 'says', text: 'done' }],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setRoleSetting('app', null, 'setup', {
            agent: 'claude',
            model: 'huge',
            effort: null,
          })
          yield* Setup.use((setup) => setup.start(project.id))
          yield* until(Effect.map(listNeeds, (groups) => groups.length === 1))
          const [group] = yield* listNeeds
          return {
            group,
            projectId: project.id,
            standing: yield* Setup.use((setup) => setup.standing(project.id)),
            live: yield* sessionsIn(['starting', 'working', 'idle']),
          }
        }),
      ),
    )
    expect(seen.group?.projectId).toBe(seen.projectId)
    expect(seen.group?.needs[0]?.owner).toMatchObject({ projectId: seen.projectId })
    expect(seen.standing.state).toBe('failed')
    expect(seen.live).toEqual([])
  })
})

/** The cap's wait, said for a Project's own phase. */
describe('The setup waits for a slot', () => {
  test('with the cap full, its state says it waits, with the cap’s sentence', async () => {
    const hold = held()
    const { run } = sessionsEngine(data, () => ({ ...proposing(), between: () => hold.promise }))
    const standing = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setProjectLimits(project.id, {
            cap: 1,
            budget: { launches: 8, attempts: 30, rounds: 3 },
          })
          const other = { kind: 'project' as const, projectId: project.id }
          yield* Sessions.use((sessions) =>
            sessions.open({ owner: other, role: 'setup', folder: project.mainCheckout }),
          )
          yield* until(Effect.map(sessionsIn(['working']), (live) => live.length === 1))
          const second = yield* Sessions.use((sessions) =>
            sessions.open({ owner: other, role: 'setup', folder: project.mainCheckout }),
          )
          const standingNow = Setup.use((setup) => setup.standing(project.id))
          yield* until(Effect.map(standingNow, (one) => one.state === 'waiting'))
          const waits = yield* standingNow
          hold.release()
          return { waits, second }
        }),
      ),
    )
    expect(standing.waits).toEqual({
      state: 'waiting',
      sentence: 'waiting for a free slot (1 of 1 in use)',
    })
  })
})

describe('A setup that outlives its first session', () => {
  const standingOf = (projectId: string) => Setup.use((setup) => setup.standing(projectId))

  test('replaced during its proposal, its successor ends once it has proposed', async () => {
    const hold = held()
    const { run } = sessionsEngine(data, (index) =>
      index === 0
        ? { steps: [{ does: 'says', text: 'Reading.' }], between: () => hold.promise }
        : { steps: [{ does: 'says', text: 'I proposed the setup.' }] },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const first = yield* Setup.use((setup) => setup.start(project.id))
          yield* until(
            Effect.map(sessionsIn(['working']), (working) =>
              working.some((one) => one.id === first.id),
            ),
          )
          yield* Sessions.use((sessions) => sessions.replace(first.id, 'its agent stopped'))
          hold.release()
          yield* until(Effect.map(standingOf(project.id), (one) => one.state === 'done'))
          return yield* sessionsIn(['starting', 'working', 'idle', 'stuck'])
        }),
      ),
    )
    expect(seen.filter((one) => one.role === 'setup')).toEqual([])
  })

  test('a restart during its proposal ends it, and its state says why', async () => {
    const hold = held()
    const first = sessionsEngine(data, () => ({
      steps: [{ does: 'says', text: 'Reading.' }],
      between: () => hold.promise,
    }))
    const projectId = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const session = yield* Setup.use((setup) => setup.start(project.id))
          yield* until(
            Effect.map(sessionsIn(['working']), (working) =>
              working.some((one) => one.id === session.id),
            ),
          )
          return project.id
        }),
      ),
    )
    hold.release()
    const second = sessionsEngine(data, () => ({ steps: [{ does: 'says', text: 'done' }] }))
    const seen = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(Effect.map(standingOf(projectId), (one) => one.state === 'failed'))
          return {
            standing: yield* standingOf(projectId),
            live: yield* sessionsIn(['starting', 'working', 'idle', 'stuck']),
          }
        }),
      ),
    )
    expect(seen.standing).toEqual({ state: 'failed', sentence: 'interrupted by a restart' })
    expect(seen.live.filter((one) => one.role === 'setup')).toEqual([])
    expect(second.world.agents).toHaveLength(0)
  })

  test('a restart while a read waits for the user expires the read’s request and its need', async () => {
    const first = sessionsEngine(data, () => ({
      turns: [
        [
          uses('toolu_env', 'fs_read', { path: 'web/.env' }),
          { does: 'says', text: 'I wait for the .env file.' },
        ],
      ],
      steps: [{ does: 'says', text: 'done' }],
    }))
    const projectId = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          writeFileSync(join(main, 'web', '.env'), 'ACME_REGION=eu-west\n')
          yield* Setup.use((setup) => setup.start(project.id))
          yield* until(Effect.map(listNeeds, (groups) => groups.length === 1))
          return project.id
        }),
      ),
    )
    const second = sessionsEngine(data, () => ({ steps: [{ does: 'says', text: 'done' }] }))
    const seen = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(Effect.map(standingOf(projectId), (one) => one.state === 'failed'))
          const database = yield* Database
          return {
            needs: yield* listNeeds,
            requests: yield* database
              .select({ state: permissionRequests.state, result: permissionRequests.result })
              .from(permissionRequests),
            expired: (yield* database
              .select({ payload: domainEvents.payload })
              .from(domainEvents)
              .where(eq(domainEvents.type, 'need.expired'))).map((one) => JSON.parse(one.payload)),
          }
        }),
      ),
    )
    expect(seen.needs).toEqual([])
    expect(seen.requests).toEqual([{ state: 'ended', result: 'not-executed' }])
    expect(seen.expired).toEqual([expect.objectContaining({ reason: 'interrupted by a restart' })])
  })

  test('started again by Retry once its model changed, its new session ends once it has proposed', async () => {
    const { run } = sessionsEngine(data, () => ({
      ...proposing([{ kind: 'variable', name: 'ACME_REGION', value: 'eu-west' }]),
      configOptions: [
        {
          id: 'model',
          name: 'model',
          category: 'model',
          type: 'select',
          currentValue: 'large',
          options: [{ value: 'large', name: 'large' }],
        },
      ],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setRoleSetting('app', null, 'setup', {
            agent: 'claude',
            model: 'huge',
            effort: null,
          })
          yield* Setup.use((setup) => setup.start(project.id))
          yield* until(Effect.map(listNeeds, (groups) => groups.length === 1))
          const [need] = (yield* listNeeds).flatMap((group) => group.needs)
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          yield* setRoleSetting('app', null, 'setup', {
            agent: 'claude',
            model: 'large',
            effort: null,
          })
          yield* retryNeed(need.id)
          yield* until(Effect.map(cardsOf(project.id), (cards) => cards.length === 1))
          yield* until(Effect.map(standingOf(project.id), (one) => one.state === 'done'))
          const live = (yield* sessionsIn(['starting', 'working', 'idle', 'stuck'])).filter(
            (one) => one.role === 'setup',
          )
          const again = yield* Setup.use((setup) => setup.start(project.id))
          return { live, again }
        }),
      ),
    )
    expect(seen.live).toEqual([])
    expect(seen.again.role).toBe('setup')
  })
})

describe('What the proposed values mask, and for how long', () => {
  test('a short or plain value is never a secret; a value is masked while its card holds it, not after', async () => {
    const { run } = sessionsEngine(data, () =>
      proposing([
        { kind: 'variable', name: 'ACME_TOKEN', value: SECRET },
        { kind: 'variable', name: 'ACME_PORT', value: '8080' },
        { kind: 'variable', name: 'ACME_REGION', value: 'eu' },
        { kind: 'variable', name: 'ACME_DEBUG', value: 'true' },
      ]),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const mask = (text: string) => Secrets.useSync((secrets) => secrets.mask(text))
          const plain = yield* mask('Deploy to europe on port 8080, debug true.')
          const whileHeld = yield* mask(SECRET)
          const [card] = yield* cardsOf(project.id)
          if (card === undefined) return yield* Effect.die(new Error('no card'))
          yield* declineCard(card.id)
          return { plain, whileHeld, afterDecline: yield* mask(SECRET) }
        }),
      ),
    )
    expect(seen.plain).toBe('Deploy to europe on port 8080, debug true.')
    expect(seen.whileHeld).not.toContain(SECRET)
    expect(seen.afterDecline).toBe(SECRET)
  })
})

describe('A card decided twice at once', () => {
  test('Accept and Decline at once: the card says what happened to the setup', async () => {
    const { run } = sessionsEngine(data, () =>
      proposing([{ kind: 'command', name: 'test', type: 'test', line: 'npm test' }]),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const [card] = yield* cardsOf(project.id)
          if (card === undefined) return yield* Effect.die(new Error('no card'))
          // Every step yields, so the two clicks interleave as two calls from the window may.
          yield* Effect.all([acceptCard(card.id), declineCard(card.id)], {
            concurrency: 'unbounded',
          }).pipe(Effect.provideService(References.MaxOpsBeforeYield, 10))
          const [after] = yield* cardsOf(project.id)
          const commands = (yield* listCommands(project.id)).filter((one) => one.name === 'test')
          return { state: after?.state, commands: commands.length }
        }),
      ),
    )
    expect(seen.commands).toBe(seen.state === 'accepted' ? 1 : 0)
  })

  test('two Accepts at once set its variable once', async () => {
    const { run } = sessionsEngine(data, () =>
      proposing([{ kind: 'variable', name: 'ACME_TOKEN', value: SECRET }]),
    )
    const sets = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const [card] = yield* cardsOf(project.id)
          if (card === undefined) return yield* Effect.die(new Error('no card'))
          yield* Effect.all([acceptCard(card.id), acceptCard(card.id)], {
            concurrency: 'unbounded',
          }).pipe(Effect.provideService(References.MaxOpsBeforeYield, 10))
          const database = yield* Database
          return yield* database
            .select()
            .from(domainEvents)
            .where(eq(domainEvents.type, 'variable.set'))
        }),
      ),
    )
    expect(sets).toHaveLength(1)
  })
})

describe('An .env template', () => {
  test('is read without asking; its value is in no trace, no record and no file of the data folder', async () => {
    const REGION = 'acme-eu-west-7'
    const { world, run } = sessionsEngine(data, () => ({
      steps: [
        uses('toolu_example', 'fs_read', { path: 'web/.env.example' }),
        { does: 'says', text: 'I read the example.' },
      ],
    }))
    const needs = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* AcpTraces.use((traces) => Effect.sync(() => traces.writing(true)))
          const { project, main } = yield* acme
          writeFileSync(join(main, 'web', '.env.example'), `ACME_REGION=${REGION}\n`)
          yield* setUp(project.id)
          return yield* listNeeds
        }),
      ),
    )
    expect(world.agents[0]?.answers.toolAnswers[0]?.text).toContain(REGION)
    expect(needs).toEqual([])
    expect(readdirSync(join(data, TRACES_FOLDER)).length).toBeGreaterThan(0)
    expect(everything(data)).not.toContain(REGION)
  })

  test('is read freely only: writing it, or reading a real .env, still asks', () => {
    const context = { home: '/home/acme', platform: 'linux' }
    expect(sensitivePlace('/work/acme/web/.env.example', context, { reading: true })).toBeNull()
    expect(
      sensitivePlace('/work/acme/web/.env.local.sample', context, { reading: true }),
    ).toBeNull()
    expect(sensitivePlace('/work/acme/web/.env.example', context)).toBe(
      '/work/acme/web/.env.example',
    )
    expect(sensitivePlace('/work/acme/web/.env.local', context, { reading: true })).toBe(
      '/work/acme/web/.env.local',
    )
    expect(sensitivePlace('/work/acme/web/.env.*', context, { reading: true })).toBe(
      '/work/acme/web/.env.*',
    )
  })
})

describe('A repository card the user partly did meanwhile', () => {
  test('accepting it completes what is missing, and it is accepted', async () => {
    const { run } = sessionsEngine(data, () =>
      proposing([{ kind: 'repository', path: 'web', remote: 'origin', baseBranch: 'main' }]),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          yield* setUp(project.id)
          const before = yield* getProject(project.id)
          yield* addRepository({ projectId: project.id, version: before.version, path: 'web' })
          const [card] = yield* cardsOf(project.id)
          if (card === undefined) return yield* Effect.die(new Error('no card'))
          const after = yield* acceptCard(card.id)
          const web = (yield* getProject(project.id)).repositories.find((one) => one.path === 'web')
          return { after, web }
        }),
      ),
    )
    expect(seen.after).toMatchObject({ state: 'accepted', refusal: null })
    expect(seen.web).toMatchObject({ remote: 'origin', baseBranch: 'main' })
  })
})
