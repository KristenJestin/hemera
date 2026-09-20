# Inspirations produit pour Hemera

**Statut :** corpus à étudier, pas décisions produit  
**Dernière mise à jour :** 2026-09-11

Ce document conserve les produits, méthodes et implémentations utiles à la réflexion sur
Hemera. Leur présence ici ne signifie pas que leur modèle doit être repris tel quel. Les décisions
retenues sont consignées dans [`core.md`](./core.md).

## OpenSpec

- Site : [openspec.dev](https://openspec.dev/)
- Dépôt : [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)
- Positionnement : framework léger et configurable de développement piloté par les Specs.
- Parcours présenté : explorer le problème et le code, proposer la Spec et ses artefacts,
  implémenter, vérifier l'implémentation contre la Spec, puis archiver le changement.
- Intérêt pour Hemera : comparer la séparation entre exploration, définition, planification,
  exécution et vérification, ainsi que le traitement d'un changement une fois terminé.

## OpenSpec Plus

- Dépôt : [sudokar/openspec-plus](https://github.com/sudokar/openspec-plus)
- Positionnement : ensemble de skills qui renforce OpenSpec sans remplacer son workflow.
- Éléments intéressants : découverte structurée avant la solution, exigences accompagnées de
  scénarios d'acceptation testables, exploration d'alternatives techniques avec arbitrage
  humain, tâches organisées en tranches verticales vérifiables et contrôle de l'implémentation
  contre la Spec.
- Intérêt pour Hemera : nourrir les instructions et critères de sortie des phases `shape`, `plan`,
  `decompose`, puis la mission `build` et sa revue interne, sans importer leur découpage de fichiers
  ni leur moteur tel quel.

## Revues de code assistées

### GitHub Copilot code review

- Documentation : [About Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
  et [Using Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review).
- Éléments intéressants : instructions globales au dépôt, instructions activées selon les chemins,
  conventions partagées dans `AGENTS.md`, skills de revue spécialisés et contexte MCP attribuable.
- Intérêt pour Hemera : composer le contexte des reviewers depuis les règles réellement applicables aux
  fichiers modifiés, sans leur transmettre l'historique de raisonnement du build.

### Graphite Agent

- Documentation : [AI Reviews](https://graphite.com/docs/ai-reviews) et
  [Customization](https://graphite.com/docs/ai-review-customization).
- Éléments intéressants : règles ciblées sur une seule préoccupation, exclusions pour réduire le
  bruit, règles issues de fichiers du dépôt, activation filtrée par chemins ou métadonnées et mesure
  de l'utilité réelle des remarques.
- Intérêt pour Hemera : sélectionner les spécialités utiles au changement et au projet, puis éviter de
  lancer des reviewers dont le domaine ne s'applique pas.

## Fin d'un changement

### OpenSpec


- Documentation : [Quickstart](https://openspec.dev/docs/quickstart) et
  [CLI archive](https://openspec.dev/docs/cli#openspec-archive).
- Fonctionnement : une fois les tâches terminées, une opération explicite archive le changement et
  synchronise ses exigences dans les Specs principales. Git reste une préoccupation séparée ; le
  moment de l'archive par rapport à la PR relève d'une convention d'équipe.
- Intérêt pour Hemera : distinguer l'acceptation du résultat, sa livraison réelle et l'archivage de son
  espace de travail.

### GitHub et GitLab

- Documentation : [fermeture automatique des issues GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-auto-closing-issues),
  [suppression automatique des branches GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)
  et [création des merge requests GitLab](https://docs.gitlab.com/user/project/merge_requests/creating_merge_requests/).
- Fonctionnement : une issue ou tâche liée peut se fermer lors du merge, tandis que la branche
  source peut être supprimée séparément selon la configuration du dépôt.
- Intérêt pour Hemera : utiliser le merge comme signal de livraison lorsqu'il existe, sans confondre
  cette transition avec l'approbation préalable de l'utilisateur.

### GitHub Spec Kit

- Références : [persistance des Specs](https://github.com/github/spec-kit/blob/main/docs/concepts/spec-persistence.md)
  et [discussion sur la fin d'une branche](https://github.com/github/spec-kit/discussions/4002).
- Fonctionnement observé : Spec Kit documente plusieurs stratégies de conservation des artefacts,
  mais ne fournit pas encore un cycle universel qui fusionne, clôt et nettoie automatiquement une
  feature branch.
- Intérêt pour Hemera : traiter explicitement la fin de livraison au lieu de laisser le workflow
  s'arrêter après l'implémentation.

## Devflow — préparation des environnements

- Source : [leoleducq/devflow](https://github.com/leoleducq/devflow).
- Le README décrit la préparation d'un worktree avec ports, `.env`, dépendances, Postgres
  initialisé et services de développement. Il distingue les environnements LITE et FULL et
  sépare la libération des services de la suppression du checkout.
- Piste pour Hemera : séparer la préparation du code de celle des services, selon la configuration
  du Projet. Assembler plusieurs worktrees de dépôts distincts dans un Workspace est une
  adaptation proposée pour Hemera, pas une capacité multi-repo établie par ce README.
- Référence de conception ; aucune adoption de l'outil ni de son périmètre technique n'est actée.

## Portless — URLs des environnements locaux

- Sources : [portless.sh](https://portless.sh/) et
  [configuration](https://portless.sh/configuration).
- Portless attribue des ports aux applications et les expose par un proxy sous des URLs
  locales nommées, avec HTTPS et détection des worktrees pour préfixer les noms.
- Piste pour Hemera : exposer des URLs distinctes et stables par application et par Workspace,
  et configurer le front pour joindre l'API du même environnement. L'isolation des données
  et des autres ressources reste une responsabilité complémentaire de préparation.
- Le choix d'intégrer Portless ou une autre implémentation reste ouvert.

## Produit précédent — commandes managées

- Le produit précédent définit les commandes au niveau du Projet, avec des instances par Workspace. Le
  runtime fournit démarrage, arrêt, relance, sortie et résultat ; les agents disposent des
  outils MCP correspondants. Les groupes permettent des actions sur plusieurs commandes.
- Socle à reprendre pour Hemera : mêmes commandes configurées pour l'utilisateur et les agents,
  exécutées dans l'environnement du Workspace. Le lancement des applications et les checks
  peuvent s'appuyer sur ce mécanisme.
- À concevoir : articulation avec la préparation d'environnement, attribution des ports,
  option système Portless, commandes ponctuelles ou persistantes et portée des groupes.

## Mnemon — mémoire durable, piste ultérieure

- Source : [mnemon-dev/mnemon](https://github.com/mnemon-dev/mnemon).
- Le README présente une mémoire persistante inter-Sessions : le LLM décide quoi retenir et
  relier, tandis que l'outil assure le stockage et la recherche des connaissances.
- Le mainteneur l'emploie actuellement, mais juge son utilité difficile à évaluer. Ce retour
  d'expérience ne constitue pas une validation de son intégration dans Hemera.
- La mémoire native d'Hemera est reportée à une version mineure ultérieure. Lire les anciennes
  Specs via MCP ou sauvegarder les Sessions ne constitue pas cette fonctionnalité.

## Autres références déjà utilisées

- Spikes Hemera — rapprochement technique : expériences
  GPUiX/ACP, persistance, terminal et prototype issues des spikes techniques. Réserves
  détaillées dans le rapport ; pas de nouveau test ni de validation
  produit implicite. Les essais de prototype restent une piste pour la livraison ultérieure.

- Les versions précédentes du produit, comme retours d'expérience produit et technique.
- GitHub Spec Kit, pour la séparation entre intention, plan et tâches ainsi que les contrats
  vérifiables.
- Les skills de Matt Pocock, notamment `grill-me`, `to-spec`, `to-tickets` et `triage`, pour la
  découverte progressive et la préparation d'un travail transmissible à un agent.
- Une expérience antérieure du mainteneur et ses PRD, pour la structuration des missions et de leur exécution.
