/**
 * The `planner` role (#85): the main session of Planning, in the Project's main checkout,
 * read-only, reading the Memory, never counted in the cap. Its layer of the instructions is the
 * ticket's, without the paragraphs the later Planning tickets add with their tools (#86 to #92).
 * Its brief is the mission as the Spec and the Memory hold it: a session never keeps state that is
 * not there.
 */

import { renderSpecMarkdown } from '@hemera/core/domain'
import { Effect } from 'effect'

import { readPreferences } from '../preferences.ts'
import type { BriefField, RoleEntry, SessionOwner } from '../sessions/roles.ts'
import { languageName } from '../sessions/instructions.ts'
import { eq } from 'drizzle-orm'

import { Database, refusedWhile } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import { specIn, visionsOf } from './store.ts'

/** The Planner's layer of the instructions, as the ticket writes it. */
export const PLANNER_TEMPLATE = `# Role: Planner

## Mission
Turn the user's idea or ticket into a Spec that a Builder with a fresh context can build without
guessing. You research, write the draft, ask the user what you cannot know, run what you would
otherwise assume, write the tasks, and declare the Spec complete. The user decides the end state
and the big choices (the technique, the tools). The how and the breakdown are yours, and you
never put them to the user.

You read the code in the main checkout. You never change it.

## Inputs
Your brief: the idea and/or the ticket, the current draft, the user's vision if they gave one,
the triage answer if any, the living spec's domains, Now, the Notes and the end of the Journal,
the Spec language and the user's language. Later inputs arrive as deliveries \`[hemera:<kind>]\`.

## How you work
1. **Read first**: the input, the ticket, the living spec for the domains it touches, the code it
   touches, and the Memory of the missions this one depends on. A file read with an uncommitted
   change says so: the base commit may not hold it.
2. **Triage**: if the input is not new work (another mission holds it, it is already delivered,
   or it is too small for a mission), call \`triage_answer\` (\`existing_mission\`, \`delivered\`, or
   \`too_small\`, which sends the user to the Chat) and end your turn.
3. **Name it**: set the title (what the mission delivers) and the type with \`mission_describe\`.
   The type is information only.
4. **Draft at once** with what you know. Where something is unclear or illogical, do not fill it:
   it becomes a question. Never present a guess as a fact.
5. **Requirements are a delta** against the living spec: each says what is added, modified or
   removed, naming the living requirement it changes. Each has scenarios WHEN … THEN …, concrete
   enough to become a test.
6. **Write in the Spec language** ({project.specLanguage}), whatever language you speak with the
   user ({user.language}).
7. **Declare complete** with \`declare_complete\` when a Builder could build it without guessing,
   saying why. If Hemera refuses, fix what it lists.

## Returns / when you stop
End your turn when nothing is left that does not wait on someone (say on what with \`now_set\`).
Hemera wakes you with the next delivery. Your work ends when the user freezes the Spec.

## Never
- Write or run anything that changes the main checkout.
- Put the breakdown, the tasks or the order of work to the user.
- Ask in your reply text.
- Send anything to a ticket or to a person: you only draft.
- Edit the Spec after Freeze, or freeze it yourself.

## Failure modes to avoid
- One question at a time, or a wave of questions that depend on each other.
- A question with no recommendation, or a recommendation not grounded in the code.
- A requirement that can be read two ways, or a vague word ("fast", "clean", "as before").
- Writing the Spec in the user's language when the Spec language differs.
- Declaring complete with an input not integrated, a question open, a scenario without proof, or
  a target that does not exist as stated.`

/**
 * The mode a Planner's session starts in. Only `draft` exists here; #86 to #97 and B1 add theirs
 * (`answers`, `prelaunch`…), each deciding when it applies.
 */
export const plannerMode = (): string => 'draft'

const TRIAGE_SAID = {
  existing_mission: 'another mission holds it',
  delivered: 'it is already delivered',
  too_small: 'it is too small for a mission: to do in the Chat',
} as const

/** The Planner's brief, from the mission, its Spec and its visions; empty fields left out. */
const plannerBrief = (owner: SessionOwner) =>
  Effect.gen(function* () {
    if (owner.kind !== 'mission') return []
    const database = yield* Database
    const spec = yield* database
      .transaction((transaction) => specIn(transaction, owner.missionId))
      .pipe(Effect.catchTag('UnknownMission', () => Effect.succeed(null)))
    if (spec === null) return []
    const [mission] = yield* database
      .select({
        sentence: missions.ideaSentence,
        ticketKey: missions.ticketKey,
        ticketUrl: missions.ticketUrl,
      })
      .from(missions)
      .where(eq(missions.id, owner.missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    const visions = yield* visionsOf(owner.missionId)
    const preferences = yield* readPreferences
    const written =
      spec.version > 0 || spec.requirements.length > 0
        ? renderSpecMarkdown(spec, { versions: true })
        : 'none yet'
    const triage = spec.triage
    const fields: ReadonlyArray<BriefField> = [
      { label: `Planner · ${spec.key} · ${spec.title}`, text: `Mode: ${plannerMode()}` },
      { label: 'Input', text: mission?.sentence ?? null },
      {
        label: 'Ticket',
        text:
          mission?.ticketKey === null || mission === undefined
            ? null
            : [mission.ticketKey, mission.ticketUrl].filter((part) => part !== null).join(' '),
      },
      {
        label: 'Vision',
        text:
          visions.length === 0
            ? null
            : visions.map((vision) => `- ${vision.at}: ${vision.text}`).join('\n'),
      },
      { label: 'Draft', text: written },
      {
        label: 'Triage',
        text:
          triage === null
            ? null
            : `You answered that ${TRIAGE_SAID[triage.kind]}${triage.ref === null ? '' : ` (${triage.ref})`}: ${triage.text}\n${
                triage.state === 'kept'
                  ? 'The user chose to keep planning it: plan it.'
                  : 'The user has not chosen yet.'
              }`,
      },
      {
        label: 'Languages',
        text: `Spec language: ${languageName(spec.language)} · Your language with the user: ${languageName(preferences.userLanguage)}`,
      },
    ]
    return fields
  })

export const PLANNER_ROLE: RoleEntry = {
  id: 'planner',
  displayName: 'the Planner',
  ownerKind: 'mission',
  placeKind: 'main-checkout',
  writes: false,
  readsMemory: true,
  projectLayer: true,
  mainOf: 'planning',
  template: PLANNER_TEMPLATE,
  brief: plannerBrief,
  countsInCap: false,
  ledByUser: false,
}
