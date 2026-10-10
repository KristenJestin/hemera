/**
 * A session's instructions, in three layers set once at its start:
 *
 * 1. Hemera's base, every role (`base.ts`, its placeholders filled here), then the session's own
 *    part of it: its owner, the languages and the tester paragraph;
 * 2. the role's layer, from the role registry;
 * 3. the Project's layer: the repositories' own instruction files (`CLAUDE.md`, `AGENTS.md`), sent
 *    only to an agent that does not read them itself when run bare, never both.
 *
 * What every session of a role shares comes first (the base, the role's layer), then the cache
 * boundary (`agents/prompt-blocks.ts`), then what belongs to the session (its part of the base,
 * the Project's layer): the provider reads the first part again for the next mission.
 *
 * Claude Code takes them as its custom system prompt, in blocks around the boundary; Codex and
 * OpenCode as an `embedded_resource` in the first message, in one text. A later change of a
 * template applies to the next session.
 */

import { readFileSync } from 'node:fs'
import { join, posix, resolve, win32 } from 'node:path'

import { ADAPTERS } from '../agents/adapters/index.ts'
import type { AgentAdapter } from '../agents/adapter.ts'
import { getProject } from '../projects.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { projectRepositories, workspaceRepositories, workspaces } from '../storage/schema.ts'
import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import type { AgentProvider } from '@hemera/core/domain'

import { SYSTEM_PROMPT_BOUNDARY } from '../agents/prompt-blocks.ts'
import { BASE, SESSION } from './base.ts'
import type { RoleEntry } from './roles.ts'

/** What the base layer's placeholders are filled with. */
export interface BaseValues {
  /** `mission ACME-12`, or `the Project Acme`. */
  readonly owner: string
  /** The role's display name. */
  readonly role: string
  /** The language the agents speak to the user, as a tag (`fr`, `en-GB`). */
  readonly userLanguage: string
  /** The Project's Spec language, as a tag. */
  readonly specLanguage: string
  readonly readsMemory: boolean
  /** The tester mode's paragraph when that mode is on (#45); nothing otherwise. */
  readonly testerMode: string | null
  /** Whether only Hemera writes to it: every role but the Chat, where the user writes too. */
  readonly hemeraOnly: boolean
}

/** A language tag as its English name: `fr` is French; a tag it cannot name stays as it is. */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

/** Keeps or drops an `{#if name}…{/if}` block. */
const kept = (template: string, name: string, keep: boolean): string =>
  template.replace(
    new RegExp(`\\{#if ${name}\\}\\n?([\\s\\S]*?)\\{\\/if\\}\\n?`, 'g'),
    (_, inside: string) => (keep ? inside : ''),
  )

const finished = (text: string): string => text.replace(/\n{3,}/g, '\n\n').trim()

/** Hemera's base, shared by every session of a role: its role's blocks kept, the rest dropped. */
export function renderBase(values: BaseValues, template: string = BASE): string {
  const blocks = kept(
    kept(template, 'readsMemory', values.readsMemory),
    'hemeraOnly',
    values.hemeraOnly,
  )
  return finished(blocks.replaceAll('{role}', values.role))
}

/** What belongs to one session: its owner, the two languages, the tester paragraph when on. */
export function renderSession(values: BaseValues, template: string = SESSION): string {
  return finished(
    kept(template, 'testerMode', values.testerMode !== null)
      .replaceAll('{owner}', values.owner)
      .replaceAll('{user.language}', languageName(values.userLanguage))
      .replaceAll('{project.specLanguage}', languageName(values.specLanguage))
      .replaceAll('{testerModeParagraph}', values.testerMode ?? ''),
  )
}

/** A repository of a session's place: its name in the Project, and its folder on disk. */
export interface PlaceRepository {
  readonly repository: string
  readonly folder: string
}

/** An instruction file as it is sent: the repository, the file, its text. */
export interface InstructionFile {
  readonly repository: string
  readonly file: 'CLAUDE.md' | 'AGENTS.md'
  readonly text: string
}

type InstructionFileName = InstructionFile['file']

const otherFile = (file: InstructionFileName): InstructionFileName =>
  file === 'CLAUDE.md' ? 'AGENTS.md' : 'CLAUDE.md'

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The file of a repository an agent that does not read them itself is sent: the one it would read
 * natively, the other when that one is absent, nothing when neither exists.
 */
const fileFor = (adapter: AgentAdapter, repository: PlaceRepository): InstructionFile | null => {
  for (const file of [adapter.instructionFile, otherFile(adapter.instructionFile)]) {
    const text = readText(join(repository.folder, file))
    if (text !== null) return { repository: repository.repository, file, text }
  }
  return null
}

/** The files Hemera sends an agent as the Project's layer: none to one that reads them itself. */
export function filesToSend(
  adapter: AgentAdapter,
  platform: NodeJS.Platform,
  repositories: ReadonlyArray<PlaceRepository>,
): ReadonlyArray<InstructionFile> {
  if (adapter.readsInstructionFiles(platform)) return []
  return repositories.flatMap((repository) => fileFor(adapter, repository) ?? [])
}

/** The Project's layer as the agent reads it: each file under its repository and name. */
export function projectLayer(files: ReadonlyArray<InstructionFile>): string {
  if (files.length === 0) return ''
  return [
    '# The Project’s own instructions',
    ...files.map((one) => `## ${one.repository}/${one.file}\n\n${one.text.trim()}`),
  ].join('\n\n')
}

/**
 * The layers, in their order, an empty one left out: the base and the role's layer, the cache
 * boundary, then the session's part of the base and the Project's layer. The role's layer takes
 * the user's language and the Spec language where it names them.
 */
export function instructionsText(
  values: BaseValues,
  role: RoleEntry,
  files: ReadonlyArray<InstructionFile>,
): string {
  const template = role.template
    .replaceAll('{user.language}', languageName(values.userLanguage))
    .replaceAll('{project.specLanguage}', languageName(values.specLanguage))
    .trim()
  const layered = (layers: ReadonlyArray<string>) =>
    layers.filter((layer) => layer !== '').join('\n\n---\n\n')
  const shared = layered([renderBase(values), template])
  const session = layered([renderSession(values), role.projectLayer ? projectLayer(files) : ''])
  return `${shared}\n\n${SYSTEM_PROMPT_BOUNDARY}\n\n${session}`
}

/**
 * A folder as a comparison of places reads it: resolved, without a trailing separator, and in one
 * case on Windows, where a drive letter or a folder written in another case is the same folder.
 */
const placeKey = (folder: string, platform: NodeJS.Platform): string =>
  platform === 'win32' ? win32.resolve(folder).toLowerCase() : posix.resolve(folder)

/**
 * The repositories of a session's place: a Workspace's worktrees, the main checkout's
 * repositories, or the folder itself when it is neither.
 */
export const placeRepositories = (
  projectId: string,
  folder: string,
  platform: NodeJS.Platform = process.platform,
) =>
  Effect.gen(function* () {
    const database = yield* Database
    const project = yield* getProject(projectId)
    const place = placeKey(folder, platform)
    if (placeKey(project.mainCheckout, platform) === place) {
      const rows = yield* database
        .select({ path: projectRepositories.path })
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, projectId))
        .orderBy(asc(projectRepositories.position))
        .pipe(Effect.mapError(refusedWhile('reading the repositories')))
      return rows.map((row) => ({
        repository: row.path,
        folder: join(project.mainCheckout, row.path),
      }))
    }
    const worktrees = yield* database
      .select({
        folder: workspaces.folder,
        path: workspaceRepositories.path,
        worktree: workspaceRepositories.worktree,
      })
      .from(workspaceRepositories)
      .innerJoin(workspaces, eq(workspaces.id, workspaceRepositories.workspaceId))
      .where(eq(workspaces.projectId, projectId))
      .orderBy(asc(workspaceRepositories.position))
      .pipe(Effect.mapError(refusedWhile('reading the Workspace')))
    const mine = worktrees.filter((row) => placeKey(row.folder, platform) === place)
    if (mine.length > 0) {
      return mine.map((row) => ({ repository: row.path, folder: row.worktree }))
    }
    return [{ repository: '.', folder: resolve(folder) }]
  })

/** What one agent does with a repository's instruction files. */
export interface AgentReading {
  readonly agent: AgentProvider
  /** `itself` when it reads its file natively, `sent` when Hemera sends one, `none` otherwise. */
  readonly how: 'itself' | 'sent' | 'none'
  /** The file read or sent, or null. */
  readonly file: 'CLAUDE.md' | 'AGENTS.md' | null
}

/** A repository of a Project: which instruction files it holds, and what each agent does. */
export interface RepositoryInstructions {
  readonly repository: string
  readonly files: ReadonlyArray<'CLAUDE.md' | 'AGENTS.md'>
  readonly agents: ReadonlyArray<AgentReading>
}

/** For the Project's settings: each repository's instruction files and each agent's way. */
export const instructionFilesOf = (projectId: string, platform: NodeJS.Platform) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const repositories = yield* placeRepositories(projectId, project.mainCheckout)
    return repositories.map((repository): RepositoryInstructions => {
      const files = (['CLAUDE.md', 'AGENTS.md'] as const).filter(
        (file) => readText(join(repository.folder, file)) !== null,
      )
      return {
        repository: repository.repository,
        files,
        agents: Object.values(ADAPTERS).map((adapter): AgentReading => {
          if (adapter.readsInstructionFiles(platform)) {
            return files.includes(adapter.instructionFile)
              ? { agent: adapter.id, how: 'itself', file: adapter.instructionFile }
              : { agent: adapter.id, how: 'none', file: null }
          }
          const sent = fileFor(adapter, repository)
          return sent === null
            ? { agent: adapter.id, how: 'none', file: null }
            : { agent: adapter.id, how: 'sent', file: sent.file }
        }),
      }
    })
  })
