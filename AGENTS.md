# AGENTS.md — Hemera product repository

Instructions for any coding agent (Claude Code, Codex, OpenCode) working in this repository.
`CLAUDE.md` in the same folder holds the full version; this file is the short contract.

## What this is

Hemera (Nyx v3): native desktop cockpit for ACP agents. One Bun process, React on GPUiX
(no DOM), SQLite via `bun:sqlite` + Drizzle. Monorepo: `apps/desktop`, `packages/core`,
`packages/runtime`, `vendor/gpuix`. Specs and product rules live in `../../openspec` and
`../../docs`; the current lot's `specs/`, `design.md` and `tasks.md` are the source of truth.

## How to work

1. Read the task's spec scenarios first. State assumptions; ask when unsure.
2. Write the minimum code. No speculative abstractions or options.
3. Change only what the task requires. Don't reformat or refactor neighbours.
4. Every implemented scenario gets a test named after it. Run the checks and report real output.

## Boundaries

`desktop → runtime → core`, `desktop → ui` (`packages/ui` = design system, no Hemera imports). `core` has no Bun, GPUiX/React, SQLite, fs or process imports.
Cross-package imports go through `exports` only. Boundary tests enforce this.

## Commands

`bun install --frozen-lockfile` · `bun run dev` · `bun run typecheck` · `bun run lint` (oxlint)
· `bun run fmt` (oxfmt) · `bun run test` · `bun run build`. Tests use a temporary profile and
never call a real LLM provider.

## Git

- Branches: `main`, `dev`, `feature/*` from `dev`, `hotfix/*` from `main`. No release branch.
- Commit freely and cleanly on `feature/*` / `hotfix/*`. **Never commit, merge, push or
  force-push on `main` or `dev`.** Never `--no-verify`.
- Angular commit messages: `type(scope): imperative subject` with types `feat fix refactor
  test docs chore build ci perf` and scopes `core runtime desktop gpuix db` or a domain name.
  One intent per commit, no `wip`.

## Data

Per-OS profile (`LOCALAPPDATA` / `XDG_DATA_HOME`), separate `prod` and `dev` channels, one
forward-only migration per lot imported statically, backup before migrating an existing
profile, state + `domain_events` in one transaction, no external call inside a transaction.

## UI

All colors, sizes, radii, fonts come from `@hemera/ui` tokens; no raw values or inline styles
outside token files (lint enforced). Reuse catalogue components; a new component needs hook,
component, test and showcase. Both light and dark themes. The HTML prototype in
`docs/prototypes/` is a token reference only: never copy its markup.

## Renderer

GPUiX has no DOM: no CSS/`className`, no ARIA, no `zIndex`, no `Tab` handling, no focus trap.
Restore focus explicitly after overlays; submit inputs via submit handlers; all visible
strings go through i18n.
