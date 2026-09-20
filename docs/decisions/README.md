# Décisions

Les décisions datées qui font la vérité du produit avec [`core.md`](../product/core.md). Une
décision prise ici prévaut sur tout document plus ancien qui dirait le contraire ; on ne réécrit
pas l'ancien, on le date et on le renvoie ici.

| Date | Fichier | Porte sur |
|---|---|---|
| 2026-09-15 | [`decisions-2026-09-15.md`](./decisions-2026-09-15.md) | Abandon de GPUiX et de Bun, socle Electron 44 + Node + pnpm + Vite+, Drizzle 1.0 sur `node:sqlite`, Effect dès le lot 3, design system Base UI + motion, redécoupage en lots 0 à 11 |
| 2026-09-13 | [`decisions-2026-09-13.md`](./decisions-2026-09-13.md) | Reprise du projet : Session-first, disposition de la coquille, lots de l'ère GPUiX |
| 2026-09-12 | [`decisions-architecture-acp-2.md`](./decisions-architecture-acp-2.md) | Architecture du chat multi-agents avec ACP |

## Comment écrire une décision

Une décision qui contredit un document plus ancien prévaut. On ne réécrit pas l'ancien : on
écrit une page datée ici, `decisions-<date>.md` ou `decisions-<date>-<sujet>.md`, qui dit ce qui
est décidé, pourquoi, et l'alternative écartée, et on cite l'issue qui l'a déclenchée. Les
décisions propres à un lot (`D<lot>-01`…) restent dans la section Design de son issue ; ici ne
vont que celles qui traversent les lots.
