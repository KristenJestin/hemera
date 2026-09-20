# Decisions of the 13 September 2026 restart

**Project code name:** Hemera
**Status:** decisions taken by the maintainer during the full re-reading of the v1 Specs.
They complement [`core.md`](../product/core.md) and prevail over the earlier proposals of the
technical design where they contradict them. Working assumptions are flagged as such; they
are not decisions.

## Organisation of the Specs

- The v1 umbrella change is split: **one change per development lot** (lot 1 to
  lot 8). Lot 1 is fully specified (proposal, specs, design, tasks). Lots 2 to 8 only have a
  proposal that records the rules already acquired and the questions to settle; they remain
  drafts until their specs and tasks are written.
- The old change is kept in the archive as a writing reference; it is no longer the source
  of the tasks.

## Product decisions

| Subject | Decision |
|---|---|
| Interface language | English only in v1; strings externalised from the foundation on (i18n-ready), a single locale shipped. The protocol briefs intended for agents are in English. |
| Project configuration | Lives in the Profile's SQLite database (Drizzle) and is edited in the interface. No configuration file is written into the user's repositories. |
| Human key of a Spec | `PREFIX-n`: short prefix configured on the Project, number allocated by the Project's transactional counter. Example `SPEC-42`. |
| End of life | A Session can be **archived** (hidden from the sidebar, restorable, nothing is deleted). No deletion of a Session, a Spec or a Project in v1; beyond `draft`, only cancellation exists. |
| Order of the `build` phases | `prepare → execute → documentation → verify → review (agents) → human review`. `core.md` (review before verify) is corrected accordingly. |
| Agent tools | No native tool of the provider is loaded ("bare" mode): Hemera itself provides the working capabilities (files, shell, search, business operations) through the Hemera MCP server or an equivalent mechanism depending on the provider. Bare mode only exists natively with Claude; the choices common to the three providers are to be settled in lot 2. |
| Permissions in `build` | Reading, writing and commands **inside the Workspace root** are auto-approved; anything that leaves it (another path, network, mass deletion) requires a human decision. Default on the Project, overridden per `build` Session. |
| Agent models | One model per **agent role** (define principal, build principal, worker, reviewer, ...), configurable on the Project and changeable at launch. Assumption: sub-agents use the principal's provider. |
| External MCP servers | Deferred until after v1. Only the Hemera MCP server is provided. |
| Branch of a dedicated Workspace | New branch `<prefix>/<key>-<slug>` (e.g. `hemera/SPEC-42-login-form`) created from the local HEAD of `main` for each repository; prefix and base reference configurable on the Project; no implicit network operation. |
| Commits in the users' Workspaces | User settings (when and whether the agent commits). **Not settled**; handled in lot 7, with the Hemera repository rules below as the natural default. |
| Hemera code repository | Git flow without release branches: `main`, `dev`, `feature/*` (and `hotfix/*`). An agent commits freely and cleanly on `feature/*`, never on `main` or `dev`. Commits follow the Angular convention. `CLAUDE.md` and `AGENTS.md` at the root of the repository. |
| Tooling | oxlint and oxfmt for linting and formatting. Vite+ examined: Bun is supported as a package manager (PR #1005, March 2026) but "runtime support is not planned"; our dev/test/build scripts run under Bun (`bun:sqlite`, `bun build --compile`, PTY), so `vp run` is not retained for the foundation. Turborepo kept, to be reassessed if the Bun runtime is ever supported. |
| `prod`/`dev` channels | The application is installed as `prod` on the development machine; dev mode and `dev` packages use a separate Profile (database, lock, preferences). Both run side by side without seeing each other. |
| Migrations | One versioned, forward-only, cumulative migration per lot that changes the schema, applicable to a Profile installed from the previous version, with a prior backup copy and a migration test from a fixture of the previous version. |
| Tests | Every spec scenario has a test named after it, with a mandatory traceability table; failure injection, property tests, boundary tests, no vague test. |
| Review loop | **A single pass** of automatic correction after the reviewers, then human review. The number and profiles of the specialised reviewers remain to be determined in lot 7. |
| Build after a stop | A build stopped by the user or made obsolete is closed and remains viewable; a new build can be launched on the same revision in a new Session, the previous evidence remaining visible but to be reconfirmed against the actual state. |

## Working assumptions (to be confirmed)

- A single active Project at a time in the window, with a Project selector. The maintainer
  has not settled this yet; lot 1 starts from this minimal assumption.
- A single local user, the implicit human actor; events carry an extensible author without
  an account model.

## Questions deferred to the lots concerned

- Lot 2: equivalents of bare mode in Codex and OpenCode; actual ACP capabilities; exact
  content of the tools provided by Hemera; attachments/images in the chat.
- Lot 3: relations between Specs (linked/blocks); state of the phase reports after
  "Rework"; reopening a phase (new instance or reset).
- Lot 4: physical location of dedicated Workspaces; ports/URLs/Portless; importing scripts
  into the catalogue.
- Lot 6: parallelism bound for workers; environment regression during a build.
- Lot 7: commits; reviewer profiles and count; acceptance without Git; what follows a round
  made stale by an external modification.
- Lot 8: OS notifications; detailed backup/restore; final matrix.
