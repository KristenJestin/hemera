/**
 * The Review page's follower (#496): what it reads of a mission in Review, how it stays live, and
 * the gestures it sends. The page keeps live on the engine's streams, never on a poll: a read
 * happens when a change is heard, and only then.
 */

import {
  FeedbackRefused,
  ImageRefused,
  ProofRefused,
  ShipRefused,
  type ShipProgress,
  type BuildingView,
  type MissionPushes,
  type ProofsView,
  type ReviewChange,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import type { Link } from '../src/renderer/link.ts'
import { followReview, type ReviewFollowView } from '../src/renderer/review-follow.ts'
import { at, building, diff, now, proof, service } from './building-fixtures.ts'
import { SILENT_LINK } from './fake-link.ts'
import {
  feedback,
  proofsView,
  pushes,
  question,
  repositoryPush,
  reviewState,
  roundDetail,
  shipPreview,
  shipProgress,
  teamComment,
} from './review-fixtures.ts'

const MISSION = { id: 'm12', projectId: 'acme', frozenAt: null }

/** Lets the promises the follower chained settle. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A link that answers Review's reads, records each, and lets a test play the streams. */
function linkOf(more: Partial<Link> = {}) {
  const calls: string[] = []
  const reviewListeners: Array<(change: ReviewChange) => void> = []
  const buildingListeners: Array<(view: BuildingView | null) => void> = []
  let state = reviewState()
  let proofs: ProofsView | null = proofsView()
  const link: Link = {
    ...SILENT_LINK,
    reviewState: () => {
      calls.push('state')
      return Promise.resolve(state)
    },
    proofs: () => {
      calls.push('proofs')
      return Promise.resolve(proofs)
    },
    shipPreview: () => {
      calls.push('preview')
      return Promise.resolve(shipPreview())
    },
    memoryNow: () => Promise.resolve(now({ stage: 'review', round: 1 })),
    waves: () => Promise.resolve([]),
    reviewRound: (_missionId, number) => Promise.resolve(roundDetail({ number })),
    missionServices: () => Promise.resolve([service()]),
    catalogue: () => Promise.resolve([]),
    liveDiff: () => Promise.resolve(diff()),
    onReviewChanges: (_missionId, listener) => {
      reviewListeners.push(listener)
      return () => undefined
    },
    onBuilding: (_missionId, listener) => {
      buildingListeners.push(listener)
      return () => undefined
    },
    ...more,
  }
  return {
    link,
    calls,
    setState: (next: typeof state) => {
      state = next
    },
    setProofs: (next: ProofsView | null) => {
      proofs = next
    },
    changed: () => {
      for (const listener of reviewListeners) listener({ missionId: 'm12', sequence: 2 })
    },
    built: (view: BuildingView) => {
      for (const listener of buildingListeners) listener(view)
    },
  }
}

function review(link: Link) {
  const views: ReviewFollowView[] = []
  const following = followReview(link, MISSION, (view) => views.push(view))
  return { following, last: () => views.at(-1) }
}

describe('Review entered', () => {
  test('the page is drawn from the engine’s reads: the feedback, the proofs, Ship’s reasons', async () => {
    const played = linkOf()
    played.setState(reviewState({ feedback: [feedback()], waits: true, fixable: true }))
    const { last } = review(played.link)
    await settled()
    played.built(building({ state: 'ended', phase: 'ended' }))
    await settled()
    const moment = last()?.moment
    expect(moment?.remarks.map((one) => one.id)).toEqual(['F1'])
    expect(moment?.fixable).toBe(true)
    expect(moment?.round).toBe(1)
    expect(moment?.refusals).toEqual(['round 1 waits for its Fix'])
    expect(moment?.services.map((one) => one.name)).toEqual(['api'])
  })

  test('no page before the Review is read: the page draws its skeletons', () => {
    const { last } = review(linkOf().link)
    expect(last()?.moment ?? null).toBeNull()
  })
})

describe('The page keeps live', () => {
  test('a change of the Review is read back, and nothing is read without a change heard', async () => {
    const played = linkOf()
    const { last } = review(played.link)
    await settled()
    played.built(building({ state: 'ended', phase: 'ended' }))
    await settled()
    const before = [...played.calls]
    await settled()
    expect(played.calls).toEqual(before)
    played.setState(reviewState({ feedback: [feedback({ body: 'A second look.' })] }))
    played.changed()
    await settled()
    expect(played.calls.slice(before.length).toSorted()).toEqual(['preview', 'proofs', 'state'])
    expect(last()?.moment?.remarks[0]?.text).toBe('A second look.')
  })
})

describe('A proof verified by hand', () => {
  test('validated: sent to the engine, then the proofs are read back', async () => {
    const sent: string[] = []
    const played = linkOf({
      validateManualProof: (missionId, scenarioId, note) => {
        sent.push(`validate ${missionId} ${scenarioId} ${String(note)}`)
        return Promise.resolve(proof({ scenario: scenarioId, state: 'validated' }))
      },
    })
    const { following } = review(played.link)
    await settled()
    const reads = played.calls.filter((one) => one === 'proofs').length
    await following.verify('S2', { validated: true })
    expect(sent).toEqual(['validate m12 S2 null'])
    expect(played.calls.filter((one) => one === 'proofs').length).toBe(reads + 1)
  })

  test('refused: the user’s reason is what the engine keeps', async () => {
    const sent: string[] = []
    const played = linkOf({
      refuseManualProof: (_missionId, scenarioId, note) => {
        sent.push(`refuse ${scenarioId} ${note}`)
        return Promise.resolve(proof({ scenario: scenarioId, state: 'refused' }))
      },
    })
    const { following } = review(played.link)
    await settled()
    await following.verify('S2', { validated: false, reason: 'The label still wraps.' })
    expect(sent).toEqual(['refuse S2 The label still wraps.'])
  })

  test('a refusal of the engine is said in its words', async () => {
    const played = linkOf({
      validateManualProof: () =>
        Promise.reject(new ProofRefused({ reason: 'S2 is not verified by hand.' })),
    })
    const { following, last } = review(played.link)
    await settled()
    await following.verify('S2', { validated: true })
    expect(last()?.refused).toBe('S2 is not verified by hand.')
  })
})

describe('The feedback', () => {
  const sent: string[] = []
  const withFeedback = (more: Partial<Link> = {}) => {
    sent.length = 0
    const played = linkOf({
      addFeedback: (missionId, kind, body, anchor, images) => {
        sent.push(`add ${missionId} ${kind} ${body} ${String(anchor)} ${(images ?? []).join(',')}`)
        return Promise.resolve(feedback())
      },
      followUpFeedback: (feedbackId, body, images) => {
        sent.push(`follow ${feedbackId} ${body} ${(images ?? []).join(',')}`)
        return Promise.resolve(feedback())
      },
      editFeedback: (feedbackId, body, version) => {
        sent.push(`edit ${feedbackId} ${body} ${String(version)}`)
        return Promise.resolve(feedback())
      },
      withdrawFeedback: (feedbackId) => {
        sent.push(`withdraw ${feedbackId}`)
        return Promise.resolve(feedback())
      },
      resolveFeedback: (feedbackId) => {
        sent.push(`resolve ${feedbackId}`)
        return Promise.resolve(feedback())
      },
      ...more,
    })
    played.setState(
      reviewState({
        feedback: [
          feedback({ id: 'fb-a', version: 3 }),
          feedback({ id: 'fb-b', state: 'addressed', createdAt: at(10, 5) }),
        ],
      }),
    )
    return played
  }

  test('a remark added goes to the engine with the images Hemera kept, and is read back', async () => {
    const played = withFeedback()
    const { following } = review(played.link)
    await settled()
    const reads = played.calls.filter((one) => one === 'state').length
    await following.add({ kind: 'remark', text: 'The header says UTC.', images: ['ev-1'] })
    expect(sent).toEqual(['add m12 remark The header says UTC. null ev-1'])
    expect(played.calls.filter((one) => one === 'state').length).toBe(reads + 1)
  })

  test('a follow-up names the remark it follows by the engine’s id', async () => {
    const played = withFeedback()
    const { following } = review(played.link)
    await settled()
    await following.add({ kind: 'remark', text: 'Still visible.', images: [], follows: 'F2' })
    expect(sent).toEqual(['follow fb-b Still visible. '])
  })

  test('edit, withdraw and resolve name the feedback by the engine’s id, the edit on its version', async () => {
    const played = withFeedback()
    const { following } = review(played.link)
    await settled()
    await following.edit('F1', 'The export keeps the filter.')
    await following.withdraw('F1')
    await following.resolve('F2')
    expect(sent).toEqual([
      'edit fb-a The export keeps the filter. 3',
      'withdraw fb-a',
      'resolve fb-b',
    ])
  })

  test('an image attached is handed to Hemera, which keeps it or says why not', async () => {
    const names: string[] = []
    const played = withFeedback({
      addImage: (missionId, name, bytes) => {
        names.push(`${missionId} ${name} ${String(bytes.length)}`)
        return name.endsWith('.gif')
          ? Promise.reject(new ImageRefused({ reason: 'GIF is not kept: png, jpeg or webp' }))
          : Promise.resolve({ evidenceId: 'ev-1', sha256: 'a1', size: 3, width: 1, height: 1 })
      },
    })
    const { following } = review(played.link)
    await settled()
    const kept = await following.attach(new File([new Uint8Array([1, 2, 3])], 'header.png'))
    const refused = await following.attach(new File([new Uint8Array([1])], 'loop.gif'))
    expect(names).toEqual(['m12 header.png 3', 'm12 loop.gif 1'])
    expect(kept).toEqual({ id: 'ev-1' })
    expect(refused).toEqual({ refused: 'GIF is not kept: png, jpeg or webp' })
  })

  test('Fix sends the round, and a refusal is the engine’s words', async () => {
    const fixed: string[] = []
    const played = withFeedback({
      fix: (missionId) => {
        fixed.push(missionId)
        return fixed.length === 1
          ? Promise.resolve()
          : Promise.reject(new FeedbackRefused({ reason: 'No feedback waits for a Fix.' }))
      },
    })
    const { following, last } = review(played.link)
    await settled()
    await following.fix()
    expect(fixed).toEqual(['m12'])
    expect(last()?.refused).toBeUndefined()
    await following.fix()
    expect(last()?.refused).toBe('No feedback waits for a Fix.')
  })

  test('Start a mission from this hands the start field the remark and where it comes from', async () => {
    const played = withFeedback({
      startMissionFrom: (feedbackId) =>
        Promise.resolve({
          feedbackId,
          text: 'Export the invoices of a year at once.',
          origin: 'm12',
          originSaid: 'Started from ACME-12, round 1',
        }),
    })
    const { following } = review(played.link)
    await settled()
    await expect(following.startMission('F2')).resolves.toEqual({
      text: 'Export the invoices of a year at once.',
      origin: 'm12',
      originFeedback: 'fb-b',
      said: 'Started from ACME-12, round 1',
    })
  })
})

describe('A round over the page', () => {
  test('each round sent is read with its questions, again when the Review or the questions change', async () => {
    const asked: string[] = []
    const questionListeners: Array<() => void> = []
    const played = linkOf({
      reviewRound: (missionId, number) => {
        asked.push(`round ${missionId} ${String(number)}`)
        return Promise.resolve(roundDetail({ number, questions: ['Q7'] }))
      },
      waves: () => {
        asked.push('waves')
        return Promise.resolve([{ number: 3, askedAt: at(10, 50), questions: [question()] }])
      },
      onOpenQuestions: (listener) => {
        questionListeners.push(() => listener([]))
        return () => undefined
      },
    })
    played.setState(
      reviewState({
        rounds: [
          { number: 1, state: 'grilling', createdAt: at(9, 0), movedAt: at(9, 30) },
          { number: 2, state: 'collecting', createdAt: at(9, 30), movedAt: at(9, 30) },
        ],
      }),
    )
    const { last } = review(played.link)
    await settled()
    await settled()
    expect(asked.toSorted()).toEqual(['round m12 1', 'waves'])
    expect(last()?.moment?.rounds[0]?.waves[0]?.questions[0]?.id).toBe('Q7')
    asked.length = 0
    for (const listener of questionListeners) listener()
    await settled()
    expect(asked).toEqual(['waves'])
  })

  test('an answer to a round’s question goes to the engine, and the questions are read back', async () => {
    const sent: string[] = []
    let waves = 0
    const played = linkOf({
      answer: (missionId, questionId, answer) => {
        sent.push(
          `${missionId} ${questionId} ${'optionId' in answer ? answer.optionId : answer.text}`,
        )
        return Promise.resolve()
      },
      waves: () => {
        waves += 1
        return Promise.resolve([])
      },
    })
    const { following } = review(played.link)
    await settled()
    const before = waves
    await following.answer('Q7', { optionId: 'A' })
    expect(sent).toEqual(['m12 Q7 A'])
    expect(waves).toBe(before + 1)
  })
})

describe('The pull requests and the team’s comments', () => {
  test('the pushes keep live on their stream, a failed one is retried by its repository', async () => {
    const listeners: Array<(heard: MissionPushes) => void> = []
    const retried: string[] = []
    const played = linkOf({
      onPushes: (_missionId, listener) => {
        listeners.push(listener)
        return () => undefined
      },
      retryPush: (missionId, repository) => {
        retried.push(`${missionId} ${repository}`)
        return Promise.resolve(pushes())
      },
    })
    const { following, last } = review(played.link)
    await settled()
    for (const listener of listeners) {
      listener(pushes({ repositories: [repositoryPush({ state: 'failed', pullRequest: null })] }))
    }
    expect(last()?.moment?.pulls.map((one) => [one.repository, one.state])).toEqual([
      ['api', 'failed'],
    ])
    await following.pull('api', 'retry')
    expect(retried).toEqual(['m12 api'])
  })

  test('a comment of the team is listed, read again on its change, and joins the round with my take', async () => {
    const listeners: Array<() => void> = []
    const sent: string[] = []
    let lists = 0
    const played = linkOf({
      teamComments: () => {
        lists += 1
        return Promise.resolve([teamComment()])
      },
      onTeamComments: (_missionId, listener) => {
        listeners.push(() => listener({ missionId: 'm12' }))
        return () => undefined
      },
      takeTeamComment: (commentId, myTake) => {
        sent.push(`take ${commentId} ${myTake}`)
        return Promise.resolve(teamComment({ myTake }))
      },
      addTeamCommentToRound: (commentId) => {
        sent.push(`round ${commentId}`)
        return Promise.resolve(teamComment({ state: 'feedback' }))
      },
      dismissTeamComment: (commentId) => {
        sent.push(`dismiss ${commentId}`)
        return Promise.resolve(teamComment({ state: 'dismissed' }))
      },
    })
    const { following, last } = review(played.link)
    await settled()
    expect(last()?.moment?.team.map((one) => one.id)).toEqual(['C1'])
    for (const listener of listeners) listener()
    await settled()
    expect(lists).toBe(2)
    await following.team('C1', 'round', 'One per user.')
    await following.team('C1', 'dismiss', '')
    expect(sent).toEqual(['take tc-1 One per user.', 'round tc-1', 'dismiss tc-1'])
  })
})

describe('Ship', () => {
  test('its progress keeps live on its stream: the re-runs, then the end', async () => {
    const listeners: Array<(heard: ShipProgress) => void> = []
    const played = linkOf({
      onShipProgress: (_missionId, listener) => {
        listeners.push(listener)
        return () => undefined
      },
    })
    const { last } = review(played.link)
    await settled()
    for (const listener of listeners) {
      listener(
        shipProgress({
          step: 'rerunning',
          reruns: [{ kind: 'proof', name: 'S8', state: 'running' }],
        }),
      )
    }
    expect(last()?.shippable).toBe(false)
    expect(last()?.moment?.shipping?.reruns.map((one) => one.state)).toEqual(['running'])
  })

  test('the confirmation is read fresh as it opens, and Ship confirms the preview the user saw', async () => {
    const confirmed: string[] = []
    let previews = 0
    const played = linkOf({
      shipPreview: () => {
        previews += 1
        return Promise.resolve(
          shipPreview({ previewId: `preview-${String(previews)}`, possible: true, reasons: [] }),
        )
      },
      confirmShip: (missionId, previewId) => {
        confirmed.push(`${missionId} ${previewId}`)
        return Promise.resolve({
          missionId,
          shippedAt: at(11, 0),
          trees: [],
          deliveredAt: null,
        })
      },
    })
    const { following, last } = review(played.link)
    await settled()
    expect(last()?.shippable).toBe(true)
    await following.previewShip()
    await expect(following.ship()).resolves.toBe(true)
    expect(confirmed).toEqual([`m12 preview-${String(previews)}`])
  })

  test('Confirm waits for the fresh preview: until its read lands nothing is offered and Ship sends nothing', async () => {
    const confirmed: string[] = []
    let previews = 0
    let land: (read: ReturnType<typeof shipPreview>) => void = () => undefined
    const played = linkOf({
      shipPreview: () => {
        previews += 1
        if (previews === 1) {
          return Promise.resolve(shipPreview({ previewId: 'stale', possible: true, reasons: [] }))
        }
        return new Promise((resolve) => {
          land = resolve
        })
      },
      confirmShip: (missionId, previewId) => {
        confirmed.push(previewId)
        return Promise.resolve({ missionId, shippedAt: at(11, 0), trees: [], deliveredAt: null })
      },
    })
    const { following, last } = review(played.link)
    await settled()
    expect(last()?.shippable).toBe(true)
    expect(last()?.confirmable).toBe(false)
    const reading = following.previewShip()
    // The dialog is open on the preview read before: it cannot be confirmed.
    await expect(following.ship()).resolves.toBe(false)
    expect(last()?.confirmable).toBe(false)
    expect(confirmed).toEqual([])
    land(shipPreview({ previewId: 'fresh', possible: true, reasons: [] }))
    await reading
    expect(last()?.confirmable).toBe(true)
    await expect(following.ship()).resolves.toBe(true)
    expect(confirmed).toEqual(['fresh'])
    // Once shipped, the next confirmation starts again from a read to wait for.
    expect(last()?.confirmable).toBe(false)
  })

  test('a fresh read that fails leaves the confirmation unoffered, and says why', async () => {
    let previews = 0
    const played = linkOf({
      shipPreview: () => {
        previews += 1
        return previews === 1
          ? Promise.resolve(shipPreview({ previewId: 'stale', possible: true, reasons: [] }))
          : Promise.reject(new ShipRefused({ reasons: ['the Workspace could not be read.'] }))
      },
    })
    const { following, last } = review(played.link)
    await settled()
    await following.previewShip()
    expect(last()?.confirmable).toBe(false)
    expect(last()?.refused).toBe('the Workspace could not be read.')
  })

  test('Ship refused: nothing goes, and the engine’s reasons are said', async () => {
    const played = linkOf({
      confirmShip: () =>
        Promise.reject(new ShipRefused({ reasons: ['web · unit tests is red after the re-run.'] })),
    })
    const { following, last } = review(played.link)
    await settled()
    expect(last()?.shippable).toBe(false)
    await following.previewShip()
    await expect(following.ship()).resolves.toBe(false)
    expect(last()?.refused).toBe('web · unit tests is red after the re-run.')
  })
})
