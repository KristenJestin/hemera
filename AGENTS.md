# AGENTS.md — Hemera product repository

Instructions for any coding agent working in this repository. `CLAUDE.md` is a symbolic link
to this file: there is one contract, not two that drift apart.

Hemera is a desktop cockpit for ACP agents: Electron 44 with its
Chromium, Node in the main process, React served by Vite in the renderer, SQLite through
`node:sqlite` + Drizzle in a named `utilityProcess`. GPUiX and Bun were abandoned on
15 September 2026. This repository holds the code and its documentation: the product rules
in `docs/product/`, the dated decisions in `docs/decisions/`, the research in `docs/technical/`,
and the way work is done in `docs/METHOD.md`. The issue you implement carries its Proposal,
Design and Spec sections and its checklists; read them, and `docs/METHOD.md`, before touching
code, and name every test suite after the scenario it covers.

Everything in this repository is in English: documents, code, comments, commits, issues,
pull requests and the interface.

Behavioral guidelines below are adapted from the Karpathy-style CLAUDE.md. They bias toward
caution over speed; for trivial tasks, use judgment.

## 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what is confusing, ask.
- A product rule lives in `docs/product/core.md` and the issue's Spec section. If code and spec
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
packages/ui       @hemera/ui       the design system: the CSS theme, the motion preset, the
                                   icon catalogue and the components. React, Tailwind 4, Base
                                   UI and motion; nothing of Hemera, nothing of Electron.
tools/            —                boundaries, commit-message, git-flow, environment-report,
                                   package-desktop, window-options, motion-properties.
                                   TypeScript run by Node, tested by Vitest.
```

Dependency direction is `desktop → core`, `desktop → ipc` and `desktop → ui`. `core`, `ipc`
and `ui` import nothing of Hemera: they are the leaves the application composes. Tabler comes
through `packages/ui/src/icons.ts` and nowhere else. Import other packages only through their
`exports`; never reach into another package's `src`.
`node tools/boundaries.ts` enforces all of it and runs inside `pnpm lint`.

"Workspace" means two things: a pnpm workspace (a package here) and a product Workspace
(a user's working environment). Don't confuse them in code or comments.

## Commands

```
pnpm install --frozen-lockfile   # once, at the root; no per-package lockfiles
pnpm dev                         # the desktop application, main + preload + renderer + engine
pnpm typecheck                   # tsc per package, through Vite+ task running
pnpm lint                        # oxlint + the package boundaries
pnpm fmt                         # oxfmt (fmt:check in CI)
pnpm test                        # vitest
pnpm build                       # the four bundles of the application
pnpm report                      # environment report of this target (D0-07)
pnpm package                     # portable package of this target, channel dev
pnpm package --channel beta      # refused outside CI: prod and beta are the pipeline's to build
pnpm check                       # typecheck, lint, fmt:check and test, in that order

pnpm --filter @hemera/desktop e2e  # the built application, driven by @wdio/electron-service
```

Configuration lives in one place: `vite.config.ts` at the root holds the `lint`, `fmt` and
`test` blocks. Two rule sets run on oxlint beside the built-in ones:

- `@shadcn/lint`, the design-system contract: no raw colour, no arbitrary Tailwind value, no
  inline style, no class built at run time, no restyling of a component through `className`.
- `anti-slop`, vendored under `tools/oxlint/anti-slop/` (MIT, from dmmulroy/anti-slop) at the
  rules kept on purpose: no chained `as`, no `as` without a `// SAFETY:` line stating the
  checked invariant, no `unknown` or `object` on a parameter, a return or an alias, no
  `Record<string, unknown|any|object>`, no `typeof` narrowing where a parser belongs, no
  `vi.mock` (inject a port instead), no accumulator copy in a reducer, no conditional `{}`
  spread, no explicit type that discards what inference already knew. The I/O boundary itself
  (`decide` in the bridge) is the one place `unknown` is allowed, and says so on the line.
  Resync by copying upstream files over; never edit them in place.

`reports/` is generated by `pnpm report` and is not committed.

A `dev` build takes `--data-dir <path>` and opens that folder instead of its own — which is how
a trial run, and the end-to-end suite, stay away from the real data.

Root `test` never runs migrations on a real data folder; tests use a temporary one.
Never run a real LLM provider from a test.

## Git rules (non-negotiable)

- Git flow without release branches: `main` (installed versions), `dev` (integration),
  `feature/<topic>` from `dev`, `hotfix/<topic>` from `main`.
- **You may commit freely and cleanly on `feature/*` and `hotfix/*` branches.**
- **Never commit, merge, rebase, push or force-push on `main` or `dev`.** If you are on one
  of these branches, create a feature branch first.
- Never rewrite history that is not yours. No `--no-verify`.
- One commit = one intent. No `wip` commits. Don't mix formatting and logic in one commit.
- The subject is `<type>(<scope>): <subject>`: the **scope is required**, the subject is 72
  characters at most, and the type is one of feat, fix, refactor, test, docs, chore, build, ci,
  perf. `node tools/commit-message.ts --range origin/dev..HEAD` is the judge; run it before a
  push, the `commit-messages` check runs the same tool.
- **Pull requests are merged by squash, and by squash only.** The squash commit takes the pull
  request's title and description, so the title is a plain Angular subject —
  `feat(desktop): lot 3, the profile and its database` — with nothing in front of it: `main`
  has to read as a history of changes, and semantic-release reads those same subjects to decide
  the version.
- A reference to whatever tracked the work goes in the footer, as `Refs: <key>`, on its own line
  at the end of the message. `commit-message.ts` does not have to change for it: a footer is
  free.
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

- **Main process**: ESM, minimal. It resolves the channel and the data folder before anything
  else, moves `userData` onto that folder, takes the single-instance lock, creates the window,
  registers the IPC channels, starts the engine and produces the environment report. Everything
  that must precede `ready` is awaited at the top
  level of the entry point: an ESM module loads asynchronously and a dynamic `import()`
  arrives too late. Nothing blocking, no heavy `require` at module level.
- **Preload**: CommonJS — a sandboxed preload does not support ESM. A few dozen lines that
  expose a narrow API through `contextBridge`, never raw `ipcRenderer`.
- **Renderer**: React 19 served by Vite, sandboxed and isolated, no access to Node. The
  `clipboard` module is gone from the renderer since Electron 44: `navigator.clipboard` only.
  It asks for its preferences and waits for the answer before mounting the shell, so nothing is
  ever drawn at a default and corrected afterwards. It does not know the fourth process exists.
- **Engine**: the named `utilityProcess` that holds the database, ESM on Node, no window and no
  Electron API beyond the port it is handed. Everything outside the renderer is written in
  Effect: services in layers, resources in a scope, typed errors, one `runPromise` per entry.
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

- The data folder — what the interface calls the Profile — lives per OS (`LOCALAPPDATA` /
  `XDG_DATA_HOME`), never in `/tmp`, never inside a product Workspace. `prod` and `beta` share
  one folder — the beta is the application the user runs every day, on real data — and `dev`
  has its own. The channel is engraved in a package's manifest when it is built and cannot be
  changed at run time.
- A `dev` build, and only a `dev` build, accepts `--data-dir <path>` for a throwaway folder,
  and refuses a path that resolves to the `prod` one. That is how the end-to-end suite and every
  trial run without ever opening the real one.
- Migrations are generated by `drizzle-kit generate` from `storage/schema.ts` and applied by
  the Drizzle migrator, never written by hand: one forward-only, cumulative migration per lot
  that changes the schema, bundled with the application, applied after a consistent backup of
  an existing database and tested from a fixture of the previous version.
- Business state and its `domain_events` row are written in the same transaction. No agent,
  Git, shell or network call inside a transaction.
- Queries go through Drizzle, built from `storage/schema.ts`. Raw SQL is for what a schema
  cannot express: pragmas and the backup checkpoint.
- A start diagnostic goes through `openDiagnosticLog`, never to the console alone: a package
  started from a desktop icon has no console to print to.

The database lives in the named `utilityProcess` created after `app.whenReady()`, and in it
alone: `apps/desktop/src/engine/` is the only folder allowed to import `node:sqlite`, Drizzle
or the Effect SQLite client, and `tools/boundaries.ts` refuses it anywhere else. The main
process asks the engine by name — `preferences.read`, `preferences.write`, `engine.status`,
declared in `packages/ipc/src/engine.ts` — and never opens the file itself.

`data` and `engine` are the names the code uses; `Profile` is the word the interface keeps for
the same folder, in the settings, in the Journal filter and on the `profile` events the engine
writes at start-up.

## UI rules

- Motion is the application's signature, and it lives in `packages/ui/src/motion.ts` as a short,
  closed set: `press` for what answers the hand (hover, press, a width following it — stiff and
  light), `arrival` for what puts itself in place (panels, popups — the prototype's "Calme"
  spring, `stiffness 170, damping 26`, no overshoot), `instant` for a system asking for less
  movement. Components read `useTransition(preset)`, never a preset directly: it answers the
  reduced-motion preference with the end state for every property, where motion's own
  `reducedMotion` would keep animating opacity. The tree runs under
  `MotionConfig reducedMotion="user"` all the same, as the net under any element that forgets
  the hook — and the lint refuses a `motion.*` element that animates without a `transition`
  from it. CSS transitions of the design system stop under `prefers-reduced-motion: reduce`.
  No component writes its own spring numbers or durations; a lint check refuses them outside
  that one file.
  **Only `transform`, `opacity`, `filter` and `clip-path` are animated.** A lint check refuses
  an animation that targets a layout property or a colour.
- Every visual value comes from the design system's CSS tokens. **No hex colors, no px sizes,
  no inline styles outside the token files.**
- The HTML prototype in `docs/prototypes/` and `spikes/proto-motion/` are **token and motion
  references only**. Never copy their markup, classes or inline styles. Copying them is a
  rejected change.
- Keyboard: declared tab order per page, visible focus ring, focus restored after overlays.
- Storybook sidebar, five roots in this order and nothing else: **Foundations** (tokens,
  icons, motion); **Components**, the primitives, flat and alphabetical; **Blocks**, the
  composed pieces that are not a screen, grouped by family and four families at most
  (`Blocks/Message`, `Blocks/Activity`, `Blocks/Composer`, `Blocks/Session`);
  **Surfaces**, one entry per screen (`Surfaces/Session`, `Surfaces/Project/Dialog` when a
  screen has several parts), never one entry per variant; **Shell**, the window frame. The
  order of the roots and the alphabetical order inside are forced by `storySort` in
  `.storybook/preview`. A story file sits next to its component, `<name>.stories.tsx`; one
  story per state, named after the state (`Empty`, `Loading`, `Error`, `Filled`, `Dense`);
  a surface's first story is `Complete`, everything in place, because it is what the UI gate
  looks at. The skill in `.agents/skills/storybook` says how to write a story; this list says
  where it shows and what it is called, and it wins when the two differ.
- Storybook badges: a story file the lot **created** wears the `new` tag, one whose component the
  lot **changed** wears `updated`. The badge belongs to the lot that touches the design system
  and not to the component: the first thing such a lot does is take the previous lot's badges
  off, so what the sidebar shows is always what is being reviewed — and a branch that changes
  nothing of `packages/ui` carries no badge change at all. `pnpm test` refuses a badge the branch
  did not earn, and a tag nothing reads.

The design system itself — tokens, Base UI, Tailwind 4, Storybook, the component catalogue —
is lot 1. Lot 0 ships an empty window and one witness panel.

## When done

Run `pnpm check` and report the real output. If something fails, say so; don't claim green.
