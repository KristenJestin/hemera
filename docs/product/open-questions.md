# Questions ouvertes du noyau produit

**Dernière mise à jour :** 2026-09-12

Ce document contient les décisions qui ne sont pas encore assez établies pour entrer dans
[`core.md`](./core.md).

## Priorités de travail proposées

Le noyau fixe déjà les principales entités, les missions, le contrat des révisions et les
validations humaines. Les éléments ci-dessous sont des pistes de travail, pas de nouvelles
décisions validées :

1. Préciser le découpage de réalisation des blocs retenus dans
   [`delivery-scope.md`](./delivery-scope.md). Prototype natif, intégrations de PR et mémoire
   durable sont reportés ; Git et le support des dépendances et du parallélisme sont inclus.
   Les matrices détaillées par version et leur registre anti-oubli commun sont des
   propositions à arbitrer, pas des validations.
2. Prototyper les interactions déjà retenues pour éprouver la navigation et les actions
   humaines, avant de figer leur présentation ou les détails de configuration.

Les questions de cette page mélangent encore choix produit et détails d'implémentation ; elles
ne nécessitent pas toutes une validation utilisateur individuelle avant de poursuivre.

## Socle technique — apports des spikes

Les expériences importées sont rapprochées dans le rapport technique de rapprochement des
spikes, sans les réexécuter.
Le [découpage v1](./spec-map-v1.md) traduit les besoins en scénarios ; il ne remplace
pas les arbitrages ci-dessous par une implémentation supposée prête.

- Les deux dépôts et leur reconstruction ont désormais une proposition dans le
  design du premier lot ; les remotes
  restent à renseigner lorsqu'une publication est nécessaire.
- Windows et Linux sont retenus dès le socle. Le conditionnement natif, les migrations et
  le serveur MCP compilé doivent être vérifiés sur chacun ; les mesures Linux ne prouvent pas Windows.
- Claude Code, Codex et OpenCode sont retenus. Quelles garanties ACP sont confirmées pour
  les versions de chacun ? Comment contrôler ses outils
  et ses sources personnelles tout en permettant les fichiers Projet explicitement choisis ?
- Le terminal interactif est retenu en v1 ; le minimum proposé dans la Spec doit être
  vérifié sur Windows/Linux, notamment sélection/copie/collage, scroll réel et interaction TUI.
- Quelles limites de presse-papiers, pièces jointes, focus/clavier et accessibilité faut-il
  résoudre pour le parcours livré ? Les propositions d'exclusion des spikes ne sont pas actées.

## Session

- Comment présenter dans le chat les appels d'outils, résultats et erreurs sans noyer la
  conversation ?
- Comment représenter une nouvelle passe de travail sans exposer inutilement les runs
  techniques ?
- Quand une activité de sous-agent mérite-t-elle de devenir une Session indépendante dans
  la sidebar ?
- Quelle partie d'une Session spécialisée est fournie à la nouvelle Session qu'elle lance
  pour poursuivre le travail avec une autre mission ?

## Contexte et reprise

- Quelles capacités de reprise native, de restitution de l'historique et de continuité du
  contexte sont disponibles par provider ACP ? La reprise native reste prioritaire ; les
  mécanismes de cache restent gérés par le provider.
- Quel contexte précis Hemera reconstruit-il pour la reprise de secours proposée à l'utilisateur
  lorsqu'une reprise ACP est impossible ? Comment vérifier les effets des tâches interrompues
  avant de continuer, sans les rejouer aveuglément ?
- Pour une reconstruction de secours uniquement, quelle part de l'historique sauvegardé est
  renvoyée au modèle, résumée, indexée ou seulement conservée pour l'utilisateur ?
- Comment articuler les instructions utilisateur du Projet avec les fichiers d'instructions
  déjà présents dans ses dépôts ? Leur utilisation comme sources sans copie est acquise ;
  restent la sélection, la portée, les conflits et les doublons avec la lecture native du provider.
- Quelles informations de contexte fournir initialement, rendre consultables via MCP ou
  actualiser pendant une Session, en préservant la continuité native du provider ?
- Comment livrer les mises à jour d'instructions du Projet selon les capacités de chaque
  provider ? Le principe est acquis : mise à jour ciblée à un point de reprise sûr pour les
  Sessions en cours, instructions actualisées dès le départ pour les nouvelles Sessions.

## Mémoire durable — version mineure ultérieure

La consultation des Specs existantes via MCP et la sauvegarde des Sessions ne constituent
pas cette fonctionnalité. Les questions suivantes sont différées et ne bloquent pas la première
livraison d'Hemera :

- Quels usages justifient une mémoire durable en complément des données déjà consultables ?
- Comment mesurer son utilité et détecter des souvenirs incorrects ou périmés ?
- Quelle portée, quelles sources et quelles règles d'alimentation ou de partage retenir ?
- Quel enseignement tirer de l'usage actuel de Mnemon par l'utilisateur, sans présumer de
  son adoption dans Hemera ?

## Spec

- Jusqu'à quel niveau relier tâches et preuves aux `UserStory` sans imposer une traçabilité
  artificielle aux petites Specs ?
- Quels détails de schéma et contrôles implémentent les contrats minimaux déjà définis pour
  `feature`, `bug` et `maintenance` ?
- Quels besoins futurs justifieraient réellement un type supplémentaire au-delà de
  `feature`, `bug` et `maintenance` ?
- Comment présenter l'édition manuelle du brouillon dans le panneau Spec et coordonner les
  modifications humaines avec celles de l'agent sans écrasement involontaire ?
- Comment attribuer et transférer l'écriture d'une Spec entre Sessions `define` dans la première
  version, puis gérer les conflits si plusieurs Sessions peuvent écrire simultanément plus tard ?
- Comment nommer et modéliser le mécanisme qui rejoue le scénario d'un bug après le `build`
  et conserve la preuve de sa correction ?
- Quels champs et relations précis complètent le socle déjà fixé pour `Prototype`, ses versions,
  leurs pages, leurs variantes, les rounds et les retours humains ?

## Projet et Workspace

- Comment représenter précisément les dossiers, dépôts, checkouts et worktrees d'un Projet
  et de ses Workspaces ?
- Comment préparer un Workspace multi-repo : choix des dépôts et branches, traitement des
  fichiers hors dépôts et modalités techniques de reprise après un échec partiel, sans
  recréer les ressources déjà préparées ? Le principe de conservation et de reprise est acquis.
- Quelles recettes de préparation des dépendances, ports, variables, données et services
  fournir au Projet, et quelles ressources préparer avant le lancement du build ou démarrer
  ensuite à la demande dans le Workspace déjà configuré ?
- Comment attribuer les URLs par application et Workspace, notamment en multi-repo, et
  configurer leurs échanges ? Portless est une piste d'intégration.
- Comment enregistrer et suivre l'ensemble des PR nécessaires à une Spec, notamment lorsqu'une
  PR est remplacée ? Le merge de toutes les PR nécessaires rend la clôture proposée éligible,
  mais seul un clic explicite de l'utilisateur l'autorise.
- Comment coordonner plusieurs builds lorsque leurs Specs partagent le même Workspace ?
- **GitHub et les issues (décidé le 15 septembre 2026, à placer dans un lot).** Hemera doit
  savoir lire et écrire les issues et les PR du dépôt d'un Projet : une Spec qui naît d'une
  issue ou en crée une, une PR de livraison rattachée à sa Spec, un état renvoyé vers GitHub.
  Le constat vient de l'outillage du projet lui-même : OpenSpec est purement fichiers et n'a pas de
  pont vers les issues, et c'est le même manque qu'un utilisateur d'Hemera aura. Reste à
  trancher : quel lot (après le 7, Workspaces, qui apporte Git), quel fournisseur en premier
  (GitHub, puis GitLab ?), authentification (`gh` local ou token dans le profil), et si le
  Journal d'Hemera devient la source et GitHub le miroir, ou l'inverse.

## Commandes

- Comment présenter les applications, vérifications et utilitaires, et leurs éventuels groupes ?
- Comment importer des scripts et proposer la promotion d'une exécution ponctuelle au catalogue
  selon la configuration du Projet ?
- Comment relier les commandes à la préparation d'environnement, aux ports et à l'option
  système Portless ?

## Missions et exécution

- Si une Spec est réouverte après création de la Session build mais avant la première tâche,
  comment gérer cette Session devenue liée à une ancienne révision ? Ce cas est distinct de
  la préparation d'environnement, qui se déroule avant toute création de Session build.
- Le catalogue initial `define` et `build` est-il fermé ou extensible ?
- Faut-il permettre plusieurs configurations réutilisables pour une même mission ?
- Quels contrôles supplémentaires deviendraient nécessaires si les critères de sortie initiaux
  de `shape`, `plan`, `prototype` et `decompose` se révèlent insuffisants en pratique ?
- Quelle empreinte minimale permet d'invalider une phase aval lorsque ses entrées changent,
  sans introduire une validation et un hash visibles pour chaque champ de la Spec ?
- Comment versionner un protocole de mission et traiter une Session encore active lorsqu'une
  nouvelle version ajoute, retire ou réordonne une phase ?
- Quelles phases de `build` peuvent être déléguées ou exécutées en
  parallèle, et quelles dépendances réelles conditionnent leur démarrage ?
- À quel moment une Session `define` commencée sans Spec doit-elle obligatoirement en créer
  ou en rejoindre une ?
- Comment composer les configurations de la documentation entre recettes Hemera, préférences utilisateur,
  règles du workspace et ajustements propres à une Session ?
- Sous quelle forme l'utilisateur ajoute-t-il ses propres cibles, règles et livrables de
  documentation ?
- Quelles missions peuvent en lancer automatiquement une autre, et selon quel consentement ?
- Comment composer la politique d'actions externes entre réglages utilisateur, configuration
  du projet et exception choisie pour une Session `build` ?
- Quels réglages et quelle présentation permettent de configurer, par projet et par action
  externe, les modes automatique, avec confirmation humaine ou désactivé, en conservant le
  clic humain obligatoire pour clôturer une Spec et fermer ou nettoyer son Workspace ?
- Comment présenter un orchestrateur `build`, ses workers et leurs demandes d'attention ?
- Quels profils de reviewers fournir, combien en lancer et comment les sélectionner selon la
  Spec, le diff et les règles du workspace ?
- Comment l'utilisateur intervient-il pendant un travail autonome ?
- Faut-il un jour autoriser une micro-intervention experte sans Spec, et sous quelle forme,
  sans affaiblir la règle de la première version qui exige une Spec pour `build` ?
- **Un serveur Hemera à qui passer la balle (décidé le 16 septembre 2026, version ultérieure,
  après la v1).** Hemera aura une part serveur : un poste qui garde les Workspaces, les
  Sessions et les agents en marche, auquel l'application de bureau se rattache. Depuis
  l'application on envoie un travail au serveur (une Session `build`, une tâche, une recette
  automatisable) ; il l'exécute, commite, pousse, et renvoie ce qui demande un humain, une
  question, un diff à relire, une recette à faire à l'écran. On se passe la balle entre le
  poste du serveur et n'importe quel autre, sans rien recopier. Le constat vient du
  développement d'Hemera lui-même : le code avance sur une machine, la recette se fait sur une autre, et le seul
  relais aujourd'hui est le ticket et la PR. À trancher : ce qui vit sur le serveur et ce qui
  reste local (le profil et la base sont-ils du serveur ?), le protocole entre l'application
  et lui (le même canal typé que l'IPC, exposé sur le réseau ?), l'authentification, et si une
  application peut se rattacher à plusieurs serveurs.

## Tâches et plan de réalisation

- Quels noms de tables et quelles cardinalités précises implémentent les tâches contractuelles,
  leurs critères, leurs dépendances et leur progression propre à chaque Session `build` ?
- Comment représenter précisément le blocage et sa résolution par l'utilisateur lorsqu'une
  tâche contractuelle est incorrecte ? Le signalement, la suspension ciblée et l'interdiction
  de modifier le contrat figé sont déjà acquis.

## Journal

- Quelle liste initiale d'événements métier mérite d'apparaître dans `domain_events`, et quel
  niveau de détail reste réservé aux logs techniques ?
- Quelle politique de rétention et de pagination conserve un Journal utile sur les Specs
  longues sans rendre la lecture ou la base non bornée ?

## Interface

- Comment présenter la vue « Contexte de la Session », ses sources et la distinction entre
  contenu fourni par Hemera et informations seulement consultables via MCP ? Son principe est acquis.
- Un espace de discussions `free` hors Projet aurait-il une place claire et utile dans
  l'interface ? À tester dans le prototype ; la première version les rattache à un Projet.
- Jusqu'où conserver les forces de la sidebar du produit précédent sans reproduire son interface à l'identique ?
- Comment rendre immédiatement visibles la mission, la Spec éventuelle, le provider et
  l'état d'une Session sans surcharger chaque ligne ?
- Comment filtrer ou rapprocher les Sessions liées à une même Spec tout en les gardant
  directement accessibles ?
- Sous quelle forme le chat reste-t-il accessible pendant un `build` actif : panneau,
  tiroir, overlay ou bascule de vue ?
