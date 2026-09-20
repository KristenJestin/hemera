# Architecture du chat multiagents avec ACP

État des décisions au 8 septembre 2026.

Ce document rassemble les orientations retenues et les éléments techniques vérifiés pour construire une interface de chat permettant de connecter Claude, Codex et OpenCode, de choisir leurs modèles et d’utiliser des outils personnalisés. Il conserve les corrections apportées pendant la recherche et distingue les possibilités établies des points restant à éprouver en implémentation.

## 1. Objectif et contrainte principale

L’utilisateur doit pouvoir connecter ses comptes, sélectionner un agent et un modèle, puis passer de l’un à l’autre dans une interface commune.

**L’utilisation des abonnements Claude et ChatGPT est une condition indispensable.** Une solution qui imposerait uniquement une facturation API séparée ne répond pas au besoin.

Le produit doit permettre de définir ses propres outils et workflows, tout en déléguant autant que possible les protocoles, l’authentification et l’exécution aux composants maintenus des agents.

## 2. Architecture retenue

**ACP v1 constitue la base commune d’intégration.** Un même client ACP pilote plusieurs agents ; leurs adaptateurs traduisent les requêtes et les événements propres à chaque moteur. ACP v2 reste expérimental et ne constitue pas le socle retenu. [S1, S2]

| Composant | Intégration retenue | Moteur utilisé |
|---|---|---|
| Client commun TypeScript | `@agentclientprotocol/sdk` | Communication ACP |
| Claude | `@agentclientprotocol/claude-agent-acp` | Claude Agent SDK et moteur Claude Code |
| Codex | `@agentclientprotocol/codex-acp` | Codex App Server |
| OpenCode | `opencode acp` | OpenCode et ses fournisseurs configurés |

L’ancien adaptateur `@zed-industries/codex-acp` est remplacé par `@agentclientprotocol/codex-acp`. Le dépôt historique est archivé et renvoie vers le nouveau projet. [S3–S6]

### Répartition du code

Trois couches permettent de limiter les conditions spécifiques à chaque fournisseur :

1. **Configuration par agent** : programme à lancer, arguments, environnement, versions et options avancées propres au moteur.
2. **Client ACP commun** : transport, messages, événements, permissions, réglages et sessions.
3. **Logique produit** : comptes connectés, catalogue regroupé, sélection active, historique commun et transfert de contexte.

Les comportements ordinaires doivent dépendre des capacités annoncées par l’agent. Les différences profondes de configuration restent isolées dans les modules d’intégration.

Un processus local ou distant doit exécuter les agents. Un navigateur seul ne remplace pas cet environnement. L’option locale ou desktop est la recommandation de départ ; le choix définitif de packaging n’est pas arrêté.

## 3. Abonnements et authentification

### OpenAI

Codex distingue la connexion ChatGPT donnant accès aux droits de l’abonnement de la connexion par clé API facturée à l’usage. App Server peut conduire le parcours ChatGPT, conserver les jetons et les renouveler automatiquement. L’application peut ainsi déléguer le cycle d’authentification au moteur officiel. [S7, S8]

Le SDK API OpenAI classique n’est pas la solution retenue pour consommer le forfait ChatGPT. Pour une interface riche autour de Codex, App Server est l’interface officielle sous-jacente utilisée par le nouvel adaptateur ACP. [S4, S8]

### Claude

**La clarification de facturation à conserver est celle du centre d’aide Anthropic mise à jour en juin 2026 : le SDK Claude, `claude -p` et les applications tierces continuent à consommer les limites d’usage de l’abonnement.** Le projet de séparation vers un crédit mensuel distinct a été suspendu. La suite de cet article conserve l’ancienne annonce à titre historique ; elle ne doit pas être interprétée comme la mesure active. [S9]

Cette possibilité ne transforme pas les identifiants Claude.ai en clés API universelles. Les conditions d’intégration prévoient notamment l’utilisation du binaire Claude Code intact, une connexion personnelle de l’utilisateur dans le parcours Anthropic, la préservation des méthodes d’authentification et l’absence de revente ou d’intermédiation de l’usage. La page Agent SDK conserve par ailleurs une restriction sur l’offre de connexion ou de quotas Claude.ai dans un produit tiers sans approbation. [S10, S11]

**Statut retenu : accès aux quotas documenté ; autorisation de toute architecture imaginable non établie.** Le produit doit conserver la connexion officielle et ne pas collecter les jetons pour les réutiliser dans son propre service d’inférence.

### Le cas T3 Code

Le code examiné de T3 Code utilise le Claude Agent SDK, appelle `query()` et lui transmet le chemin du binaire Claude Code par `pathToClaudeCodeExecutable`. Son site annonce l’utilisation des abonnements existants. Aucune dérogation particulière n’a été établie pendant la recherche. T3 Code constitue une référence d’intégration, pas une preuve d’autorisation transférable à un autre produit. [S12, S13]

### OpenCode ne remplace pas le chemin Claude officiel

Le chemin retenu pour l’abonnement Claude est Claude ACP. La documentation OpenCode indique que les plugins réutilisant les abonnements Claude Pro/Max dans son moteur sont interdits par Anthropic et ne sont plus intégrés depuis OpenCode 1.3.0. Placer ACP devant OpenCode ne modifie pas cette situation. [S14]

### Conséquences pour l’interface

- Distinguer connexion par abonnement et connexion API quand l’information est disponible.
- Ne pas considérer la réussite d’une connexion comme la preuve que toute requête est incluse dans le forfait.
- Conserver les limites et erreurs de quota visibles pour l’utilisateur.
- Ne pas basculer silencieusement vers une route API payante.

## 4. Ce qui est mutualisé par ACP

| Fonction | Mécanisme commun | Responsabilité produit |
|---|---|---|
| Initialisation | `initialize` | Démarrer la connexion et retenir les capacités |
| Authentification | Méthodes annoncées dans `authMethods` | Présenter le parcours approprié |
| Nouvelle session | `session/new` | Associer la session au chat |
| Envoi d’un message | `session/prompt` | Saisie et routage |
| Streaming et progression | `session/update` | Affichage des messages et actions |
| Permissions | `session/request_permission` | Présenter et transmettre les décisions |
| Arrêt d’un tour | `session/cancel` | Bouton Stop et état de l’interface |
| Configuration | `configOptions` et `session/set_config_option` | Construire les sélecteurs |
| Reprise | `session/load` ou `session/resume`, selon support | Persister les références et restaurer |

Ces noms sont ceux des méthodes du protocole ; les méthodes TypeScript exactes dépendent de la version du SDK. Certaines fonctions sont optionnelles : leur présence doit être vérifiée, pas déduite du seul nom de l’agent. [S1, S15–S17]

La connexion n’est pas un widget prêt à l’emploi. ACP décrit notamment des parcours pilotés par l’agent et des parcours nécessitant un terminal interactif, suivi d’une reconnexion. Le client doit implémenter ces types de parcours et respecter les capacités annoncées. [S15]

## 5. Modèles et réglages

### Sélection générique

Les agents peuvent exposer leurs réglages dans `configOptions`, avec identifiant, libellé, valeur courante et choix possibles. Les catégories peuvent identifier le modèle, le mode ou le niveau de réflexion.

Le client peut produire les contrôles depuis ces données, puis transmettre une sélection avec `session/set_config_option`. L’agent renvoie l’état complet actualisé ; des notifications peuvent également faire évoluer les options. Cela permet de répercuter les dépendances entre modèle et réglages. [S16]

Les implémentations examinées de Claude ACP, Codex ACP et OpenCode possèdent une gestion des options de session. Il reste nécessaire de vérifier la couverture des versions effectivement distribuées. [S18–S20]

### Catalogue du produit

L’application regroupe les modèles annoncés par les connexions actives. Chaque choix conserve au minimum l’identité de la connexion, celle de l’agent et l’identifiant du modèle.

**Agent et modèle restent deux notions distinctes.** OpenCode est un moteur pouvant utiliser plusieurs fournisseurs. Un même nom de modèle accessible par deux moteurs ne garantit ni les mêmes outils, ni les mêmes instructions, ni le même mode de facturation.

Le sélecteur doit afficher les modèles exposés par l’agent dans son contexte, et non promettre l’accès à tout le catalogue commercial du fournisseur. La présence dans une liste ne garantit pas une requête réussie ou un quota disponible.

## 6. Conversation commune et changement d’agent

### Changement de modèle dans le même agent

Le changement porte sur une option de la session existante. La recommandation initiale est de faire appliquer la sélection au prochain message, après la fin ou l’annulation du tour en cours, pour garder un comportement compréhensible.

### Passage de Claude à Codex ou OpenCode

**ACP n’offre pas de migration universelle de mémoire entre agents.** Charger une session signifie demander à son moteur de restaurer une session qu’il connaît ; l’identifiant d’une session Claude n’est pas une mémoire directement exploitable par Codex. [S17]

L’application doit posséder son propre historique commun et gérer le transfert de contexte. Le schéma de données recommandé comprend :

| Objet | Rôle |
|---|---|
| Conversation | Fil visible commun |
| Messages et événements | Contenu conservé avec sa provenance |
| Session d’agent | Lien entre conversation, connexion et session du moteur |
| Point de synchronisation | Dernier élément du fil transmis à chaque session |
| Sélection active | Connexion, agent et modèle du prochain tour |

Exemple de fonctionnement : l’utilisateur discute avec Claude, sélectionne Codex, puis l’application crée ou reprend la session Codex et lui fournit les éléments pertinents du fil. Lors du retour à Claude, elle transmet ce qui s’est ajouté depuis son dernier tour.

Cette stratégie est une architecture applicative à implémenter. Le transfert peut inclure objectif, décisions, messages pertinents, résultats d’outils et état des fichiers. Il consomme des tokens et ne copie pas les raisonnements internes, les processus en cours ou tous les états privés du moteur. Un répertoire partagé aide à partager les fichiers, pas la mémoire conversationnelle.

## 7. Outils personnalisés et configuration avancée

### Niveau de contrôle retenu

**Construire notre interface, nos instructions, nos outils et notre orchestration est faisable. Remplacer entièrement la boucle interne des moteurs n’est pas une capacité générale d’ACP.**

La boucle Claude, par exemple, continue à appeler le modèle, exécuter les outils et réinjecter les résultats. Les événements exposent l’activité ; ils ne donnent pas automatiquement au client la maîtrise de chaque requête et du contenu exact de son contexte. [S21]

### Claude ACP

Le code vérifié accepte des extensions à la création de session :

| Paramètre | Utilisation |
|---|---|
| `_meta.systemPrompt` | Prompt système personnalisé |
| `_meta.claudeCode.options.tools` | Sélection des outils intégrés ; `[]` les désactive |
| `_meta.claudeCode.options.disallowedTools` | Exclusions d’outils |
| `mcpServers` | Outils MCP apportés par le client |
| `_meta.claudeCode.options.settingSources` | Contrôle des sources de réglages chargées |

L’ancien `_meta.disableBuiltInTools` est un raccourci conservé pour compatibilité. Ces options sont propres à Claude ACP. Certains champs du SDK sont contrôlés ou remplacés par l’adaptateur : il ne faut pas supposer que toute option du SDK traverse librement ACP. Les callbacks JavaScript ne se sérialisent pas dans une requête JSON. [S18, S22]

`allowedTools` est une liste de préautorisation, pas une liste exclusive des outils visibles. Pour supprimer les outils intégrés tout en gardant les outils MCP, la sélection `tools: []` est adaptée ; `disallowedTools: ["*"]` supprimerait aussi les outils MCP. Refuser une exécution et retirer une définition d’outil sont deux opérations différentes. [S23]

### Codex ACP

Le moteur expose des réglages de permissions, sandbox, modèles et MCP. L’adaptateur accepte notamment `CODEX_CONFIG`. La configuration Codex comprend des contrôles de shell, recherche web et filtrage des outils MCP. **La suppression exhaustive de tous les outils intégrés n’a pas été validée.** Un environnement en lecture seule ne signifie pas que le modèle ne voit plus les outils. [S4, S24]

### OpenCode

OpenCode permet des agents personnalisés avec prompts, permissions par outil et outils supplémentaires. Le champ `permission` est à privilégier ; l’ancien champ `tools` est déprécié. Les personnalisations passent par la configuration OpenCode, même lorsque l’interface utilise ACP. [S25, S26]

### Outils communs via MCP

MCP est le format recommandé pour exposer les outils métier communs aux différents moteurs : recherche documentaire, accès aux données, modification d’un projet, demande d’information ou délégation de tâche.

Le serveur d’outils maîtrise les accès, la validation des entrées et les effets exécutés. Le moteur reste responsable de la boucle de décision. Avec Claude Agent SDK directement, des outils TypeScript peuvent également être exposés dans le même processus ; avec un adaptateur ACP externe, un serveur MCP séparé constitue une intégration naturelle. [S27]

## 8. Harness produit et séparation des responsabilités

Le harness métier appartient à l’application. ACP reste la couche de communication avec Claude, Codex et OpenCode ; MCP constitue le format commun pour exposer les outils ; le produit conserve l’état, les règles de workflow, les artifacts, les validations et l’expérience utilisateur.

```text
Application et moteur de workflow
    → sélection du rôle, du provider et du modèle
    → création ou reprise d’une session ACP
    → mise à disposition des outils via MCP
    → collecte des événements, artifacts et résultats
    → application des gates et transitions d’état
```

Le rôle d’un agent ne doit pas être couplé à son provider. Une même opération peut être exécutée par Claude, Codex ou OpenCode sans modifier le workflow métier :

```ts
runAgent({
  role: "dev",
  mode: "review",
  runtime: { agent: "claude", model: "opus" },
  targetRevision: "build-42"
});
```

Les différences de lancement et de configuration restent confinées aux adaptateurs ACP. Le workflow manipule des capacités, des rôles et des artifacts, pas des branches conditionnelles dispersées du type `if Claude / else if Codex`.

### Les trois agents retenus

Trois définitions d’agents suffisent. Les différentes activités sont des **modes d’exécution**, pas de nouveaux agents.

| Agent | Responsabilité | Modes principaux | Écritures autorisées par défaut |
|---|---|---|---|
| **Spec Agent** | Comprendre, rechercher, challenger et formaliser l’intention | `draft`, `clarify`, `research`, `revise`, `validate` | Specs, décisions et critères d’acceptation |
| **Dev Agent** | Concevoir techniquement, prototyper, implémenter, tester et reviewer | `plan`, `prototype`, `implement`, `review`, `fix` | Plans, tâches, code et tests |
| **Doc Agent** | Documenter l’état réellement livré et détecter les divergences | `draft`, `sync`, `audit` | Documentation, guides et changelog |

Une code review agentique est une nouvelle exécution du Dev Agent en mode `review`, dans une session isolée de la session d’implémentation. Lorsque possible, le produit peut sélectionner un autre modèle ou provider. La séparation importante porte sur les exécutions et leur contexte, pas sur la multiplication des personnages.

Le Dev Agent ne modifie pas directement une spec approuvée. S’il découvre une contradiction, il crée une proposition d’amendement qui revient au Spec Agent ou à l’utilisateur. Le Doc Agent ne doit pas inventer le comportement du produit : il compare la spec approuvée, le diff accepté et le produit vérifié.

## 9. Développement piloté par les specs

GitHub Spec Kit est une source d’inspiration méthodologique, pas une dépendance centrale. Son workflow sépare constitution, spécification, plan, tâches, implémentation et convergence. Il propose aussi clarification, analyse de cohérence, checklists et une extension dédiée aux bugs. [S30–S34]

### Concepts repris de Spec Kit

- Séparer le besoin fonctionnel du plan technique.
- Définir des critères d’acceptation observables et testables.
- Versionner les artifacts et les décisions.
- Conserver une traçabilité entre exigences, tâches, code et tests.
- Prévoir des opérations de clarification et de vérification de cohérence.
- Utiliser des principes de projet communs sans construire un prompt monolithique.
- Vérifier la convergence entre spec, implémentation et tests.
- Pour les bugs, séparer diagnostic, correction et vérification.

### Éléments non repris tels quels

- La prolifération de commandes slash et de prompts installés différemment dans chaque agent.
- L’explosion en fichiers Markdown imposés pour chaque étape intermédiaire.
- Les templates rigides dont tous les champs seraient toujours obligatoires.
- Les tâches représentées uniquement par des checkboxes Markdown.
- Les boucles de convergence sans limite d’itérations, de temps ou de tokens.
- Le couplage entre l’état métier de l’application et une organisation précise du filesystem.

Le produit réimplémente ces concepts sous forme d’objets métier, de transitions et de surfaces UI. Les représentations Markdown restent exportables et versionnables, mais ne constituent pas l’unique base de données applicative.

### Spec de fonctionnalité

Une spec fonctionnelle décrit le **quoi** et le **pourquoi** :

- problème, contexte et résultat attendu ;
- utilisateurs et parcours concernés ;
- périmètre et hors périmètre ;
- exigences fonctionnelles ;
- critères d’acceptation ;
- cas limites ;
- exigences non fonctionnelles ;
- contraintes produit, sécurité et conformité ;
- questions ouvertes et décisions humaines ;
- prototypes associés.

Le framework, les fichiers à modifier, les migrations et le découpage en tâches appartiennent au plan technique produit par le Dev Agent. Cette séparation reprend le principe des templates `spec.md` et `plan.md` de Spec Kit sans en imposer la structure exacte. [S31, S32]

### Workflow feature

```text
DRAFT
→ NEEDS_INPUT
→ SPEC_REVIEW
→ SPEC_APPROVED
→ PROTOTYPING ou PLANNING
→ BUILDING
→ AGENT_REVIEW
→ HUMAN_REVIEW
→ ACCEPTED
→ DOCUMENTING
→ DONE
```

`CHANGES_REQUESTED` renvoie vers la dernière étape capable de résoudre la demande : révision de spec, modification de prototype, correction de code ou mise à jour documentaire. Les petites modifications peuvent sauter le prototype, mais pas la définition du résultat attendu ni les validations requises par leur niveau de risque.

### Spec et workflow spécifiques aux bugs

Un bug possède un artifact plus court et plus factuel qu’une feature spec :

| Champ | Contenu attendu |
|---|---|
| Comportement observé | Symptôme effectivement constaté |
| Comportement attendu | Référence fonctionnelle ou résultat souhaité |
| Reproduction | Étapes, environnement et fréquence |
| Preuves | Logs, traces, captures, requêtes et fichiers concernés |
| Impact | Utilisateurs, données et sévérité |
| Cause | Statut `suspected` ou `confirmed`, avec preuves |
| Contraintes de correction | Invariants à préserver et limites de périmètre |
| Risques de régression | Zones et parcours à revérifier |
| Critères d’acceptation | Résultat de la reproduction et tests attendus |
| Impact documentaire | Aucun, interne ou visible utilisateur |

```text
REPORTED
→ REPRODUCING
→ DIAGNOSED
→ FIX_PLANNED
→ FIXING
→ VERIFYING
→ AGENT_REVIEW
→ HUMAN_REVIEW
→ DOCUMENTING
→ DONE
```

Le Spec Agent ne modifie pas le code pendant le diagnostic. Le Dev Agent ne présente pas comme confirmée une cause seulement supposée. Un test de régression est requis par défaut ; s’il est impossible, l’absence doit être justifiée. Une reproduction non exécutée reste explicitement `not-run` ou `partial`, jamais `verified`.

Spec Kit applique déjà des garde-fous utiles : les étapes d’évaluation et de test ne modifient pas le code, seule l’étape de correction le fait, et un résultat non réellement testé ne peut pas être surévalué. [S34]

## 10. Prototypes et reviews comme objets de première classe

Un prototype n’est pas seulement une branche. Il référence au minimum une révision de spec, une variante, un commit, un environnement, une URL de preview, des captures et les retours reçus.

```ts
interface Prototype {
  id: string;
  specRevisionId: string;
  variant: string;
  branch: string;
  environmentId: string;
  commitSha: string;
  previewUrl?: string;
  screenshots: ArtifactReference[];
  status: "creating" | "ready" | "under-review" |
          "selected" | "rejected" | "archived";
}
```

Le produit peut ainsi produire plusieurs propositions isolées, les afficher côte à côte, recueillir des annotations humaines, demander des itérations, promouvoir la variante retenue et archiver les autres. Les retours sur prototype deviennent des décisions ou une nouvelle révision de spec ; ils ne restent pas enfermés dans le chat.

### Modèle commun de review

Les reviews humaines et agentiques utilisent la même structure et se distinguent par leur auteur :

```ts
interface Review {
  id: string;
  targetType: "spec" | "prototype" | "build" | "documentation";
  targetRevision: string;
  reviewer: {
    type: "human" | "agent";
    id: string;
    provider?: "claude" | "codex" | "opencode";
    model?: string;
  };
  verdict: "approved" | "changes-requested" | "commented";
  findings: Finding[];
}
```

Un finding conserve sévérité, catégorie, message, preuve, emplacement éventuel, correction proposée et état de résolution. Une nouvelle review ne supprime jamais les commentaires précédents. L’UI doit montrer la réponse apportée, le changement réalisé et la décision de résolution ou de rejet.

### Modèle métier central

```text
Project
├── ProjectPolicy
├── WorkItem
│   ├── type: FEATURE | BUG
│   ├── SpecRevision[]
│   ├── Decision[]
│   ├── PlanRevision[]
│   ├── Task[]
│   ├── Prototype[]
│   ├── Build[]
│   ├── Review[]
│   ├── Artifact[]
│   └── AgentRun[]
└── Environment[]
```

Chaque exécution conserve la révision de spec utilisée, le commit de départ, le provider, le modèle, la configuration d’agent, les outils autorisés, l’environnement, les artifacts produits, les limites et le résultat. Cette provenance est nécessaire pour reproduire et expliquer les décisions de l’agent.

## 11. Environnements de développement et DevFlow

DevFlow correspond à la couche d’environnements isolés du harness, pas au protocole agent ni au moteur de workflow. Son modèle fournit un worktree, des ports, une base Postgres, des fichiers `.env`, des dépendances, des serveurs et des logs propres à chaque branche. Son interface non interactive, ses sorties JSON, ses erreurs structurées et ses logs persistants sont adaptées aux agents. [S38]

La distinction LITE/FULL est retenue comme principe :

| Activité | Environnement recommandé |
|---|---|
| Lecture du dépôt par le Spec Agent | LITE |
| Analyse du Doc Agent | LITE |
| Review statique | LITE |
| Implémentation | FULL |
| Prototype exécutable | FULL |
| Review navigateur ou E2E | FULL |

Le produit doit toutefois rester propriétaire de l’état. Un agent ne crée pas silencieusement un environnement par une commande Bash que l’UI découvrirait après coup. Il demande l’opération au harness ; l’orchestrateur l’exécute, publie les événements et renvoie à l’agent un identifiant, les chemins et l’URL.

```ts
interface EnvironmentManager {
  create(input: CreateEnvironmentInput): Promise<Environment>;
  promote(id: string): Promise<Environment>;
  start(id: string): Promise<void>;
  logs(id: string, options?: LogOptions): Promise<LogChunk>;
  diff(id: string): Promise<DiffArtifact>;
  destroy(id: string): Promise<void>;
}
```

DevFlow peut être utilisé derrière cette interface ou ses concepts peuvent être réimplémentés. L’UI et le modèle métier ne dépendent pas directement du CLI. Les limites actuelles relevées dans son README — développement principalement macOS, absence de support Windows, orientation Postgres et détection optimisée pour certains monorepos — doivent être intégrées au plan de portabilité. [S38]

## 12. Briques techniques du harness

### Recherche de code : `tgrep`

`tgrep` est retenu comme moteur possible pour les grands dépôts. Son index trigramme et son serveur local accélèrent fortement les recherches regex répétées ; son flux JSON facilite l’intégration depuis TypeScript. Il ne remplace ni la recherche sémantique ni l’analyse de symboles. Sur les petits dépôts ou lorsqu’une fraîcheur absolue est nécessaire, `ripgrep` ou le mode sans index restent préférables. [S35, S36]

Le modèle appelle un outil stable du produit, par exemple `code_search`, et le harness choisit l’implémentation. La construction initiale et l’état de fraîcheur de l’index doivent être contrôlés avant de considérer une absence de résultats comme définitive.

### Ingestion documentaire : MarkItDown

MarkItDown est retenu comme convertisseur d’entrée pour PDF, DOCX, PPTX, XLSX, HTML, images, audio et autres formats vers un Markdown destiné aux LLM. L’intégration recommandée est un worker Python isolé derrière un outil typé du harness. MarkItDown n’est pas une solution d’édition ou de reconstruction haute fidélité des documents ; la génération de livrables conserve une couche dédiée. Les fichiers non fiables sont traités dans une sandbox avec les privilèges minimaux. [S37]

### Compression de contexte : Headroom

Headroom reste une expérimentation optionnelle, pas une dépendance critique. Sa bibliothèque TypeScript, son serveur MCP et ses mécanismes de compression réversible sont intéressants pour les sorties d’outils volumineuses et les longues sessions. Le proxy qui intercepte les communications internes de Claude ou Codex n’est pas retenu comme fondation de l’accès par abonnement. [S39]

La première intégration, si les évaluations la justifient, se place uniquement sur les données contrôlées par le produit : le résultat brut est conservé comme artifact, une version compacte est transmise au modèle et celui-ci peut récupérer l’original. Un feature flag et des évaluations comparent réussite, omissions, tokens, latence et fréquence de récupération. La mémoire canonique des specs et décisions reste dans le stockage du produit.

### Principes de harness retenus

Les travaux consultés convergent sur plusieurs principes : un agent est le modèle plus tout son environnement d’exécution ; chaque échec récurrent doit améliorer le harness ; les instructions orientent, tandis que les tests, linters, hooks et autres sensors vérifient ; les contrôles déterministes sont privilégiés avant le jugement par un autre LLM. [S40–S43]

Ces principes conduisent à conserver des règles courtes et traçables, à exposer progressivement la documentation utile, à rendre les environnements et les résultats observables, et à transformer les retours de review en améliorations durables plutôt qu’en corrections ponctuelles du chat.

## 13. Périmètre de réimplémentation

Le cœur différenciant à réimplémenter comprend :

- moteur de workflow et transitions d’état ;
- modèle de specs et gestion des révisions ;
- rôles, modes et politiques d’outils des agents ;
- décisions, tâches, artifacts et provenance ;
- gates de validation ;
- reviews humaines et agentiques ;
- gestion et comparaison des prototypes ;
- registre des environnements et previews ;
- événements temps réel, observabilité et UI ;
- synchronisation entre spec, code et documentation.

Les briques commoditaires restent remplaçables derrière des interfaces : ACP pour les agents, MCP pour les outils, Git et worktrees pour les versions, Docker pour l’isolation, MarkItDown pour l’extraction documentaire et `ripgrep`/`tgrep` pour la recherche textuelle.

**Décision structurante : trois agents stables, plusieurs modes d’exécution, deux types initiaux de work items (`FEATURE` et `BUG`), des reviews comme gates et les prototypes comme artifacts exécutables de la spec.**

## 14. Limites et points à éprouver

Les validations de cette phase sont documentaires et reposent également sur la lecture de code. Elles ne constituent pas encore une validation de bout en bout avec des comptes connectés.

Les points suivants restent à vérifier lors du prototype :

- Consommation effective des quotas des deux abonnements, avec les versions et méthodes de connexion retenues.
- Compatibilité du parcours produit précis avec les conditions Anthropic ; absence de garantie générale tirée du seul exemple T3 Code.
- Couverture réelle des modèles, options, reprises et annulations dans les versions distribuées des adaptateurs.
- Désactivation effective des outils souhaités, particulièrement côté Codex.
- Installation, mise à jour et isolation des configurations et des comptes.
- Qualité, coût et stratégie du transfert de contexte entre agents.
- Gestion des extensions non standard et des événements inconnus.

Ne sont pas encore arrêtés : framework d’interface, packaging desktop ou web avec compagnon local, base de données, hébergement et politique exacte de résumé de conversation.

## 15. Autres bibliothèques examinées

**Sandbox Agent** fournit une interface commune avec SDK TypeScript et serveur HTTP/SSE pour plusieurs agents, en local ou dans un environnement distant. C’est une alternative à évaluer si l’exécution distante devient centrale ; ce n’est pas une dépendance arrêtée ni une garantie d’accès aux abonnements. [S28]

**spawn-agent** propose une interface compatible Vercel AI SDK au-dessus d’ACP. Elle peut accélérer un prototype, mais sa maturité n’a pas été suffisamment établie pour en faire la dépendance centrale. [S29]

Le socle conservé dans ce document est donc le client ACP officiel et les adaptateurs actuels, avec une couche produit pour la continuité du chat et une couche de configuration propre à chaque moteur.

## Sources

Sources consultées pendant la recherche, état au 8 septembre 2026. Les liens vers `main` ou `dev` évoluent : les versions et commits devront être figés lors de l’implémentation.

- **S1** — [Vue d’ensemble ACP v1](https://agentclientprotocol.com/protocol/v1/overview)
- **S2** — [SDK TypeScript ACP](https://github.com/agentclientprotocol/typescript-sdk)
- **S3** — [Claude Agent ACP](https://github.com/agentclientprotocol/claude-agent-acp)
- **S4** — [Codex ACP maintenu](https://github.com/agentclientprotocol/codex-acp)
- **S5** — [Support ACP dans OpenCode](https://opencode.ai/docs/acp/)
- **S6** — [Ancien adaptateur Codex et annonce de migration](https://github.com/zed-industries/codex-acp)
- **S7** — [Authentification Codex](https://learn.chatgpt.com/docs/auth)
- **S8** — [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- **S9** — [Usage du Claude Agent SDK avec un abonnement et suspension du changement de facturation](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- **S10** — [Conditions d’intégration et d’authentification Claude Code](https://code.claude.com/docs/en/legal-and-compliance)
- **S11** — [Présentation Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- **S12** — [Adaptateur Claude de T3 Code](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/ClaudeAdapter.ts)
- **S13** — [Site T3 Code](https://t3.codes/)
- **S14** — [Fournisseurs OpenCode et restriction Claude](https://opencode.ai/docs/providers/#anthropic)
- **S15** — [Authentification ACP](https://agentclientprotocol.com/protocol/v1/authentication)
- **S16** — [Options de session ACP](https://agentclientprotocol.com/protocol/v1/session-config-options)
- **S17** — [Création et reprise des sessions ACP](https://agentclientprotocol.com/protocol/v1/session-setup)
- **S18** — [Implémentation de Claude ACP](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/acp-agent.ts)
- **S19** — [Configuration de modèle Codex ACP](https://github.com/agentclientprotocol/codex-acp/blob/main/src/ModelConfigOption.ts)
- **S20** — [Implémentation ACP OpenCode](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/acp/agent.ts)
- **S21** — [Boucle d’exécution Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- **S22** — [Extensions ACP](https://agentclientprotocol.com/protocol/v1/extensibility)
- **S23** — [Permissions et sélection d’outils Claude](https://code.claude.com/docs/en/agent-sdk/permissions)
- **S24** — [Référence de configuration Codex](https://learn.chatgpt.com/docs/config-file/config-reference)
- **S25** — [Agents personnalisés OpenCode](https://opencode.ai/docs/agents/)
- **S26** — [Outils OpenCode](https://opencode.ai/docs/tools/)
- **S27** — [Outils personnalisés Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/custom-tools)
- **S28** — [Sandbox Agent](https://github.com/rivet-dev/sandbox-agent)
- **S29** — [spawn-agent](https://github.com/millionco/spawn-agent)
- **S30** — [GitHub Spec Kit](https://github.com/github/spec-kit)
- **S31** — [Template de feature spec de Spec Kit](https://github.com/github/spec-kit/blob/main/templates/spec-template.md)
- **S32** — [Template de plan technique de Spec Kit](https://github.com/github/spec-kit/blob/main/templates/plan-template.md)
- **S33** — [Template de tâches de Spec Kit](https://github.com/github/spec-kit/blob/main/templates/tasks-template.md)
- **S34** — [Extension bug de Spec Kit](https://github.com/github/spec-kit/tree/main/extensions/bug)
- **S35** — [`tgrep`](https://github.com/microsoft/tgrep)
- **S36** — [Guide `tgrep` pour les coding agents](https://github.com/microsoft/tgrep/blob/main/AGENTS.md)
- **S37** — [Microsoft MarkItDown](https://github.com/microsoft/markitdown)
- **S38** — [DevFlow — README fourni pour l’analyse](https://github.com/leoleducq/devflow)
- **S39** — [Headroom](https://github.com/headroomlabs-ai/headroom)
- **S40** — [Mitchell Hashimoto — My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey)
- **S41** — [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/)
- **S42** — [Birgitta Böckeler — Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)
- **S43** — [Addy Osmani — Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/)
