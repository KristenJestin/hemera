# AGENTS.md — Hemera product repository

Instructions for any coding agent working in this repository. `CLAUDE.md` is a symbolic link
to this file: there is one contract, not two that drift apart.

Hemera (code name of Nyx v3) is a desktop cockpit for ACP agents: Electron 44 with its
Chromium, Node in the main process, React served by Vite in the renderer, SQLite through
`node:sqlite` + Drizzle in a named `utilityProcess`. GPUiX and Bun were abandoned on
15 September 2026. This repository is the product monorepo. Product rules, OpenSpec changes
and spike reports live in the parent documentation folder (`../../docs`, `../../openspec`);
read the current lot's `proposal.md`, `specs/`, `design.md` and `tasks.md` before touching
code.

Behavioral guidelines below are adapted from the Karpathy-style CLAUDE.md. They bias toward
caution over speed; for trivial tasks, use judgment.

## 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what is confusing, ask.
- A product rule lives in `docs/product/core.md` and the lot's specs. If code and spec
  disagree, the spec wins; if the spec is wrong, say so instead of quietly deviating.

## 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what the task asks. No abstractions for single-use code.
- No configurability, flexibility or "future-proofing" that was not requested.
- No error handling for impossible scenarios. If 200 lines could be 50, rewrite.
- Ask: "would a senior engineer call this overcomplicated?" If yes, simplify.

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments or formatting. Don't refactor what isn't broken.
- Match existing style. If you notice unrelated dead code, mention it, don't delete it.
- Remove imports/variables/functions that *your* change made unused, nothing else.
- Every changed line must trace directly to the task.

## 4. Goal-driven execution

**Define success criteria. Loop until verified.**

- "Add validation" → write tests for invalid inputs, then make them pass.
- "Fix the bug" → write a test that reproduces it, then make it pass.
- "Refactor X" → tests pass before and after.
- For multi-step work, state a short plan `step → verify` and follow it.
- Every spec scenario you implement gets a test named after it. A scenario without a test
  is a defect, not a TODO.

## Repository layout

```
apps/desktop      @hemera/desktop  Electron application: main process (ESM), preload
                                   (CommonJS, sandboxed), renderer (React 19 served by Vite).
packages/core     @hemera/core     pure TypeScript: domain, use cases, ports. No Electron,
                                   no React, no SQLite, no fs/process APIs.
packages/ipc      @hemera/ipc      the shared channel declaration: one name per channel, its
                                   Zod argument schema and its response type. Names and
                                   schemas only, no implementation and no Electron.
legacy/           —                the parked GPUiX era: the former apps/desktop,
                                   packages/ui, packages/runtime and the tools that were not
                                   ported. Read-only, outside the workspace, never imported.
                                   Lots 1 and 3 will mine it, then it goes.
tools/            —                boundaries, commit-message, git-flow, traceability,
                                   environment-report, package-desktop. TypeScript run by
                                   Node, tested by Vitest.
```

Dependency direction is `desktop → core` and `desktop → ipc`. `core` imports nothing of
Hemera, `ipc` imports nothing of Hemera: both are leaves the application composes. Import
other packages only through their `exports`; never reach into another package's `src`. Nothing
in the workspace imports `legacy/`. `node tools/boundaries.ts` enforces all of it and runs
inside `pnpm lint`.

"Workspace" means two things: a pnpm workspace (a package here) and a product Workspace
(a user's working environment). Don't confuse them in code or comments.

## Commands

```
pnpm install --frozen-lockfile   # once, at the root; no per-package lockfiles
pnpm dev                         # the desktop application, main + preload + renderer
pnpm typecheck                   # tsc per package, through Vite+ task running
pnpm lint                        # oxlint + the package boundaries
pnpm fmt                         # oxfmt (fmt:check in CI)
pnpm test                        # vitest
pnpm build                       # the three bundles of the application
pnpm report                      # environment report of this target (D0-07)
pnpm package                     # portable package of this target
pnpm check                       # typecheck, lint, fmt:check and test, in that order
```

Configuration lives in one place: `vite.config.ts` at the root holds the `lint`, `fmt` and
`test` blocks. `legacy/` is excluded there and absent from `pnpm-workspace.yaml`, so nothing
compiles, lints, formats or tests it.

Root `test` never runs migrations on a real user profile; tests use a temporary profile.
Never run a real LLM provider from a test.

## Git rules (non-negotiable)

- Git flow without release branches: `main` (installed versions), `dev` (integration),
  `feature/<topic>` from `dev`, `hotfix/<topic>` from `main`.
- **You may commit freely and cleanly on `feature/*` and `hotfix/*` branches.**
- **Never commit, merge, rebase, push or force-push on `main` or `dev`.** If you are on one
  of these branches, create a feature branch first.
- Never rewrite history that is not yours. No `--no-verify`.
- One commit = one intent. No `wip` commits. Don't mix formatting and logic in one commit.
- Every commit carries the machine's own Git identity. A tool that writes commits under a
  name of its own invention is a tool to fix, not an identity to keep.

### Commit messages: Angular convention

```
<type>(<scope>): <subject>

<body: why, not what — optional>

BREAKING CHANGE: <description — only if schema or internal API changes>
```

- `type`: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`, `perf`.
- `scope`: `core`, `ipc`, `desktop`, `repo`, `db`, or a domain name (`sessions`, `projects`,
  `journal`).
- `subject`: imperative, lowercase, no trailing period, ≤ 72 chars, in English.
- Examples: `feat(ipc): declare the environment report channel`,
  `fix(desktop): restore focus after closing the project selector`,
  `test(core): cover rank rebalancing with random insertions`.

## The window and the process model

- **Main process**: ESM, minimal. It creates the window, registers the IPC channels and
  produces the environment report. Everything that must precede `ready` is awaited at the top
  level of the entry point: an ESM module loads asynchronously and a dynamic `import()`
  arrives too late. Nothing blocking, no heavy `require` at module level.
- **Preload**: CommonJS — a sandboxed preload does not support ESM. A few dozen lines that
  expose a narrow API through `contextBridge`, never raw `ipcRenderer`.
- **Renderer**: React 19 served by Vite, sandboxed and isolated, no access to Node. The
  `clipboard` module is gone from the renderer since Electron 44: `navigator.clipboard` only.
- The window is frameless with Window Controls Overlay, shown immediately on the application
  background colour, with `windowStatePersistence`. The renderer reads `env(titlebar-area-*)`
  and marks its drag zone; the controls stay `no-drag`.
- **Refused, and checked by a test**: any `webPreferences` option outside
  `sandbox`, `contextIsolation`, `nodeIntegration: false`, `backgroundThrottling`,
  `spellcheck` and `preload` — in particular `additionalArguments`, `enableBlinkFeatures`,
  `disableBlinkFeatures`, `experimentalFeatures`, `offscreen` and any non-default partition,
  each of which loses the warmed-up renderer. No `commandLine.appendSwitch`, no ozone flag,
  no `--no-sandbox`, `--single-process`, `--in-process-gpu` or `--disable-gpu`.
- Wayland has no `win.setPosition()` and no `screen.getCursorScreenPoint()` by design of the
  protocol. They are not used.

Every version is pinned exactly: Electron, pnpm, Vite+, and whatever a lot adds. Nothing is
downloaded or installed while the application runs.

## Data and migrations

- Profile lives per OS (`LOCALAPPDATA` / `XDG_DATA_HOME`), never in `/tmp`, never inside
  a product Workspace. `prod` and `dev` channels use separate profiles.
- One versioned, forward-only SQL migration per lot that changes the schema, imported
  statically (no on-disk migration folder in compiled binaries), applied one transaction each
  with its tracking row, after a consistent backup of an existing profile.
- Business state and its `domain_events` row are written in the same transaction. No agent,
  Git, shell or network call inside a transaction.
- Queries go through Drizzle, built from `storage/schema.ts`. Raw SQL is for what a schema
  cannot express: pragmas, the migration statements, the backup checkpoint.
- A start diagnostic goes through `openDiagnosticLog`, never to the console alone: a package
  started from a desktop icon has no console to print to.

The database arrives in lot 3, in a named `utilityProcess` created after `app.whenReady()`.
Until then nothing in this repository opens one.

## UI rules

- Motion is the application's signature: `motion` with the "Calme" personality, soft springs
  (`stiffness 170, damping 26`), no bounce, under `MotionConfig reducedMotion="user"`.
  **Only `transform`, `opacity`, `filter` and `clip-path` are animated.** A lint check refuses
  an animation that targets a layout property or a colour.
- Every visual value comes from the design system's CSS tokens. **No hex colors, no px sizes,
  no inline styles outside the token files.**
- The HTML prototype in `docs/prototypes/` and `spikes/proto-motion/` are **token and motion
  references only**. Never copy their markup, classes or inline styles. Copying them is a
  rejected change.
- Keyboard: declared tab order per page, visible focus ring, focus restored after overlays.

The design system itself — tokens, Base UI, Tailwind 4, Storybook, the component catalogue —
is lot 1. Lot 0 ships an empty window and one witness panel.

## When done

Run `pnpm check` and report the real output. If something fails, say so; don't claim green.
