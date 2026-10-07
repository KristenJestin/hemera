/**
 * The Chat's own tools (#43), as the gate executes them: `missions_list`, the Project's missions
 * read-only, and `spec_create_draft`, a mission created in Planning from the conversation, which
 * answers its key and the missions whose titles look like it. Nothing here writes into a mission.
 */

import { MISSIONS_LISTED_MAX, type ToolArguments, isLive } from '@hemera/core/domain'
import { Effect } from 'effect'

import { ballSaid } from '../memory/render.ts'
import { createMission, listMissions } from '../missions.ts'
import { getSession } from '../sessions/store.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { addEntry, chatOfLineage } from './store.ts'

/** The words of a title that say something: three letters or more, case aside. */
const wordsOf = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  )

/** The Project's missions, read-only, filtered by stage and by words of their key or title. */
export const missionsList = (grant: Grant, args: ToolArguments<'missions_list'>) =>
  Effect.gen(function* () {
    const missions = yield* listMissions(grant.projectId)
    const wanted = wordsOf(args.text ?? '')
    const shown = missions
      .filter((mission) => args.stage === undefined || mission.stage === args.stage)
      .filter((mission) => {
        if (wanted.size === 0) return true
        const held = wordsOf(`${mission.key} ${mission.title}`)
        return [...wanted].every((word) => held.has(word))
      })
      .slice(0, MISSIONS_LISTED_MAX)
    if (shown.length === 0) return answered('No mission of the Project matches.')
    return answered(
      shown
        .map((mission) =>
          [
            mission.key,
            mission.title,
            mission.stage,
            mission.ball === null
              ? isLive(mission.stage)
                ? 'idle'
                : 'ended'
              : ballSaid(mission.ball),
            `last change ${mission.updatedAt}`,
          ].join(' · '),
        )
        .join('\n'),
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))

/**
 * A mission in Planning in the Chat's Project, its title the first line of its idea, its Journal
 * naming the Chat; the answer gives its key and the missions whose titles share words with it.
 */
export const specCreateDraft = (grant: Grant, args: ToolArguments<'spec_create_draft'>) =>
  Effect.gen(function* () {
    if (grant.missionId !== null) {
      return refusal('refused: only a Chat creates a mission this way')
    }
    const session = yield* getSession(grant.sessionId)
    const chat = yield* chatOfLineage(session.lineage)
    if (chat === null) return refusal('refused: this session is no Chat’s')
    const before = yield* listMissions(grant.projectId)
    const mission = yield* createMission(
      {
        projectId: grant.projectId,
        idea: { sentence: `${args.title}\n\n${args.idea}`, ticket: args.ticket ?? null },
      },
      { fromChat: chat.title },
    )
    yield* addEntry(chat.id, {
      kind: 'notice',
      text: `Mission ${mission.key} created: ${mission.title}`,
    })
    const titled = wordsOf(args.title)
    const similar = before.filter((one) => [...wordsOf(one.title)].some((word) => titled.has(word)))
    return answered(
      [
        `Created ${mission.key} in Planning: ${mission.title}. Give the user its key.`,
        similar.length === 0
          ? 'No other mission of the Project has a title like it.'
          : [
              'Missions whose titles look like it (tell the user if one is the same):',
              ...similar.map((one) => `- ${one.key} · ${one.title} · ${one.stage}`),
            ].join('\n'),
      ].join('\n\n'),
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))
