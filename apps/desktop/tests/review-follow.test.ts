/**
 * The Review page's follower (#496): what it reads of a mission in Review, how it stays live, and
 * the gestures it sends. The page keeps live on the engine's streams, never on a poll: a read
 * happens when a change is heard, and only then.
 */

import { ProofRefused, type BuildingView, type ProofsView, type ReviewChange } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import type { Link } from '../src/renderer/link.ts'
import { followReview, type ReviewFollowView } from '../src/renderer/review-follow.ts'
import { building, diff, now, proof, service } from './building-fixtures.ts'
import { SILENT_LINK } from './fake-link.ts'
import { feedback, proofsView, reviewState, shipPreview } from './review-fixtures.ts'

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
