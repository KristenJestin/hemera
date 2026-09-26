# Hemera product core

**Status:** foundation being defined  
**Last updated:** 2026-09-12

This document contains only the validated product directions. The details still to be
settled live in [`open-questions.md`](./open-questions.md), and the methods or products
to study are kept in [`inspirations.md`](./inspirations.md).
Availability in the first delivery or in a later evolution is distinguished
in [`delivery-scope.md`](./delivery-scope.md): a validated target rule does not imply that
the corresponding feature is delivered immediately.

Hemera starts from scratch. The previous product, the earlier experiments and their PRDs serve
as lessons learned, but their model and their interface are not compatibility
constraints.

## Where the foundation lives

Development takes place in the product repository:
the Hemera application on Electron (Chromium, Node), pnpm monorepo. The GPUiX fork
(`sources/gpuix/`) was abandoned on 15 September 2026, see
[`decisions-2026-09-15.md`](../decisions/decisions-2026-09-15.md).

The technical consolidation of the spikes gathers the conclusions
of the experiments and their limits. It complements this core without replacing its decisions with
the older product assumptions of the technical reports.

While preparing the start, Windows and Linux are retained from the foundation on. The first
version targets Claude Code, Codex and OpenCode and includes an integrated interactive terminal, distinct
from managed commands. Development is split into eight lots (see the
[Spec map](./spec-map-v1.md)); lot 1 is specified, the
following ones are draft proposals. The [decisions of 13 September](../decisions/decisions-2026-09-13.md)
complement this core; the actual capabilities remain to be verified per provider and platform.
The visual design of the real application may be explored during its development; this
does not reactivate the postponed product prototype feature.

## Purpose

Hemera is a local development environment where a developer talks with agents,
entrusts them with work, watches what they do and validates the result, without losing
continuity between sessions.

Its differentiating value is to manage a Spec end to end and to integrate it deeply
into the application, the sessions and the agents' work.

The fundamental loop is:

```text
discuss -> define -> build -> verify -> document
```

## Two complementary principles

### Session-first interaction

The Session remains the main unit visible and manipulable in the application. Sessions
are present in the sidebar and the user can follow several pieces of work simultaneously.

Hemera also allows opening free discussions. A Session is therefore not necessarily
attached to a Spec.

### Spec-centered work

The Spec is the durable backbone of structured work. It is neither a document
attached to a conversation nor a mere separate screen.

A Spec can bring together several Sessions. The agents working on the same Spec
access its shared state through the MCP tools provided by Hemera. They do not depend
on an opaque memory transfer from the previous agent.

For the first version, only one `define` Session at a time can write the content of a
draft Spec. Other Sessions can be linked to it and consult it. The sub-agents
of the writing Session remain coordinated by it. This limit on concurrent writing
is a first-version choice: the model keeps the relationship between one Spec and several
Sessions, so as to allow several writing `define` Sessions later. The coordination and
conflict-resolution rules required for that evolution remain to be designed.

Navigation does not become Spec-first: Specs do not replace the direct presence
of Sessions in the sidebar.

## Project and Workspace

The `Project` is the durable grouping of repositories, Specs, Sessions, knowledge and
configuration rules. The name Project is retained.

The Project is a logical grouping and carries no distinct physical root. The path
belongs to the `main` Workspace, which serves as the main environment. This name does not determine
that of the Git branches. A Project can begin before the sources exist: the `main`
folder can hold the preparation and the design documents, then receive the
sources in subfolders.

The Project configures the locations of its repositories relative to the Workspaces' root, for example
`./sources/api` and `./sources/front`. Multi-repo is part of the first version. If the
list is empty, Hemera uses the root `.` as the default location; this does not assume
that a Git repository exists and does not trigger its automatic initialisation.

A `Workspace` is a concrete working environment attached to the Project. A Project can
own several, and they are all one kind of thing: `main`, a folder the user picks, and a
Workspace dedicated to a Spec. A dedicated Workspace assembles one worktree per included
repository under its own root, keeping their relative paths: `sources/api` and `sources/front`
can thus be two independent worktrees in the same Workspace. It is therefore limited neither to
a single worktree nor to a full copy of the `main` folder.

A dedicated Workspace lives in the Project's Workspaces folder, set in its configuration and by
default a folder of Hemera's own, never inside `main`. It is named after the Spec's slug by
default, a name the user can change. Each repository is included in every Workspace by default
or not, as the Project configures it, and the choice can be changed at creation. Each worktree
is created on a new branch `<prefix>/<key>-<slug>` — the prefix is the Project's, its name as a
slug by default — from the local HEAD of that repository in `main`; the creation dialog shows
the base and the branch of each repository before anything is made. Every check runs before
anything is written, and one that fails refuses the whole creation, naming it. No network
operation is ever made. A declared location that holds no repository in `main` gets no
worktree and is said so. The user can also create a Workspace on a folder they pick, named
after that folder by default: Hemera assembles nothing there. Environments without Git remain
possible, prepared by the recipe's copied and linked files.

Hemera talks to Git through the machine's own `git`; its absence is a refusal that names it when
a dedicated Workspace is created. The branch, the commit and the changes (staged, unstaged,
untracked) of each repository of a Workspace are read from Git when they are shown and never
stored; a Git error is shown as Git wrote it.

A Workspace used for development has by default its own execution environment,
distinct from those of the other Workspaces. The configuration belongs to the Project; the
effective resources belong to the Workspace: processes, ports and URLs, environment variables
and the data spaces needed. The level of isolation and any explicit sharing
are configurable; this does not impose a full container for each Workspace. The Project sets
environment variables that each Workspace can override; Hemera gives the result to every
command, preparation step and agent of that Workspace, and a command run keeps the variables it
was given.

Hemera takes charge of the complete preparation of the Workspace according to the Project's configuration:
creation of the necessary worktrees, registration of the Workspace in Hemera and preparation of
its environment. The user does not have to orchestrate these operations with an external agent.
A button allows triggering this preparation alone, without launching a build. A
combined action "Create the environment and launch the build" allows chaining the two: Hemera
first prepares the Workspace, then creates and launches the build Session only when that
environment is ready and configured. If the Workspace is already ready, the action is simply
"Launch the build". Preparation belongs to Hemera, outside the build mission; no
build Session is created to wait for this preparation. Moving the Spec to `ready`
does not by itself trigger this preparation or the build.

The build reuses the Workspace already associated with the Spec: it does not systematically create a
new environment. If no Workspace is associated, Hemera allows preparing one or
choosing an existing one, including `main`, according to the Project's configuration. Preparation
alone and that of the combined action use the same Hemera mechanism.

Creating the worktrees and preparing the environment remain distinct operations
in this mechanism. Before launching the build, Hemera must make available the
resources needed for development and verifications, taking into account what
is already ready. This preparation is not part of the agent's `prepare` phase.
Services can be started as needed, in the environment intended for that
Workspace.

The preparation follows a recipe the Project holds: an ordered list of steps, each of which
copies a file of `main`, links an unversioned file or folder of `main`, or runs a command of the
catalogue in the Workspace. A copied or linked file sits at the Workspace root or in each of its
repositories. A copy never overwrites a file already there, and does nothing when the source is
absent from `main`; a run fails when its command ends with a non-zero exit, its output kept. The
recipe is replayed for each dedicated Workspace as it stood when the Workspace was created:
first one step per worktree, in the repositories' order, then the recipe's steps in order, each
with its own durable state, one after the other.

If preparation fails partially, Hemera keeps the successful operations and the resources
already created, shows the failed step with the message of whatever refused it, as it was said,
and allows resuming preparation taking that state into account. A resume first re-checks what
was done against the disk — a worktree, a copied file, a link — and redoes what is missing,
then retries the failed step and carries on; a command that already ran is not run again.
The failure does not trigger an automatic deletion of what has been prepared.
Launching the build remains blocked as long as the prerequisites of its environment are not
satisfied.

If the Workspace is ready but launching the agent fails, Hemera keeps the Workspace
and offers "Retry the launch". This action retries launching the agent without
recreating the worktrees or replaying the environment preparation. The failure remains visible
so that the user can fix its cause before retrying.

If the user reworks the Spec during this preparation, Hemera invalidates the build launch
requested on the old revision and keeps the environment already prepared. The
new revision must be validated as `ready`, then the build launch explicitly requested.
The end of preparation or the new validation is not enough to relaunch this sequence.

The common case is a Workspace dedicated to a Spec. In this version, one Spec has one
Workspace: a dedicated Workspace belongs to the Spec it was made for and is not offered to
another, and a Spec that does not want one of its own reuses `main` or a Workspace the user
created on a folder they picked. The model does not require creating a distinct environment
for each Spec. Sharing a Workspace between builds — a second build on the same space waiting
explicitly, a Workspace kept as long as another use remains — is coordinated by the build lot,
see the [decisions of 23 September](../decisions/decisions-2026-09-23-workspaces.md).

Cleaning up a dedicated Workspace is a click of the user, never an agent's: its worktrees are
removed and its folder deleted, and the branches they were on are kept. It is refused, with its
reason and nothing removed, on `main`, on a folder the user picked, while the Workspace is being
prepared, while one of its services runs, while its build Session is not archived, and when Git
refuses to remove a worktree — uncommitted changes stop it.

## Commands

Hemera takes up the principle of managed commands: reusable definitions belong
to the Project and their instances run in a Workspace. The interface and the agents via
MCP share the operations of launching, stopping, restarting and consulting states, outputs
and results. Launching uses the folder and the environment of the Workspace concerned: a
command's folder is the Workspace root or one of the Project's repositories, found inside the
Workspace the run is in. A run shows the line it ran, its folder, the variables Hemera gave it,
its output and its exit code.

The Project's catalogue gathers the commands meant to be found and reused. Each has one of
seven types, drawn with the icon the type fixes:

- `serve`: API, front and development servers, with state, URL and logs;
- `test`, `lint` and `build`: verifications, with their results;
- `configure`, `debug` and `script`: preparation, data generation and other reusable scripts.

A command is one entry with a default line and, optionally, a line of its own for Windows and
one for Linux: the machine runs its own line when there is one, the default line otherwise.

A `serve` command runs either once per Workspace, each Workspace having its own instance, or
once for the Project, in `main`, whichever Workspace asks for it; asking again for a running one
joins it rather than starting a second. Its address is presented as starting until it answers a
request, then as ready; an address that does not answer within a minute is said not to. Hemera
allocates no port. When a service publishes a port that another running service of the Project
already holds, or fails because its address is in use, the conflict is shown, naming the service
and the Workspace holding the port. Stopping a service stops that instance only.

A `serve` command can be marked to run through Portless. At launch, Hemera checks that Portless
is installed and refuses by name, starting nothing, when it is not; otherwise the line runs
through Portless under the Workspace's name and the command's, the `.localhost` address it
prints is the service's URL, checked like any other, and no port conflict is looked for.

A one-off execution requested by the agent remains visible in the activity of its Session,
with the Workspace concerned, without automatically creating a permanent entry in that
catalogue. For example, the backend test suite can be a Project command, whereas
rerunning a specific test during a fix remains a one-off execution.

The agent first looks for a suitable existing command. It can propose a new
reusable command through a Hemera tool; the proposal appears in its Session, where a human
accepts or declines it. Nothing enters the catalogue otherwise: the agent has no write on it,
and the human can also add a one-off execution from the Session. Repeating a one-off execution
is not enough to promote it automatically. The details of groups and script imports remain to
be designed.

## Spec

A Spec represents the intention and the shared state of a piece of work followed end to end.

- It can exist independently of an active Session.
- It can be linked to several Sessions.
- It provides the various Sessions with a common context controlled by Hemera.
- Its content and its life cycle follow the contracts detailed below.

The Spec carries its `slug`. Hemera can generate it from the title, but it does belong to
the persisted identity of the Spec.

A Spec can point to a realisation workspace. This link is optional: a Spec can
be defined, discussed or ready before a workspace is associated with it. The Git branch possibly
associated with the work is not a canonical field of the Spec. It is observed in real time
from the workspace's repository or repositories. This derivation remains correct in multi-repo and
if a new realisation pass uses another environment.

The Spec carries no `position` field meant to order a board. A display order is
a property of the view; its evolution must not force the renumbering of Specs.

The exhaustive inventory of possible information is not a form to fill in. The
`define` mission builds the Spec from the conversation, Hemera automatically produces the
derivable metadata, and only the blocks relevant to the type and the current work are
requested. The internal form of this information remains to be fixed.

The common base of a ready Spec contains:

- a title;
- a type;
- the problem;
- the expected outcome;
- the scope;
- the way to verify the result.

This base separates the queryable metadata from the written content:

- `title`, `slug`, `type`, `status` and the relations are structured data known to
  Hemera;
- `problem`, `expected_outcome`, `scope` and `verification` are four rich, editable
  sections, not a decomposition into many atomic fields. Each is a row of `spec_sections`,
  versioned on its own and carrying its last author, `human` or `agent`, and Session.

This structure lets the agent evolve a section as a coherent whole and
the user read the Spec as a document, while letting Hemera drive its identity, its
life cycle and its attachments.

The level of detail and the additional blocks depend on the type and complexity of the
work. A draft Spec can be more incomplete: it is the move to `ready` that
imposes the applicable contract.

A Spec can own native `UserStory` items. They are optional and mainly
useful to `feature` Specs that comprise several distinct slices of value.

A `UserStory` contains one rich sentence bringing together the actor, their need and the expected
benefit. These elements do not become three separate fields. It also has a title
generated by the agent, a list of acceptance criteria and, if it really helps with
slicing, an optional priority. Its order is managed by Hemera through a flexible rank and
not a fragile integer position.

Hemera can link the tasks that realise a `UserStory` and the proofs that validate it. Its
progress is derived from these relations; the user does not maintain a story status
by hand.

### Spec and revisions

Statuses are consequences of business actions controlled by Hemera. No generic tool
of the `change_status` kind is exposed to the agent. For each action the backend checks the actor,
the authorisations and the prerequisites, then applies its effects on the state and the revisions.
A business action does not allow bypassing a human validation.

Validating a Spec, reworking it as a draft, cancelling it or closing it is a matter of explicit
buttons in Hemera. The agent can propose these actions, but does not execute them on behalf of
the user. Execution facts, on the other hand, update their state without an additional status
click: notably, the first task actually started by the build moves the Spec
to `in_progress`, without its preparation alone being enough. The agent can read
the state and the useful constraints; it does not have to orchestrate these internal transitions.

The `Spec` is the durable identity and carries its live state. A `spec_revisions` table keeps
the versions of its complete contract. A revision is a relational aggregate made up of its
main row, its sections, its `UserStory` items and their acceptance criteria. The revision carries
no status of its own: the life cycle belongs to the Spec.

Only the current revision of a `draft` Spec is editable. Moving the Spec from `draft` to
`ready` freezes its entire current contract, including its stories and their criteria. As long as the
Spec has not returned to `draft`, no contractual content can be modified. Feedback
obtained during the build or the review can produce findings and tasks without modifying
the Spec; their precise model will be defined later.

The user action "Rework the Spec" authorises its reopening. A write call from
the agent on a frozen Spec is refused; it never implicitly triggers its reopening.
The agent can write into the new draft once the human action has been performed.

The only return to `draft` starts from the `ready` state. The `ready → draft` transition
necessarily creates a new revision: in a single transaction, the backend copies the
current revision, its sections, its `UserStory` items and their criteria, points
`current_revision_id` to the copy, then places the Spec in `draft`. The previous revision
remains intact.

This transition relies on a dedicated business operation of full cloning, not on a series
of independent writes exposed to clients. The product action targets the Spec, for example
`reopen_spec(spec_id, expected_revision_id, reason)`, reserved for the authorised user path,
and not exposed as an MCP tool to the agent. The backend:

1. checks that the Spec is still `ready` and still points to the expected revision;
2. creates the next revision with a new number and the creation metadata;
3. copies all the contractual content, its sections with their versions, and all the child rows;
4. assigns new IDs to the copied sections, `UserStory` items and criteria while keeping their
   relations and their order;
5. switches `current_revision_id` and the Spec's status to `draft`;
6. records the reopening event and the reason, if any.

The whole succeeds or fails in a single transaction. The
`expected_revision_id` check prevents two concurrent Sessions from silently creating two
drafts from the same base. The internal detail may be called `clone_spec_revision`, but
the visible command remains a reopening of the Spec, not a manual manipulation of rows.

Once a Spec has gone beyond `ready`, it can no longer return to `draft`. Its contract can
therefore not be rewritten during or after its realisation. The mechanisms for correcting,
succeeding or replacing a Spec will be handled separately when a real case
requires it.

Product operations remain addressed to the Spec. Launching a build requires a `spec_id`, not
a `spec_revision_id`. In the same operation, the backend checks the Spec's state, resolves its
current revision then keeps its ID on the new build Session. The work thus remains
attached to an exact version without exposing this detail to the user or the caller.

The logical schema retained is:

```text
specs
- id
- project_id
- key
- slug
- status
- priority nullable
- workspace_id nullable
- current_revision_id
- writer_session_id nullable
- content_version
- created_at
- updated_at

spec_revisions
- id
- spec_id
- number
- title
- type
- change_summary nullable
- change_reason nullable
- created_by
- attested_content_version nullable
- created_at

spec_sections
- id
- revision_id
- name
- body
- version
- author
- session_id nullable
- updated_at

user_stories
- id
- revision_id
- title
- narrative
- priority nullable
- rank

acceptance_criteria
- id
- story_id
- body
- rank

task_sets          id, revision_id, kind (`contract`)
spec_tasks         id, task_set_id, title, result, type, executor, criteria, rank
task_dependencies  task_id, depends_on_id
task_stories       task_id, story_id
spec_questions     id, revision_id, body, blocking, phase nullable, raised_by, options,
                   answer_option_id nullable, answer_text nullable, resolved_at nullable,
                   created_at
spec_phases        id, revision_id, phase, state, summary nullable, assumptions, basis,
                   protocol_version, declared_at nullable
spec_edit_buffers  spec_id, name, body, base_version, updated_at
```

A section belongs to a single `SpecRevision`, once per name. Its name comes from a closed
set: the base `problem`, `expected_outcome`, `scope` and `verification`, then `plan`, and the
section of each type, `behaviour` for a `feature`, `reproduction` for a `bug` and `invariants`
for a `maintenance`. Every write to a section bumps its `version` and the Spec's
`content_version`.

A `UserStory` belongs directly to a single `SpecRevision`. An acceptance criterion
belongs directly to a single `UserStory`. The relation to the Spec is deduced through the
revision; `user_stories` therefore does not duplicate a `spec_id`.

The `define` mission also produces the realisation plan before the Spec moves to
`ready`. This decomposition is performed by the same agent that framed and designed
the Spec: it prepares instructions precise enough for a future `build`
Session, possibly executed by a less capable model, to follow them.

These realisation tasks belong to the frozen contract of the revision and are copied with
it on a reopening. They must not be confused with the free sub-steps
that a `build` orchestrator may create to organise its execution.

A contractual task contains at minimum a title, the observable result to deliver, its
type, its executor (`agent` or `human`), its acceptance criteria and its dependencies. It
can reference the `UserStory` items it covers or the prototype to realise. Priority and
parallelism are derived from the dependency graph rather than stored as redundant
properties.

Tasks share the same structure but are gathered in `TaskSet` groups. The initial
group, of type `contract`, belongs to the `SpecRevision`. A group of type `correction`
belongs to the `build` Session, references the `ReviewRound` its feedback comes from and
keeps the feedback or findings that triggered it. This ownership is enough to distinguish
the Spec's frozen tasks from the tasks added during the build, while keeping the latter
linked to the Spec through the Session and its pinned revision.

The execution status does not modify this frozen definition. Each `build` Session keeps
separately the progress, the attempts and the proofs associated with each task. The orchestrator
can create private sub-steps to conduct the work without modifying the Spec's
contract.

There is neither a `BuildCycle` nor a versioned copy of the workspace in the core. The Session carries the
entire build and the execution of a `TaskSet` represents a modification pass. An
interrupted pass remains observable through its task executions without an additional cycle entity.

When a new revision is created, the backend copies in a single transaction the
`spec_revisions` row, its `spec_sections` rows, its `user_stories` rows and their
`acceptance_criteria` rows. The copies receive new IDs. There is no story identity spanning
revisions and no second versioning mechanism. A possible future need to trace the origin of a copy
could add a lineage link, but it does not belong to the current core.

The content is therefore not an opaque JSON snapshot. A native list is stored as
SQL child rows. A JSON field remains possible later for flexible data that has neither
an identity of its own nor a direct relation with other objects.

The result of the `plan` phase is not a standalone entity. It directly complements the
revision with a rich `plan` section, which gathers the technical approach, the impacts, the
decisions, the constraints and the risks. The phase can also refine the existing
`verification` section. This form avoids a parallel table and versioning cycle:
the content is frozen with the rest of the revision.

The native prototype is postponed to a later delivery. Its phase is defined but
unavailable in the first delivery, without blocking `ready`; support for parallelism
and dependencies is, on the other hand, present from the foundation on. The following paragraphs describe
the target contract once this feature is available.

The prototype is a native Hemera component integrated into the Spec and the Sessions concerned. It
is not a generic attachment. It constitutes a standalone rendering contract, structured
enough for a `build` agent to query directly its pages, its states, its
interactions, its design-system components and the selected variant.

The `prototype` phase ends only when every identified page has an explicit
state: either the user has selected a variant, or has declined the page. No page
can remain with several variants without a human choice. Hemera mechanically checks that all
pages are resolved; the user remains the authority on choosing or refusing a
variant. The prototype's data is carried by native relational Hemera entities,
and the Spec revision references by identifier the prototype version finally selected.

During `shape`, the agent proposes this phase when it detects a need for rendering. It is
activated only if the user accepts, and the user can also request it manually as long as
the Spec remains in `draft`. Its native model comprises at minimum a `Prototype`, its versions,
the pages of each version and the variants of each page. Once activated, the phase can
be delegated to a sub-agent in parallel with `plan` and `decompose`. It blocks neither of
these two phases; it only blocks the move to `ready` as long as all its pages are not
resolved and the prototyper has not confirmed the coherence of the whole.

A realisation task can point to a prototype but does not copy its visual
description. As long as the Spec is in `draft`, the prototype can evolve without making that task
stale: the relation keeps designating the same object. The move to `ready` freezes in the
revision the prototype version selected by the user. The precise relational schema, its
rounds and the retention of its variants remain to be defined.

Hemera takes from GitHub Spec Kit the idea of separating the intention, the expected outcome, the plan
and the tasks, as well as the requirement for verifiable criteria. It does not
necessarily take up its documents, its commands or its level of formalism.

### Spec types

Hemera uses a single `Spec` entity. The `feature`, `bug` and `maintenance` types do not create
three separate models: they select a content and validation contract suited
to the work.

A Spec has an explicit type. The type is not a mere display category: it
determines the Spec's minimal contract, the instructions given to the agents, the order of
their work and the way to validate the result.

The first version has three types:

| Type | Main contract |
|---|---|
| `feature` | Prove that the expected new behaviour exists |
| `bug` | Prove that the incorrect behaviour has disappeared |
| `maintenance` | Prove that the internal transformation has not altered the expected behaviour |

A new type must be added only if it really changes the behaviour asked of the
agents and its termination condition. The size or urgency of the work does not constitute
a type. A bug, even a very small one, is therefore not a less formal "quick fix".

For a `feature`, `define` explores the need, the journeys, the scope and the acceptance
criteria. `build` builds the new behaviour and verifies these criteria.

A Spec of type `bug` must contain a scenario allowing the problem to be reproduced before
development. This scenario belongs to the Spec and must be replayable after the
`build`, by an agent or by the user, in order to observe that the incorrect behaviour
is no longer present.

The reproduction before the fix and its verification after the fix form a single
traceable contract. The precise form of the surface and the associated proofs remains to be defined.

For a `maintenance`, `define` describes the current technical state and the target, the reason for the
change, the dependencies affected, the invariants to preserve, compatibility, the
possible migration and the rollback. `build` performs the transformation and proves that
the existing behaviours have remained stable by means of appropriate checks.

## Session

A Session is a visible and durable thread of work belonging to Hemera.

- It appears directly in the multi-session interface.
- It keeps a classic chat between the user and the agent.
- It can be free or linked to a Spec.
- It has an optional mission.
- It uses a provider and a model to execute the agentic work.

A Session has a fixed main agent. This agent remains the same throughout all the
phases of its mission; changing agent or mission implies a new Session. The
possible relation to a Spec belongs to the Session, never to the mission: the mission
only determines whether this relation is mandatory and how the agent uses the Spec.

A Hemera Session is not the technical session opened with the ACP provider. Hemera keeps
what it owns of the thread and the work. The provider's session can be stopped, resumed or
lost without making the Session visible in Hemera disappear.

The provider's native continuity via ACP takes priority: Hemera favours its existing session
and leaves it the management of its context, its history and its caching mechanisms,
according to the capabilities it provides. Hemera does not replace this continuity with a homemade
reconstruction and does not systematically reinject a copy of the thread on a native resumption.
Exact cache retention is not a universal guarantee of the ACP protocol.

In parallel, Hemera records as it goes the Session content it receives: messages,
tool calls, results and available activity events. This saving does not depend
on an action of the agent and is not limited to a summary note kept by it.
It keeps the history accessible on the Hemera side and provides a fallback base, without claiming
to capture the provider's unexposed internal state. Keeping this content and deciding which part
to give back to the model are two distinct responsibilities.

If the ACP connection drops during a build, Hemera keeps the Session, the progress of the tasks
and the work done. It first tries to resume the provider's existing session,
according to the available capabilities. If that resumption is impossible, Hemera offers the user
to continue in the same Hemera Session with a reconstructed context; this fallback
does not claim to restore the provider's memory identically. It does not change the main
agent chosen for the Session.

Before continuing, the agent checks the real state of the interrupted work. An interrupted task
may have produced modifications or effects without its result having been recorded:
it is therefore neither considered finished nor blindly replayed. The resumption does not restart
the tasks already accomplished. The possible fidelity of the ACP resumption, the precise content of the
reconstructed context and the reconciliation checks remain to be detailed.

## Context provided to agents

Hemera composes the context useful to the agent from the Hemera base, the Project, the Workspace,
the mission and its phase, the possible Spec and the Session. The base explains
in particular that the agent works in Hemera, must favour its MCP tools for the operations
managed by the product and must respect human validations.

The Project has a space where the user can write their own instructions common
to their agents. These instructions complement the structured information provided by Hemera;
they replace neither the Spec's contract nor the backend's authorisation checks.

When a modification of the Project's instructions occurs during a Session, Hemera
signals its content to the agent at the next safe resumption point, without interrupting a response
in progress or recreating its ACP session. Only the useful update is transmitted, without reinjecting
the whole context. New Sessions directly use the updated instructions.

The delivery modalities are specified since issue #18 (designs D6-07 and D6-08). The base reaches
each agent once, at the start of the Session, by that agent's own means: through the system prompt
where the agent takes one (Claude Code), and as an embedded resource of the first prompt elsewhere
(Codex, OpenCode). The Project's instructions are the Workspace's `AGENTS.md`, and whether an
agent reads it itself under bare mode is its adapter's declaration. Codex does: Hemera does not
send it, records its fingerprint when the Session starts and lists it as read natively. Claude Code
does not (it reads `CLAUDE.md`, and with no settings source it reads nothing), nor does OpenCode
(project instructions are skipped under `OPENCODE_DISABLE_PROJECT_CONFIG`): Hemera gives them the
file at the start of the Session, as a resource of the first prompt, records its fingerprint and
lists it as given at the start. A `CLAUDE.md` of the Workspace is never sent by Hemera. While a
Session's agent runs, Hemera watches that file; a change is delivered
at the next safe point — when the turn in progress ends, or at once between two turns — as a
prompt of its own made of a Hemera marker and the new text as a resource. The thread records it as
a delivery, never as a message of the user, and no new native session is opened for it. A change
made while no agent runs is delivered before the next prompt.

Instruction files already present in the repositories, such as `AGENTS.md` or
`CLAUDE.md`, can serve as context sources from the first version on. Their content
remains maintained in the original files, without an independent copy to maintain in Hemera.
The instructions specific to the Hemera Project complement them. The rules of selection, scope,
conflict resolution and the articulation with the provider's native reading remain to be
specified, in particular to avoid a double injection.

The available commands, the organisation of the repositories and the progress of the tasks remain
data managed by Hemera and consulted from their source. They do not become independent copies
in an agent's memory. Composing the context does not mean that
all data and all conversations are injected in full at every turn.

A "Session Context" view lets the user inspect the instructions and
information provided by Hemera, with their provenance. It distinguishes what was provided to
the agent from what is only available for consultation via MCP. It does not claim to
expose the entirety of the provider's internal context or to guarantee that a piece of information was
retained or used by the model. Its detailed presentation remains to be designed.

Access to past Specs is a matter of consulting existing business data, not of a
memory system: agents have MCP tools to read them and the Hemera context
directs them to that consultation when necessary. Saving Sessions and resuming them
also remain distinct from durable memory.

Durable memory does not yet exist as a native Hemera feature. It is postponed
to a later minor version and does not condition Hemera's first delivery. Its
scope, its storage, its feeding and its value in use remain to be studied; neither an
automatic publication of discoveries nor a Mnemon integration is decided.

All sub-agents receive a context targeted on the work entrusted to them: Hemera
base, relevant Project instructions and information needed for their intervention.
They do not automatically inherit the whole conversation of the main Session.
For reviewers, this targeting preserves in particular the independence already retained: contract,
prototype, code and useful proofs, without the reasoning history of the developer agents.

## Session missions

A mission describes why the Session exists. It is neither a persona nor the name of the
provider.

| Mission | Responsibility |
|---|---|
| `define` | Turn an intention into a usable Spec |
| `build` | Execute the frozen contract, implement, document and verify the result, possibly with sub-agents |

`free` designates the absence of a mission. It is a lightweight discussion Session, which can receive
its first mission later without changing thread.

For the first version, a `free` Session belongs to a Project. It requires neither a Spec nor a
Workspace. The possibility of discussions outside a Project remains a lead to test in the
UI prototype, in particular to determine where to create them and find them again.

The mission determines the instructions and the MCP tools made available. The provider
indicates which engine executes the Session, for example Claude, Codex or OpenCode.

A `free` Session is offered Hemera's code tools and, of the Spec tools, `spec_propose` alone,
to propose a Spec. A `define` Session produces a Spec and not code: it reads the Workspace
(`fs_read`, `fs_list`, `search`, `project_get`, `session_get`, `commands_list`,
`commands_output`) and writes only its Spec, through `spec_read`, `spec_write` and
`spec_propose`; it is offered neither `fs_write`, `fs_edit`, `commands_run` nor `commands_stop`.
The Session, its Spec and its write right are deduced from the caller, never from the arguments
of a call. The Context view lists the set of the Session's mission.

## Session view

The chat belongs to all Sessions, but it is not necessarily their main surface
at all times. The central place adapts to the mission and its state.

The Session combines three generic elements:

- the chat;
- the context of the mission and of the possible Spec;
- a working surface suited to the current activity.

The chat is the agent's own thread: each message, thought, tool call, diff and permission request
is one typed entry, in the order it arrived, persisted in the Profile and projected into the
Journal. The composer carries what the agent says it can do — its models, its reasoning effort, its
permission modes — and, beside them, what the turn used: the reading the agent gave of its context
window, with "not provided" for whatever it did not announce. Hemera divides by no window an agent
never named.

The effort scale marks the level the agent recommends for the current model, and nothing where it
recommends none. While the user has chosen no effort in the Session, a model change puts the
agent on the level the new model recommends, so the scale stands on its recommended mark instead
of on whatever the agent's own settings kept; a model that recommends no level leaves the effort
where it is. Once the user has chosen an effort in the Session, it is kept across model changes.
The composer of a Project's Home follows the same rule before the Session exists.

The views surrounding the main surface are closable and mutually exclusive:
the user opens only one at a time. The Spec panel of a `define` Session is not one of them: it
is that Session's working surface, and it has no close control. A working surface can display, as
needed, a Spec, tasks, a prototype, a diff, a review or a document.

The mission gives a focus and a default behaviour; it does not limit the activities
possible in the Session. A `define` Session can for example produce a prototype, and
a `build` Session can perform an intermediate code review.

- A `free` Session remains a chat without an imposed work structure.
- A `define` Session keeps the chat in the centre and the live Spec beside it, in the place of
  the side column; its header reads its mission, its agent and the key of its Spec. A `free`
  Session offers no Spec of its own: one begins with its agent's proposal in the thread.
- An active `build` Session puts task progress and execution activity in the centre.
  The chat remains accessible without taking up all the space.
- When a `build` is finished or requests an intervention, the chat can take back the
  central place to explain the result and collect feedback.
- During the automatic review then the user validation, the `build` Session highlights
  the result, the diff and the proofs to verify.

When a Session has a mission, its interface shows the useful information about
that mission. When it is linked to a Spec, it also shows the useful information
about that Spec. This information consists of live projections: it updates in
real time when the agent modifies the Spec or its tasks through Hemera's tools.

The full Spec remains openable beside the chat. The user can therefore consult the
structured context without leaving the Session or losing the conversation.

The user can also directly modify the content of a `draft` Spec from this panel,
including during a discussion with the agent. Hemera records these modifications with their
human provenance and signals them to the agent of the `define` Session concerned so that it
takes them into account. The content remains locked from `ready` on, in accordance with the revision rules.

The panel edits one Markdown text area per section, with a preview toggle, and structured rows
for the stories, criteria, tasks and questions. A save carries the version of the section it was
opened on. If the section has moved since, the save is refused: the unsaved text is kept in a
buffer, one per section of the Spec, that survives a relaunch, and the panel offers to compare
the two texts, to apply the human's text on the current one as a new human write, or to discard
it. Last-writer-wins is refused: a conflict never loses an unsaved human text. The agent's writes
carry their base version the same way and are refused on a mismatch. A human edit reaches the
writer Session's agent at its next safe point, between two turns, never in the middle of one.

A question of the Spec is asked in the chat, where it is answered. The agent offers its answers
as options, one of them recommended, and the user picks one or writes their own; a question
with no option takes a text only. The answer is written beside the question in the thread, drawn
there as the user's own message — the option chosen or the text typed —, resolves it, and reaches the
agent at its next safe point like a human edit. The questions part
of the Spec is the register of what was asked and what was decided.

Presentation examples:

```text
DEFINE · Claude Sonnet
BUILD · Claude Opus
```

The head of a Session names its Project and nothing else: the mission shows in the panel beside
the chat, and the agent in the composer.

At this stage, Hemera does not need distinct `Role` or `AgentDefinition` business entities.
They will only become useful if a need for reusable and configurable profiles is
confirmed.

### Mission protocols and phases

A mission is not a mere prompt. It is executed according to a versioned protocol,
made up of ordered phases. The definition of the built-in protocols belongs to Hemera's code,
and not to generic tables of workflows, nodes or transitions. Long textual
briefs can be resources versioned with the application.

The mission carries the permanent instructions that remain true from start to finish: its
responsibility, its limits of authority, its relationship with the user and the Spec, its
common rules and its general definition of success. Each phase adds a temporary objective,
expected results, suitable tools and exit criteria. Hemera composes the mission's
instructions, the brief of the phase in focus and the Spec as it stands, each section with its
version, into the mission brief, and hands it to the agent as a delivery at a safe point, the
way a change of the Workspace's instructions is handed over: before the Session's first turn,
again each time the phase in focus changes, and to an agent whose own session was opened afresh.
The brief is a prompt of its own, a Hemera marker and the brief as a resource, never a part of
the user's message; the thread shows it as a folded Hemera line, and it counts as given only
once the agent took it. Between two briefs, the human's section edits and answers reach the
agent the same way, each a delivery of its own and a Hemera line of the thread: at once when no
turn runs, once the running turn ends otherwise.

The `define` mission defines three main phases and one conditional phase. The
`prototype` phase remains unavailable and cannot be triggered in the first delivery; its declaration
preserves its dependencies and its parallelisable nature for its later activation:

1. `shape` frames the need, the problem, the expected outcome, the scope, the type and the
   possible `UserStory` items, then translates the need into verifiable behaviours and acceptance
   scenarios;
2. `plan` analyses the code when necessary and fixes the technical decisions, the
   constraints, the risks and the verification strategy. When several structuring
   directions exist, the agent exposes their trade-offs and has the user decide
   those with a product or lasting impact;
3. `decompose` turns the contract and the design into ordered, verifiable vertical
   slices, along with their dependencies and their success criteria, rather
   than into lots separated by technical layer;
4. `prototype`, activated only when a need for rendering has been identified and accepted by
   the user, builds the native rendering contract with a specialised sub-agent.

These phases are visible in the Session but do not require manual launches. The
same agent chains them automatically. In particular, `decompose` is mandatory for
the agent before proposing the move to `ready`, but does not constitute an optional step
to be triggered by the user. `ready` is not a fourth phase: it is the state of the
Spec obtained after the final human validation, which freezes its revision and its plan.

The order of the phases describes their presentation and the nominal path. The dependencies declared
by the protocol really determine what can start. A phase can be marked as
delegated and parallelisable; this does not make all phases independent. Initially,
`plan` depends on the end of `shape`, `prototype` depends on `shape`, and `decompose` depends on
`plan` but not on `prototype`. The prototype can therefore advance in a sub-agent while
the main agent continues the design then the decomposition. The move to `ready` requires that
all activated phases are finished, including the human selection of the prototype when
it was requested.

Several phases can be open simultaneously. Hemera keeps a phase focus to
know which phase provides the main brief for the current turn, but this cursor is not
the global state of the mission. The focus is the first phase, in the protocol's order, that is
open or stale: a stale phase has to be declared again, and that is the work the turn points at.
Each phase has its own durable state. If an input on which a phase depends changes, its result
can become stale. Writing a section makes stale the finished phase that owns it along with the
finished phases that depend on it, so the owner's exit checks are asked again rather than kept on
a text that changed. A mere evolution of a prototype's
content does not, however, make `decompose` stale, since the tasks reference the prototype
instead of duplicating its rendering.

The agent can signal that it considers a phase finished; Hemera then applies the mechanical
checks provided by the protocol and records the result. The exact details of the criteria
specific to the phases remain to be fixed.

The end of a phase brings together two complementary authorities. The agent has the semantic
judgement: it declares that the work is sufficiently complete and provides a summary, the
elements of the Spec that support it and the assumptions or questions still open. Hemera has
the mechanical invariants: it checks that the expected phase is indeed active, that the
required data exists and that no declared blocker makes the transition impossible. The agent
can therefore neither bypass the protocol's order nor force a failing check.

This declaration goes through a structured Hemera MCP tool, `spec_propose` with the kind
`phase_done`, and not through a mere sentence in the chat. The backend itself deduces the
Session, the agent and the mission; the targeted phase must be an open phase assigned to that
caller. If the agent's summary and Hemera's checks are both met, the phase is recorded as
finished, its dependants become eligible and the main agent's focus can advance; otherwise the
call answers the failing checks and changes nothing.

Finishing a phase is a work checkpoint, not a contractual validation. A phase
can be reopened by the user or become stale if its inputs change. Only
the user can move the Spec to `ready` and freeze its revision.

Before proposing this move to `ready`, Hemera runs a cross-cutting coherence check between
the functional contract, the technical approach, the tasks and the possible prototype. This check
is a protocol gate, not an additional phase: it blocks the proposal as long as a
contradiction or an activated but unresolved element remains. `shape`, `plan` and `decompose`
must be finished, as well as `prototype` when it was activated. No
blocking question may remain; every requirement or `UserStory` must be covered by criteria
and tasks, whose dependencies and references are valid. The agent then attests, through
`spec_propose` with the kind `ready`, that the contract is complete and executable without any
major decision left to invent; the attestation holds for the content it was made on. Hemera can propose it,
but only an explicit action of the user freezes the revision by moving the Spec to `ready`.

The `shape` phase can end when Hemera observes that the title, the type, the problem, the
expected outcome and the scope are present, and that no blocking question targeting these
elements is open. The `slug` is produced automatically; the `UserStory` items, the workspace,
the prototype and the tasks do not block this phase. The type's contract adds to the base:
a `bug` already has a reproducible scenario, a `maintenance` names the invariants to
preserve and a `feature` describes the expected observable behaviour. Finally, the agent provides
a semantic summary confirming that it can begin `plan` without inventing the product intention.
No intermediate human validation is required.

To reach this result, `shape` applies an interview method inspired by `grill-me`:
the agent explores the important branches of the need, asks a single question at a time and attaches
its recommendation to each decision requested. It looks up by itself the facts accessible in
the environment and only asks the user for the arbitrations that belong to them.
The depth of the interview adapts to the complexity of the change. This behaviour belongs
only to `shape` and becomes neither an additional phase nor a rule of `plan`.

The `plan` phase can end when the available workspace has been analysed, when the
`plan` field exposes a usable approach and when no major technical decision is still
blocking. If no workspace is available, this limit is explicit and the agent does not invent
the state of the code. For a `bug`, the plan contains the established cause or a bounded investigation;
for a `feature`, its integration mode; for a `maintenance`, the invariants and the
possible migration strategy. Finally, the agent confirms that `decompose` can begin without
having to choose the architecture.

The `decompose` phase can end when all requirements are covered by
tasks, when each task constitutes a verifiable vertical slice and when the dependency
graph is valid. Hemera mechanically checks the required fields, the references, the
coverage and the absence of cycles. The agent confirms that a `build` agent starting over with a
fresh context can execute each task without any major technical or product decision.

The database keeps the durable execution of the protocol: version used, phase results,
possible proofs and invalidations. It does not contain the configurable definition of a
graph. A future customisation of missions could introduce another storage mode
if a real need justifies it.

### The `build` mission protocol

A `build` Session requires a `ready` Spec and a Workspace already prepared and configured by Hemera.
Its creation receives the `spec_id`; Hemera checks these prerequisites, resolves the
current revision and keeps its exact identifier on the Session. The original `define`
Session remains intact and available for consultation.

A Spec can have only one active `build` Session at a time. Hemera enforces this
uniqueness; workers and reviewers remain sub-agents of that Session. A pause or
a wait for validation or delivery does not free this slot. This rule does not limit
the `define` Sessions or the free discussions linked to the same Spec.

Creating the Session and the `prepare` phase leave the Spec in `ready`. When a task
actually begins its execution in `build`, its progress moves to `in_progress` in
that Session. The start of the first task also moves the Spec from `ready`
to `in_progress`. This is the moment when returning the Spec to `draft` becomes forbidden.

The backend coordinates the reopening and the start of the first task to prevent
both from being authorised on a stale state. A replaced revision cannot
begin its execution.

The Spec remains in `in_progress` during corrections, reviews, documentation and
the wait for delivery, including after human approval of the result. Phases,
blockers and waits are described by the state of the Session and its executions; they
do not create additional statuses on the Spec. The delivery signal makes it possible to propose
its closure; it never triggers it without an explicit action of the user in Hemera.

The initial protocol has four main phases and one resumption phase:

1. `prepare` loads the contract, the `plan` field, the tasks and the possible prototype into the
   already prepared Workspace, then prepares their execution without redefining the solution. This phase
   does not create the Workspace and does not perform its environment preparation;
2. `execute` processes the tasks according to their dependencies. The main agent acts as
   orchestrator and can delegate tasks to workers attached to the Session;
3. `verify` runs the criteria of each task then the global verification of the Spec and
   gathers the proofs obtained; the documentation internal to the build is re-evaluated before
   this step;
4. `review`, conditional on the presence of a usable Git history, launches in parallel
   several specialised reviewers with a fresh context, so that they are not influenced
   by the conversation or the reasoning of the implementation; they receive the proofs from
   `verify` and their findings consistent with the contract give rise to a single automatic
   correction pass before the human review;
5. `feedback`, activated when human feedback requests a new pass, verifies the problem
   on the real result, clarifies the intention if necessary, checks its compatibility with the
   Spec and produces a correction `TaskSet` before handing the focus back to `execute`.

The order `prepare → execute → documentation → verify → review → human review` was settled
on 13 September 2026 ([decisions](../decisions/decisions-2026-09-13.md)).

Documentation belongs to the `build` mission, not to a separate mission or Session.
It can be entrusted to a specialised sub-agent, but its modifications are made in
the same workspace and are part of the same diff, the same commits and the same PR as
the implementation. Its scope is configurable per user and per workspace: Hemera
provides default recipes and the user can add their own. The exact format of
this configuration and the placement of this activity in the protocol remain to be specified.

The `shape`, `plan` and `decompose` phases remain specific to the `define` mission and are not
replayed in `build`. The `feedback` phase can take up their discipline of clarification and
of transformation into tasks, but has its own instructions and its own data.
If the feedback requires modifying the frozen contract or plan, Hemera does not create a
correction task: it raises a Spec conflict to the user.

The progress, attempts and proofs of a task are specific to that `build`
Session. A worker can create internal sub-steps, but can modify neither the contractual
task nor the frozen Spec. An inconsistency in the contract becomes an explicit blocker to
raise; it cannot be silently corrected during the build. Only the task
concerned and its dependants are suspended, while independent tasks continue.
The mission cannot be declared finished as long as the user has not handled or
explicitly dismissed this blocker.

The build result is accepted when all contractual tasks and human actions are
satisfied, the reviews and verifications pass, no blocker remains and
the user approves it. The closure of the Spec then waits for the delivery conditions and
the explicit user click defined below. A failure or a skipped task cannot be hidden by
the agent. The build result remains linked to the Session, the exact revision and the workspace
used.

### External actions and delivery

Git is integrated from the first delivery, but PR integrations come later.
The rules below on PR tracking and merging therefore describe the later target; without
that integration, Hemera relies on human confirmation of delivery and does not claim
to observe PRs. Human closure validations remain mandatory in all cases.

As soon as a workflow acts outside Hemera, its behaviour is a matter of a configurable
policy of the Project. Hemera therefore does not impose a
universal branch or pull request cycle. The configuration can choose the forge and its access
mode, the moment to create or publish a branch, the possible creation of a draft
PR, its move to ready, the actions authorised after approval, as well as the
cleanup of temporary resources.

This policy also applies to other external effects, such as publishing documentation
or updating a third-party tool. The absence of configuration never amounts to implicit
authorisation. The capabilities actually available depend on the integrations, the permissions
and the rules of the target; Hemera must clearly expose what it will do before launching.
The project provides the usual behaviour, which the user can override for a specific `build`
Session. Without a defined policy, Hemera stays local and asks for a decision before any
external action.

The project configures each external action and its mode separately: automatic, with
human confirmation, or disabled. This rule also applies to what follows a delivery
or a cancellation: closing a PR, deleting a branch and cleaning up a workspace are
independent actions. The user can thus keep the work while authorising the
closing of the PR. A confirmation covers only the action concerned; the agent can neither
widen that authorisation nor change the policy. The backend enforces the effective
configuration and the required confirmations. The presentation of these settings remains to be defined.

Closing the Spec and closing or cleaning up its Workspace constitute a
mandatory exception to the automatic modes: these operations require an explicit click
by the user in the Hemera interface. The Project's configuration can define their conditions
and the actions proposed, but cannot remove this human validation. Agents
have no access to closure operations via MCP; a sentence from the agent or an interpretation
of the chat cannot stand in for an authorisation. The backend controls this boundary.

Cancelling a Spec is a matter of an explicit action of the user. Its external
consequences are determined by the project's policy and any choices specific to the build;
it therefore does not by itself imply closing a PR or deleting the work done.

After acceptance of the result, Hemera waits for the delivery signal provided by this policy.
With a tracked PR, this signal is its merge; without a PR, it is an explicit confirmation
of delivery by the user. When the closure conditions include the merge and the Spec
requires several PRs, notably in several repositories, all those necessary PRs must
be merged. A partial merge leaves the Spec in progress; a PR closed without merging does not satisfy
this condition. When the conditions are satisfied, Hemera offers a closure button
with a summary of the situation. The Spec remains open as long as the user has not
clicked to authorise its closure. The merge here constitutes a signal that the change has been integrated,
without presuming its deployment to production; observing it authorises neither merging another
PR nor closing the Spec.

This wait is handled in the background by Hemera from the tracked PRs and the available
integrations; it does not require leaving an agent running or judging delivery on its own.
An unknown state does not amount to a satisfied condition.
Closing the Spec does not implicitly authorise closing or cleaning up the Workspace:
the interface distinguishes the actions and asks for explicit authorisation for those retained.
The cleanup then follows the project's policy and concerns only the temporary spaces
created by Hemera, after checking that no local work would be lost there. The user's main
folder is not deleted. The Spec, its Sessions and their history remain
available for consultation after closure and cleanup.
A shared Workspace cannot be cleaned up as long as another Spec or Session still
needs it; the closure of a single Spec is not enough to make it available for deletion.

Each review wave has a `ReviewRound`. It represents a logical checkpoint: as long
as it is open, the orchestrator no longer modifies the result presented. Hemera does not copy the
workspace and does not recreate a versioning system. With Git, the round can reference the
exact commit or diff. Without Git, Hemera offers neither diff, nor line comments, nor automatic
code review. The build and its verifications keep working, then the user
performs a classic review of the current product. Their product or general feedback is
directly attached to the round.

During a `ReviewRound`, feedback is accumulated without triggering a modification after
each comment. The `feedback` phase can clarify it as it comes, but the user
explicitly triggers the correction pass once they have finished their review. The agent then
analyses all the feedback and creates one `TaskSet` per coherent batch: remarks about
the same behaviour stay grouped, while independent batches can be executed
in parallel. Each group keeps the links to all the feedback or findings that
produced it.

Reviewers receive the Spec and its frozen revision, the final state of the workspace, the diff and
the useful proofs, but not the reasoning history of the agents that developed. Their
list and their specialities are defined by the protocol and may evolve. The core does not
yet fix their number, their precise profiles or their selection rule.

These reviewers are neither missions nor additional Sessions. `build` remains the
mission, `review` is one of its internal phases, and each reviewer is a sub-agent
execution attached to that phase. When the main agent considers the implementation finished,
the phase launches several of these sub-agents, potentially in parallel, before presenting
the result to the user. They remain grouped in the `build` Session and do not create
additional entries in the sidebar.

A finding that
can be corrected without contradicting the Spec automatically relaunches `execute`, then only
the reviewers concerned. If the correction touches several areas of the contract or has a
cross-cutting impact, Hemera invalidates and relaunches the whole review. A finding that calls the
contract into question becomes a blocker submitted to
the user. When the agent checks are satisfied, the same Session moves to waiting
for human validation; user feedback relaunches a new correction and
review loop without creating a separate `review` mission.

A sub-agent execution is attached to the parent Session and to its phase of origin.
When it ends, Hemera persists the result then places a signal in a durable
inbox of the main Session. This signal is never injected in the middle of a generation and
never passes itself off as a human message: it is delivered at the next safe point, as a
delivery said to be internal. If
the main agent is idle, Hemera can launch an internal continuation to integrate the
result without waiting for a new user message. This inbox guarantees
delivery; `domain_events` separately keeps its history.

## Controlling the transition between missions

A Session without a mission can receive its first mission in place, without creating a new
thread. It can in particular become `define` or `build`.

Moving from `free` to `define` never leaves a Session without its Spec. The agent of a `free`
Session proposes a Spec, a title and a type, in the thread; when the user accepts it, Hemera
creates the Spec, makes the Session its writer and switches it to `define` in one transaction,
keeping the thread. A `define` Session opened from a Spec, in the list of a Project's Specs, is
attached to it from its creation: it writes the draft when nobody does, and reads it otherwise.

The agent proposes through Hemera's `spec_propose` tool, with the kind `spec`, a title and a
type: of the Spec tools, it is the only one a `free` Session is offered. Hemera writes the
proposal in the thread, below what the agent said before it, and nothing else; a `define`
Session is refused a proposal. The tools an agent holds are fixed when it is started, so once
the proposal is accepted Hemera lets the Session's agent go, and its next turn starts it again,
its conversation resumed, with the tools of a `define` Session.

Moving from `free` to `build` is only possible if the Session is first attached to an
existing Spec. Without a Spec, the user must remain in free discussion, accept the agent's
proposal of a Spec to go through `define`, or open a `define` Session on an existing Spec from
the Project's list of Specs.

Among the specialised missions, only `define` is reached from a free discussion without an
existing Spec, since its responsibility is precisely to create one. The `build` mission
requires a linked Spec.

Once its first mission is assigned, the Session no longer changes mission. Moving from
`define` to `build` creates a new Session.

Attachment to a Spec remains a relation of its own, stored apart from the mission.

The end of a `define` Session is determined by the Spec itself: when the Spec moves to
the `ready` state from that Session, Hemera offers to create a new `build` Session linked
to the same Spec. The user keeps control of the launch.

Hemera may also automatically chain certain missions when the user has
explicitly requested it.

A new build or verification pass remains possible after the user's
feedback. The exact way to present these passes is not yet decided.

## Journal and domain events

Hemera keeps a global append-only journal of domain events in a
`domain_events` table. This journal is not the source of truth of the Spec and does not constitute
full event sourcing: the business tables keep their current state. Each mutation and its
event are nevertheless written in the same transaction.

An event has a global sequence, a type, the entity mainly concerned, its
source, its author and its date. It can be explicitly correlated to a Spec, to its exact
revision, to a Session, to a mission and to a phase. These correlations are indexed
columns when they serve product reads; they are not hidden only
in a JSON payload.

The `Journal` page of a Spec is a paginated projection of all the `domain_events` carrying
its `spec_id`. It can thus bring together the framing, the design, the decomposition, the move
to `ready`, the build, the findings, the review and the documentation, while showing for each
entry its Session and its phase of origin. The same journal can also be projected per Session
or at a more global level. The detailed technical outputs of providers and runtimes
are not mixed into it.

## Current boundaries

The following directions have been ruled out:

- replacing the multi-session sidebar with a navigation centred on Specs;
- hiding all the work of a Spec behind four fixed internal spaces;
- launching a `build` mission without a linked Spec;
- using the size or urgency of a piece of work as a Spec type;
- treating the structure of the previous product as an obligation for Hemera;
- exposing ACP technical notions as the main navigation model.
