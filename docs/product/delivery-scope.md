# Périmètre de livraison d'Hemera

**Dernière mise à jour :** 2026-09-12

Le [noyau produit](./core.md) décrit les règles validées du produit cible. Ce document
distingue leur disponibilité à la première livraison des évolutions ultérieures. Il ne fixe
ni calendrier ni numéro de version mineure et ne constitue pas encore un plan de développement.

Le détail par capacité, les critères d'acceptation et les affectations proposées vivent dans
des matrices par version, hors de ce document. Les numéros de versions ultérieures et les lignes proposées
restent à valider ; les reports actés ici continuent de faire autorité.

## Première livraison — blocs retenus

- Système de Sessions : `free`, `define`, `build` et leur fonctionnement avec les agents ACP.
- Windows et Linux dès le premier socle ; Claude Code, Codex et OpenCode visés en v1,
  avec vérification distincte des capacités par provider et plateforme.
- Terminal interactif intégré en v1, distinct des commandes managées et rattaché à un Workspace.
- Gestion des Specs et de leur contrat révisionné.
- Intégration MCP Hemera et contexte permettant aux agents d'utiliser ses outils.
- Gestion des Projets et Workspaces, avec préparation d'environnement par Hemera.
- Gestion multi-repo.
- Workflow multi-phase : dépendances, phases déléguées et parallélisme font partie du socle.
- Intégration Git : les usages Git du noyau ne sont pas reportés avec les intégrations de PR.
  Le détail des opérations et des écrans Git reste à préciser. Le fonctionnement sans Git
  reste possible, sans code review fondée sur un diff.

Les tâches, retours, commandes, validations humaines, contexte, persistance et Journal sont
décrits dans le noyau. Leur découpage de réalisation et le niveau exact de finition à livrer
restent à préciser avec les blocs ci-dessus.

## Prototype — phase prévue, fonctionnalité indisponible

La phase `prototype` figure dans la définition du protocole dès la première livraison, avec
ses dépendances et sa possibilité de travail délégué en parallèle. Le moteur doit prendre en
charge ces mécanismes dès ce socle, même si le prototype utilisateur arrive ultérieurement.

Cette phase ne peut pas être déclenchée dans la première livraison, ni par l'utilisateur ni
par l'agent. Elle est indisponible, et non une exécution suspendue à reprendre. Les instructions
ne proposent pas son lancement. Elle ne bloque pas le passage de la Spec à `ready` et ne
nécessite ni faux résultat ni validation humaine de pages inexistantes.

La création, l'affichage, les variantes et la validation du prototype natif sont reportés.
Leur contrat cible reste conservé dans le noyau, sans imposer de réaliser maintenant tout
leur modèle de stockage ou leur interface.

## Évolutions ultérieures

- Prototype natif : activation de la phase et fonctionnalités correspondantes.
- Intégrations de pull requests : création, suivi, actions sur les PR et constat du merge
  depuis la forge. Les règles produit déjà validées restent la cible, pas une capacité initiale.
- Mémoire durable native : usages et utilité à évaluer avant de choisir son fonctionnement.

Sans intégration de PR à la première livraison, Hemera ne suppose pas connaître leur état ni
leur merge. La livraison repose sur la confirmation explicite de l'utilisateur ; la clôture
de la Spec et la fermeture ou le nettoyage du Workspace restent soumis aux actions humaines
définies dans le noyau. Git local n'est pas assimilé à une intégration de forge.
