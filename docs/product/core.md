# Noyau produit d'Hemera

**Statut :** fondation en cours de définition  
**Dernière mise à jour :** 2026-09-12

Ce document contient uniquement les directions produit validées. Les détails encore à
trancher vivent dans [`open-questions.md`](./open-questions.md), et les méthodes ou produits
à étudier sont conservés dans [`inspirations.md`](./inspirations.md).
La disponibilité à la première livraison ou dans une évolution ultérieure est distinguée
dans [`delivery-scope.md`](./delivery-scope.md) : une règle cible validée n'implique pas que
la fonctionnalité correspondante soit livrée immédiatement.

Hemera repart de zéro. Le produit précédent, les expériences antérieures et leurs PRD servent
de retours d'expérience, mais leur modèle et leur interface ne sont pas des contraintes de
compatibilité.

## Implantation du socle

Le développement se fait dans le dépôt du produit :
l'application Hemera sur Electron (Chromium, Node), monorepo pnpm. Le fork GPUiX
(`sources/gpuix/`) a été abandonné le 15 septembre 2026, voir
[`decisions-2026-09-15.md`](../decisions/decisions-2026-09-15.md).

Le rapprochement technique des spikes rassemble les conclusions
des expériences et leurs limites. Il complète ce noyau sans remplacer ses décisions par
les hypothèses produit plus anciennes des rapports techniques.

Lors de la préparation du démarrage, Windows et Linux sont retenus dès le socle. La première
version vise Claude Code, Codex et OpenCode et inclut un terminal interactif intégré, distinct
des commandes managées. Le développement est découpé en huit lots (voir la
[carte des Specs](./spec-map-v1.md)) ; le lot 1 est spécifié, les
suivants sont des propositions en brouillon. Les [décisions du 13 septembre](../decisions/decisions-2026-09-13.md)
complètent ce noyau ; les capacités réelles restent à vérifier par provider et plateforme.
Le design visuel de la vraie application peut être exploré pendant son développement ; cela
ne réactive pas la fonctionnalité prototype produit reportée.

## Raison d'être

Hemera est un environnement de développement local où un développeur discute avec des agents,
leur confie du travail, observe ce qu'ils font et valide le résultat, sans perdre la
continuité entre les sessions.

Sa valeur différenciante est de gérer une Spec de bout en bout et de l'intégrer profondément
dans l'application, les sessions et le travail des agents.

La boucle fondamentale est :

```text
discuter -> définir -> construire -> vérifier -> documenter
```

## Deux principes complémentaires

### Interaction session-first

La Session reste l'unité principale visible et manipulable dans l'application. Les Sessions
sont présentes dans la sidebar et l'utilisateur peut suivre plusieurs travaux simultanément.

Hemera permet aussi d'ouvrir des discussions libres. Une Session n'est donc pas obligatoirement
rattachée à une Spec.

### Travail Spec-centered

La Spec est la colonne vertébrale durable d'un travail structuré. Ce n'est pas un document
joint à une conversation ni un simple écran séparé.

Une Spec peut réunir plusieurs Sessions. Les agents qui interviennent sur une même Spec
accèdent à son état partagé au moyen des outils MCP fournis par Hemera. Ils ne dépendent pas
d'un transfert opaque de mémoire depuis l'agent précédent.

Pour la première version, une seule Session `define` à la fois peut écrire le contenu d'une
Spec en brouillon. D'autres Sessions peuvent lui être liées et la consulter. Les sous-agents
de la Session rédactrice restent coordonnés par celle-ci. Cette limite d'écriture simultanée
est un choix de première version : le modèle conserve la relation entre une Spec et plusieurs
Sessions, afin de permettre plus tard plusieurs Sessions `define` rédactrices. Les règles de
coordination et de résolution des conflits nécessaires à cette évolution restent à concevoir.

La navigation ne devient pas Spec-first : les Specs ne remplacent pas la présence directe
des Sessions dans la sidebar.

## Projet et Workspace

Le `Projet` est le regroupement durable des dépôts, Specs, Sessions, connaissances et règles
de configuration. Le nom Projet est retenu.

Le Projet est un regroupement logique et ne porte pas de racine physique distincte. Le chemin
appartient au Workspace `main`, qui sert d'environnement principal. Ce nom ne détermine pas
celui des branches Git. Un Projet peut commencer avant que les sources existent : le dossier
de `main` peut contenir la préparation et les documents de conception, puis accueillir les
sources dans des sous-dossiers.

Le Projet configure les emplacements de ses dépôts relativement à la racine des Workspaces, par exemple
`./sources/api` et `./sources/front`. Le multi-repo fait partie de la première version. Si la
liste est vide, Hemera utilise la racine `.` comme emplacement par défaut ; cela ne suppose pas
qu'un dépôt Git existe et ne déclenche pas son initialisation automatique.

Un `Workspace` est un environnement concret de travail rattaché au Projet. Un Projet peut en
posséder plusieurs. Un Workspace dédié peut assembler un worktree par dépôt sous sa propre
racine, en conservant leurs chemins relatifs : `sources/api` et `sources/front` peuvent ainsi
être deux worktrees indépendants dans le même Workspace. Il n'est donc pas limité à un unique
worktree ni à la copie complète du dossier de `main`. Les environnements sans Git restent
possibles ; leur préparation précise relève de la configuration à détailler.

Un Workspace utilisé pour développer possède par défaut son propre environnement d'exécution,
distinct de ceux des autres Workspaces. La configuration appartient au Projet ; les ressources
effectives appartiennent au Workspace : processus, ports et URLs, variables d'environnement
et espaces de données nécessaires. Le niveau d'isolation et les éventuels partages explicites
sont configurables ; cela n'impose pas un conteneur complet pour chaque Workspace.

Hemera prend en charge la préparation complète du Workspace selon la configuration du Projet :
création des worktrees nécessaires, enregistrement du Workspace dans Hemera et préparation de
son environnement. L'utilisateur n'a pas à orchestrer ces opérations avec un agent externe.
Un bouton permet de déclencher cette préparation seule, sans lancer de build. Une action
combinée « Créer l'environnement et lancer le build » permet d'enchaîner les deux : Hemera
prépare d'abord le Workspace, puis crée et lance la Session build uniquement lorsque cet
environnement est prêt et configuré. Si le Workspace est déjà prêt, l'action est simplement
« Lancer le build ». La préparation appartient à Hemera, en dehors de la mission build ; aucune
Session build n'est créée pour attendre cette préparation. Le passage de la Spec à `ready`
ne déclenche pas à lui seul cette préparation ni le build.

Le build réutilise le Workspace déjà associé à la Spec : il ne crée pas systématiquement un
nouvel environnement. Si aucun Workspace n'est associé, Hemera permet d'en préparer un ou d'en
choisir un existant, y compris `main`, selon la configuration du Projet. La préparation
seule et celle de l'action combinée utilisent le même mécanisme Hemera.

La création des worktrees et la préparation de l'environnement restent des opérations
distinctes dans ce mécanisme. Avant de lancer le build, Hemera doit rendre disponibles les
ressources nécessaires au développement et aux vérifications, en tenant compte de ce qui
est déjà prêt. Cette préparation ne relève pas de la phase `prepare` de l'agent.
Les services peuvent être démarrés selon le besoin, dans l'environnement prévu pour ce
Workspace. Les recettes et leurs modalités de configuration restent à détailler.

Si la préparation échoue partiellement, Hemera conserve les opérations réussies et les ressources
déjà créées, affiche l'étape en échec et permet de reprendre la préparation en tenant compte
de cet état. L'échec ne déclenche pas une suppression automatique de ce qui a été préparé.
Le lancement du build reste bloqué tant que les prérequis de son environnement ne sont pas
satisfaits.

Si le Workspace est prêt mais que le lancement de l'agent échoue, Hemera conserve le Workspace
et propose « Réessayer le lancement ». Cette action retente le lancement de l'agent sans
recréer les worktrees ni rejouer la préparation de l'environnement. L'échec reste visible
pour permettre à l'utilisateur d'en corriger la cause avant de réessayer.

Si l'utilisateur retravaille la Spec pendant cette préparation, Hemera invalide le lancement
de build demandé sur l'ancienne révision et conserve l'environnement déjà préparé. Il faut
valider la nouvelle révision en `ready`, puis demander explicitement le lancement du build.
La fin de la préparation ou la nouvelle validation ne suffit pas à relancer cet enchaînement.

Le cas courant est un Workspace dédié à une Spec. Ce lien n'est toutefois pas exclusif :
plusieurs Specs peuvent partager le même Workspace. Le modèle n'impose pas une relation
un-à-un et n'oblige pas à créer un environnement distinct pour chaque Spec. La coordination
des builds partageant un Workspace reste à détailler lorsqu'un usage le nécessite.

## Commandes

Hemera reprend le principe des commandes managées : les définitions réutilisables appartiennent
au Projet et leurs instances s'exécutent dans un Workspace. L'interface et les agents via
MCP partagent les opérations de lancement, arrêt, relance et consultation des états, sorties
et résultats. Le lancement utilise le dossier et l'environnement du Workspace concerné.

Le catalogue du Projet regroupe les commandes destinées à être retrouvées et réutilisées :

- applications : API, front et serveurs de développement, avec état, URL et logs ;
- vérifications : tests, lint et compilation, avec leurs résultats ;
- utilitaires : préparation, génération de données et autres scripts réutilisables.

Une exécution ponctuelle demandée par l'agent reste visible dans l'activité de sa Session,
avec le Workspace concerné, sans créer automatiquement une entrée permanente dans ce
catalogue. Par exemple, la suite de tests du backend peut être une commande du Projet, tandis
que relancer un test précis pendant une correction reste une exécution ponctuelle.

L'agent recherche d'abord une commande existante adaptée. Il peut proposer une nouvelle
commande réutilisable ; son ajout au catalogue suit la configuration du Projet. Répéter une
exécution ponctuelle ne suffit pas à la promouvoir automatiquement. Le détail des groupes,
des imports de scripts et du branchement aux ports ou à Portless reste à concevoir.

## Spec

Une Spec représente l'intention et l'état partagé d'un travail suivi de bout en bout.

- Elle peut exister indépendamment d'une Session active.
- Elle peut être liée à plusieurs Sessions.
- Elle fournit aux différentes Sessions un contexte commun contrôlé par Hemera.
- Son contenu et son cycle de vie suivent les contrats détaillés ci-dessous.

La Spec porte son `slug`. Hemera peut le générer à partir du titre, mais il appartient bien à
l'identité persistée de la Spec.

Une Spec peut pointer vers un workspace de réalisation. Ce lien est optionnel : une Spec peut
être définie, discutée ou prête avant qu'un workspace lui soit associé. La branche Git éventuellement
associée au travail n'est pas un champ canonique de la Spec. Elle est observée en temps réel
depuis le ou les repositories du workspace. Cette dérivation reste correcte en multi-repo et
si une nouvelle passe de réalisation utilise un autre environnement.

La Spec ne porte pas de champ `position` destiné à ordonner un board. Un ordre d'affichage est
une propriété de la vue ; son évolution ne doit pas forcer la renumérotation des Specs.

L'inventaire exhaustif des informations possibles n'est pas un formulaire à remplir. La
mission `define` construit la Spec depuis la conversation, Hemera produit automatiquement les
métadonnées dérivables, et seuls les blocs pertinents pour le type et le travail courant sont
demandés. La forme interne de ces informations reste à fixer.

Le socle commun d'une Spec prête contient :

- un titre ;
- un type ;
- le problème ;
- le résultat attendu ;
- le périmètre ;
- la manière de vérifier le résultat.

Ce socle sépare les métadonnées requêtables du contenu rédigé :

- `title`, `slug`, `type`, `status` et les relations sont des données structurées connues de
  Hemera ;
- `problem`, `expected_outcome`, `scope` et `verification` sont quatre sections riches et
  éditables, pas une décomposition en nombreux champs atomiques.

Cette structure permet à l'agent de faire évoluer une section comme un ensemble cohérent et à
l'utilisateur de lire la Spec comme un document, tout en laissant Hemera piloter son identité, son
cycle de vie et ses rattachements.

Le niveau de détail et les blocs supplémentaires dépendent du type et de la complexité du
travail. Une Spec en brouillon peut être plus incomplète : c'est le passage à `ready` qui
impose le contrat applicable.

Une Spec peut posséder des `UserStory` natives. Elles sont facultatives et principalement
utiles aux Specs `feature` qui comportent plusieurs tranches de valeur distinctes.

Une `UserStory` contient une phrase riche réunissant l'acteur, son besoin et le bénéfice
attendu. Ces éléments ne deviennent pas trois champs séparés. Elle possède aussi un titre
généré par l'agent, une liste de critères d'acceptation et, si cela aide réellement au
découpage, une priorité facultative. Son ordre est géré par Hemera au moyen d'un rang souple et
non d'une position entière fragile.

Hemera peut relier les tâches qui réalisent une `UserStory` et les preuves qui la valident. Son
avancement est dérivé de ces relations ; l'utilisateur ne maintient pas un statut de story à
la main.

### Spec et révisions

Les statuts sont des conséquences d'actions métier contrôlées par Hemera. Aucun outil générique
de type `change_status` n'est exposé à l'agent. Le backend vérifie pour chaque action l'acteur,
les autorisations et les prérequis, puis applique ses effets sur l'état et les révisions.
Une action métier ne permet pas de contourner une validation humaine.

Valider une Spec, la retravailler en brouillon, l'annuler ou la clôturer relève de boutons
explicites dans Hemera. L'agent peut proposer ces actions, mais ne les exécute pas à la place de
l'utilisateur. Les faits d'exécution mettent en revanche leur état à jour sans clic de statut
supplémentaire : notamment, la première tâche réellement démarrée par le build entraîne le
passage de la Spec à `in_progress`, sans que sa préparation seule suffise. L'agent peut lire
l'état et les contraintes utiles ; il n'a pas à orchestrer ces transitions internes.

La `Spec` est l'identité durable et porte son état vivant. Une table `spec_revisions` conserve
les versions de son contrat complet. Une révision est un agrégat relationnel constitué de sa
ligne principale, de ses `UserStory` et de leurs critères d'acceptation. La révision ne porte
pas de statut propre : le cycle de vie appartient à la Spec.

Seule la révision courante d'une Spec `draft` est éditable. Le passage de la Spec de `draft` à
`ready` fige tout son contrat courant, y compris ses stories et leurs critères. Tant que la
Spec n'est pas revenue à `draft`, aucun contenu contractuel ne peut être modifié. Les retours
obtenus pendant le build ou la review peuvent produire des findings et des tâches sans modifier
la Spec ; leur modèle précis sera défini plus tard.

L'action utilisateur « Retravailler la Spec » autorise sa réouverture. Un appel d'écriture de
l'agent sur une Spec figée est refusé ; il ne déclenche jamais implicitement sa réouverture.
L'agent peut écrire dans le nouveau brouillon une fois l'action humaine effectuée.

Le seul retour autorisé vers `draft` part de l'état `ready`. La transition `ready → draft`
crée obligatoirement une nouvelle révision : dans une même transaction, le backend copie la
révision courante, ses `UserStory` et leurs critères, fait pointer `current_revision_id` vers
la copie, puis place la Spec en `draft`. La révision précédente reste intacte.

Cette transition repose sur une opération métier dédiée de clonage complet, pas sur une suite
d'écritures indépendantes exposées aux clients. L'action produit vise la Spec, par exemple
`reopen_spec(spec_id, expected_revision_id, reason)`, réservée au parcours utilisateur autorisé,
et non exposée comme outil MCP à l'agent. Le backend :

1. vérifie que la Spec est encore `ready` et pointe toujours vers la révision attendue ;
2. crée la révision suivante avec un nouveau numéro et les métadonnées de création ;
3. copie tout le contenu contractuel et toutes les lignes enfants ;
4. attribue de nouveaux IDs aux `UserStory` et critères copiés en conservant leurs relations
   et leur ordre ;
5. bascule `current_revision_id` et le statut de la Spec vers `draft` ;
6. enregistre l'événement de réouverture et la raison éventuelle.

L'ensemble réussit ou échoue dans une seule transaction. Le contrôle
`expected_revision_id` empêche deux Sessions concurrentes de créer silencieusement deux
brouillons depuis la même base. Le détail interne peut s'appeler `clone_spec_revision`, mais
la commande visible reste une réouverture de la Spec, pas une manipulation manuelle de lignes.

Dès qu'une Spec a dépassé `ready`, elle ne peut plus revenir à `draft`. Son contrat ne peut
donc pas être réécrit pendant ou après sa réalisation. Les mécanismes de correction, de
succession ou de remplacement d'une Spec seront traités séparément lorsqu'un cas réel le
nécessitera.

Les opérations produit restent adressées à la Spec. Lancer un build demande un `spec_id`, pas
un `spec_revision_id`. Dans la même opération, le backend vérifie l'état de la Spec, résout sa
révision courante puis conserve son ID sur la nouvelle Session de build. Le travail reste ainsi
attaché à une version exacte sans exposer ce détail à l'utilisateur ou à l'appelant.

Le schéma logique retenu est :

```text
specs
- id
- key
- slug
- status
- priority
- workspace_id nullable
- current_revision_id
- created_at
- updated_at

spec_revisions
- id
- spec_id
- number
- title
- type
- problem
- expected_outcome
- scope
- verification
- change_summary
- change_reason
- created_by
- created_at

user_stories
- id
- spec_revision_id
- title
- narrative
- priority nullable
- rank

acceptance_criteria
- id
- user_story_id
- body
- rank
```

Une `UserStory` appartient directement à une seule `SpecRevision`. Un critère d'acceptation
appartient directement à une seule `UserStory`. La relation vers la Spec se déduit par la
révision ; `user_stories` ne duplique donc pas de `spec_id`.

La mission `define` produit également le plan de réalisation avant que la Spec passe à
`ready`. Cette décomposition est effectuée par le même agent que celui qui a cadré et conçu
la Spec : elle prépare des instructions suffisamment précises pour qu'une future Session
`build`, éventuellement exécutée par un modèle moins capable, puisse les suivre.

Ces tâches de réalisation appartiennent au contrat figé de la révision et sont copiées avec
elle lors d'une réouverture. Elles ne doivent pas être confondues avec les sous-étapes libres
qu'un orchestrateur `build` peut créer pour organiser son exécution.

Une tâche contractuelle contient au minimum un titre, le résultat observable à livrer, son
type, son exécuteur (`agent` ou `human`), ses critères d'acceptation et ses dépendances. Elle
peut référencer les `UserStory` qu'elle couvre ou le prototype à réaliser. La priorité et le
parallélisme sont dérivés du graphe de dépendances plutôt que stockés comme des propriétés
redondantes.

Les tâches partagent une même structure mais sont rassemblées dans des `TaskSet`. Le groupe
initial, de type `contract`, appartient à la `SpecRevision`. Un groupe de type `correction`
appartient à la Session `build`, référence la `ReviewRound` dont proviennent ses retours et
conserve les feedbacks ou findings qui l'ont déclenché. Cette appartenance suffit à distinguer
les tâches figées de la Spec des tâches ajoutées pendant le build, tout en gardant ces dernières
reliées à la Spec par la Session et sa révision épinglée.

Le statut d'exécution ne modifie pas cette définition figée. Chaque Session `build` conserve
séparément l'avancement, les tentatives et les preuves associés à chaque tâche. L'orchestrateur
peut créer des sous-étapes privées pour conduire le travail sans modifier le contrat de la
Spec.

Il n'existe ni `BuildCycle` ni copie versionnée du workspace dans le noyau. La Session porte le
build entier et l'exécution d'un `TaskSet` représente une passe de modification. Une passe
interrompue reste observable par ses exécutions de tâches sans entité de cycle supplémentaire.

Lorsqu'une nouvelle révision est créée, le backend copie dans une même transaction la ligne
`spec_revisions`, ses lignes `user_stories` et leurs lignes `acceptance_criteria`. Les copies
reçoivent de nouveaux IDs. Il n'existe pas d'identité de story transverse aux révisions ni de
second mécanisme de versionnement. Un éventuel besoin futur de retrouver l'origine d'une copie
pourra ajouter un lien de filiation, mais il n'appartient pas au noyau actuel.

Le contenu n'est donc pas un snapshot JSON opaque. Une liste native est stockée comme des
lignes enfants SQL. Un champ JSON reste possible plus tard pour une donnée souple qui n'a ni
identité propre ni relation directe avec d'autres objets.

Le résultat de la phase `plan` n'est pas une entité autonome. Il complète directement la
révision avec un champ riche `plan`, qui rassemble l'approche technique, les impacts, les
décisions, les contraintes et les risques. La phase peut également préciser le champ
`verification` existant. Cette forme évite une table et un cycle de versionnement parallèles :
le contenu est figé avec le reste de la révision.

Le prototype natif est reporté à une livraison ultérieure. Sa phase est définie mais
indisponible dans la première livraison, sans bloquer `ready` ; le support du parallélisme
et des dépendances est en revanche présent dès le socle. Les paragraphes suivants décrivent
le contrat cible une fois cette fonctionnalité disponible.

Le prototype est un composant natif d'Hemera intégré à la Spec et aux Sessions concernées. Ce
n'est pas une annexe générique. Il constitue un contrat de rendu autonome et suffisamment
structuré pour qu'un agent `build` puisse interroger directement ses pages, ses états, ses
interactions, ses composants du design system et la variante retenue.

La phase `prototype` se termine seulement lorsque chaque page identifiée possède un état
explicite : soit l'utilisateur a retenu une variante, soit il a décliné la page. Aucune page
ne peut rester avec plusieurs variantes sans choix humain. Hemera vérifie mécaniquement que toutes
les pages sont résolues ; l'utilisateur reste l'autorité sur le choix ou le refus d'une
variante. Les données du prototype sont portées par des entités relationnelles natives d'Hemera,
et la révision de Spec référence par identifiant la version de prototype finalement retenue.

Pendant `shape`, l'agent propose cette phase lorsqu'il détecte un besoin de rendu. Elle n'est
activée que si l'utilisateur accepte, et celui-ci peut aussi la demander manuellement tant que
la Spec reste en `draft`. Son modèle natif comprend au minimum un `Prototype`, ses versions,
les pages de chaque version et les variantes de chaque page. Une fois activée, la phase peut
être déléguée à un sous-agent en parallèle de `plan` et `decompose`. Elle ne bloque aucune de
ces deux phases ; elle bloque uniquement le passage à `ready` tant que toutes ses pages ne sont
pas résolues et que le prototypeur n'a pas confirmé la cohérence de l'ensemble.

Une tâche de réalisation peut pointer vers un prototype mais ne recopie pas sa description
visuelle. Tant que la Spec est en `draft`, le prototype peut évoluer sans rendre cette tâche
périmée : la relation continue de désigner le même objet. Le passage à `ready` fige dans la
révision la version de prototype retenue par l'utilisateur. Le schéma relationnel précis, ses
rounds et la conservation de ses variantes restent à définir.

Hemera reprend de GitHub Spec Kit l'idée de séparer l'intention, le résultat attendu, le plan
et les tâches, ainsi que l'exigence de critères vérifiables. Il ne reprend pas
nécessairement ses documents, ses commandes ni son niveau de formalisme.

### Types de Spec

Hemera utilise une seule entité `Spec`. Les types `feature`, `bug` et `maintenance` ne créent
pas trois modèles séparés : ils sélectionnent un contrat de contenu et de validation adapté
au travail.

Une Spec possède un type explicite. Le type n'est pas une simple catégorie d'affichage : il
détermine le contrat minimal de la Spec, les instructions données aux agents, l'ordre de
leur travail et la manière de valider le résultat.

La première version possède trois types :

| Type | Contrat principal |
|---|---|
| `feature` | Prouver que le nouveau comportement attendu existe |
| `bug` | Prouver que le comportement incorrect a disparu |
| `maintenance` | Prouver que la transformation interne n'a pas altéré le comportement attendu |

Un nouveau type ne doit être ajouté que s'il modifie réellement le comportement demandé aux
agents et sa condition de terminaison. La taille ou l'urgence du travail ne constitue pas
un type. Un bug, même très petit, n'est donc pas un « quick fix » moins formel.

Pour une `feature`, `define` explore le besoin, les parcours, le périmètre et les critères
d'acceptation. `build` construit le nouveau comportement et vérifie ces critères.

Une Spec de type `bug` doit contenir un scénario permettant de reproduire le problème avant
le développement. Ce scénario appartient à la Spec et doit pouvoir être rejoué après le
`build`, par un agent ou par l'utilisateur, afin de constater que le comportement incorrect
n'est plus présent.

La reproduction avant correction et sa vérification après correction forment un même
contrat traçable. La forme précise de la surface et des preuves associées reste à définir.

Pour une `maintenance`, `define` décrit l'état technique actuel et la cible, la raison du
changement, les dépendances touchées, les invariants à préserver, la compatibilité, la
migration éventuelle et le retour arrière. `build` réalise la transformation et prouve que
les comportements existants sont restés stables au moyen de checks appropriés.

## Session

Une Session est un fil de travail visible et durable appartenant à Hemera.

- Elle apparaît directement dans l'interface multi-session.
- Elle conserve un chat classique entre l'utilisateur et l'agent.
- Elle peut être libre ou liée à une Spec.
- Elle possède une mission optionnelle.
- Elle utilise un provider et un modèle pour exécuter le travail agentique.

Une Session possède un agent principal fixe. Cet agent reste le même pendant toutes les
phases de sa mission ; changer d'agent ou de mission implique une nouvelle Session. La
relation éventuelle vers une Spec appartient à la Session, jamais à la mission : la mission
détermine seulement si cette relation est obligatoire et comment l'agent utilise la Spec.

Une Session Hemera n'est pas la session technique ouverte chez le provider ACP. Hemera conserve
ce qu'il possède du fil et du travail. La session du provider peut être arrêtée, reprise ou
perdue sans faire disparaître la Session visible dans Hemera.

La continuité native du provider via ACP est prioritaire : Hemera privilégie sa session existante
et lui laisse la gestion de son contexte, de son historique et de ses mécanismes de cache,
selon les capacités qu'il fournit. Hemera ne remplace pas cette continuité par une reconstruction
maison et ne réinjecte pas systématiquement une copie du fil lors d'une reprise native.
Le maintien exact du cache n'est pas une garantie universelle du protocole ACP.

En parallèle, Hemera enregistre au fil de l'eau le contenu de Session qu'il reçoit : messages,
appels d'outils, résultats et événements d'activité disponibles. Cette sauvegarde ne dépend
pas d'une action de l'agent et ne se limite pas à une note de synthèse tenue par celui-ci.
Elle conserve l'historique accessible côté Hemera et fournit une base de secours, sans prétendre
capturer l'état interne non exposé du provider. Conserver ce contenu et décider quelle partie
redonner au modèle sont deux responsabilités distinctes.

Si la connexion ACP tombe pendant un build, Hemera conserve la Session, l'avancement des tâches
et le travail réalisé. Il tente en priorité de reprendre la session existante du provider,
selon les capacités disponibles. Si cette reprise est impossible, Hemera propose à l'utilisateur
de continuer dans la même Session Hemera avec un contexte reconstruit ; cette solution de secours
ne prétend pas restaurer à l'identique la mémoire du provider. Elle ne change pas l'agent
principal choisi pour la Session.

Avant de poursuivre, l'agent vérifie l'état réel du travail interrompu. Une tâche interrompue
peut avoir produit des modifications ou des effets sans que son résultat ait été enregistré :
elle n'est donc ni considérée comme terminée ni rejouée aveuglément. La reprise ne recommence
pas les tâches déjà accomplies. La fidélité possible de la reprise ACP, le contenu précis du
contexte reconstruit et les contrôles de réconciliation restent à détailler.

## Contexte fourni aux agents

Hemera compose le contexte utile à l'agent à partir du socle Hemera, du Projet, du Workspace,
de la mission et de sa phase, de la Spec éventuelle et de la Session. Le socle explique
notamment que l'agent travaille dans Hemera, doit privilégier ses outils MCP pour les opérations
gérées par le produit et doit respecter les validations humaines.

Le Projet dispose d'un espace où l'utilisateur peut rédiger ses propres instructions communes
à ses agents. Ces instructions complètent les informations structurées fournies par Hemera ;
elles ne remplacent ni le contrat de la Spec ni les contrôles d'autorisation du backend.

Lorsqu'une modification des instructions du Projet intervient pendant une Session, Hemera en
signale la teneur à l'agent au prochain point de reprise sûr, sans interrompre une réponse
en cours ni recréer sa session ACP. Seule la mise à jour utile est transmise, sans réinjecter
tout le contexte. Les nouvelles Sessions utilisent directement les instructions actualisées.
Les modalités de livraison selon les capacités du provider restent à préciser.

Les fichiers d'instructions déjà présents dans les dépôts, tels que `AGENTS.md` ou
`CLAUDE.md`, peuvent servir de sources de contexte dès la première version. Leur contenu
reste maintenu dans les fichiers d'origine, sans copie indépendante à entretenir dans Hemera.
Les instructions propres au Projet Hemera les complètent. Les règles de sélection, de portée,
de résolution des conflits et l'articulation avec la lecture native du provider restent à
préciser, notamment pour éviter une injection en double.

Les commandes disponibles, l'organisation des dépôts et l'avancement des tâches restent des
données gérées par Hemera et consultées depuis leur source. Elles ne deviennent pas des copies
indépendantes dans une mémoire de l'agent. La composition du contexte ne signifie pas que
toutes les données et toutes les conversations sont injectées intégralement à chaque tour.

Une vue « Contexte de la Session » permet à l'utilisateur d'inspecter les instructions et
informations fournies par Hemera, avec leur provenance. Elle distingue ce qui a été fourni à
l'agent de ce qui est seulement disponible à la consultation via MCP. Elle ne prétend pas
exposer l'intégralité du contexte interne du provider ni garantir qu'une information a été
retenue ou utilisée par le modèle. Sa présentation détaillée reste à concevoir.

L'accès aux Specs passées relève de la consultation des données métier existantes, pas d'un
système de mémoire : les agents disposent d'outils MCP pour les lire et le contexte Hemera les
oriente vers cette consultation lorsque nécessaire. La sauvegarde des Sessions et leur reprise
restent elles aussi distinctes de la mémoire durable.

La mémoire durable n'existe pas encore comme fonctionnalité native d'Hemera. Elle est reportée
à une version mineure ultérieure et ne conditionne pas la première livraison d'Hemera. Sa
portée, son stockage, son alimentation et sa valeur à l'usage restent à étudier ; ni une
publication automatique des découvertes ni une intégration de Mnemon ne sont décidées.

Tous les sous-agents reçoivent un contexte ciblé sur le travail qui leur est confié : socle
Hemera, instructions pertinentes du Projet et informations nécessaires à leur intervention.
Ils n'héritent pas automatiquement de toute la conversation de la Session principale.
Pour les reviewers, ce ciblage conserve en particulier l'indépendance déjà retenue : contrat,
prototype, code et preuves utiles, sans historique du raisonnement des agents développeurs.

## Missions de Session

Une mission décrit pourquoi la Session existe. Ce n'est ni un personnage ni le nom du
provider.

| Mission | Responsabilité |
|---|---|
| `define` | Transformer une intention en Spec exploitable |
| `build` | Exécuter le contrat figé, implémenter, documenter et vérifier le résultat, éventuellement avec des sous-agents |

`free` désigne l'absence de mission. C'est une Session de discussion légère, qui peut recevoir
plus tard sa première mission sans changer de fil.

Pour la première version, une Session `free` appartient à un Projet. Elle n'exige ni Spec ni
Workspace. La possibilité de discussions hors Projet reste une piste à tester dans le
prototype UI, notamment pour déterminer où les créer et les retrouver.

La mission détermine les instructions et les outils MCP mis à disposition. Le provider
indique quel moteur exécute la Session, par exemple Claude, Codex ou OpenCode.

## Vue d'une Session

Le chat appartient à toutes les Sessions, mais il n'est pas nécessairement leur surface
principale en permanence. La place centrale s'adapte à la mission et à son état.

La Session combine trois éléments génériques :

- le chat ;
- le contexte de la mission et de la Spec éventuelle ;
- une surface de travail adaptée à l'activité courante.

Les vues qui entourent la surface principale sont fermables et mutuellement exclusives :
l'utilisateur n'en ouvre qu'une à la fois. Une surface de travail peut afficher, selon le
besoin, une Spec, des tâches, un prototype, un diff, une review ou un document.

La mission donne un focus et un comportement par défaut ; elle ne limite pas les activités
possibles dans la Session. Une Session `define` peut par exemple produire un prototype, et
une Session `build` peut effectuer une review de code intermédiaire.

- Une Session `free` reste un chat sans structure de travail imposée.
- Une Session `define` garde le chat au centre et permet d'ouvrir la Spec vivante à côté.
- Une Session `build` active met au centre l'avancement des tâches et l'activité d'exécution.
  Le chat reste accessible sans occuper tout l'espace.
- Quand un `build` est terminé ou demande une intervention, le chat peut reprendre la place
  centrale pour expliquer le résultat et recueillir les retours.
- Pendant la revue automatique puis la validation utilisateur, la Session `build` met en
  avant le résultat, le diff et les preuves à vérifier.

Quand une Session possède une mission, son interface affiche les informations utiles sur
cette mission. Quand elle est liée à une Spec, elle affiche aussi les informations utiles
sur cette Spec. Ces informations sont des projections vivantes : elles se mettent à jour en
temps réel lorsque l'agent modifie la Spec ou ses tâches par les outils d'Hemera.

La Spec complète reste ouvrable à côté du chat. L'utilisateur peut donc consulter le
contexte structuré sans quitter la Session ni perdre la conversation.

L'utilisateur peut aussi modifier directement le contenu d'une Spec `draft` depuis ce panneau,
y compris pendant une discussion avec l'agent. Hemera enregistre ces modifications avec leur
provenance humaine et les signale à l'agent de la Session `define` concernée pour qu'il en
tienne compte. Le contenu reste verrouillé dès `ready`, conformément aux règles des révisions.
Le détail de l'éditeur et la coordination des modifications humaines et agentiques restent à
concevoir.

Exemples de présentation :

```text
DEFINE · Claude Sonnet
BUILD · Claude Opus
```

À ce stade, Hemera n'a pas besoin d'entités métier distinctes `Role` ou `AgentDefinition`.
Elles ne deviendront utiles que si un besoin de profils réutilisables et configurables est
confirmé.

### Protocoles et phases de mission

Une mission n'est pas un simple prompt. Elle est exécutée selon un protocole versionné,
composé de phases ordonnées. La définition des protocoles intégrés appartient au code de
Hemera, et non à des tables génériques de workflows, de nœuds ou de transitions. Les briefs
textuels longs peuvent être des ressources versionnées avec l'application.

La mission porte les instructions permanentes qui restent vraies du début à la fin : sa
responsabilité, ses limites d'autorité, sa relation avec l'utilisateur et la Spec, ses règles
communes et sa définition générale de réussite. Chaque phase ajoute un objectif temporaire,
des résultats attendus, des outils adaptés et des critères de sortie. À chaque tour, Hemera
compose les règles globales, les instructions de la mission, les instructions de la phase
active et le contexte vivant de la Session et de la Spec.

La mission `define` définit trois phases principales et une phase conditionnelle. La phase
`prototype` reste indisponible et indéclenchable dans la première livraison ; sa déclaration
préserve ses dépendances et son caractère parallélisable pour son activation ultérieure :

1. `shape` cadre le besoin, le problème, le résultat attendu, le périmètre, le type et les
   éventuelles `UserStory`, puis traduit le besoin en comportements et scénarios d'acceptation
   vérifiables ;
2. `plan` analyse le code lorsque nécessaire et fixe les décisions techniques, les
   contraintes, les risques et la stratégie de vérification. Lorsque plusieurs directions
   structurantes existent, l'agent expose leurs compromis et fait trancher par l'utilisateur
   celles qui ont un impact produit ou durable ;
3. `decompose` transforme le contrat et la conception en tranches verticales ordonnées et
   vérifiables, accompagnées de leurs dépendances et de leurs critères de réussite, plutôt
   qu'en lots séparés par couche technique ;
4. `prototype`, activée seulement lorsqu'un besoin de rendu a été identifié et accepté par
   l'utilisateur, construit le contrat de rendu natif avec un sous-agent spécialisé.

Ces phases sont visibles dans la Session mais ne demandent pas des lancements manuels. Le
même agent les enchaîne automatiquement. En particulier, `decompose` est obligatoire pour
l'agent avant la proposition de passage à `ready`, mais ne constitue pas une étape facultative
à déclencher par l'utilisateur. `ready` n'est pas une quatrième phase : c'est l'état de la
Spec obtenu après la validation humaine finale, qui fige sa révision et son plan.

L'ordre des phases décrit leur présentation et le parcours nominal. Les dépendances déclarées
par le protocole déterminent réellement ce qui peut démarrer. Une phase peut être marquée comme
déléguée et parallélisable ; cela ne rend pas toutes les phases indépendantes. Initialement,
`plan` dépend de la fin de `shape`, `prototype` dépend de `shape`, et `decompose` dépend de
`plan` mais pas de `prototype`. Le prototype peut donc avancer dans un sous-agent pendant que
l'agent principal poursuit la conception puis la décomposition. Le passage à `ready` exige que
toutes les phases activées soient terminées, y compris la sélection humaine du prototype quand
il a été demandé.

Plusieurs phases peuvent être ouvertes simultanément. Hemera conserve un focus de phase pour
savoir quelle phase fournit le brief principal au tour courant, mais ce curseur n'est pas
l'état global de la mission. Chaque phase possède son propre état durable. Si une entrée dont
une phase dépend change, son résultat peut devenir périmé. Une simple évolution du contenu
d'un prototype ne périme toutefois pas `decompose`, puisque les tâches référencent le prototype
au lieu d'en dupliquer le rendu.

L'agent peut signaler qu'il estime une phase terminée ; Hemera applique alors les contrôles
mécaniques prévus par le protocole et enregistre le résultat. Le détail exact des critères
propres aux phases reste à fixer.

La fin d'une phase réunit deux autorités complémentaires. L'agent possède le jugement
sémantique : il déclare que le travail est suffisamment abouti et fournit un bilan, les
éléments de la Spec qui l'étayent et les hypothèses ou questions encore ouvertes. Hemera possède
les invariants mécaniques : il vérifie que la phase attendue est bien active, que les données
requises existent et qu'aucun blocage déclaré ne rend la transition impossible. L'agent ne
peut donc ni contourner l'ordre du protocole ni forcer un contrôle en échec.

Cette déclaration passe par un outil MCP Hemera structuré, et non par une simple phrase dans le
chat. Le backend déduit lui-même la Session, l'agent et la mission ; la phase visée doit être
une phase ouverte attribuée à cet appelant. Si le bilan de l'agent et les contrôles Hemera sont
réunis, la phase est enregistrée comme terminée, ses dépendantes deviennent éligibles et le
focus de l'agent principal peut avancer.

Terminer une phase est un checkpoint de travail, pas une validation contractuelle. Une phase
peut être rouverte par l'utilisateur ou devenir périmée si ses entrées changent. Seul
l'utilisateur peut faire passer la Spec à `ready` et figer sa révision.

Avant de proposer ce passage à `ready`, Hemera exécute un contrôle transversal de cohérence entre
le contrat fonctionnel, l'approche technique, les tâches et le prototype éventuel. Ce contrôle
est un gate du protocole, pas une phase supplémentaire : il bloque la proposition tant qu'une
contradiction ou un élément activé mais non résolu subsiste. `shape`, `plan` et `decompose`
doivent être terminées, ainsi que `prototype` lorsqu'elle a été activée. Il ne doit rester
aucune question bloquante ; chaque exigence ou `UserStory` doit être couverte par des critères
et des tâches, dont les dépendances et les références sont valides. L'agent atteste alors que
le contrat est complet et exécutable sans décision majeure à inventer. Hemera peut le proposer,
mais seule une action explicite de l'utilisateur fige la révision en passant la Spec à `ready`.

La phase `shape` peut se terminer lorsqu'Hemera constate que le titre, le type, le problème, le
résultat attendu et le périmètre sont présents, et qu'aucune question bloquante visant ces
éléments n'est ouverte. Le `slug` est produit automatiquement ; les `UserStory`, le workspace,
le prototype et les tâches ne bloquent pas cette phase. Le contrat du type s'ajoute au socle :
un `bug` possède déjà un scénario reproductible, une `maintenance` nomme les invariants à
préserver et une `feature` décrit le comportement observable attendu. L'agent fournit enfin
un bilan sémantique confirmant qu'il peut commencer `plan` sans inventer l'intention produit.
Aucune validation humaine intermédiaire n'est requise.

Pour atteindre ce résultat, `shape` applique une méthode d'entretien inspirée de `grill-me` :
l'agent explore les branches importantes du besoin, pose une seule question à la fois et joint
sa recommandation à chaque décision demandée. Il recherche lui-même les faits accessibles dans
l'environnement et ne sollicite l'utilisateur que pour les arbitrages qui lui appartiennent.
La profondeur de l'entretien s'adapte à la complexité du changement. Ce comportement appartient
uniquement à `shape` et ne devient ni une phase supplémentaire ni une règle de `plan`.

La phase `plan` peut se terminer lorsque le workspace disponible a été analysé, que le champ
`plan` expose une approche exploitable et qu'aucune décision technique majeure n'est encore
bloquante. Si aucun workspace n'est disponible, cette limite est explicite et l'agent n'invente
pas l'état du code. Pour un `bug`, le plan contient la cause établie ou une investigation bornée ;
pour une `feature`, son mode d'intégration ; pour une `maintenance`, les invariants et la
stratégie de migration éventuelle. L'agent confirme enfin que `decompose` peut commencer sans
avoir à choisir l'architecture.

La phase `decompose` peut se terminer lorsque toutes les exigences sont couvertes par des
tâches, que chaque tâche constitue une tranche verticale vérifiable et que le graphe de
dépendances est valide. Hemera contrôle mécaniquement les champs requis, les références, la
couverture et l'absence de cycle. L'agent confirme qu'un agent `build` repartant avec un
contexte neuf peut exécuter chaque tâche sans décision technique ou produit majeure.

La base conserve l'exécution durable du protocole : version utilisée, résultats de phases,
preuves éventuelles et invalidations. Elle ne contient pas la définition configurable d'un
graphe. Une future personnalisation des missions pourra introduire un autre mode de stockage
si un besoin réel le justifie.

### Protocole de la mission `build`

Une Session `build` exige une Spec `ready` et un Workspace déjà prêt et configuré par Hemera.
Sa création reçoit le `spec_id` ; Hemera vérifie ces prérequis, résout la
révision courante et conserve son identifiant exact sur la Session. La Session `define`
d'origine reste intacte et consultable.

Une Spec ne peut avoir qu'une seule Session `build` active à la fois. Hemera fait respecter cette
unicité ; les workers et reviewers restent des sous-agents de cette Session. Une pause ou
une attente de validation ou de livraison ne libère pas cette place. Cette règle ne limite
pas les Sessions `define` ou les discussions libres liées à la même Spec.

La création de la Session et la phase `prepare` laissent la Spec en `ready`. Quand une tâche
commence réellement son exécution dans `build`, son avancement passe à `in_progress` dans
cette Session. Le démarrage de la première tâche fait également passer la Spec de `ready`
à `in_progress`. C'est à ce moment que le retour de la Spec en `draft` devient interdit.

Le backend coordonne la réouverture et le démarrage de la première tâche pour empêcher
qu'ils soient tous deux autorisés sur un état périmé. Une révision remplacée ne peut pas
commencer son exécution.

La Spec reste en `in_progress` pendant les corrections, les revues, la documentation et
l'attente de livraison, y compris après l'approbation humaine du résultat. Les phases,
blocages et attentes sont décrits par l'état de la Session et de ses exécutions ; ils ne
créent pas de statuts supplémentaires sur la Spec. Le signal de livraison permet de proposer
sa clôture ; il ne la déclenche jamais sans une action explicite de l'utilisateur dans Hemera.

Le protocole initial possède quatre phases principales et une phase de reprise :

1. `prepare` charge le contrat, le champ `plan`, les tâches et le prototype éventuel dans le
   Workspace déjà prêt, puis prépare leur exécution sans redéfinir la solution. Cette phase
   ne crée pas le Workspace et ne réalise pas sa préparation d'environnement ;
2. `execute` traite les tâches selon leurs dépendances. L'agent principal agit comme
   orchestrateur et peut déléguer des tâches à des workers rattachés à la Session ;
3. `verify` exécute les critères de chaque tâche puis la vérification globale de la Spec et
   rassemble les preuves obtenues ; la documentation interne au build est réévaluée avant
   cette étape ;
4. `review`, conditionnelle à la présence d'un historique Git exploitable, lance en parallèle
   plusieurs reviewers spécialisés avec un contexte neuf, afin qu'ils ne soient pas influencés
   par la conversation ou le raisonnement de l'implémentation ; ils reçoivent les preuves de
   `verify` et leurs findings conformes au contrat donnent lieu à une seule passe de
   correction automatique avant la review humaine ;
5. `feedback`, activée lorsqu'un retour humain demande une nouvelle passe, vérifie le problème
   sur le résultat réel, clarifie l'intention si nécessaire, contrôle sa compatibilité avec la
   Spec et produit un `TaskSet` de correction avant de rendre le focus à `execute`.

L'ordre `prepare → execute → documentation → verify → review → review humaine` a été arrêté
le 13 septembre 2026 ([décisions](../decisions/decisions-2026-09-13.md)).

La documentation appartient à la mission `build`, pas à une mission ou une Session séparée.
Elle peut être confiée à un sous-agent spécialisé, mais ses modifications sont réalisées dans
le même workspace et font partie du même diff, des mêmes commits et de la même PR que
l'implémentation. Son périmètre est configurable selon l'utilisateur et le workspace : Hemera
fournit des recettes par défaut et l'utilisateur peut ajouter les siennes. Le format exact de
cette configuration et le placement de cette activité dans le protocole restent à préciser.

Les phases `shape`, `plan` et `decompose` restent propres à la mission `define` et ne sont pas
rejouées dans `build`. La phase `feedback` peut reprendre leur discipline de clarification et
de transformation en tâches, mais possède ses propres instructions et ses propres données.
Si le retour exige de modifier le contrat ou le plan figé, Hemera ne crée pas de tâche de
correction : il remonte un conflit de Spec à l'utilisateur.

La progression, les tentatives et les preuves d'une tâche sont propres à cette Session
`build`. Un worker peut créer des sous-étapes internes, mais ne peut ni modifier la tâche
contractuelle ni la Spec figée. Une incohérence du contrat devient un blocage explicite à
remonter ; elle ne peut pas être corrigée silencieusement pendant le build. Seule la tâche
concernée et ses dépendantes sont suspendues, tandis que les tâches indépendantes continuent.
La mission ne peut pas être déclarée terminée tant que l'utilisateur n'a pas traité ou
explicitement écarté ce blocage.

Le résultat du build est accepté lorsque toutes les tâches contractuelles et actions humaines sont
satisfaites, que les revues et vérifications passent, qu'aucun blocage ne reste et que
l'utilisateur l'approuve. La clôture de la Spec attend ensuite les conditions de livraison et
le clic explicite de l'utilisateur définis ci-dessous. Un échec ou une tâche ignorée ne peut pas être masqué par
l'agent. Le résultat du build reste relié à la Session, à la révision exacte et au workspace
utilisé.

### Actions externes et livraison

Git est intégré dès la première livraison, mais les intégrations de PR viennent ensuite.
Les règles de suivi des PR et du merge ci-dessous décrivent donc la cible ultérieure ; sans
cette intégration, Hemera s'appuie sur la confirmation humaine de livraison et ne prétend pas
observer les PR. Les validations humaines de clôture restent obligatoires dans tous les cas.

Dès qu'un workflow agit hors d'Hemera, son comportement relève d'une politique configurable
du Projet. Hemera n'impose donc pas un cycle
universel de branche ou de pull request. La configuration peut choisir la forge et son mode
d'accès, le moment de créer ou publier une branche, la création éventuelle d'une PR en
brouillon, son passage en prête, les actions autorisées après approbation, ainsi que le
nettoyage des ressources temporaires.

Cette politique s'applique aussi aux autres effets externes, comme publier une documentation
ou mettre à jour un outil tiers. L'absence de configuration ne vaut jamais autorisation
implicite. Les capacités réellement disponibles dépendent des intégrations, des permissions
et des règles de la cible ; Hemera doit exposer clairement ce qu'il fera avant le lancement.
Le projet fournit le comportement habituel, que l'utilisateur peut remplacer pour une Session
`build` précise. Sans politique définie, Hemera reste local et demande une décision avant toute
action externe.

Le projet configure séparément chaque action externe et son mode : automatique, avec
confirmation humaine, ou désactivée. Cette règle s'applique aussi aux suites d'une livraison
ou d'une annulation : fermer une PR, supprimer une branche et nettoyer un workspace sont des
actions indépendantes. L'utilisateur peut ainsi conserver le travail tout en autorisant la
fermeture de la PR. Une confirmation ne couvre que l'action concernée ; l'agent ne peut ni
élargir cette autorisation ni changer la politique. Le backend fait respecter la configuration
effective et les confirmations requises. La présentation de ces réglages reste à définir.

La clôture de la Spec et la fermeture ou le nettoyage de son Workspace constituent une
exception obligatoire aux modes automatiques : ces opérations nécessitent un clic explicite
de l'utilisateur dans l'interface Hemera. La configuration du Projet peut définir leurs conditions
et les actions proposées, mais ne peut pas supprimer cette validation humaine. Les agents
n'ont pas accès aux opérations de clôture via MCP ; une phrase de l'agent ou une interprétation
du chat ne peut pas tenir lieu d'autorisation. Le backend contrôle cette frontière.

L'annulation d'une Spec relève d'une action explicite de l'utilisateur. Ses conséquences
externes sont déterminées par la politique du projet et les éventuels choix propres au build ;
elle n'implique donc pas à elle seule de fermer une PR ou de supprimer le travail réalisé.

Après acceptation du résultat, Hemera attend le signal de livraison prévu par cette politique.
Avec une PR suivie, ce signal est son merge ; sans PR, il s'agit d'une confirmation explicite
de livraison par l'utilisateur. Lorsque les conditions de clôture incluent le merge et que la Spec
nécessite plusieurs PR, notamment dans plusieurs dépôts, toutes ces PR nécessaires doivent
être mergées. Un merge partiel laisse la Spec en cours ; une PR fermée sans merge ne satisfait
pas cette condition. Lorsque les conditions sont satisfaites, Hemera propose un bouton de clôture
avec le récapitulatif de la situation. La Spec reste ouverte tant que l'utilisateur n'a pas
cliqué pour autoriser sa clôture. Le merge constitue ici un signal d'intégration du changement,
sans présumer de son déploiement en production ; le constater n'autorise ni à merger une autre
PR ni à clôturer la Spec.

Cette attente est gérée en arrière-plan par Hemera à partir des PR suivies et des intégrations
disponibles ; elle ne nécessite pas de laisser un agent tourner ou juger seul de la livraison.
Un état inconnu ne vaut pas condition satisfaite.
La clôture de la Spec n'autorise pas implicitement la fermeture ou le nettoyage du Workspace :
l'interface distingue les actions et demande une autorisation explicite pour celles retenues.
Le nettoyage suit ensuite la politique du projet et ne concerne que les espaces temporaires
créés par Hemera, après vérification qu'aucun travail local n'y serait perdu. Le dossier principal
de l'utilisateur n'est pas supprimé. La Spec, ses Sessions et leur historique restent
consultables après la clôture et le nettoyage.
Un Workspace partagé ne peut pas être nettoyé tant qu'une autre Spec ou Session en a encore
besoin ; la clôture d'une seule Spec ne suffit pas à le rendre disponible pour suppression.

Chaque vague de revue possède une `ReviewRound`. Elle représente un checkpoint logique : tant
qu'elle est ouverte, l'orchestrateur ne modifie plus le résultat présenté. Hemera ne copie pas le
workspace et ne recrée pas un système de versionnement. Avec Git, la round peut référencer le
commit ou le diff exact. Sans Git, Hemera ne propose ni diff, ni commentaire de ligne, ni revue
automatique du code. Le build et ses vérifications continuent de fonctionner, puis l'utilisateur
effectue une review classique du produit courant. Ses feedbacks produit ou généraux sont
directement rattachés à la round.

Pendant une `ReviewRound`, les retours sont accumulés sans déclencher une modification après
chaque commentaire. La phase `feedback` peut les clarifier au fil de l'eau, mais l'utilisateur
déclenche explicitement la passe de correction lorsqu'il a terminé sa review. L'agent analyse
alors l'ensemble des retours et crée un `TaskSet` par lot cohérent : des remarques portant sur
le même comportement restent groupées, tandis que des lots indépendants peuvent être exécutés
en parallèle. Chaque groupe conserve les liens vers tous les feedbacks ou findings qui l'ont
produit.

Les reviewers reçoivent la Spec et sa révision figée, l'état final du workspace, le diff et
les preuves utiles, mais pas l'historique de raisonnement des agents ayant développé. Leur
liste et leurs spécialités sont définies par le protocole et pourront évoluer. Le noyau ne
fixe pas encore leur nombre, leurs profils précis ni leur règle de sélection.

Ces reviewers ne sont ni des missions ni des Sessions supplémentaires. `build` reste la
mission, `review` est l'une de ses phases internes, et chaque reviewer est une exécution de
sous-agent rattachée à cette phase. Lorsque l'agent principal estime l'implémentation terminée,
la phase lance plusieurs de ces sous-agents, potentiellement en parallèle, avant de présenter
le résultat à l'utilisateur. Ils restent regroupés dans la Session `build` et ne créent pas
d'entrées supplémentaires dans la sidebar.

Un finding qui
peut être corrigé sans contredire la Spec relance automatiquement `execute`, puis uniquement
les reviewers concernés. Si la correction touche plusieurs zones du contrat ou possède un
impact transversal, Hemera invalide et relance l'ensemble de la revue. Un finding qui remet le
contrat en cause devient un blocage soumis à
l'utilisateur. Lorsque les contrôles agents sont satisfaits, la même Session passe en attente
de validation humaine ; un retour utilisateur relance une nouvelle boucle de correction et de
revue sans créer une mission `review` séparée.

Une exécution de sous-agent est rattachée à la Session parente et à sa phase d'origine.
Lorsqu'elle se termine, Hemera persiste le résultat puis place un signal dans une boîte d'entrée
durable de la Session principale. Ce signal n'est jamais injecté au milieu d'une génération et
ne se fait jamais passer pour un message humain : il est remis au prochain point sûr. Si
l'agent principal est inactif, Hemera peut lancer une continuation interne pour intégrer le
résultat sans attendre un nouveau message utilisateur. Cette boîte d'entrée garantit la
livraison ; `domain_events` en conserve séparément l'histoire.

## Contrôle du passage entre missions

Une Session sans mission peut recevoir sa première mission sur place, sans créer un nouveau
fil. Elle peut notamment devenir `define` ou `build`.

Le passage de `free` à `define` ne crée pas automatiquement une Spec vide. La Session
`define` choisit ensuite de créer une Spec ou d'absorber son travail dans une Spec existante.
Une Session `define` lancée directement depuis une Spec lui est en revanche rattachée dès sa
création.

Le passage de `free` à `build` n'est possible que si la Session est d'abord rattachée à une
Spec existante. Sans Spec, l'utilisateur doit rester en discussion libre ou passer par
`define` pour créer ou absorber la Spec nécessaire.

Parmi les missions spécialisées, seule `define` peut commencer sans Spec, puisque sa
responsabilité est précisément d'en créer une ou d'absorber son travail dans une Spec
existante. La mission `build` exige une Spec liée.

Une fois sa première mission attribuée, la Session ne change plus de mission. Passer de
`define` à `build` crée une nouvelle Session.

Le rattachement à une Spec reste indépendant de la mission : une Session sans mission peut
aussi rejoindre une Spec tout en restant une discussion libre.

La fin d'une Session `define` est déterminée par la Spec elle-même : lorsque la Spec passe à
l'état `ready` depuis cette Session, Hemera propose de créer une nouvelle Session `build` liée
à la même Spec. L'utilisateur garde le contrôle du lancement.

Hemera pourra aussi enchaîner automatiquement certaines missions lorsque l'utilisateur l'a
explicitement demandé.

Une nouvelle passe de construction ou de vérification reste possible après les retours de
l'utilisateur. La manière exacte de présenter ces passes n'est pas encore décidée.

## Journal et événements métier

Hemera conserve un journal global append-only d'événements métier dans une table
`domain_events`. Ce journal n'est pas la source de vérité de la Spec et ne constitue pas un
event sourcing complet : les tables métier gardent leur état courant. Chaque mutation et son
événement sont néanmoins écrits dans la même transaction.

Un événement possède une séquence globale, un type, l'entité principalement concernée, sa
source, son auteur et sa date. Il peut être corrélé explicitement à une Spec, à sa révision
exacte, à une Session, à une mission et à une phase. Ces corrélations sont des colonnes
indexées lorsqu'elles servent aux lectures produit ; elles ne sont pas cachées uniquement
dans un payload JSON.

La page `Journal` d'une Spec est une projection paginée de tous les `domain_events` portant
son `spec_id`. Elle peut ainsi réunir le cadrage, la conception, la décomposition, le passage
à `ready`, le build, les findings, la review et la documentation, tout en montrant pour chaque
entrée sa Session et sa phase d'origine. Le même journal peut aussi être projeté par Session
ou à un niveau plus global. Les sorties techniques détaillées des providers et des runtimes
n'y sont pas mélangées.

## Frontières actuelles

Les directions suivantes ont été écartées :

- remplacer la sidebar multi-session par une navigation centrée sur les Specs ;
- cacher tout le travail d'une Spec derrière quatre espaces internes fixes ;
- lancer une mission `build` sans Spec liée ;
- utiliser la taille ou l'urgence d'un travail comme type de Spec ;
- traiter la structure du produit précédent comme une obligation pour Hemera ;
- exposer les notions techniques ACP comme modèle principal de navigation.
