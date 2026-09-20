# Hemera — carte des Specs de la première livraison

Date : 2026-09-13 (remplace la carte du 12 septembre). La v1 d'Hemera correspond à la livraison
**3.0** de l'index des versions.

## Organisation

Le changement chapeau `hemera-v1` a été découpé le 13 septembre en **huit changements OpenSpec,
un par lot de développement**. Chaque lot livre un résultat observable et ses tests ; les lots
sont des étapes de construction, pas une réduction du périmètre v1. L'ancien changement a été
archivé avec ses notes d'audit ; il n'est plus la source des tâches.

| Lot | Changement | Résultat observable | État |
|---|---|---|---|
| 1 | `lot-1-demarrage` | Monorepo Bun/Turborepo, fork séparé, paquets Windows/Linux, fenêtre native, profil SQLite, Projet/main et Session free persistés après redémarrage. | Spécifié (proposal, specs, design, tasks). |
| 2 | `lot-2-conversation` | Sessions ACP durables avec Claude Code, Codex et OpenCode, capacités fournies par Hemera, MCP compilé, interruption et reprise. | Proposition en brouillon. |
| 3 | `lot-3-spec-ready` | Free → define, édition humaine/agent, phases shape/plan/decompose, clone atomique, gate ready. | Proposition en brouillon. |
| 4 | `lot-4-workspaces` | Multi-repo, préparation reprenable, catalogue de commandes, services et URLs, Git local. | Proposition en brouillon. |
| 5 | `lot-5-terminal` | Terminal interactif dans le Workspace sur les deux plateformes. | Proposition en brouillon. |
| 6 | `lot-6-build` | Premier build sur contrat figé, tâches/dépendances, workers, preuves, interruption sans replay. | Proposition en brouillon. |
| 7 | `lot-7-review-livraison` | Documentation, reviewers, feedback groupé, corrections, acceptation, livraison, clôture. | Proposition en brouillon. |
| 8 | `lot-8-qualification` | Nettoyage, sauvegarde/restauration, matrice 3 providers × 2 OS, parcours et limites documentées. | Proposition en brouillon. |

Un lot en brouillon possède seulement sa proposition : résultat visé, capacités prévues, règles
déjà acquises à reprendre dans ses specs et questions à trancher avant leur rédaction. Ses specs,
son design et ses tâches sont rédigés lorsque le lot précédent est engagé et que ses questions
sont tranchées. Les specs durables se remplissent à l'archivage de chaque lot.

Le noyau et les [décisions du 13 septembre](../decisions/decisions-2026-09-13.md) restent la référence. Les
exigences issues de lignes **P** du registre constituent une proposition à arbitrer ; leur
formulation normative ne vaut pas validation utilisateur.

## Couverture par capacité et par lot

| Capacité | Objet | Lots porteurs | Lignes de la livraison 3.0 |
|---|---|---|---|
| application-foundation | Deux dépôts, monorepo, fork, profil, instance unique, paquets portables, i18n | 1, 8 | APP01, SET01, SET02 |
| project-workspaces | Projet/main, configuration en base, multi-repo, préparation, baux | 1, 4, 8 | E01–E08 |
| sessions | Free/define/build, archivage, rattachements, navigation | 1, 2, 3, 6 | S01, S02, S03, S04, S08, S09 |
| domain-journal | État + événement, séquence, corrélations, pièces jointes, rétention | 1, 2, 3, 8 | J01, J02 |
| agent-runtime | ACP, trois providers, supervision, pool, reprise | 2, 6, 8 | S05, S06, S07 |
| agent-context | Instructions, sources, mises à jour, contexte ciblé | 2, 3, 7 | C01–C04, SP08, S09 |
| hemera-mcp | Transport local, catalogue filtré, idempotence, contrôles backend | 2, 3, 4, 6, 8 | M01, M02 |
| spec-management | Contrat, clé `PREFIXE-n`, types, stories, révisions, questions | 3, 6 | SP01–SP07 |
| mission-workflows | Protocoles épinglés, phases, invalidation, boîte d'entrée, gate ready | 3, 6, 7 | W01–W07 |
| managed-commands | Catalogue, définitions avec variantes OS, instances, ports/URLs | 4, 8 | CMD01, CMD02, CMD03 |
| interactive-terminal | Terminal intégré au Workspace (capacité distincte des commandes) | 5, 8 | TERM01 |
| build-execution | Tâches, orchestration, preuves, corrections, documentation | 6, 7 | B01, B02, B03, B05, B07, B08, B09 |
| git-review | Git local, reviewers, rounds, retours humains, sans Git | 4, 7 | G01, G02, G03, B04, B06 |
| human-control | Décisions humaines, politique Projet, livraison, nettoyage | 3, 7, 8 | H01, H02, H03, B10 |

Toutes les lignes de la livraison 3.0 ont au moins une capacité et un lot porteurs.
La couverture atteste la présence d'un contrat proposé, pas une preuve de réalisation.

## Arbitrages conservés

Les **A01 à A22** restent suivis dans le registre commun des décisions restantes,
mis à jour avec les décisions du 13 septembre. Les questions encore ouvertes sont consignées dans
la proposition du lot qui doit les trancher.

Le prototype est **déclaré mais indisponible** dans la v1 ; les dépendances et le parallélisme
sont réellement requis. PR, mémoire durable et serveurs MCP externes sont hors de cette livraison.

## État de la capture

- Lot 1 : quatre artefacts rédigés et validés par `openspec validate --strict`.
- Lots 2 à 8 : proposition seule ; `openspec status` les affiche incomplets tant que specs,
  design et tâches ne sont pas rédigés.
- Aucune tâche d'implémentation accomplie ni capacité présentée comme livrée ; aucun spike
  relancé lors de cette rédaction.
