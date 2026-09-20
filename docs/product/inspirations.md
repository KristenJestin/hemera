# Product inspirations for Hemera

**Status:** corpus to study, not product decisions  
**Last updated:** 2026-09-11

This document keeps the products, methods and implementations useful to thinking about
Hemera. Their presence here does not mean that their model must be taken up as is. The decisions
retained are recorded in [`core.md`](./core.md).

## OpenSpec

- Site: [openspec.dev](https://openspec.dev/)
- Repository: [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)
- Positioning: lightweight, configurable Spec-driven development framework.
- Journey presented: explore the problem and the code, propose the Spec and its artefacts,
  implement, verify the implementation against the Spec, then archive the change.
- Interest for Hemera: compare the separation between exploration, definition, planning,
  execution and verification, as well as the handling of a change once finished.

## OpenSpec Plus

- Repository: [sudokar/openspec-plus](https://github.com/sudokar/openspec-plus)
- Positioning: set of skills that strengthens OpenSpec without replacing its workflow.
- Interesting elements: structured discovery before the solution, requirements accompanied by
  testable acceptance scenarios, exploration of technical alternatives with human
  arbitration, tasks organised into verifiable vertical slices and checking of the implementation
  against the Spec.
- Interest for Hemera: feed the instructions and exit criteria of the `shape`, `plan` and
  `decompose` phases, then the `build` mission and its internal review, without importing their file breakdown
  or their engine as is.

## Assisted code reviews

### GitHub Copilot code review

- Documentation: [About Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
  and [Using Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review).
- Interesting elements: repository-wide instructions, instructions activated by path,
  conventions shared in `AGENTS.md`, specialised review skills and assignable MCP context.
- Interest for Hemera: compose the reviewers' context from the rules actually applicable to the
  modified files, without passing them the build's reasoning history.

### Graphite Agent

- Documentation: [AI Reviews](https://graphite.com/docs/ai-reviews) and
  [Customization](https://graphite.com/docs/ai-review-customization).
- Interesting elements: rules targeted at a single concern, exclusions to reduce
  noise, rules from repository files, activation filtered by paths or metadata and measurement
  of the real usefulness of remarks.
- Interest for Hemera: select the specialities useful to the change and the project, then avoid
  launching reviewers whose domain does not apply.

## End of a change

### OpenSpec


- Documentation: [Quickstart](https://openspec.dev/docs/quickstart) and
  [CLI archive](https://openspec.dev/docs/cli#openspec-archive).
- How it works: once the tasks are finished, an explicit operation archives the change and
  synchronises its requirements into the main Specs. Git remains a separate concern; the
  timing of the archive relative to the PR is a matter of team convention.
- Interest for Hemera: distinguish acceptance of the result, its actual delivery and the archiving of its
  working space.

### GitHub and GitLab

- Documentation: [automatic closing of GitHub issues](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-auto-closing-issues),
  [automatic deletion of GitHub branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)
  and [creating GitLab merge requests](https://docs.gitlab.com/user/project/merge_requests/creating_merge_requests/).
- How it works: a linked issue or task can close on merge, while the source
  branch can be deleted separately according to the repository's configuration.
- Interest for Hemera: use the merge as a delivery signal when it exists, without confusing
  that transition with the user's prior approval.

### GitHub Spec Kit

- References: [Spec persistence](https://github.com/github/spec-kit/blob/main/docs/concepts/spec-persistence.md)
  and [discussion on the end of a branch](https://github.com/github/spec-kit/discussions/4002).
- Observed behaviour: Spec Kit documents several strategies for keeping artefacts,
  but does not yet provide a universal cycle that automatically merges, closes and cleans up a
  feature branch.
- Interest for Hemera: handle the end of delivery explicitly instead of letting the workflow
  stop after the implementation.

## Devflow — environment preparation

- Source: [leoleducq/devflow](https://github.com/leoleducq/devflow).
- The README describes preparing a worktree with ports, `.env`, dependencies, initialised
  Postgres and development services. It distinguishes LITE and FULL environments and
  separates releasing the services from deleting the checkout.
- Lead for Hemera: separate the preparation of the code from that of the services, according to the
  Project's configuration. Assembling several worktrees of distinct repositories in a Workspace is an
  adaptation proposed for Hemera, not a multi-repo capability established by that README.
- Design reference; no adoption of the tool or its technical scope is settled.

## Portless — URLs of local environments

- Sources: [portless.sh](https://portless.sh/) and
  [configuration](https://portless.sh/configuration).
- Portless assigns ports to applications and exposes them through a proxy under named local
  URLs, with HTTPS and worktree detection to prefix the names.
- Lead for Hemera: expose distinct, stable URLs per application and per Workspace,
  and configure the front to reach the API of the same environment. Isolation of data
  and other resources remains a complementary preparation responsibility.
- The choice of integrating Portless or another implementation remains open.

## Previous product — managed commands

- The previous product defines commands at the Project level, with instances per Workspace. The
  runtime provides start, stop, restart, output and result; agents have the
  corresponding MCP tools. Groups allow actions on several commands.
- Base to take up for Hemera: the same commands configured for the user and the agents,
  executed in the Workspace's environment. Launching applications and checks
  can rely on this mechanism.
- To design: articulation with environment preparation, port assignment,
  Portless system option, one-off or persistent commands and scope of groups.

## Mnemon — durable memory, later lead

- Source: [mnemon-dev/mnemon](https://github.com/mnemon-dev/mnemon).
- The README presents a persistent cross-Session memory: the LLM decides what to retain and
  link, while the tool handles storage and search of the knowledge.
- The maintainer currently uses it, but finds its usefulness hard to evaluate. This
  experience feedback does not constitute a validation of its integration into Hemera.
- Hemera's native memory is postponed to a later minor version. Reading old
  Specs via MCP or saving Sessions does not constitute this feature.

## Other references already used

- Hemera spikes — technical consolidation: GPUiX/ACP, persistence, terminal and prototype
  experiments from the technical spikes. Detailed reservations
  in the report; no new test and no implicit product
  validation. The prototype trials remain a lead for the later delivery.

- The previous versions of the product, as product and technical lessons learned.
- GitHub Spec Kit, for the separation between intention, plan and tasks as well as the verifiable
  contracts.
- Matt Pocock's skills, in particular `grill-me`, `to-spec`, `to-tickets` and `triage`, for
  progressive discovery and the preparation of work that can be handed to an agent.
- An earlier experiment of the maintainer and its PRDs, for structuring missions and their execution.
