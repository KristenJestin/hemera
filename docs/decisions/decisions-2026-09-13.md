# Décisions de la reprise du 13 septembre 2026

**Nom de code du projet :** Hemera
**Statut :** décisions du mainteneur prises pendant la relecture complète des Specs de la v1.
Elles complètent [`core.md`](../product/core.md) et prévalent sur les propositions antérieures
du design technique lorsqu'elles les contredisent. Les hypothèses de travail sont
signalées comme telles ; elles ne sont pas des décisions.

## Organisation des Specs

- Le changement chapeau de la v1 est découpé : **un changement par lot de
  développement** (lot 1 à lot 8). Le lot 1 est entièrement spécifié
  (proposal, specs, design, tasks). Les lots 2 à 8 ne possèdent qu'une proposition qui
  consigne les règles déjà acquises et les questions à trancher ; ils restent des
  brouillons tant que leurs specs et tâches ne sont pas rédigées.
- L'ancien changement est conservé en archive comme référence de rédaction ; il n'est plus
  la source des tâches.

## Décisions produit

| Sujet | Décision |
|---|---|
| Langue de l'interface | Anglais seul en v1 ; chaînes externalisées dès le socle (i18n prêt), une seule locale livrée. Les briefs de protocole destinés aux agents sont en anglais. |
| Configuration du Projet | Vit dans la base SQLite du profil (Drizzle) et s'édite dans l'interface. Aucun fichier de configuration écrit dans les dépôts de l'utilisateur. |
| Clé humaine d'une Spec | `PREFIXE-n` : préfixe court configuré sur le Projet, numéro alloué par compteur transactionnel du Projet. Exemple `SPEC-42`. |
| Fin de vie | Une Session peut être **archivée** (masquée de la sidebar, restaurable, rien n'est supprimé). Aucune suppression de Session, de Spec ou de Projet en v1 ; au-delà de `draft`, seule l'annulation existe. |
| Ordre des phases `build` | `prepare → execute → documentation → verify → review (agents) → review humaine`. `core.md` (review avant verify) est corrigé dans ce sens. |
| Outils des agents | Aucun outil natif du provider n'est chargé (mode « nu ») : Hemera fournit lui-même les capacités de travail (fichiers, shell, recherche, opérations métier) via le serveur MCP Hemera ou un mécanisme équivalent selon le provider. Le mode nu n'existe nativement que chez Claude ; les choix communs aux trois providers sont à fixer au lot 2. |
| Permissions en `build` | Lecture, écriture et commandes **à l'intérieur de la racine du Workspace** sont auto-approuvées ; tout ce qui en sort (autre chemin, réseau, suppression massive) demande une décision humaine. Défaut au Projet, override par Session `build`. |
| Modèles des agents | Un modèle par **rôle d'agent** (principal define, principal build, worker, reviewer, …), configurable au Projet et modifiable au lancement. Hypothèse : les sous-agents utilisent le provider du principal. |
| Serveurs MCP externes | Reportés après la v1. Seul le serveur MCP Hemera est fourni. |
| Branche d'un Workspace dédié | Nouvelle branche `<prefixe>/<clé>-<slug>` (ex. `hemera/SPEC-42-login-form`) créée depuis le HEAD local de `main` pour chaque dépôt ; préfixe et référence de base configurables au Projet ; aucune opération réseau implicite. |
| Commits dans les Workspaces des utilisateurs | Réglages utilisateur (quand et si l'agent commit). **Non tranché** ; traité au lot 7, avec pour défaut naturel les règles du dépôt Hemera ci-dessous. |
| Dépôt de code Hemera | Git flow sans branche de release : `main`, `dev`, `feature/*` (et `hotfix/*`). Un agent committe librement et proprement sur `feature/*`, jamais sur `main` ni `dev`. Commits en convention Angular. `CLAUDE.md` et `AGENTS.md` à la racine du dépôt. |
| Outillage | oxlint et oxfmt pour le lint et le formatage. Vite+ examiné : Bun est supporté comme gestionnaire de paquets (PR #1005, mars 2026) mais « runtime support is not planned » ; nos scripts dev/test/build tournent sous Bun (`bun:sqlite`, `bun build --compile`, PTY), donc `vp run` n'est pas retenu pour le socle. Turborepo conservé, à réévaluer si le runtime Bun est supporté un jour. |
| Canaux `prod`/`dev` | L'application est installée en `prod` sur le poste de développement ; le mode dev et les paquets `dev` utilisent un profil séparé (base, verrou, préférences). Les deux tournent en parallèle sans se voir. |
| Migrations | Une migration versionnée, forward-only et cumulative par lot qui modifie le schéma, applicable à un profil installé de la version précédente, avec copie de sauvegarde préalable et test de migration depuis une fixture de la version précédente. |
| Tests | Chaque scénario de spec a un test nommé d'après lui, avec table de traçabilité obligatoire ; injection d'échecs, tests de propriétés, tests de frontières, pas de test flou. |
| Boucle de review | **Une seule passe** de correction automatique après les reviewers, puis review humaine. Le nombre et les profils des reviewers spécialisés restent à déterminer au lot 7. |
| Build après arrêt | Un build arrêté par l'utilisateur ou devenu obsolète est clos et reste consultable ; un nouveau build peut être lancé sur la même révision dans une nouvelle Session, les preuves précédentes restant visibles mais à reconfirmer sur l'état réel. |

## Hypothèses de travail (à confirmer)

- Un seul Projet actif à la fois dans la fenêtre, avec un sélecteur de Projet. Le mainteneur
  n'a pas encore tranché ; le lot 1 part de cette hypothèse minimale.
- Un seul utilisateur local, acteur humain implicite ; les événements portent un auteur
  extensible sans modèle de comptes.

## Questions reportées aux lots concernés

- Lot 2 : équivalents du mode nu chez Codex et OpenCode ; capacités ACP réelles ; contenu
  exact des outils fournis par Hemera ; pièces jointes/images dans le chat.
- Lot 3 : relations entre Specs (liée/bloque) ; état des bilans de phases après
  « Retravailler » ; réouverture d'une phase (nouvelle instance ou remise à zéro).
- Lot 4 : emplacement physique des Workspaces dédiés ; ports/URLs/Portless ; import de
  scripts vers le catalogue.
- Lot 6 : borne de parallélisme des workers ; régression de l'environnement pendant un build.
- Lot 7 : commits ; profils et nombre de reviewers ; acceptation sans Git ; suite d'une round
  périmée par modification externe.
- Lot 8 : notifications OS ; sauvegarde/restauration détaillée ; matrice finale.
