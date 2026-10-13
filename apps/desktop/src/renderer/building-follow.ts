/**
 * The followers of the Ready and Building pages: what each reads, follows and sends. A follower
 * holds the engine's latest answers, turns them into the page's words through `building-model.ts`
 * at each change, and sends the user's gestures; no React, no Effect: the calls are promises.
 *
 * On Ready, Build checks the mission against the code of today; when nothing moved, or what moved
 * leaves the Spec whole, the launch goes on by itself, once (the user is never asked twice).
 * Otherwise the check waits for the user's choice: Launch anyway, Back to Planning, Check again.
 */

import { CHECK_EXPIRED, type LaunchChoice } from '@hemera/core/domain'
import {
  BuildingRefused,
  type AgentState,
  type AutoReviewView,
  type BuildingPreparation,
  type BuildingView,
  type CheckModel,
  type Command,
  type HelperChip,
  type JournalLine,
  type MissionDiff,
  type MissionService,
  type ModelMark,
  type Now,
  type PrelaunchView,
  type Spec,
} from '@hemera/ipc'
import { launchable, type Building, type ModelChoice, type ServiceAction } from '@hemera/ui'
import { Predicate } from 'effect'

import {
  buildingMomentOf,
  launchCheckOf,
  percentOf,
  readyMomentOf,
  type MissionRead,
} from './building-model.ts'
import { markedAs } from './chat-actions.ts'
import { settingOfChoice } from './chat-items.ts'
import type { Link } from './link.ts'

/** The mission a page follows: its ids, and when its Spec was frozen. */
export interface FollowedMission {
  readonly id: string
  readonly projectId: string
  readonly frozenAt: string | null
}

/** What the Ready page shows of its follower. */
export interface ReadyFollowView {
  /** The page, once the frozen Spec is read. */
  readonly moment: Building.ReadyMoment | null
  /** Whether Launch is the header's action now. */
  readonly launchable: boolean
  /** Why the page could not be read, in words. */
  readonly error?: string | undefined
  /** Why the last gesture did not go through, in words. */
  readonly refused?: string | undefined
}

export interface ReadyFollowing {
  /** Build, or Check again: a check, then the launch by itself when it holds. */
  readonly launch: () => Promise<void>
  readonly launchAnyway: () => Promise<void>
  readonly backToPlanning: () => Promise<void>
  /** The Builder's model for this mission, or null to inherit it. */
  readonly chooseModel: (choice: ModelChoice | null) => Promise<void>
  /** A model starred or hidden in the picker, by its agent and its name. */
  readonly mark: (
    agent: string,
    model: string,
    change: { readonly favourite?: boolean; readonly hidden?: boolean },
  ) => Promise<void>
  readonly revoke: (grantId: string) => Promise<void>
  /** Reads again, after a failure. */
  readonly retry: () => void
  readonly stop: () => void
}

/** What the Building page shows of its follower. */
export interface BuildingFollowView {
  /** The page, once the Building is read; null before. */
  readonly moment: Building.BuildingMoment | null
  /** The Building as the engine gives it: a task's view is read from it. */
  readonly building: BuildingView | null
  readonly spec: Spec | null
  /** Building's percentage (open question 24), once read. */
  readonly percent: number | null
  readonly error?: string | undefined
  readonly refused?: string | undefined
}

export interface BuildingFollowing {
  /** A service's act, by the id its row names it by: its run, or the catalogue's command. */
  readonly service: (id: string, action: ServiceAction) => Promise<void>
  /** Reads the journal further back. */
  readonly journalMore: () => Promise<void>
  readonly revoke: (grantId: string) => Promise<void>
  readonly retry: () => void
  readonly stop: () => void
}

const NO_THINGS: MissionRead = {
  dependencies: null,
  titles: new Map(),
  grants: [],
  budget: null,
}

/**
 * Reads the mission's own things, each on its own: one refused keeps what was shown of it before,
 * since the page goes on without it.
 */
function readThings(
  link: Link,
  mission: FollowedMission,
  before: MissionRead,
): Promise<MissionRead> {
  const kept = <A>(read: Promise<A>, fallback: A): Promise<A> => read.catch(() => fallback)
  return Promise.all([
    kept(link.dependencies(mission.id), before.dependencies),
    kept(
      link
        .missions(mission.projectId)
        .then((missions) => new Map(missions.map((one) => [one.key, one.title]))),
      before.titles,
    ),
    kept(link.missionGrants(mission.id), before.grants),
    kept(link.missionBudget(mission.id), before.budget),
  ]).then(([dependencies, titles, grants, budget]) => ({ dependencies, titles, grants, budget }))
}

/** Whether a check shown on Ready holds and needs nothing of the user: the launch goes on. */
const holds = (state: Building.LaunchCheck['state']): boolean =>
  state === 'clear' || state === 'moved'

/** Follows a Ready mission: its frozen Spec, its last check and its launch. */
export function followReady(
  link: Link,
  mission: FollowedMission,
  onView: (view: ReadyFollowView) => void,
  clock: () => Date = () => new Date(),
): ReadyFollowing {
  const missionId = mission.id
  let stopped = false
  let spec: Spec | null = null
  let check: PrelaunchView | null = null
  let preparation: BuildingPreparation | null = null
  let model: CheckModel | null = null
  let agents: ReadonlyArray<AgentState> = []
  let marks: ReadonlyArray<ModelMark> = []
  let things = NO_THINGS
  let checking = false
  let expired = false
  let launching = false
  /** The check the user asked for in this visit, which launches by itself once it holds. */
  let asked: string | null = null
  let error: string | undefined
  let refused: string | undefined
  let unsubscribe: () => void = () => undefined

  /**
   * The check the card shows: one asked in this visit, one that needs the user's choice, or the
   * one the launch went on from. A check that held from an earlier visit is not one to show:
   * Launch checks again.
   */
  const shownCheck = (): PrelaunchView | null => {
    if (check === null || check.kind !== 'full') return null
    if (check.id === asked || preparation !== null) return check
    const state = launchCheckOf({ check, checking: false, expired: false, things }, clock()).state
    return holds(state) || check.state === 'running' ? null : check
  }

  const emit = (): void => {
    if (stopped) return
    const moment =
      spec === null
        ? null
        : readyMomentOf(
            {
              spec,
              frozenAt: mission.frozenAt,
              check: shownCheck(),
              checking,
              expired,
              preparation,
              model,
              agents,
              marks,
              things,
            },
            clock(),
          )
    onView({
      moment,
      launchable: moment !== null && !launching && preparation === null && launchable(moment),
      error,
      refused,
    })
  }

  const send = (choice: LaunchChoice): Promise<void> => {
    if (check === null || launching) return Promise.resolve()
    launching = true
    refused = undefined
    emit()
    return link.launch(missionId, check.id, choice).then(
      (heard) => {
        launching = false
        preparation = heard
        emit()
      },
      (failure: Error) => {
        launching = false
        if (failure instanceof BuildingRefused && failure.reasons[0] === CHECK_EXPIRED) {
          expired = true
        } else {
          refused = failure.message
        }
        emit()
      },
    )
  }

  /** The check asked has ended: when it holds, the launch goes on, once. */
  const ended = (heard: PrelaunchView): Promise<void> => {
    if (heard.id !== asked || heard.state !== 'done') return Promise.resolve()
    const state = launchCheckOf(
      { check: heard, checking: false, expired: false, things },
      clock(),
    ).state
    if (!holds(state)) return Promise.resolve()
    asked = null
    check = heard
    return send('launch')
  }

  const heardCheck = (heard: PrelaunchView): Promise<void> => {
    if (heard.kind !== 'full') return Promise.resolve()
    check = heard
    model = heard.model
    const launched = ended(heard)
    emit()
    return launched
  }

  const start = (): void => {
    unsubscribe = link.onLaunch(
      missionId,
      (change) => {
        if (Predicate.isTagged(change, 'CheckChanged')) {
          void heardCheck(change.check)
          return
        }
        preparation = change.preparation
        emit()
      },
      // The check's stream is a help: the answers of the calls carry the same.
      () => undefined,
    )
    link.spec(missionId).then(
      (read) => {
        spec = read
        error = undefined
        emit()
      },
      (failure: Error) => {
        error = failure.message
        emit()
      },
    )
    readThings(link, mission, things).then((read) => {
      things = read
      emit()
    })
    link.agents().then(
      (read) => {
        agents = read
        emit()
      },
      () => undefined,
    )
    link.modelMarks().then(
      (read) => {
        marks = read
        emit()
      },
      () => undefined,
    )
  }

  start()

  return {
    launch: () => {
      if (checking || launching) return Promise.resolve()
      checking = true
      expired = false
      refused = undefined
      emit()
      return link.checkLaunch(missionId).then(
        (heard) => {
          checking = false
          asked = heard.id
          return heardCheck(heard)
        },
        (failure: Error) => {
          checking = false
          refused = failure.message
          emit()
        },
      )
    },
    launchAnyway: () => send('launch_anyway'),
    backToPlanning: () => {
      if (check === null) return Promise.resolve()
      refused = undefined
      return link.backToPlanning(missionId, check.id).then(
        // The mission moves back to Planning: its page follows the move.
        () => undefined,
        (failure: Error) => {
          refused = failure.message
          emit()
        },
      )
    },
    chooseModel: (choice) => {
      const agent = agents.find((one) => one.id === choice?.agent)?.id
      const setting = choice === null || agent === undefined ? null : settingOfChoice(agent, choice)
      if (choice !== null && setting === null) return Promise.resolve()
      return link.chooseBuilderModel(missionId, setting).then(
        (heard) => {
          model = heard
          emit()
        },
        (failure: Error) => {
          refused = failure.message
          emit()
        },
      )
    },
    mark: (agentId, name, change) => {
      // The picker offers the agents it was given: one it names is one of them.
      const agent = agents.find((one) => one.id === agentId)?.id
      if (agent === undefined) return Promise.resolve()
      return link.markModel(markedAs(marks, agent, name, change)).then(
        () =>
          link.modelMarks().then((read) => {
            marks = read
            emit()
          }),
        (failure: Error) => {
          refused = failure.message
          emit()
        },
      )
    },
    revoke: (grantId) =>
      link.revokeGrant(grantId).then(
        () =>
          readThings(link, mission, things).then((read) => {
            things = read
            emit()
          }),
        (failure: Error) => {
          refused = failure.message
          emit()
        },
      ),
    retry: () => {
      unsubscribe()
      error = undefined
      emit()
      start()
    },
    stop: () => {
      stopped = true
      unsubscribe()
    },
  }
}

/** The journal's lines, newest first, each once. */
const mergedLines = (
  one: ReadonlyArray<JournalLine>,
  other: ReadonlyArray<JournalLine>,
): JournalLine[] => {
  const bySequence = new Map([...one, ...other].map((line) => [line.sequence, line]))
  return [...bySequence.values()].toSorted((a, b) => b.sequence - a.sequence)
}

/** The Workspace's name: the folder its repositories sit in. */
const workspaceOf = (building: BuildingView): string | null =>
  building.repositories[0]?.folder.split(/[\\/]/).at(-2) ?? null

/** Follows a Building mission: the Building, Now, the journal, the services, the helpers. */
export function followBuilding(
  link: Link,
  mission: FollowedMission,
  onView: (view: BuildingFollowView) => void,
  clock: () => Date = () => new Date(),
): BuildingFollowing {
  const missionId = mission.id
  let stopped = false
  let building: BuildingView | null = null
  let spec: Spec | null = null
  let now: Now | null = null
  let journal: ReadonlyArray<JournalLine> = []
  let before: number | null = null
  let services: ReadonlyArray<MissionService> = []
  let catalogue: ReadonlyArray<Command> = []
  let helpers: ReadonlyArray<HelperChip> = []
  let review: AutoReviewView | null = null
  let diff: MissionDiff | null = null
  let things = NO_THINGS
  let error: string | undefined
  let refused: string | undefined
  let unsubscribe: Array<() => void> = []

  const emit = (): void => {
    if (stopped) return
    onView({
      moment:
        building === null
          ? null
          : buildingMomentOf(
              {
                building,
                spec,
                now,
                journal,
                journalMore: before !== null,
                services,
                catalogue,
                helpers,
                review,
                diff,
                workspace: workspaceOf(building),
                things,
              },
              clock(),
            ),
      building,
      spec,
      percent: building === null ? null : percentOf(building),
      error,
      refused,
    })
  }

  /** A read whose refusal leaves what was shown: the page goes on without it. */
  const quietly = <A>(read: Promise<A>, then: (value: A) => void): Promise<void> =>
    read.then(
      (value) => {
        then(value)
        emit()
      },
      () => undefined,
    )

  const readServices = (): Promise<void> =>
    quietly(link.missionServices(missionId), (read) => {
      services = read
    })
  const readDiff = (): Promise<void> =>
    quietly(link.liveDiff(missionId), (read) => {
      diff = read
    })
  const readAround = (): Promise<void> =>
    readThings(link, mission, things).then((read) => {
      things = read
      emit()
    })

  const start = (): void => {
    const failed = (failure: Error): void => {
      if (stopped) return
      error = failure.message
      emit()
    }
    unsubscribe = [
      link.onBuilding(
        missionId,
        (heard) => {
          building = heard
          error = undefined
          emit()
          void readAround()
        },
        failed,
      ),
      link.onMemory(
        missionId,
        (change) => {
          now = change.now
          journal = mergedLines(change.added, journal)
          emit()
        },
        // Now and the journal are a help: the page goes on without them.
        () => undefined,
      ),
      link.onHelpers(
        missionId,
        (heard) => {
          helpers = heard
          emit()
        },
        () => undefined,
      ),
      link.onAutoReview(
        missionId,
        (heard) => {
          review = heard
          emit()
        },
        () => undefined,
      ),
      link.onMissionWorkspaces(
        (changed) => {
          if (changed !== missionId) return
          void readServices()
          void readDiff()
        },
        () => undefined,
      ),
      link.onDiffChanges(
        missionId,
        () => {
          void readDiff()
        },
        () => undefined,
      ),
    ]
    void quietly(link.spec(missionId), (read) => {
      spec = read
    })
    void quietly(link.memoryNow(missionId), (read) => {
      now ??= read
    })
    void quietly(link.journal(missionId, null), (page) => {
      journal = mergedLines(journal, page.lines)
      before = page.before
    })
    void quietly(link.catalogue(mission.projectId), (read) => {
      catalogue = read
    })
    void readServices()
    void readDiff()
  }

  start()

  /** A gesture: its refusal said in the head, its effect read back. */
  const gesture = <A>(send: Promise<A>, after: () => Promise<void>): Promise<void> => {
    refused = undefined
    return send.then(after, (failure: Error) => {
      refused = failure.message
      emit()
    })
  }

  return {
    service: (id, action) => {
      const run = services.find((one) => one.runId === id)
      switch (action) {
        case 'stop':
          return run === undefined
            ? Promise.resolve()
            : gesture(link.stopService(missionId, run.runId), readServices)
        case 'restart':
          return run === undefined
            ? Promise.resolve()
            : gesture(link.restartService(missionId, run.runId), readServices)
        case 'dismiss':
          return run === undefined
            ? Promise.resolve()
            : gesture(link.dismissService(missionId, run.runId), readServices)
        case 'start': {
          // A service that stopped starts again from its command; one of the catalogue by its id.
          const commandId = run === undefined ? id : run.commandId
          if (commandId !== null) {
            return gesture(link.startService(missionId, commandId), readServices)
          }
          return run === undefined
            ? Promise.resolve()
            : gesture(link.restartService(missionId, run.runId), readServices)
        }
        // Opening and copying the address are the window's own.
        case 'open':
        case 'copy':
          return Promise.resolve()
      }
    },
    journalMore: () => {
      if (before === null) return Promise.resolve()
      return quietly(link.journal(missionId, before), (page) => {
        journal = mergedLines(journal, page.lines)
        before = page.before
      })
    },
    revoke: (grantId) => gesture(link.revokeGrant(grantId), readAround),
    retry: () => {
      for (const stop of unsubscribe) stop()
      error = undefined
      emit()
      start()
    },
    stop: () => {
      stopped = true
      for (const stop of unsubscribe) stop()
    },
  }
}
