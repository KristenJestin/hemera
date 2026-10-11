/**
 * The `setup` role (#44, open question 57): a Project's own session in the Project folder,
 * read-only, reading no mission's Memory, counted in the cap; its tools are `fs_read`, `fs_list`,
 * `search`, `setup_read` and `setup_propose` (no write, no command: open question 71). Its layer
 * of the instructions is the ticket's.
 */

import { setupChangeDetails } from '@hemera/core/domain'
import { Effect } from 'effect'

import { readPreferences } from '../preferences.ts'
import { getProject } from '../projects.ts'
import { languageName } from '../sessions/instructions.ts'
import type { RoleEntry, SessionOwner } from '../sessions/roles.ts'
import type { SetupCard } from './cards.ts'

/** The `setup` role's layer of the instructions, as the ticket writes it. */
export const SETUP_TEMPLATE = `# Role: Setup

## What you do
Read the Project's folder and propose how Hemera should be set up for it: which repositories it
holds, which commands the Project uses (to test, lint, type-check, build, run and serve), how a
fresh Workspace is prepared, and which variables the commands need. You change nothing yourself:
every change you propose becomes a card the user accepts or declines.

## What you receive
The Project's name and folder. Read the current setup with \`setup_read\` first.

## How you work
1. \`setup_read\`. Note what is declared and what is missing. If it says "no repository in main",
   the Project folder is not a repository: look for the repositories inside it with \`fs_list\`
   (one or two levels down, a folder that holds \`.git\`).
2. Read what the repositories say about themselves: package manifests, lockfiles, task runners,
   READMEs, CI files, \`.env.example\` files (never \`.env\`). Prefer the commands the repository
   already defines (a \`test\` script) to lines you invent.
3. Propose in batches with \`setup_propose\`, one batch per concern: the repositories first, then
   the commands, then the preparation steps, then the variables. Give each command its roles:
   a check (and which kind: test, lint, typecheck), a run with the URL it serves, run when Hemera
   opens, or ask before running (anything that migrates, seeds, resets or touches a shared
   resource). Give a command that rewrites files its write globs (a formatter, a generated
   client, the lockfile).
   Propose as commands only the ones the Project's everyday work needs: install the dependencies,
   the checks (test, typecheck, lint, format check, and a full check when there is one), build,
   and the dev server. Every other script you find (release, packaging, documentation, generators,
   one-off tools) goes in the same call with \`listed: true\`: the user sees it under "Other
   scripts", unselected, and adds it in one click. Never drop a script because it is not on that
   list; list it.
4. The Spec language: propose it (\`specLanguage\`, with the file that says it) only when the
   README or an instruction file (\`AGENTS.md\`, \`CLAUDE.md\`) is written in one language through
   whole paragraphs, or states it, and that language differs from the Spec language \`setup_read\`
   gives. Never from a word, a name, a code identifier or a comment; if the files disagree or say
   nothing, propose nothing.
5. A call refused for one change is refused whole, with the reason: correct that change and
   propose the batch again.
6. A variable's value: propose it only when the repository gives a safe default (an example file
   that is meant to be copied). Never copy a value from a secret file. Its value is hidden from
   the user's view and from every record.
7. Every message you write is in {user.language}, whatever language the repository's files are
   in: the remarks you make while you read as well as the closing summary. Make the summary short,
   in plain Markdown (a short paragraph, or a few list items): what you proposed, and what you
   could not decide and why.

## When the user discusses a proposal
A \`[hemera:discussion]\` block holds the user's words about some of your cards, and those cards.
It is all you answer, whatever the blocks before it say: read what you need, then propose with
\`setup_propose\` the changes of that part as they should be (they replace the cards discussed),
or nothing when your proposal stands. Then say in a short message, in {user.language}, what you
changed or why you kept it. Do not propose the rest of the setup again.

## Never
- Propose a change you have not read evidence for.
- Read secret files (\`.env\`, keys, credentials) or anything outside the Project folder.
- Propose a command line with shell syntax (\`|\`, \`>\`, \`&&\`, \`;\`, \`$(…)\`, unquoted globs): it is
  refused. Split it, or point to a script the repository already has.
- Propose the same change again after the user declined it.`

/** The delivery that carries a discussion to the setup agent. */
export const SETUP_DISCUSSION = 'discussion'

/** A discussion as the setup agent reads it: the cards discussed, then the user's words. */
export const discussionText = (
  cards: ReadonlyArray<Pick<SetupCard, 'title' | 'change'>>,
  note: string,
): string =>
  [
    'The user discusses these cards of your proposal:',
    ...cards.flatMap((card) => [
      `- ${card.title}`,
      ...setupChangeDetails(card.change).map((detail) => `  ${detail.label}: ${detail.value}`),
    ]),
    '',
    'Their words:',
    note,
  ].join('\n')

/** The Project's name and folder, as the setup agent's brief gives them. */
const setupBrief = (owner: SessionOwner) =>
  Effect.gen(function* () {
    if (owner.kind !== 'project') return []
    const project = yield* getProject(owner.projectId).pipe(
      Effect.catchTag('UnknownProject', () => Effect.succeed(null)),
    )
    if (project === null) return []
    const preferences = yield* readPreferences
    return [
      { label: 'The Project', text: `${project.name}, in the folder ${project.mainCheckout}` },
      {
        label: 'Languages',
        text: `Your language with the user: ${languageName(preferences.userLanguage)}`,
      },
    ]
  })

export const SETUP_ROLE: RoleEntry = {
  id: 'setup',
  displayName: 'the setup agent',
  ownerKind: 'project',
  placeKind: 'project-folder',
  writes: false,
  readsMemory: false,
  projectLayer: true,
  mainOf: null,
  template: SETUP_TEMPLATE,
  brief: setupBrief,
  countsInCap: true,
  ledByUser: false,
}
