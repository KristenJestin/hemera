# AGENTS.md — Hemera

Instructions for any coding agent working in this repository. `CLAUDE.md` is a symbolic link
to this file: there is one contract, not two that drift apart.

Hemera is a desktop application for driving coding agents: Electron 44 with its Chromium, Node
in the main process, React served by Vite in the renderer. 1.0 is being rebuilt from this
repository's first commit, which holds the tooling and an empty window; the previous code is
archived in `KristenJestin/hemera-legacy`. The issue you implement says what is wanted, where,
and how to verify it: read it before touching code, and name every test suite after the
scenario it covers.

Everything in this repository is in English: documents, code, comments, commits, issues,
pull requests and the interface.

## 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what is confusing, ask.
- If the code and the issue disagree, the issue wins; if the issue is wrong, say so instead of
  quietly deviating.

## 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what the task asks. No abstractions for single-use code.
- No configurability, flexibility or "future-proofing" that was not requested.
- No error handling for impossible scenarios. If 200 lines could be 50, rewrite.

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments or formatting. Don't refactor what isn't broken.
- Match existing style. If you notice unrelated dead code, mention it, don't delete it.
- Every changed line must trace directly to the task.

## 4. The failing test first

**Define success criteria. Loop until verified.**

- Write the test (or the story) that fails first, see it fail, then make it pass.
- "Fix the bug" → a test that reproduces it, then the fix. "Refactor X" → tests pass before
  and after.
- Every scenario of the issue gets a test named after it. A scenario without a test is a
  defect, not a TODO.

## Repository layout

```
apps/desktop      @hemera/desktop  Electron application: main process (ESM), preload
                                   (CommonJS, sandboxed), renderer (React 19 served by Vite).
packages/core     @hemera/core     The schemas shared by the processes and their conventions
                                   (Effect Schema): `@hemera/core/schema`.
packages/ipc      @hemera/ipc      The links between the processes: Effect RPC over MessagePorts
                                   and one RPC group per domain. No Electron, no React.
tools/            —                commit-message, branch-guard, install-hooks, window-options,
                                   boundaries, package-desktop, release-tag, aur-publish, and the
                                   vendored lint rules. TypeScript run by Node, tested by Vitest.
packaging/aur     —                the AUR packages hemera-bin and hemera-beta-bin, updated by
                                   tools/aur-publish.ts on each release and beta.
```

`packages/*` is part of the pnpm workspace. Import another package only
through its `exports`; never reach into another package's `src`. "Workspace" means a pnpm
workspace here; say so when a product concept shares the word.

## Commands

```
pnpm install --frozen-lockfile   # once, at the root; no per-package lockfiles
pnpm dev                         # the desktop application, main + preload + renderer
pnpm typecheck                   # tsc per package, through Vite+ task running
pnpm lint                        # oxlint, then the window options check
pnpm fmt                         # oxfmt (fmt:check in CI)
pnpm test                        # vitest (in a terminal: `pnpm exec vp test run`, no watching)
pnpm build                       # the bundles of the application
pnpm package                     # portable package of this target, channel dev
pnpm package --channel beta      # refused outside CI: prod and beta are the pipeline's to build
pnpm check                       # typecheck, lint, fmt:check and test, in that order

pnpm --filter @hemera/desktop e2e:headless   # the built application, driven by wdio, no window on screen
```

The end-to-end suite runs only headless, one run at a time on a machine, after `pnpm build`.
On Linux it starts its own headless weston (`DISPLAY` unset, `WAYLAND_DISPLAY` set to its
socket) and never opens a window on the desktop. `N passed, M total` from wdio counts spec
files × capabilities.

Configuration lives in one place: `vite.config.ts` at the root holds the `lint`, `fmt` and
`test` blocks. Three rule sets run on oxlint beside the built-in ones:

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

Vendored rules are resynced by copying upstream files over; never edit them in place.

Never run a real LLM provider from a test. Tests write to a temporary folder, never to a real
profile.

## Effect

- Effect 4 stable in the engine: Schema for every value that crosses a boundary, RPC between
  the processes.
- For Effect code, read `node_modules/effect/AGENTS.md` and its `ai-docs/` first.
- Effect is pinned exactly; an upgrade is its own pull request.
- No zod: the lint refuses its import. Effect `Schema` replaces it everywhere.
- No Effect inside React components: the renderer uses schemas and the generated RPC clients
  only. Schema types, decoders and the form helper (`toFormSchema`) are allowed in the
  interface; no `Effect`, `Layer`, `Stream` or fiber in a component or a hook.
- The conventions of `@hemera/core/schema`, each proven by a test: a value crosses a process
  link through `Schema.toCodecJson` (bytes as base64, dates as ISO strings); an MCP tool takes
  its input schema from `toToolInputSchema` only; a parse error reaches a person only through
  `formatSchemaError` or `toFormSchema`, never as Schema's raw message.

## Git rules (non-negotiable)

- Git flow without release branches: `main` (installed versions), `dev` (integration),
  `feature/<topic>` from `dev`, `hotfix/<topic>` from `main`.
- **Never commit, merge, rebase, push or force-push on `main` or `dev`.** If you are on one
  of these branches, create a feature branch first. `node tools/install-hooks.ts` installs the
  hooks that refuse it.
- Never rewrite history that is not yours. No `--no-verify`.
- One commit = one intent. No `wip` commits. Don't mix formatting and logic in one commit.
- Every commit is authored and committed as `kris <kristen.jestin@pm.me>`. A tool that writes
  commits under a name of its own invention is a tool to fix, not an identity to keep.
- The subject is `<type>(<scope>): <subject>`: the **scope is required**, the subject is 72
  characters at most, and the type is one of feat, fix, refactor, test, docs, chore, build, ci,
  perf. `node tools/commit-message.ts --range origin/dev..HEAD` is the judge; run it before a
  push, the `commit-messages` check runs the same tool.
- **Pull requests are merged by squash, and by squash only.** The squash commit takes the pull
  request's title, so the title is a plain Angular subject with nothing in front of it:
  semantic-release reads those subjects to decide the version. The description ends with
  `Closes #<n>`.

### Commit messages: Angular convention

```
<type>(<scope>): <subject>

<body: why, not what — optional>

BREAKING CHANGE: <description — only if a schema or an internal API changes>
```

- `scope`: `desktop`, `repo`, `tools`, `ci`, or the name of a package or a domain.
- `subject`: imperative, lowercase, no trailing period, ≤ 72 chars, in English.
- Examples: `feat(desktop): open the window on the system theme`,
  `fix(tools): read the channel flag written either way round`.

## The window and the process model

- **Main process**: ESM, minimal. It takes the single-instance lock and creates the window.
  Anything that must precede `ready` is awaited at the top level of the entry point. Nothing
  blocking, no heavy `require` at module level.
- **Preload**: CommonJS — a sandboxed preload does not support ESM. A few dozen lines that
  expose a narrow API through `contextBridge`, never raw `ipcRenderer`.
- **Renderer**: React 19 served by Vite, sandboxed and isolated, no access to Node.
  `navigator.clipboard` only.
- The window is frameless with Window Controls Overlay, shown immediately on the background
  colour of the system's theme. The renderer marks its drag zone; the controls stay `no-drag`.
- **Refused, and checked by `node tools/window-options.ts`**: any `webPreferences` option
  outside `sandbox`, `contextIsolation`, `nodeIntegration: false`, `backgroundThrottling`,
  `spellcheck` and `preload` — in particular `additionalArguments`, `enableBlinkFeatures`,
  `disableBlinkFeatures`, `experimentalFeatures`, `offscreen` and any non-default partition.
  No `commandLine.appendSwitch`, no ozone flag, no `--no-sandbox`, `--single-process`,
  `--in-process-gpu` or `--disable-gpu`.
- Wayland has no `win.setPosition()` and no `screen.getCursorScreenPoint()` by design of the
  protocol. They are not used.

Every version is pinned exactly: Electron, pnpm, Vite+, and whatever a change adds. Nothing is
downloaded or installed while the application runs.

## UI rules

- Every visual value comes from the design system's CSS tokens. **No hex colors, no px sizes,
  no inline styles outside the token files.** Until the design system is back, the empty shell
  wears the system colours (`Canvas`, `CanvasText`).
- Motion lives in one file of the design system as a short, closed set of named kinds; no
  component writes its own spring, duration, curve or keyframe. Every movement answers the
  reduced-motion preference with its end state.
- Keyboard: declared tab order per page, visible focus ring, focus restored after overlays.
- A component is designed in Storybook first, one story per state, named after the state
  (`Empty`, `Loading`, `Error`, `Filled`), in both themes, before it is wired.

## When done

Run `pnpm check`, `pnpm build` and, when the window changed, the headless end-to-end suite,
and report the real output. If something fails, say so; don't claim green.
