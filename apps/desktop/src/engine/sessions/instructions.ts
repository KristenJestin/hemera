/**
 * A session's instructions, in three layers set once at its start:
 *
 * 1. Hemera's base, every role (`base.ts`, its placeholders filled here);
 * 2. the role's layer, from the role registry;
 * 3. the Project's layer: the repositories' own instruction files (`CLAUDE.md`, `AGENTS.md`), sent
 *    only to an agent that does not read them itself when run bare, never both.
 *
 * Claude Code takes them as its custom system prompt; Codex and OpenCode as an `embedded_resource`
 * in the first message. A later change of a template applies to the next session.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { ADAPTERS } from '../agents/adapters/index.ts'
import type { AgentAdapter } from '../agents/adapter.ts'
import { getProject } from '../projects.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { projectRepositories, workspaceRepositories, workspaces } from '../storage/schema.ts'
import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import type { AgentProvider } from '@hemera/core/domain'

import { BASE } from './base.ts'
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

/** Hemera's base, its placeholders filled and its conditional blocks kept or dropped. */
export function renderBase(values: BaseValues, template: string = BASE): string {
  const blocks = kept(
    kept(template, 'readsMemory', values.readsMemory),
    'testerMode',
    values.testerMode !== null,
  )
  return blocks
    .replaceAll('{owner}', values.owner)
    .replaceAll('{role}', values.role)
    .replaceAll('{user.language}', languageName(values.userLanguage))
    .replaceAll('{project.specLanguage}', languageName(values.specLanguage))
    .replaceAll('{testerModeParagraph}', values.testerMode ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

/** The three layers, in their order, an empty one left out. */
export function instructionsText(
  base: string,
  role: RoleEntry,
  files: ReadonlyArray<InstructionFile>,
): string {
  return [base, role.template.trim(), role.projectLayer ? projectLayer(files) : '']
    .filter((layer) => layer !== '')
    .join('\n\n---\n\n')
}

/**
 * The repositories of a session's place: a Workspace's worktrees, the main checkout's
 * repositories, or the folder itself when it is neither.
 */
export const placeRepositories = (projectId: string, folder: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const project = yield* getProject(projectId)
    const place = resolve(folder)
    if (resolve(project.mainCheckout) === place) {
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
      .select({ path: workspaceRepositories.path, worktree: workspaceRepositories.worktree })
      .from(workspaceRepositories)
      .innerJoin(workspaces, eq(workspaces.id, workspaceRepositories.workspaceId))
      .where(eq(workspaces.folder, folder))
      .orderBy(asc(workspaceRepositories.position))
      .pipe(Effect.mapError(refusedWhile('reading the Workspace')))
    if (worktrees.length > 0) {
      return worktrees.map((row) => ({ repository: row.path, folder: row.worktree }))
    }
    return [{ repository: '.', folder: place }]
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
