# Open questions of the product core

**Last updated:** 2026-09-12

This document contains the decisions that are not yet established enough to enter
[`core.md`](./core.md).

## Proposed work priorities

The core already fixes the main entities, the missions, the revision contract and the
human validations. The items below are work leads, not new
validated decisions:

1. Specify the realisation breakdown of the blocks retained in
   [`delivery-scope.md`](./delivery-scope.md). Native prototype, PR integrations and durable
   memory are postponed; Git and support for dependencies and parallelism are included.
   The detailed matrices per version and their common anti-omission register are
   proposals to arbitrate, not validations.
2. Prototype the interactions already retained to test the navigation and the human
   actions, before freezing their presentation or the configuration details.

The questions on this page still mix product choices and implementation details; they
do not all require an individual user validation before proceeding.

## Technical foundation — contributions of the spikes

The imported experiments are consolidated in the technical report consolidating the
spikes, without rerunning them.
The [v1 breakdown](./spec-map-v1.md) translates the needs into scenarios; it does not replace
the arbitrations below with an implementation assumed ready.

- The two repositories and their reconstruction now have a proposal in the
  design of the first lot; the remotes
  remain to be filled in when a publication is necessary.
- Windows and Linux are retained from the foundation on. Native packaging, migrations and
  the compiled MCP server must be verified on each; Linux measurements do not prove Windows.
- Claude Code, Codex and OpenCode are retained. Which ACP guarantees are confirmed for
  the versions of each? How to control its tools
  and its personal sources while allowing explicitly chosen Project files?
- The interactive terminal is retained in v1; the minimum proposed in the Spec must be
  verified on Windows/Linux, in particular selection/copy/paste, real scrolling and TUI interaction.
- Which clipboard, attachment, focus/keyboard and accessibility limits must be
  resolved for the delivered journey? The exclusion proposals from the spikes are not settled.

## Session

- How to present tool calls, results and errors in the chat without drowning the
  conversation?
- How to represent a new work pass without needlessly exposing the technical
  runs?
- When does a sub-agent activity deserve to become an independent Session in
  the sidebar?
- Which part of a specialised Session is provided to the new Session it launches
  to continue the work with another mission?

## Context and resumption

- Which capabilities of native resumption, history restitution and context
  continuity are available per ACP provider? Native resumption remains the priority; the
  caching mechanisms remain managed by the provider.
- Which precise context does Hemera reconstruct for the fallback resumption offered to the user
  when an ACP resumption is impossible? How to check the effects of interrupted tasks
  before continuing, without blindly replaying them?
- For a fallback reconstruction only, which share of the saved history is
  sent back to the model, summarised, indexed or only kept for the user?
- How to articulate the Project's user instructions with the instruction files
  already present in its repositories? Their use as sources without copying is settled;
  what remains is selection, scope, conflicts and duplicates with the provider's native reading.
- Which context information to provide initially, make available via MCP or
  refresh during a Session, while preserving the provider's native continuity?
- How to deliver updates to the Project's instructions according to each provider's
  capabilities? The principle is settled: targeted update at a safe resumption point for
  Sessions in progress, updated instructions from the start for new Sessions.

## Durable memory — later minor version

Consulting existing Specs via MCP and saving Sessions do not constitute
this feature. The following questions are deferred and do not block Hemera's first
delivery:

- Which uses justify a durable memory in addition to the data already available for consultation?
- How to measure its usefulness and detect incorrect or stale memories?
- Which scope, which sources and which feeding or sharing rules to retain?
- What lesson to draw from the user's current use of Mnemon, without presuming
  its adoption in Hemera?

## Spec

- To what level should tasks and proofs be linked to `UserStory` items without imposing artificial
  traceability on small Specs?
- Which schema details and checks implement the minimal contracts already defined for
  `feature`, `bug` and `maintenance`?
- Which future needs would really justify an additional type beyond
  `feature`, `bug` and `maintenance`?
- How to present manual editing of the draft in the Spec panel and coordinate
  human modifications with the agent's without unintended overwriting?
- How to assign and transfer the writing of a Spec between `define` Sessions in the first
  version, then handle conflicts if several Sessions can write simultaneously later?
- How to name and model the mechanism that replays a bug's scenario after the `build`
  and keeps the proof of its fix?
- Which precise fields and relations complete the base already fixed for `Prototype`, its versions,
  their pages, their variants, the rounds and the human feedback?

## Project and Workspace

- How to precisely represent the folders, repositories, checkouts and worktrees of a Project
  and its Workspaces?
- How to prepare a multi-repo Workspace: choice of repositories and branches, handling of
  files outside repositories and technical modalities of resumption after a partial failure, without
  recreating the resources already prepared? The principle of retention and resumption is settled.
- Which preparation recipes for dependencies, ports, variables, data and services to
  provide to the Project, and which resources to prepare before launching the build or start
  afterwards on demand in the already configured Workspace?
- How to assign URLs per application and Workspace, in particular in multi-repo, and
  configure their exchanges? Portless is an integration lead.
- How to record and track all the PRs needed for a Spec, in particular when a
  PR is replaced? The merge of all the necessary PRs makes the proposed closure eligible,
  but only an explicit click by the user authorises it.
- How to coordinate several builds when their Specs share the same Workspace?
- **GitHub and issues (decided on 15 September 2026, to be placed in a lot).** Hemera must
  be able to read and write the issues and PRs of a Project's repository: a Spec born from an
  issue or creating one, a delivery PR attached to its Spec, a state sent back to GitHub.
  The observation comes from the project's own tooling: OpenSpec is purely file-based and has no
  bridge to issues, and it is the same gap that a Hemera user will have. Still to
  decide: which lot (after 7, Workspaces, which brings Git), which provider first
  (GitHub, then GitLab?), authentication (local `gh` or token in the Profile), and whether the
  Hemera Journal becomes the source and GitHub the mirror, or the reverse.

## Commands

- How to present applications, verifications and utilities, and their possible groups?
- How to import scripts and propose promoting a one-off execution to the catalogue
  according to the Project's configuration?
- How to link commands to environment preparation, ports and the Portless
  system option?

## Missions and execution

- If a Spec is reopened after the build Session is created but before the first task,
  how to handle this Session now linked to an old revision? This case is distinct from
  environment preparation, which takes place before any build Session is created.
- Is the initial `define` and `build` catalogue closed or extensible?
- Should several reusable configurations be allowed for the same mission?
- Which additional checks would become necessary if the initial exit criteria
  of `shape`, `plan`, `prototype` and `decompose` prove insufficient in practice?
- Which minimal fingerprint allows invalidating a downstream phase when its inputs change,
  without introducing a visible validation and hash for each field of the Spec?
- How to version a mission protocol and handle a still-active Session when a
  new version adds, removes or reorders a phase?
- Which `build` phases can be delegated or executed in
  parallel, and which real dependencies condition their start?
- At what point must a `define` Session started without a Spec necessarily create
  or join one?
- How to compose documentation configurations between Hemera recipes, user preferences,
  workspace rules and adjustments specific to a Session?
- In what form does the user add their own documentation targets, rules and
  deliverables?
- Which missions can automatically launch another, and with what consent?
- How to compose the external actions policy between user settings, project
  configuration and the exception chosen for a `build` Session?
- Which settings and which presentation allow configuring, per project and per external
  action, the automatic, with-human-confirmation or disabled modes, while keeping the
  mandatory human click to close a Spec and close or clean up its Workspace?
- How to present a `build` orchestrator, its workers and their requests for attention?
- Which reviewer profiles to provide, how many to launch and how to select them according to the
  Spec, the diff and the workspace rules?
- How does the user intervene during autonomous work?
- Should an expert micro-intervention without a Spec one day be allowed, and in what form,
  without weakening the first-version rule that requires a Spec for `build`?
- **A Hemera server to hand the work over to (decided on 16 September 2026, later version,
  after v1).** Hemera will have a server part: a machine that keeps the Workspaces, the
  Sessions and the agents running, to which the desktop application attaches. From
  the application, a piece of work is sent to the server (a `build` Session, a task, an automatable
  acceptance test); it executes it, commits, pushes, and sends back what needs a human: a
  question, a diff to review, an acceptance test to perform on screen. The work is handed back and forth
  between the server's machine and any other, without copying anything over. The observation comes from the
  development of Hemera itself: the code advances on one machine, acceptance testing is done on another, and the only
  relay today is the ticket and the PR. To decide: what lives on the server and what
  stays local (are the Profile and the database the server's?), the protocol between the application
  and it (the same typed channel as the IPC, exposed on the network?), authentication, and whether an
  application can attach to several servers.

## Tasks and realisation plan

- Which table names and which precise cardinalities implement the contractual tasks,
  their criteria, their dependencies and their progress specific to each `build` Session?
- How to precisely represent the blocker and its resolution by the user when a
  contractual task is incorrect? Reporting, targeted suspension and the prohibition
  on modifying the frozen contract are already settled.

## Journal

- Which initial list of domain events deserves to appear in `domain_events`, and which
  level of detail remains reserved for technical logs?
- Which retention and pagination policy keeps a useful Journal on long Specs
  without making reading or the database unbounded?

## Interface

- How to present the "Session Context" view, its sources and the distinction between
  content provided by Hemera and information only available for consultation via MCP? Its principle is settled.
- Would a space for `free` discussions outside a Project have a clear and useful place in
  the interface? To test in the prototype; the first version attaches them to a Project.
- How far to keep the strengths of the previous product's sidebar without reproducing its interface identically?
- How to make the mission, the possible Spec, the provider and the state of a Session
  immediately visible without overloading each row?
- How to filter or bring together the Sessions linked to the same Spec while keeping them
  directly accessible?
- In what form does the chat remain accessible during an active `build`: panel,
  drawer, overlay or view toggle?
