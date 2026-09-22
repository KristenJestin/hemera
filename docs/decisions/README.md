# Decisions

The dated decisions that, together with [`core.md`](../product/core.md), make up the product
truth. A decision taken here prevails over any older document that says otherwise; the older
one is not rewritten, it is dated and pointed back here.

| Date | File | Covers |
|---|---|---|
| 2026-09-22 | [`decisions-2026-09-22-motion.md`](./decisions-2026-09-22-motion.md) | Motion goes where the UX needs it; replaces D0-06 compositor-only rule with the preset named kinds |
| 2026-09-15 | [`decisions-2026-09-15.md`](./decisions-2026-09-15.md) | Abandoning GPUiX and Bun, Electron 44 + Node + pnpm + Vite+ foundation, Drizzle 1.0 on `node:sqlite`, Effect from lot 3 on, Base UI + motion design system, re-splitting into lots 0 to 11 |
| 2026-09-13 | [`decisions-2026-09-13.md`](./decisions-2026-09-13.md) | Project restart: Session-first, shell layout, lots of the GPUiX era |
| 2026-09-12 | [`decisions-architecture-acp-2.md`](./decisions-architecture-acp-2.md) | Multi-agent chat architecture with ACP |

## How to write a decision

A decision that contradicts an older document prevails. The older one is not rewritten: a
dated page is written here, `decisions-<date>.md` or `decisions-<date>-<subject>.md`, stating
what is decided, why, and the alternative set aside, and it cites the issue that triggered it.
Decisions specific to a lot (`D<lot>-01`...) stay in the Design section of its issue; only
those that cross lots go here.
