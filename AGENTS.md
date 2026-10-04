# AGENTS.md — Hemera

Instructions for any coding agent working in this repository. `CLAUDE.md` is a symbolic link
to this file: there is one contract, not two that drift apart. This file holds what applies
everywhere; a package with rules of its own has its own `AGENTS.md`, read **in addition** to
this one:

- `apps/desktop/AGENTS.md`: the Electron process model, the window, the engine, the end-to-end
  suite;
- `packages/ui/AGENTS.md`: the design system, Storybook, tokens, motion, and the interface
  conventions of 1.0 (which the renderer follows too);
- `packages/core/AGENTS.md`: Effect and Schema, wherever Effect is written.

## Project overview

Hemera is a desktop application for driving coding agents: Electron 44 with its Chromium, Node
in the main process, React served by Vite in the renderer. 1.0 is being rebuilt from this
repository's first commit, which holds the tooling and an empty window; the previous code is
archived in `KristenJestin/hemera-legacy`. The issue you implement says what is wanted, where,
and how to verify it: read it before touching code, and name every test suite after the
scenario it covers.

Everything in this repository is in English: documents, code, comments, commits, issues,
pull requests and the interface.

```
apps/desktop      @hemera/desktop  Electron application: main process (ESM), preload
                                   (CommonJS, sandboxed), renderer (React 19 served by Vite).
packages/core     @hemera/core     The schemas shared by the processes and their conventions
                                   (Effect Schema): `@hemera/core/schema`.
packages/ipc      @hemera/ipc      The links between the processes: Effect RPC over MessagePorts
                                   and one RPC group per domain. No Electron, no React.
packages/ui       @hemera/ui       The design system: the theme, the motion kinds, the icons and
                                   the components, each with its stories. React, never Electron.
tools/            —                commit-message, branch-guard, install-hooks, window-options,
                                   boundaries, motion-presets, scales, text-measure,
                                   package-desktop, release-tag, aur-publish, and the vendored
                                   lint rules. TypeScript run by Node, tested by Vitest.
packaging/aur     —                the AUR packages hemera-bin and hemera-beta-bin, updated by
                                   tools/aur-publish.ts on each release and beta.
```

`packages/*` is part of the pnpm workspace. Import another package only through its `exports`;
never reach into another package's `src`. "Workspace" means a pnpm workspace here; say so when a
product concept shares the word.

Every version is pinned exactly: Electron, pnpm, Vite+, Effect, and whatever a change adds.
Nothing is downloaded or installed while the application runs.

## Commands

```
pnpm install --frozen-lockfile   # once, at the root; no per-package lockfiles
pnpm dev                         # the desktop application, main + preload + renderer
pnpm typecheck                   # tsc per package, through Vite+ task running
pnpm lint                        # oxlint, then the window options, boundaries, motion, scale
                                 # and text-measure checks
pnpm fmt                         # oxfmt (fmt:check in CI)
pnpm run doctor                  # React Doctor on packages/ui and the renderer; fails on an
                                 # error-level finding (`run`: `pnpm doctor` is pnpm's own)
pnpm test                        # vitest (in a terminal: `pnpm exec vp test run`, no watching)
pnpm build                       # the bundles of the application
pnpm package                     # portable package of this target, channel dev
pnpm package --channel beta      # refused outside CI: prod and beta are the pipeline's to build
pnpm check                       # typecheck, lint, fmt:check and test, in that order
pnpm storybook                   # the catalogue of the design system, on port 6006

pnpm --filter @hemera/desktop e2e:headless   # the built application, driven by wdio, no window on screen
```

Configuration lives in one place: `vite.config.ts` at the root holds the `lint`, `fmt` and
`test` blocks.

## Principles

### 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what is confusing, ask.
- If the code and the issue disagree, the issue wins; if the issue is wrong, say so instead of
  quietly deviating.

### 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what the task asks. No abstractions for single-use code.
- No configurability, flexibility or "future-proofing" that was not requested.
- No error handling for impossible scenarios. If 200 lines could be 50, rewrite.

### 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments or formatting. Don't refactor what isn't broken.
- Match existing style. If you notice unrelated dead code, mention it, don't delete it.
- Every changed line must trace directly to the task.

### 4. The failing test first

**Define success criteria. Loop until verified.**

- Write the test (or the story) that fails first, see it fail, then make it pass.
- "Fix the bug" → a test that reproduces it, then the fix. "Refactor X" → tests pass before
  and after.
- Every scenario of the issue gets a test named after it. A scenario without a test is a
  defect, not a TODO.

## Code style

Three rule sets run on oxlint beside the built-in ones:

- `@shadcn/lint`, the design-system contract: no raw colour, no arbitrary Tailwind value, no
  inline style, no class built at run time, no restyling of a component through `className`.
- `anti-slop`, vendored under `tools/oxlint/anti-slop/` (MIT, from dmmulroy/anti-slop): no
  chained `as`, no `as` without a `// SAFETY:` line stating the checked invariant, no `unknown`
  or `object` on a parameter, a return or an alias, no `Record<string, unknown|any|object>`, no
  `typeof` narrowing where a parser belongs, no `vi.mock` (inject a port instead), no
  accumulator copy in a reducer, no conditional `{}` spread, no explicit type that discards what
  inference already knew.
- `anti-slop-effect`, vendored under `tools/oxlint/anti-slop-effect/`: an error carries its tag
  from the class that declares it, a tag is matched and never compared by hand, a service is
  reached through its own accessor, a branch on a tagged value goes through `Effect.match`.

Vendored rules are resynced by copying upstream files over; never edit them in place. No zod
anywhere: Effect `Schema` replaces it (see `packages/core/AGENTS.md`).

## Testing

- `pnpm test` runs three projects: `repository` on Node, and `storybook-light` and
  `storybook-dark`, every story of the design system played in a headless Chromium once per
  theme (`vp test run --project storybook-light`). The Chromium is Playwright's:
  `pnpm --filter @hemera/ui exec playwright install chromium` once per machine.
- Always `vp test run`: plain `vp test` starts watch mode and never ends.
- Never run a real LLM provider from a test. Tests write to a temporary folder, never to a real
  profile.
- A test that fails only under load is rerun alone before the failure is called real; if it
  fails alone, it is real.
- The end-to-end suite runs only headless, one run at a time on a machine, after `pnpm build`;
  its details are in `apps/desktop/AGENTS.md`.

## How the work is organised

| Who | What |
|---|---|
| The maintainer | decides what is built, validates the designs at each tranche's UI gate and the app at the end of each tranche, and merges what they have not delegated |
| The lead agent | turns the maintainer's feedback into issues, launches sub-agents, reviews their pull requests and merges them into the integration branch, keeps the tracker honest, and never hides a failure |
| Sub-agents | implement one issue each: the failing test or story first, then the code, the verification and a pull request; they never merge |
| CI | `verify` on Linux and Windows, `commit-messages` and `shape` on every pull request; releases from `dev` and `main` (semantic-release) |

Sub-agents run on a model of the same level as the lead agent or below; the lead may use a
lighter model for simple tasks.

### The tracker

- **Issues are the tickets, and a ticket stands alone.** A sub-agent reads only its ticket, so
  the ticket holds the what, the where, the "how to verify" and the base branch, with no local
  path. If it lacks one of them, ask rather than guess.
- One milestone, `1.0.0`. The plan is cut into **tranches**, labels `tranche:0`, `tranche:1`…,
  beside `type:*`, `area:*` and `platform:*`. A tranche ends on something usable, and the
  maintainer accepts it in the app, on Linux and then on Windows.
- **`feature/1.0` is the integration branch** until it returns to `dev`: a 1.0 branch starts from
  `origin/feature/1.0` and its pull request targets it. GitHub closes an issue on its own only
  for a merge into the default branch, so an issue merged into `feature/1.0` is closed by hand,
  with a comment naming the pull request.
- **UI gates**: a tranche's screens are designed in Storybook and validated by the maintainer
  before the ticket that builds them is launched.

### The loop

1. Launch one sub-agent per ticket whose dependencies are merged; two or three at a time, in
   parallel only when their files do not overlap.
2. Read the pull request when it reports: the scope, the body, the decisions taken on the way,
   what was not verified.
3. Merge it (squash) once CI is green, when the change needs no check in the app and no design
   choice and the maintainer has delegated that merge; otherwise ask first. Then close the issue
   and remove the worktree, after checking it holds no uncommitted or unpushed work.
4. Tell the maintainer in a few lines: what landed, what was decided, what is not verified,
   what waits for them.

Follow-ups on a pull request go to the sub-agent that wrote it, resumed with its context, rather
than to a new one. A sub-agent the maintainer stopped is not resumed without their word.

### The brief of a sub-agent

- The ticket, read in full with its comments (`gh issue view <n>`), and this file.
- Setup: fetch, then a worktree outside the clone on a new branch from `origin/feature/1.0`;
  absolute paths only.
- Who else works in parallel, and on which files.
- The rules of this file, in particular: the failing test or story first, nothing private in the
  pull request, the end-to-end suite under the lock, never a real profile, never a merge, nothing
  published outside the pull request (no gist, no upload).
- Verify: `pnpm typecheck`, `pnpm lint`, `pnpm fmt:check`, `pnpm build`,
  `npx vp test run --project repository`, and the Storybook projects when the interface is
  touched.
- Deliver: a pull request into `feature/1.0` titled as the issue, ending with `Closes #<n>`, CI
  green on Linux and Windows, and a short report (pull request, CI, decisions, what was not
  verified).

### Porting from `hemera-legacy`

Old code is read from `KristenJestin/hemera-legacy` at the commit the ticket pins, never at its
moving head. It is rewritten against the ticket, not copied: port nothing the ticket does not
list, and say in the pull request what changed against the old code, and why.

### Design work

- Each tranche's screens are designed as whole screens and component states in Storybook (the
  design tickets) and reviewed there by the maintainer, not as a list of parts.
- Give real opinions: recommend one option and say why. When a request is unclear, ask a short
  question rather than build the wrong thing.

### Reviews

- An external review of the plan is sorted point by point: already settled, an engineering
  contract to decide by default, or a product decision for the maintainer, put to them with a
  recommendation. The result goes into the tickets.
- Before a tranche closes, its tickets are checked against the design and its acceptance.

## Git and pull requests (non-negotiable)

- Git flow without release branches: `main` (installed versions), `dev` (integration),
  `feature/<topic>` from `dev`, `hotfix/<topic>` from `main`; during 1.0, `feature/1.0` is the
  integration branch (see the tracker).
- **Never commit, merge, rebase, push or force-push on `main`, `dev` or `feature/1.0`
  directly.** If you are on one of these branches, create a branch first.
  `node tools/install-hooks.ts` installs the hooks that refuse it for `main` and `dev`.
- Never rewrite published history. No `--no-verify`.
- One commit = one intent. No `wip` commits. Don't mix formatting and logic in one commit.
- Commits use the Git user configured on the machine. A tool that writes commits under a name
  of its own invention is a tool to fix, not an identity to keep.
- The subject is `<type>(<scope>): <subject>`: the **scope is required**, the subject is 72
  characters at most, and the type is one of feat, fix, refactor, test, docs, chore, build, ci,
  perf. `node tools/commit-message.ts --range origin/dev..HEAD` (`origin/feature/1.0..HEAD` for
  a 1.0 branch) is the judge; run it before a push, the `commit-messages` check runs the same
  tool.
- **Pull requests are merged by squash, and by squash only.** The squash commit takes the pull
  request's title, so the title is a plain Angular subject with nothing in front of it:
  semantic-release reads those subjects to decide the version. The description is written in the
  first person as the maintainer and ends with `Closes #<n>`.

```
<type>(<scope>): <subject>

<body: why, not what — optional>

BREAKING CHANGE: <description — only if a schema or an internal API changes>
```

- `scope`: `desktop`, `repo`, `tools`, `ci`, or the name of a package or a domain.
- `subject`: imperative, lowercase, no trailing period, ≤ 72 chars, in English.
- Examples: `feat(desktop): open the window on the system theme`,
  `fix(tools): read the channel flag written either way round`.

## Security and privacy

- This repository is public. Nothing private goes into it, nor into an issue, a pull request, a
  commit or a story: no personal work case, no private infrastructure, no personal tool, no real
  person or domain. Stories and tests use neutral data.
- Secrets are read at the moment they are needed and never printed, logged or committed.
- Nothing is published outside the pull request: no gist, no upload, no paste service.
- Never touch a real profile or a real repository of the person running you; tests and runs use
  temporary folders.
- **A permission denial is never worked around**: do what remains, say what was refused, and
  leave that action to the maintainer.
- The window's refused options (`node tools/window-options.ts`) are in `apps/desktop/AGENTS.md`.

## Working on a machine

- Worktrees, logs, screenshots, drafts and every other scratch file live outside the clone, in a
  sibling work folder; never inside the repository.
- Heavy commands (builds, full test runs, the end-to-end suite) run at low priority
  (`nice -n 19` on Linux), one at a time.
- The end-to-end suite takes a lock folder kept outside the repository before it starts and
  releases it after: one run at a time on a machine.
- Before removing a worktree, check it holds no uncommitted change and no unpushed commit
  (`git log HEAD --not --remotes`).
- Do not `pkill -f <pattern>` from a shell whose own command line contains the pattern: it kills
  the calling shell. Match processes from a script file instead.

## GitHub gotchas

- GitHub's GraphQL API gets rate-limited. Prefer REST: `gh api repos/…`, and for a merge
  `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge -f merge_method=squash`.
- Issues close automatically only when a pull request merges into the default branch. For a
  merge into `feature/1.0`, close the issue by hand with a comment.
- A body holding backticks or apostrophes is written to a file and passed with `--body-file`;
  shell heredocs break on them.

## When done

Run `pnpm check`, `pnpm run doctor`, `pnpm build` and, when the window changed, the headless
end-to-end suite, and report the real output. If something fails, say so; don't claim green.
