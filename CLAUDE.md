# CLAUDE.md — Hemera product repository

Hemera (code name of Nyx v3) is a native desktop cockpit for ACP agents: one Bun process,
React on GPUiX (no DOM, no Chromium), SQLite via `bun:sqlite` + Drizzle. This repository is
the product monorepo. Product rules, OpenSpec changes and spike reports live in the parent
documentation folder (`../../docs`, `../../openspec`); read the current lot's `proposal.md`,
`specs/`, `design.md` and `tasks.md` before touching code.

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
apps/desktop      @hemera/desktop  GPUiX/React app: pages, routing, i18n resources, platform
                                   glue, entry. Composes @hemera/ui; defines no styles.
packages/ui       @hemera/ui       design system: tokens (primitive → semantic → component),
                                   light/dark themes, fonts, lucide icons, primitives and
                                   components (headless hook + styled component), showcase.
                                   No business logic, no import of core/runtime.
packages/core     @hemera/core     pure TypeScript: domain, use cases, ports. No Bun, no
                                   GPUiX/React, no SQLite, no fs/process APIs.
packages/runtime  @hemera/runtime  Bun implementations of core ports: storage (Drizzle,
                                   bun:sqlite, static migrations), platform (profile path,
                                   instance lock, environment report), later agents/commands/
                                   terminal/integrations.
vendor/gpuix      pinned tarballs of the GPUiX fork + provenance manifest (never edit)
```

Dependency direction is `desktop → runtime → core` and `desktop → ui`. `core` never imports
`runtime`, `runtime` never imports `desktop`, `ui` imports nothing from Hemera. Import other packages only through their `exports`;
never reach into another package's `src`. Boundary tests enforce this.

"Workspace" means two things: a Bun workspace (a package here) and a product Workspace
(a user's working environment). Don't confuse them in code or comments.

## Commands

```
bun install --frozen-lockfile   # once, at the root; no per-package lockfiles
bun run dev                     # desktop in dev channel (separate profile from prod)
bun run typecheck               # turbo, follows package dependencies
bun run lint                    # oxlint
bun run fmt                     # oxfmt (fmt:check in CI)
bun run test                    # business tests without GPU + traceability table
bun run build                   # native builds, no cache
bun run report                  # environment report of this target (D02)
bun run package                 # portable package of this target
```

Root `test` never runs migrations on a real user profile; tests use a temporary profile.
Never run a real LLM provider from a test.

After re-vendoring the fork (`tools/gpuix/pack-vendor.ts`), run `rm bun.lock && bun install`:
the lockfile pins each archive by its path and the install cache keys on that path, so a new
archive written at the same path is served as the old one.

## Git rules (non-negotiable)

- Git flow without release branches: `main` (installed versions), `dev` (integration),
  `feature/<topic>` from `dev`, `hotfix/<topic>` from `main`.
- **You may commit freely and cleanly on `feature/*` and `hotfix/*` branches.**
- **Never commit, merge, rebase, push or force-push on `main` or `dev`.** If you are on one
  of these branches, create a feature branch first.
- Never push. Never rewrite history that is not yours. No `--no-verify`.
- One commit = one intent. No `wip` commits. Don't mix formatting and logic in one commit.

### Commit messages: Angular convention

```
<type>(<scope>): <subject>

<body: why, not what — optional>

BREAKING CHANGE: <description — only if schema or internal API changes>
```

- `type`: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`, `perf`.
- `scope`: `core`, `runtime`, `desktop`, `gpuix`, `db`, or a domain name (`sessions`,
  `projects`, `journal`).
- `subject`: imperative, lowercase, no trailing period, ≤ 72 chars, in English.
- Examples: `feat(runtime): add instance lock with stale-owner recovery`,
  `fix(desktop): restore focus after closing the project selector`,
  `test(core): cover rank rebalancing with random insertions`.

## Data and migrations

- Profile lives per OS (`LOCALAPPDATA` / `XDG_DATA_HOME`), never in `/tmp`, never inside
  a product Workspace. `prod` and `dev` channels use separate profiles.
- One versioned, forward-only SQL migration per lot that changes the schema, imported
  statically (no on-disk migration folder in compiled binaries), applied one transaction each
  with its tracking row, after a consistent backup of an existing profile.
- Business state and its `domain_events` row are written in the same transaction. No agent,
  Git, shell or network call inside a transaction.

## UI rules (design system)

- Every visual value comes from `@hemera/ui` tokens. **No hex colors, no px sizes, no inline
  styles in pages or components outside the token files.** A lint check fails the build.
- Reuse the catalogue (Button, Badge, Card, NavItem, Tab, Composer, Select, DialogPanel…).
  Never write a local one-off component that duplicates a catalogue component. If a variant
  is missing, add it to the catalogue with its showcase and test.
- A new component = folder `packages/ui/src/components/<name>/` with `<name>.tsx`,
  `use-<name>.ts`, `<name>.test.tsx`, `<name>.showcase.tsx`. Not mergeable without the four.
- Both themes (light and dark) must render correctly; the showcase page shows both.
- The HTML prototype in `docs/prototypes/` is a **token reference only**. Never copy its
  markup, classes or inline styles. Copying it is a rejected change.
- Keyboard: declared tab order per page, visible focus ring, focus restored after overlays.

## Renderer gotchas (GPUiX, no DOM)

No `className`/CSS, no HTML `<button>`, no `role`/`aria-*`, no `zIndex`, one scroll level per
panel, `Tab` not handled (manual focus traversal), focus must be restored explicitly after
closing an overlay, `Enter` in inputs is eaten by the native editor (use submit), no focus
trap / real modal, fonts must exist before process start. All user-visible strings go through
i18n resources (English only for now).

## When done

Run `bun run typecheck && bun run lint && bun run fmt:check && bun run test` and report the
real output. If something fails, say so; don't claim green.
