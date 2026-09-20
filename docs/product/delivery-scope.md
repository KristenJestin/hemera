# Hemera delivery scope

**Last updated:** 2026-09-12

The [product core](./core.md) describes the validated rules of the target product. This document
distinguishes their availability in the first delivery from later evolutions. It fixes
neither a calendar nor a minor version number and does not yet constitute a development plan.

The detail per capability, the acceptance criteria and the proposed assignments live in
matrices per version, outside this document. The numbers of later versions and the proposed rows
remain to be validated; the postponements settled here continue to be authoritative.

## First delivery — retained blocks

- Session system: `free`, `define`, `build` and how they work with ACP agents.
- Windows and Linux from the first foundation; Claude Code, Codex and OpenCode targeted in v1,
  with distinct verification of capabilities per provider and platform.
- Integrated interactive terminal in v1, distinct from managed commands and attached to a Workspace.
- Management of Specs and their revisioned contract.
- Hemera MCP integration and context allowing agents to use its tools.
- Management of Projects and Workspaces, with environment preparation by Hemera.
- Multi-repo management.
- Multi-phase workflow: dependencies, delegated phases and parallelism are part of the foundation.
- Git integration: the core's Git uses are not postponed along with the PR integrations.
  The detail of Git operations and screens remains to be specified. Working without Git
  remains possible, without diff-based code review.

Tasks, feedback, commands, human validations, context, persistence and Journal are
described in the core. Their realisation breakdown and the exact level of finish to deliver
remain to be specified along with the blocks above.

## Prototype — planned phase, unavailable feature

The `prototype` phase appears in the protocol definition from the first delivery, with
its dependencies and its possibility of delegated work in parallel. The engine must support
these mechanisms from this foundation on, even if the user prototype arrives later.

This phase cannot be triggered in the first delivery, neither by the user nor
by the agent. It is unavailable, not a suspended execution to resume. The instructions
do not propose launching it. It does not block the Spec's move to `ready` and
requires neither a fake result nor human validation of non-existent pages.

The creation, display, variants and validation of the native prototype are postponed.
Their target contract remains kept in the core, without requiring all of
their storage model or their interface to be realised now.

## Later evolutions

- Native prototype: activation of the phase and corresponding features.
- Pull request integrations: creation, tracking, actions on PRs and observation of the merge
  from the forge. The product rules already validated remain the target, not an initial capability.
- Native durable memory: uses and usefulness to evaluate before choosing how it works.

Without PR integration in the first delivery, Hemera does not assume it knows their state or
their merge. Delivery relies on the user's explicit confirmation; the closure
of the Spec and the closing or cleanup of the Workspace remain subject to the human actions
defined in the core. Local Git is not equated with a forge integration.
