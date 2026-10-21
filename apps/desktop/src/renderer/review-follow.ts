/**
 * The Review page's follower: what it reads of a mission in Review, follows and sends. It holds
 * the engine's latest answers, turns them into the page's words through `review-model.ts` at each
 * change, and sends the user's gestures; no React, no Effect: the calls are promises. The page
 * keeps live on the engine's streams, never on a poll: a read happens when a change is heard.
 */

import type {
  AutoReviewView,
  BuildingView,
  Command,
  MissionDiff,
  MissionPushes,
  MissionService,
  Now,
  ProofsView,
  ReviewStateView,
  RoundDetailView,
  ShipPreview,
  ShipProgress,
  Spec,
  TeamCommentView,
  Wave,
} from '@hemera/ipc'
import type { Review } from '@hemera/ui'

import type { FollowedMission } from './building-follow.ts'
import type { Link } from './link.ts'
import { reviewMomentOf } from './review-model.ts'

/** What the Review page shows of its follower. */
export interface ReviewFollowView {
  /** The page, once the Review is read; null before. */
  readonly moment: Review.ReviewMoment | null
  /** Why the page could not be read, in words. */
  readonly error?: string | undefined
  /** Why the last gesture did not go through, in words. */
  readonly refused?: string | undefined
}

export interface ReviewFollowing {
  /** A service's act, by its name on the page. */
  readonly service: (name: string, action: 'start' | 'stop' | 'restart' | 'remove') => Promise<void>
  /** A proof verified by hand: validated, or refused with the user's reason. */
  readonly verify: (
    scenarioId: string,
    verdict: { readonly validated: boolean; readonly reason?: string | undefined },
  ) => Promise<void>
  /** Reads again, after a failure. */
  readonly retry: () => void
  readonly stop: () => void
}

/** Follows a mission in Review: its feedback and rounds, its proofs, its services, Ship's word. */
export function followReview(
  link: Link,
  mission: FollowedMission,
  onView: (view: ReviewFollowView) => void,
  clock: () => Date = () => new Date(),
): ReviewFollowing {
  const missionId = mission.id
  let stopped = false
  let state: ReviewStateView | null = null
  const details: ReadonlyArray<RoundDetailView> = []
  const waves: ReadonlyArray<Wave> = []
  let spec: Spec | null = null
  let building: BuildingView | null = null
  let review: AutoReviewView | null = null
  let proofs: ProofsView | null = null
  let now: Now | null = null
  let services: ReadonlyArray<MissionService> = []
  let catalogue: ReadonlyArray<Command> = []
  let diff: MissionDiff | null = null
  const pushes: MissionPushes | null = null
  const team: ReadonlyArray<TeamCommentView> = []
  let preview: ShipPreview | null = null
  const progress: ShipProgress | null = null
  let error: string | undefined
  let refused: string | undefined
  let unsubscribe: Array<() => void> = []

  const emit = (): void => {
    if (stopped) return
    onView({
      moment:
        state === null
          ? null
          : reviewMomentOf(
              {
                round: now?.round ?? 0,
                state,
                details,
                waves,
                spec,
                building,
                review,
                proofs,
                now,
                services,
                catalogue,
                diff,
                pushes,
                team,
                preview,
                progress,
              },
              clock(),
            ),
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

  const failed = (failure: Error): void => {
    if (stopped) return
    error = failure.message
    emit()
  }

  const readState = (): Promise<void> =>
    link.reviewState(missionId).then((read) => {
      state = read
      error = undefined
      emit()
    }, failed)
  const readProofs = (): Promise<void> =>
    quietly(link.proofs(missionId), (read) => {
      proofs = read
    })
  const readPreview = (): Promise<void> =>
    quietly(link.shipPreview(missionId), (read) => {
      preview = read
    })
  const readServices = (): Promise<void> =>
    quietly(link.missionServices(missionId), (read) => {
      services = read
    })
  const readDiff = (): Promise<void> =>
    quietly(link.liveDiff(missionId), (read) => {
      diff = read
    })
  /** What a change of the Review moves: the feedback and rounds, the proofs, Ship's word. */
  const readReview = (): Promise<void> =>
    Promise.all([readState(), readProofs(), readPreview()]).then(() => undefined)

  const start = (): void => {
    unsubscribe = [
      link.onReviewChanges(missionId, () => void readReview(), failed),
      link.onBuilding(
        missionId,
        (heard) => {
          building = heard
          emit()
        },
        // The Building's end is a help on Review: the page goes on without it.
        () => undefined,
      ),
      link.onMemory(
        missionId,
        (change) => {
          now = change.now
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
      link.onDiffChanges(
        missionId,
        () => void readDiff(),
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
      // A service publishes its address, and is answered, after it started: the list is read again.
      link.onRunChanges(
        (run) => {
          if (run.type === 'serve') void readServices()
        },
        () => undefined,
      ),
    ]
    void readReview()
    void quietly(link.spec(missionId), (read) => {
      spec = read
    })
    void quietly(link.memoryNow(missionId), (read) => {
      now ??= read
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
    service: (name, action) => {
      const run = services.find((one) => one.name === name)
      if (action === 'start') {
        const commandId = run?.commandId ?? catalogue.find((one) => one.name === name)?.id ?? null
        if (commandId !== null)
          return gesture(link.startService(missionId, commandId), readServices)
        if (run === undefined) return Promise.resolve()
        return gesture(link.restartService(missionId, run.runId), readServices)
      }
      if (run === undefined) return Promise.resolve()
      switch (action) {
        case 'stop':
          return gesture(link.stopService(missionId, run.runId), readServices)
        case 'restart':
          return gesture(link.restartService(missionId, run.runId), readServices)
        case 'remove':
          return gesture(link.dismissService(missionId, run.runId), readServices)
      }
    },
    verify: (scenarioId, verdict) =>
      gesture(
        verdict.validated
          ? link.validateManualProof(missionId, scenarioId, verdict.reason ?? null)
          : link.refuseManualProof(missionId, scenarioId, verdict.reason ?? ''),
        () => Promise.all([readProofs(), readPreview()]).then(() => undefined),
      ),
    retry: () => {
      for (const one of unsubscribe) one()
      error = undefined
      emit()
      start()
    },
    stop: () => {
      stopped = true
      for (const one of unsubscribe) one()
    },
  }
}
