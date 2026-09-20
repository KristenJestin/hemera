# Hemera — Spec map of the first delivery

Date: 2026-09-13 (replaces the map of 12 September). Hemera's v1 corresponds to delivery
**3.0** of the version index.

## Organisation

The umbrella change `hemera-v1` was split on 13 September into **eight OpenSpec changes,
one per development lot**. Each lot delivers an observable result and its tests; the lots
are construction steps, not a reduction of the v1 scope. The former change was
archived with its audit notes; it is no longer the source of the tasks.

| Lot | Change | Observable result | State |
|---|---|---|---|
| 1 | `lot-1-demarrage` | Bun/Turborepo monorepo, separate fork, Windows/Linux packages, native window, SQLite Profile, Project/main and free Session persisted across restart. | Specified (proposal, specs, design, tasks). |
| 2 | `lot-2-conversation` | Durable ACP Sessions with Claude Code, Codex and OpenCode, capabilities provided by Hemera, compiled MCP, interruption and resumption. | Draft proposal. |
| 3 | `lot-3-spec-ready` | Free → define, human/agent editing, shape/plan/decompose phases, atomic clone, ready gate. | Draft proposal. |
| 4 | `lot-4-workspaces` | Multi-repo, resumable preparation, command catalogue, services and URLs, local Git. | Draft proposal. |
| 5 | `lot-5-terminal` | Interactive terminal in the Workspace on both platforms. | Draft proposal. |
| 6 | `lot-6-build` | First build on a frozen contract, tasks/dependencies, workers, proofs, interruption without replay. | Draft proposal. |
| 7 | `lot-7-review-livraison` | Documentation, reviewers, grouped feedback, corrections, acceptance, delivery, closure. | Draft proposal. |
| 8 | `lot-8-qualification` | Cleanup, backup/restore, 3 providers × 2 OS matrix, journeys and documented limits. | Draft proposal. |

A draft lot has only its proposal: targeted result, planned capabilities, rules
already settled to take up in its specs and questions to decide before writing them. Its specs,
its design and its tasks are written when the previous lot is under way and its questions
are decided. The durable specs are filled in when each lot is archived.

The core and the [decisions of 13 September](../decisions/decisions-2026-09-13.md) remain the reference. The
requirements stemming from **P** rows of the register constitute a proposal to arbitrate; their
normative wording does not amount to user validation.

## Coverage per capability and per lot

| Capability | Object | Carrying lots | Rows of delivery 3.0 |
|---|---|---|---|
| application-foundation | Two repositories, monorepo, fork, Profile, single instance, portable packages, i18n | 1, 8 | APP01, SET01, SET02 |
| project-workspaces | Project/main, configuration in the database, multi-repo, preparation, leases | 1, 4, 8 | E01–E08 |
| sessions | Free/define/build, archiving, linking, navigation | 1, 2, 3, 6 | S01, S02, S03, S04, S08, S09 |
| domain-journal | State + event, sequence, correlations, attachments, retention | 1, 2, 3, 8 | J01, J02 |
| agent-runtime | ACP, three providers, supervision, pool, resumption | 2, 6, 8 | S05, S06, S07 |
| agent-context | Instructions, sources, updates, targeted context | 2, 3, 7 | C01–C04, SP08, S09 |
| hemera-mcp | Local transport, filtered catalogue, idempotence, backend checks | 2, 3, 4, 6, 8 | M01, M02 |
| spec-management | Contract, `PREFIXE-n` key, types, stories, revisions, questions | 3, 6 | SP01–SP07 |
| mission-workflows | Pinned protocols, phases, invalidation, inbox, ready gate | 3, 6, 7 | W01–W07 |
| managed-commands | Catalogue, definitions with OS variants, instances, ports/URLs | 4, 8 | CMD01, CMD02, CMD03 |
| interactive-terminal | Terminal integrated into the Workspace (capability distinct from commands) | 5, 8 | TERM01 |
| build-execution | Tasks, orchestration, proofs, corrections, documentation | 6, 7 | B01, B02, B03, B05, B07, B08, B09 |
| git-review | Local Git, reviewers, rounds, human feedback, without Git | 4, 7 | G01, G02, G03, B04, B06 |
| human-control | Human decisions, Project policy, delivery, cleanup | 3, 7, 8 | H01, H02, H03, B10 |

All rows of delivery 3.0 have at least one carrying capability and lot.
Coverage attests the presence of a proposed contract, not a proof of realisation.

## Arbitrations kept

**A01 to A22** remain tracked in the common register of remaining decisions,
updated with the decisions of 13 September. The questions still open are recorded in
the proposal of the lot that must decide them.

The prototype is **declared but unavailable** in v1; dependencies and parallelism
are really required. PRs, durable memory and external MCP servers are outside this delivery.

## State of the capture

- Lot 1: four artefacts written and validated by `openspec validate --strict`.
- Lots 2 to 8: proposal only; `openspec status` shows them as incomplete as long as specs,
  design and tasks are not written.
- No implementation task accomplished and no capability presented as delivered; no spike
  rerun during this writing.
