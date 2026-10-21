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
  ForgeRepositoryStatus,
  Mission,
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
import type { Attached, Mentionable, NewRemark, Review } from '@hemera/ui'

import type { FollowedMission } from './building-follow.ts'
import { mentionablesOf } from './chat-items.ts'
import type { Link } from './link.ts'
import { feedbackLabels, reviewMomentOf, teamInOrder } from './review-model.ts'
import type { StartSeed } from './start-results.ts'

/** What the Review page shows of its follower. */
export interface ReviewFollowView {
  /** The page, once the Review is read; null before. */
  readonly moment: Review.ReviewMoment | null
  /** What the fields offer after `@`: the Project's missions and commands. */
  readonly mentionables: ReadonlyArray<Mentionable>
  /** Whether Ship is the head's action now: the engine says it may, and no Ship runs. */
  readonly shippable: boolean
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
  /** A remark or a question added, or a follow-up of a remark, by its name on the page. */
  readonly add: (remark: NewRemark) => Promise<void>
  /** An image handed to Hemera at once: the id it keeps it by, or why it refused it. */
  readonly attach: (file: File) => Promise<Attached>
  readonly edit: (label: string, text: string) => Promise<void>
  readonly withdraw: (label: string) => Promise<void>
  readonly resolve: (label: string) => Promise<void>
  readonly fix: () => Promise<void>
  /** What the start field opens with, for a mission started from a remark; null when refused. */
  readonly startMission: (label: string) => Promise<StartSeed | null>
  /** A round's question answered, put to someone, or answered from a proposal. */
  readonly answer: (
    questionId: string,
    answer: { readonly optionId: string } | { readonly text: string },
  ) => Promise<void>
  readonly waitOnSomeone: (questionId: string, note: string | null) => Promise<void>
  readonly acceptProposed: (proposalId: string, text: string | null) => Promise<void>
  readonly dismissProposed: (proposalId: string) => Promise<void>
  /** A failed push run again, or the forge's CLI checked again once the user signed in. */
  readonly pull: (repository: string, action: 'retry' | 'check') => Promise<void>
  /** A comment of the team added to the round or dismissed, with the user's take when given. */
  readonly team: (label: string, action: 'round' | 'dismiss', take: string) => Promise<void>
  /** Reads Ship's preview fresh, as its confirmation opens. */
  readonly previewShip: () => Promise<void>
  /** Ship, on the preview the user saw; false when the engine refused it, its reasons said. */
  readonly ship: () => Promise<boolean>
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
  let details: ReadonlyArray<RoundDetailView> = []
  let waves: ReadonlyArray<Wave> = []
  let spec: Spec | null = null
  let building: BuildingView | null = null
  let review: AutoReviewView | null = null
  let proofs: ProofsView | null = null
  let now: Now | null = null
  let services: ReadonlyArray<MissionService> = []
  let catalogue: ReadonlyArray<Command> = []
  let missions: ReadonlyArray<Mission> = []
  let diff: MissionDiff | null = null
  let pushes: MissionPushes | null = null
  let team: ReadonlyArray<TeamCommentView> = []
  let forges: ReadonlyArray<ForgeRepositoryStatus> = []
  let preview: ShipPreview | null = null
  let progress: ShipProgress | null = null
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
                forges,
              },
              clock(),
            ),
      mentionables: mentionablesOf(missions, catalogue),
      shippable:
        preview?.possible === true &&
        (progress === null || progress.step === 'idle' || progress.step === 'stopped'),
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

  /** Each round sent, as a small Spec; a round that cannot be read keeps what was shown of it. */
  const readDetails = (read: ReviewStateView): Promise<void> =>
    Promise.all(
      read.rounds
        .filter((one) => one.state !== 'collecting')
        .map((one) =>
          link.reviewRound(missionId, one.number).then(
            (detail) => detail,
            () => details.find((known) => known.number === one.number) ?? null,
          ),
        ),
    ).then((detailed) => {
      details = detailed.filter((one) => one !== null)
      emit()
    })
  const readState = (): Promise<void> =>
    link.reviewState(missionId).then((read) => {
      state = read
      error = undefined
      emit()
      return readDetails(read)
    }, failed)
  const readTeam = (): Promise<void> =>
    quietly(link.teamComments(missionId), (read) => {
      team = read
    })
  const readForges = (): Promise<void> =>
    quietly(link.forgeStatus(mission.projectId), (read) => {
      forges = read
    })
  const readWaves = (): Promise<void> =>
    quietly(link.waves(missionId), (read) => {
      waves = read
    })
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
    Promise.all([readState(), readProofs(), readPreview(), readWaves()]).then(() => undefined)

  const start = (): void => {
    unsubscribe = [
      link.onReviewChanges(missionId, () => void readReview(), failed),
      // A Ship's progress comes with where it stands, then each change.
      link.onShipProgress(
        missionId,
        (heard) => {
          progress = heard
          emit()
        },
        () => undefined,
      ),
      // The pushes come with their first state, then each change.
      link.onPushes(
        missionId,
        (heard) => {
          pushes = heard
          emit()
        },
        () => undefined,
      ),
      link.onTeamComments(
        missionId,
        () => void readTeam(),
        () => undefined,
      ),
      // A round's questions are asked, answered and replaced as planning's are.
      link.onOpenQuestions(
        () => void readWaves(),
        () => undefined,
      ),
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
    void quietly(link.missions(mission.projectId), (read) => {
      missions = read
    })
    void readServices()
    void readDiff()
    void readTeam()
    void readForges()
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

  /** A feedback by its name on the page (`F2`), as the engine knows it. */
  const feedbackOf = (label: string) => {
    const feedback = state?.feedback ?? []
    const labels = feedbackLabels(feedback)
    return feedback.find((one) => labels.get(one.id) === label)
  }
  /** A gesture on a feedback named on the page; one the engine no longer has is done with. */
  const onFeedback = <A>(label: string, send: (feedbackId: string) => Promise<A>) => {
    const one = feedbackOf(label)
    return one === undefined ? Promise.resolve() : gesture(send(one.id), readReview)
  }

  return {
    add: (remark) => {
      if (remark.follows === undefined) {
        return gesture(
          link.addFeedback(missionId, remark.kind, remark.text, null, remark.images),
          readReview,
        )
      }
      return onFeedback(remark.follows, (id) =>
        link.followUpFeedback(id, remark.text, remark.images),
      )
    },
    attach: (file) =>
      file
        .arrayBuffer()
        .then((buffer) => link.addImage(missionId, file.name, new Uint8Array(buffer)))
        .then(
          (added): Attached => ({ id: added.evidenceId }),
          (failure: Error): Attached => ({ refused: failure.message }),
        ),
    edit: (label, text) =>
      onFeedback(label, (id) => link.editFeedback(id, text, feedbackOf(label)?.version ?? 1)),
    withdraw: (label) => onFeedback(label, (id) => link.withdrawFeedback(id)),
    resolve: (label) => onFeedback(label, (id) => link.resolveFeedback(id)),
    fix: () => gesture(link.fix(missionId), readReview),
    answer: (questionId, answer) => gesture(link.answer(missionId, questionId, answer), readWaves),
    waitOnSomeone: (questionId, note) =>
      gesture(link.waitOnSomeone(missionId, questionId, note), readWaves),
    acceptProposed: (proposalId, text) =>
      gesture(link.acceptProposedAnswer(proposalId, text), readWaves),
    dismissProposed: (proposalId) => gesture(link.dismissProposedAnswer(proposalId), readWaves),
    startMission: (label) => {
      const one = feedbackOf(label)
      if (one === undefined) return Promise.resolve(null)
      refused = undefined
      return link.startMissionFrom(one.id).then(
        (source): StartSeed => ({
          text: source.text,
          origin: source.origin,
          originFeedback: source.feedbackId,
          said: source.originSaid,
        }),
        (failure: Error) => {
          refused = failure.message
          emit()
          return null
        },
      )
    },
    previewShip: readPreview,
    ship: () => {
      if (preview === null) return Promise.resolve(false)
      refused = undefined
      return link.confirmShip(missionId, preview.previewId).then(
        () => true,
        (failure: Error) => {
          refused = failure.message
          emit()
          void readPreview()
          return false
        },
      )
    },
    pull: (repository, action) => {
      if (action === 'retry') {
        return gesture(link.retryPush(missionId, repository), () => Promise.resolve())
      }
      const repositoryId =
        pushes?.repositories.find((one) => one.repository === repository)?.repositoryId ?? null
      return gesture(link.checkForgeAgain(mission.projectId, repositoryId), readForges)
    },
    team: (label, action, take) => {
      const one = teamInOrder(team)[Number(label.slice(1)) - 1]
      if (one === undefined) return Promise.resolve()
      const taken =
        take === '' || take === (one.myTake ?? '')
          ? Promise.resolve()
          : link.takeTeamComment(one.id, take).then(() => undefined)
      return gesture(
        taken.then(() =>
          action === 'round' ? link.addTeamCommentToRound(one.id) : link.dismissTeamComment(one.id),
        ),
        () => Promise.all([readTeam(), readReview()]).then(() => undefined),
      )
    },
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
