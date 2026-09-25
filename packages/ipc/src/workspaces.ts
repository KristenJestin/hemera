/**
 * The Workspaces of a Project as the window reads them: what they are, how one is planned, what
 * Git says of each repository, the steps that prepare one, the Project's recipe and the variables
 * (design D8-01 to D8-06, D8-15).
 *
 * The use cases that carry them are declared with every other one, in `engine.ts`; what is here
 * is what they answer with, declared once and reused by every use case that answers it.
 */

import { z } from 'zod'

/** Where a Workspace stands (D8-01): `main` is `ready` from its creation. */
export const workspaceStateSchema = z.enum(['preparing', 'ready', 'failed', 'cleaned'])

export type WorkspaceState = z.infer<typeof workspaceStateSchema>

/** A worktree of a dedicated Workspace as it was created: what it was made on (D8-01). */
export const worktreeSchema = z.object({
  relativePath: z.string(),
  branch: z.string(),
  /** The commit the branch was created from, resolved when the Workspace was created. */
  base: z.string(),
})

export type Worktree = z.infer<typeof worktreeSchema>

/**
 * One Workspace of a Project (D8-01, D8-02).
 *
 * `specId` is the Spec it was made for, null for `main` and for one made on a folder. `dedicated`
 * is true for one Hemera assembled — it has worktrees or steps — and false for `main` and a
 * folder the user picked, which Hemera never cleans up (D8-14). `live` is true while a
 * preparation of it runs in the engine: a `preparing` Workspace that is not live was
 * interrupted, and waits for a resume (D8-05). The dates are ISO strings.
 */
export const workspaceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  path: z.string(),
  specId: z.string().nullable(),
  state: workspaceStateSchema,
  main: z.boolean(),
  dedicated: z.boolean(),
  live: z.boolean(),
  createdAt: z.string(),
  cleanedAt: z.string().nullable(),
  repositories: z.readonly(z.array(worktreeSchema)),
})

export type Workspace = z.infer<typeof workspaceSchema>

/**
 * What a dedicated Workspace would be made of, proposed and editable before anything is written
 * (D8-04): per repository of the Project, whether `main` holds one there, the local branches that
 * repository has and the base chosen from them, then the branch that would be created.
 * A location Git would not read carries its refusal in `reason`, and nothing else.
 * `gitAvailable` false is a plan with nothing to start from, whose creation is refused by name.
 */
export const workspacePlanSchema = z.object({
  name: z.string(),
  root: z.string(),
  path: z.string(),
  branchPrefix: z.string(),
  repositories: z.readonly(
    z.array(
      z.object({
        relativePath: z.string(),
        holdsRepository: z.boolean(),
        branches: z.readonly(z.array(z.string())),
        base: z.string().nullable(),
        detachedCommit: z.string().nullable(),
        branch: z.string(),
        included: z.boolean(),
        reason: z.string().nullable(),
      }),
    ),
  ),
  gitAvailable: z.boolean(),
})

export type WorkspacePlan = z.infer<typeof workspacePlanSchema>

/**
 * One repository of a Workspace as Git answers for it now, never stored (D8-15): its branch, its
 * commit and its counts of changes, or Git's own words when it refused.
 */
export const repositoryStateSchema = z.object({
  relativePath: z.string(),
  git: z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      branch: z.string(),
      commit: z.string(),
      staged: z.number(),
      unstaged: z.number(),
      untracked: z.number(),
    }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
})

export type RepositoryState = z.infer<typeof repositoryStateSchema>

/** What a recipe step does (D8-05). */
export const recipeKindSchema = z.enum(['copy', 'link', 'run'])

/**
 * One step of a Workspace's preparation (D8-05): a worktree, then the recipe's copies, links and
 * runs, in order. `target` is the worktree's path, a copy's or a link's path under its `base` — a
 * repository, null for the root — the name of the command a run starts, or the line a run of a
 * line of its own runs on this system, whose `path` is the folder it starts in (recette 2).
 * `message` is what refused it, in the words of whatever did, or what a `copy` kept; `runId` the
 * run a `run` step started.
 */
export const workspaceStepSchema = z.object({
  id: z.string(),
  position: z.number(),
  kind: z.enum(['worktree', 'copy', 'link', 'run']),
  target: z.string(),
  base: z.string().nullable(),
  path: z.string().nullable(),
  commandId: z.string().nullable(),
  state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  message: z.string().nullable(),
  runId: z.string().nullable(),
})

export type WorkspaceStep = z.infer<typeof workspaceStepSchema>

/**
 * One step of a Project's recipe (D8-05 as amended by recette 1 and by recette 2): `base` one of
 * the Project's repositories as it declares it, null for the Workspace root; `path` a file or a
 * folder relative to that base for a copy and a link, the folder a run of a line of its own starts
 * in for such a run, null otherwise; `commandId` the catalogue command a run starts, null for a
 * copy, a link and a run of a line of its own. `line`, `lineWindows` and `lineLinux` are that
 * run's own lines, written the way a command's are (D8-07): one line for every system, or one per
 * system with null where it has none. `rank` is its order.
 */
export const recipeStepSchema = z.object({
  id: z.string(),
  kind: recipeKindSchema,
  base: z.string().nullable(),
  path: z.string().nullable(),
  commandId: z.string().nullable(),
  line: z.string().nullable(),
  lineWindows: z.string().nullable(),
  lineLinux: z.string().nullable(),
  rank: z.string(),
})

export type RecipeStep = z.infer<typeof recipeStepSchema>

/** One variable (D8-06): the Project's when `workspaceId` is null, that Workspace's otherwise. */
export const variableSchema = z.object({
  key: z.string(),
  value: z.string(),
  workspaceId: z.string().nullable(),
})

export type Variable = z.infer<typeof variableSchema>
