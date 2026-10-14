/**
 * A Project's delivery rules as the engine keeps them (#340): saved on the version they were
 * edited from and refused with their reasons, checked against the repositories' forges and the
 * catalogue, the dependencies proposed from `package.json` and saved only once accepted, and the
 * sections a mission copies: once, with their version in the Journal, unchanged by a later save
 * or a restart.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DeliveryRulesDraft, RepositoryWaves } from '@hemera/core/domain'
import { defaultDeliveryRules } from '@hemera/core/domain'
import { type CommandDraft, DeliveryRulesRefused, StaleVersion } from '@hemera/ipc'
import { Deferred, Effect, Fiber, Ref } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { saveCommand } from '../src/engine/catalogue.ts'
import {
  acceptDependencies,
  copySection,
  missionCopies,
  preparationChangedSinceCopy,
  readDeliveryRules,
  saveDeliveryRules,
  validateDeliveryRules,
} from '../src/engine/delivery-rules.ts'
import { ForgePort } from '../src/engine/forges/port.ts'
import { readEvents } from '../src/engine/journal.ts'
import { createMission } from '../src/engine/missions.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { createProject } from '../src/engine/projects.ts'
import { commandsEngine } from './commands-engine.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('delivery-rules'))
  work = realpathSync.native(temporaryFolder('delivery-rules-work'))
})
afterEach(removeFolders)

/** Acme's three repositories, each on GitHub by its remote; nothing reaches a network. */
const REPOSITORIES = ['shared', 'api', 'web'] as const

const checkout = () => {
  const main = join(work, 'acme')
  for (const path of REPOSITORIES) {
    const folder = join(main, path)
    mkdirSync(folder, { recursive: true })
    git(folder, 'init', '-q', '-b', 'main')
    git(folder, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(folder, 'remote', 'add', 'origin', `git@github.com:acme/${path}.git`)
  }
  return main
}

interface Acme {
  readonly projectId: string
  readonly main: string
  readonly id: (path: string) => string
}

/** One opening of the engine; Acme is created by the first, found again by the next. */
const engine = <A, E>(program: Effect.Effect<A, E, EngineServices>) =>
  commandsEngine(data)(({ profile }) => profile.use(program))

const acme = Effect.gen(function* () {
  const main = checkout()
  const project = yield* createProject({
    name: 'Acme',
    mainCheckout: main,
    repositories: [...REPOSITORIES],
  })
  const id = (path: string) => {
    const found = project.repositories.find((one) => one.path === path)
    if (found === undefined) throw new Error(`no repository ${path}`)
    return found.id
  }
  return { projectId: project.id, main, id } satisfies Acme
})

const waves = (
  repositoryId: string,
  preset: RepositoryWaves['preset'],
  deliversAfter: ReadonlyArray<string> = [],
  steps: RepositoryWaves['steps'] = { off: [], changed: [], added: [] },
): RepositoryWaves => ({ repositoryId, preset, steps, deliversAfter })

/** Acme as a chain: shared publishes, api bumps on it, web on api. */
const chain = (world: Acme): DeliveryRulesDraft => {
  const base = defaultDeliveryRules()
  return {
    ...base,
    waves: {
      ...base.waves,
      repositories: [
        waves(world.id('shared'), 'library'),
        waves(world.id('api'), 'library', [world.id('shared')]),
        waves(world.id('web'), 'application', [world.id('api')]),
      ],
    },
  }
}

/** The same with web's reviewers changed, in its preparation. */
const reviewedBy = (rules: DeliveryRulesDraft, repositoryId: string, reviewers: string[]) => ({
  ...rules,
  preparation: {
    ...rules.preparation,
    repositories: [
      {
        repositoryId,
        commitTemplate: '{key}: {title}',
        pullRequestTitle: '{key}: {title}',
        pullRequestBody: '{summary}\n\n{images}',
        reviewers,
        requireApproval: false,
        pushSteps: { off: [], changed: [], added: [] },
      },
    ],
  },
})

const eventsOf = (type: string) =>
  readEvents({ limit: 1000 }).pipe(
    Effect.map(({ events }) => events.filter((event) => event.type === type)),
  )

const command = (name: string): CommandDraft => ({
  name,
  type: 'script',
  line: 'pnpm changeset',
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
})

describe('The rules are saved on their version', () => {
  test('a Project that never saved rules reads its defaults, at version 0', async () => {
    const view = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        return yield* readDeliveryRules(world.projectId)
      }),
    )
    expect(view.rules.version).toBe(0)
    expect(view.rules.savedAt).toBeNull()
    expect(view.repositories.map((one) => [one.name, one.preset])).toEqual([
      ['shared', 'application'],
      ['api', 'application'],
      ['web', 'application'],
    ])
  })

  test('a save on a stale version is refused', async () => {
    const seen = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        const first = yield* saveDeliveryRules(world.projectId, chain(world), 0)
        const stale = yield* Effect.flip(
          saveDeliveryRules(
            world.projectId,
            reviewedBy(chain(world), world.id('web'), ['acme/web']),
            0,
          ),
        )
        const second = yield* saveDeliveryRules(
          world.projectId,
          reviewedBy(chain(world), world.id('web'), ['acme/web']),
          1,
        )
        const saved = yield* eventsOf('delivery.rules_saved')
        return { first, stale, second, saved }
      }),
    )
    expect(seen.first.rules.version).toBe(1)
    expect(seen.first.rules.savedAt).not.toBeNull()
    expect(seen.stale).toBeInstanceOf(StaleVersion)
    expect(seen.second.rules.version).toBe(2)
    expect(seen.saved.map((event) => event.payload['version'])).toEqual([1, 2])
  })

  test('inconsistent rules are refused when saved, with their reason, and nothing is written', async () => {
    const seen = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        const base = chain(world)
        const cycle: DeliveryRulesDraft = {
          ...base,
          waves: {
            ...base.waves,
            repositories: [
              waves(world.id('shared'), 'library', [world.id('api')]),
              waves(world.id('api'), 'library', [world.id('shared')]),
            ],
          },
        }
        const problems = yield* validateDeliveryRules(world.projectId, cycle)
        const refused = yield* Effect.flip(saveDeliveryRules(world.projectId, cycle, 0))
        const after = yield* readDeliveryRules(world.projectId)
        return { problems, refused, after }
      }),
    )
    expect(seen.problems.map((one) => one.sentence)).toEqual([
      'These repositories deliver after each other in a cycle: shared → api → shared.',
    ])
    expect(seen.refused).toBeInstanceOf(DeliveryRulesRefused)
    expect(seen.refused.message).toBe(
      'These repositories deliver after each other in a cycle: shared → api → shared.',
    )
    expect(seen.after.rules.version).toBe(0)
  })

  test('the rules are checked against each repository’s forge and the catalogue', async () => {
    const seen = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        const changeset = yield* saveCommand({
          projectId: world.projectId,
          id: null,
          command: command('changeset'),
        })
        const withCommand = (commandId: string): DeliveryRulesDraft => {
          const base = chain(world)
          return {
            ...base,
            end: {
              ...base.end,
              cleanup: [
                ...base.end.cleanup,
                { id: 'notes', kind: 'command', mode: 'auto', commandId },
              ],
            },
          }
        }
        const known = yield* validateDeliveryRules(world.projectId, withCommand(changeset.id))
        const unknown = yield* validateDeliveryRules(world.projectId, withCommand('gone'))
        // web forced to no forge: its pull request and merge are refused.
        yield* ForgePort.use((port) =>
          port.setForced(world.projectId, world.id('web'), 'none', null),
        )
        const forgeless = yield* validateDeliveryRules(world.projectId, chain(world))
        return { known, unknown, forgeless }
      }),
    )
    expect(seen.known).toEqual([])
    expect(seen.unknown.map((one) => one.code)).toEqual(['unknown-command'])
    expect(seen.forgeless.map((one) => [one.code, one.stepId])).toEqual([
      ['forge-step-without-forge', 'pull-request'],
      ['forge-step-without-forge', 'merge'],
    ])
  })
})

describe('Repository dependencies', () => {
  test('the dependency proposal from two package.json files finds the edge; nothing is saved without accept', async () => {
    const seen = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        writeFileSync(join(world.main, 'shared', 'package.json'), '{"name":"@acme/shared"}')
        writeFileSync(
          join(world.main, 'api', 'package.json'),
          '{"name":"@acme/api","dependencies":{"@acme/shared":"workspace:*"}}',
        )
        const proposed = yield* readDeliveryRules(world.projectId)
        const accepted = yield* acceptDependencies(world.projectId, proposed.proposedDependencies)
        const saved = yield* eventsOf('delivery.rules_saved')
        return { world, proposed, accepted, saved }
      }),
    )
    const { world } = seen
    expect(seen.proposed.proposedDependencies).toEqual([
      { repositoryId: world.id('api'), deliversAfter: world.id('shared') },
    ])
    expect(seen.proposed.rules.version).toBe(0)
    expect(seen.proposed.repositories.every((one) => one.deliversAfter.length === 0)).toBe(true)
    expect(seen.accepted.rules.version).toBe(1)
    expect(seen.accepted.proposedDependencies).toEqual([])
    expect(seen.accepted.repositories.map((one) => [one.name, one.deliversAfter])).toEqual([
      ['shared', []],
      ['api', [world.id('shared')]],
      ['web', []],
    ])
    expect(seen.saved).toHaveLength(1)
  })
  test('accepted dependencies that make a cycle are refused, and nothing is written', async () => {
    const seen = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        const base = chain(world)
        yield* saveDeliveryRules(world.projectId, base, 0)
        const refused = yield* Effect.flip(
          acceptDependencies(world.projectId, [
            { repositoryId: world.id('shared'), deliversAfter: world.id('web') },
          ]),
        )
        const after = yield* readDeliveryRules(world.projectId)
        return { refused, after }
      }),
    )
    expect(seen.refused).toBeInstanceOf(DeliveryRulesRefused)
    expect(seen.refused.message).toBe(
      'These repositories deliver after each other in a cycle: shared → web → api → shared.',
    )
    expect(seen.after.rules.version).toBe(1)
  })
})

describe('A mission copies each section when it starts acting', () => {
  test('copySection twice answers the same copy and writes one Journal line; after a Project change, preparationChangedSinceCopy lists the difference', async () => {
    const seen = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        yield* saveDeliveryRules(world.projectId, chain(world), 0)
        const mission = yield* createMission({
          projectId: world.projectId,
          idea: { sentence: 'Export the ledger as CSV', ticket: null },
        })
        const before = yield* preparationChangedSinceCopy(mission.id)
        const first = yield* copySection(mission.id, 'preparation')
        const second = yield* copySection(mission.id, 'preparation')
        const unchanged = yield* preparationChangedSinceCopy(mission.id)
        yield* saveDeliveryRules(
          world.projectId,
          reviewedBy(chain(world), world.id('web'), ['acme/design']),
          1,
        )
        const changed = yield* preparationChangedSinceCopy(mission.id)
        const copied = yield* eventsOf('delivery.rules_copied')
        return { world, mission, before, first, second, unchanged, changed, copied }
      }),
    )
    expect(seen.before).toBeNull()
    expect(seen.second).toEqual(seen.first)
    expect(seen.first.version).toBe(1)
    expect(seen.unchanged).toEqual({ copiedVersion: 1, currentVersion: 1, differences: [] })
    expect(seen.changed).toEqual({
      copiedVersion: 1,
      currentVersion: 2,
      differences: [{ repositoryId: seen.world.id('web'), field: 'reviewers' }],
    })
    expect(seen.copied.map((event) => [event.entityKind, event.entityId, event.payload])).toEqual([
      ['mission', seen.mission.id, { section: 'preparation', version: 1 }],
    ])
  })

  test('two copies of one section asked at once make one copy and one Journal line', async () => {
    const seen = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        const mission = yield* createMission({
          projectId: world.projectId,
          idea: { sentence: 'Export the ledger as CSV', ticket: null },
        })
        // Both copies are held until both have read the Project, then let go together.
        const arrived = yield* Ref.make(0)
        const bothHeld = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const hold = Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(arrived, (one) => one + 1)
          if (count === 2) yield* Deferred.succeed(bothHeld, undefined)
          yield* Deferred.await(gate)
        })
        const copies = yield* Effect.forkChild(
          Effect.all(
            [copySection(mission.id, 'waves', hold), copySection(mission.id, 'waves', hold)],
            {
              concurrency: 'unbounded',
            },
          ),
        )
        yield* Deferred.await(bothHeld)
        yield* Deferred.succeed(gate, undefined)
        const both = yield* Fiber.join(copies)
        const copied = yield* eventsOf('delivery.rules_copied')
        const kept = yield* missionCopies(mission.id)
        return { both, copied, kept }
      }),
    )
    expect(seen.both[1]).toEqual(seen.both[0])
    expect(seen.kept).toEqual([seen.both[0]])
    expect(seen.copied).toHaveLength(1)
  })

  test('a copy is unchanged by a later save and survives a restart of the engine', async () => {
    const first = await engine(
      Effect.gen(function* () {
        const world = yield* acme
        yield* saveDeliveryRules(world.projectId, chain(world), 0)
        const mission = yield* createMission({
          projectId: world.projectId,
          idea: { sentence: 'Export the ledger as CSV', ticket: null },
        })
        const copies = [
          yield* copySection(mission.id, 'preparation'),
          yield* copySection(mission.id, 'waves'),
          yield* copySection(mission.id, 'end'),
        ]
        return { world, missionId: mission.id, copies }
      }),
    )
    const { world, missionId } = first
    // A second opening of the engine changes the Project's rules.
    await engine(
      saveDeliveryRules(
        world.projectId,
        reviewedBy(chain(world), world.id('web'), ['acme/design']),
        1,
      ),
    )
    // A third reads the mission's copies, and asks for them again.
    const after = await engine(
      Effect.gen(function* () {
        const copies = yield* missionCopies(missionId)
        const again = yield* copySection(missionId, 'preparation')
        const change = yield* preparationChangedSinceCopy(missionId)
        const copied = yield* eventsOf('delivery.rules_copied')
        return { copies, again, change, copied }
      }),
    )
    expect(after.copies).toEqual(first.copies)
    expect(after.again).toEqual(first.copies[0])
    expect(after.change?.currentVersion).toBe(2)
    expect(after.change?.differences).toEqual([
      { repositoryId: world.id('web'), field: 'reviewers' },
    ])
    expect(after.copied.map((event) => event.payload['section'])).toEqual([
      'preparation',
      'waves',
      'end',
    ])
    expect(first.copies.map((copy) => [copy.section, copy.version])).toEqual([
      ['preparation', 1],
      ['waves', 1],
      ['end', 1],
    ])
  })
})
