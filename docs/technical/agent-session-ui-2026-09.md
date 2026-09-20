# Surface UI d'une Session avec un agent — recherche du 16 septembre 2026

Date : 2026-09-16. Portée : l'écran qui suit « Sessions libres », c'est-à-dire celui où
l'utilisateur parle à un agent ACP et voit ce qu'il fait. Objectif : rassembler assez de
matière pour en tirer un prototype HTML et une liste de composants. Les noms de composants et
de props restent en anglais ; le reste est en français.

Sources primaires consultées le 16 septembre 2026 : les pages de composants de beui.dev, la
documentation Zed (`zed.dev/docs/ai`), la documentation Claude Code (`code.claude.com/docs`),
la spécification Agent Client Protocol (`agentclientprotocol.com`) et la documentation Cursor
et OpenCode. Les URL sont listées en fin de document.

## Synthèse

Un écran de Session est un **fil chronologique** dans lequel tout ce que fait l'agent est un
bloc, plus une **zone d'écriture** en bas, plus une **colonne latérale** qui ne sert qu'aux
choses devant rester visibles quand on défile : le plan, le récapitulatif des fichiers
touchés, le mode courant. Les trois produits de référence convergent là-dessus : Zed met le
fil dans le panneau agent et sort la revue des diffs dans un onglet multi-buffer ; Claude Code
met tout dans le fil et ne sort que la to-do list (`Ctrl+T`) et le transcript détaillé
(`Ctrl+O`) ; Cursor montre le diff en direct dans l'éditeur et garde le fil pour la
conversation.

Trois points structurent le reste :

1. **Le fil n'est pas une liste de messages, c'est une liste d'événements** — texte, pensée,
   appel d'outil, diff, sortie de terminal, plan, demande de permission. ACP l'exprime déjà
   ainsi : un seul type `session/update` avec un discriminant `sessionUpdate`.
2. **Les appels d'outils se replient.** Tous les produits observés affichent un résumé d'une
   ligne (titre + statut) et n'ouvrent le contenu qu'à la demande, sauf pendant l'exécution où
   le bloc reste ouvert puis se referme à la fin. beui code exactement ce comportement via
   `collapseOnComplete`.
3. **Une question à l'utilisateur bloque le tour.** Permission ou choix : le fil s'arrête, le
   bloc de décision est le dernier élément, le composer passe en état « en attente ».

beui couvre presque tout le besoin (message, activité, outil, diff, approbation, composer) et
est sous licence MIT, distribué en registry shadcn. Ce qui manque : la sortie de terminal en
direct, la revue de diff avec accept/reject par hunk, l'indicateur de mode de session, la
palette de commandes disponibles, et l'affichage d'un bloc bloquant permanent.

## 1. Les composants « agents » de beui

**Licence et distribution.** Dépôt `github.com/starc007/ui-components`, licence MIT. Les
composants sont distribués via un registry shadcn sous le namespace `@beui` :
`npx shadcn@latest add @beui/<nom>` (les pages montrent `bunx --bun shadcn add @beui/<nom>` ;
Hemera n'utilise pas Bun, donc la forme `npx` ou `pnpm dlx` s'applique). Le README assume le
modèle « Copy the source, own the code » : le code vit dans l'application, pas derrière un
paquet. Cela reste une source d'inspiration : la règle Hemera est d'écrire les composants
maison, jamais de recopier le markup.

Socle commun à tous : `motion/react`, `lucide-react`, `clsx` + `tailwind-merge` (`cn()`),
`shiki` pour la coloration, et des jetons d'easing partagés (`EASE_OUT`, `SPRING_PRESS`,
`SPRING_SWAP`, `SPRING_LAYOUT`, `SPRING_PANEL`). Tous déclarent respecter
`prefers-reduced-motion` via un hook `useReducedMotion`.

| Composant | Rôle | États | Animé | Props notables |
|---|---|---|---|---|
| `prompt-input` | Composer auto-grandissant : textarea, sélecteur de modèle, popover d'actions, bouton submit/stop | idle, loading, focus | échange flèche ↔ carré (`SPRING_SWAP`), rotation 45° du `+`, bordure au focus | `value`, `models`, `actions`, `loading`, `onSubmit`, `minRows`=2, `maxRows`=8 |
| `message` | Primitives de rangée : `Message`, `MessageGroup`, `MessageAvatar`, `MessageContent/Header/Footer`, `MessageMarker`, `MessageTyping` | from user/assistant | entrée opacité 0→1 + `translateY(8px) scale(.95)`, ressort 480/32 ; typing 3 points, cycle 1,05 s, décalage 0,14 s | `from`, `animateIn`, `spacing` compact/default, `placeholder` |
| `message-bubble` | Surface de bulle : `MessageBubble`, `MessageBubbleContent`, `MessageBubbleGroup`, `MessageBubbleCollapsible` | 6 variantes `solid/soft/tint/outline/ghost/danger` | pop `scale .92→1` (ressort 520/27), contenu en fondu après la surface, chevron + masque au dépli | `variant`, `align` start/end, `animateIn`, `collapsedLines` 2–6 (déf. 4) |
| `message-scroller` | Viewport conscient du lecteur : suit le bord vif, relâche quand on remonte ; rail de navigation optionnel | following / not following | défilement doux ou instantané selon `smooth` et reduced-motion ; ticks du rail mis à l'échelle selon la proximité du centre | `followOutput`=true, `followThreshold`=56 px, `smooth`=true, `navigation:"rail"`, `busy`, `onFollowChange`, `viewportClassName` |
| `streaming-response` | Surface de réponse stable : contenu rendu, barre d'actions de fin, disclosure des sources | `streaming` (avec `aria-busy="true"`, pas d'actions), `complete`, `error` | barre d'actions en fondu + translation (200 ms), pression bouton `scale .9`, révélation des sources par `clip-path` | `status`, `copyText`, `sources: CitationItem[]`, `feedback` up/down/null, `announce`=true, `showActions` |
| `citations` | Marqueurs inline + collection repliable | ouvert/fermé | apparition progressive à ressort, rotation du chevron, `popLayout` pour le reflow | `citations`, `title` (déf. « Sources »), `defaultOpen`, `onOpenChange`, `idPrefix` ; `Citation` prend `citationId`, `index`, `idPrefix` |
| `agent-loading-states` (paquet `@beui/reasoning-text`) | Trois états d'attente : `ReasoningText` (phrases qui tournent + shimmer), `ThinkingShimmer` (shimmer discret), `AgentProgress` (glyphe + verbe + chrono) | en cours seulement | cascade de caractères, shimmer continu, grille 3×3 pulsée, loader ASCII | `phrases`, `variant` cascade/swap/scramble, `interval`=1800 ms, `shimmerDuration`=2,2 s ; `label`, `running`, `elapsedSeconds` |
| `todo-list` | Plan de tâches repliable avec compteur | par item : pending (cercle pointillé), in-progress (arc de progression + %), completed (cercle plein, texte barré), cancelled (croix rouge) | morphing des marques de statut, arc, rature, compteur roulant (`ActionSwapRollText`), collapse | `items: TodoItem[]` (id, title, status, progress, detail), `title` (déf. « To-dos »), `open`/`defaultOpen`, `collapseOnComplete`=true, `maxHeight`=248 |
| `agent-activity` | Flux d'activité adaptatif : raisonnement, recherches, appels d'outils, ou mélange chronologique | `working` (suit le flux par `transform`, masque dégradé aux bords), `complete` (défilement rendu à l'utilisateur, replié) | fondus décalés à l'arrivée, décalage vertical par transform, chevron, `SPRING_LAYOUT` | `items: AgentActivityItem[]`, `status`, `maxHeight`=208, `collapseOnComplete`=true, `contentType` (déf. `mixed`), `duration` |
| `tool-result` | Disclosure d'exécution d'un outil avec sortie colorée | `running` (loader, auto-scroll, reste ouvert), `success`, `error`, `cancelled` | titre en texte roulant, chevron 180° (`SPRING_SWAP`), auto-scroll, pression `scale .9`, révélation `clip-path` | `tool`, `title`, `status`, `kind` terminal/request/custom, `copyText`, `onRetry`, `maxHeight`=220, `collapseOnComplete`=true |
| `code-block` | Code coloré à mise à jour stable | `streaming`, `complete` | auto-scroll en `useLayoutEffect` quand le contenu dépasse, loader → check, pression du bouton copier | `code`, `language` (bash, diff, json, text, tsx, typescript), `status`, `highlightLines`, `maxHeight`=280, `showLineNumbers`=true, `copyable`=true ; Shiki, thèmes GitHub light/dark high-contrast, tokens mis en cache |
| `file-diff` | Diff de fichier coloré, lignes progressives, compteur vif | `streaming` (spinner, auto-scroll, ouvert), `complete` (check, replie) | surlignage vert/rouge par ligne, défilement doux, échange d'icône du bouton copier (1,6 s) | `file`, `lines: FileDiffLine[]`, `status`, `language`, `maxHeight`=220, `collapseOnComplete`=true, `copyText` |
| `tool-approval` | Carte de permission : revue des paramètres puis décision | `pending` (ambre), `approving` (bleu, loader), `approved`/`complete` (vert), `denied`/`error` (rouge), `running` | transitions de statut à ressort, couleur de l'indicateur | `tool`, `title`, `description`, `parameters` (label/value), `status`, `onApprove`, `onAlwaysAllow`, `onDeny` — soit « Allow once », « Always allow », « Deny » |
| `approval-card` | Surface de décision générique : approbation, question à choix unique ou multiple, réponse libre, flux multi-étapes | `pending`, `submitting`, `approved`, `rejected`, `changes-requested`, `answered` | titre roulant, points de progression, glissement des questions (`AnimatePresence`), révélation `clip-path` | `questions`, `status`, `onApprove`, `onReject`, `onRequestChanges`, `answers`/`onAnswersChange`, `step`/`onStepChange`, `result` |
| `ai-sidebar` | Barre latérale d'espace de travail : dossiers, fichiers, favoris, navigation clavier, déplacement optimiste, renommage inline, libellés en marquee | replié/déplié, drag, édition inline | layout à ressort, cibles de dépôt, popover morphé, marquee, rollback si `onMove` rejette | `items`/`defaultItems`, `onMove`, `onRename`, `activeId`, `defaultExpandedIds`, `renderIcon`/`renderMenu`, `ariaLabel` |
| `chat-app` | Assemblage complet : sidebar + scroller + composer + activité + approbation + outil + diff + plan + médias | — | plie la sidebar hors-champ sous le seuil | `sidebarWidth` (déf. `17rem`), `collapseSidebarBelow` (déf. 600 px) |
| `image-generation` | Surface d'image générée à raffinement progressif | `queued` (flou fort, opacité 0), `generating`, `refining` (~62 %), `complete`, `error` | `DitherMark` rotatif, `DitherField` sur canvas suivant le pointeur, disparition du dither à la fin, « sans layout shift » | `status`, `children` (img/video/canvas), `prompt`, `resolution` (déf. `1024 × 1024`), `interactive`, `onRetry` |

Deux dépendances internes reviennent partout et sont à reproduire côté Hemera :
`AgentDisclosure` (conteneur repliable animé par `clip-path`/transform, réutilisé par
`todo-list`, `agent-activity`, `tool-result`, `file-diff`, `tool-approval`, `approval-card`,
`citations`) et `ActionSwapRollText` (échange de texte roulant pour les titres et compteurs).
`image-generation` n'a pas d'usage dans Hemera.

## 2. Comment trois produits de référence disposent une session

### Zed — panneau agent (ACP de bout en bout)

- **Disposition** : le fil est chronologique dans le panneau agent, latéral. Les messages de
  l'utilisateur sont des **cartes éditables** ; les réponses du modèle arrivent en flux. Des
  flèches en bas du panneau sautent au dernier prompt ou au début du fil. Les agents externes
  sont hébergés dans ce même panneau, plus une « Threads Sidebar » pour les fils parallèles.
- **Appels d'outils** : « les réponses arrivent avec des indicateurs montrant quels outils le
  modèle utilise ». Les éditions sont agrégées dans une barre accordéon qui dit **quels
  fichiers, combien, et combien de lignes** ont changé.
- **Permissions** : les appels sous permission peuvent être « allowed, denied, or confirmed ».
  Un modèle sans capacité d'outil porte l'étiquette « No tools » ; une icône d'avertissement
  signale une incompatibilité MCP.
- **Diff et acceptation** : soit on déplie l'accordéon, soit on clique **Review Changes** pour
  ouvrir un onglet multi-buffer avec toutes les modifications ; on accepte ou rejette **chaque
  hunk individuellement, ou l'ensemble**. Le réglage `agent.single_file_review` donne à la
  place un diff inline mono-fichier.
- **Retour en arrière** : à chaque édition, un bouton **Restore Checkpoint** apparaît.
- **Suivi** : une icône en croix de visée fait suivre l'agent — l'éditeur saute à chaque
  fichier touché (ACP appelle ça les `locations` d'un appel d'outil).
- **Contexte** : mentions `@` pour fichiers, dossiers, symboles ; un extrait multi-lignes
  collé devient automatiquement une mention de contexte.
- Non vérifié : la liste des réglages UI (`always_allow_tool_actions`, `expand_edit_card`,
  `notify_when_agent_waiting`…) ne figure pas sur la page `agent-settings` consultée.

### Claude Code — conventions du terminal

- **Tout est dans le fil.** Les appels d'outils apparaissent comme des lignes condensées ; le
  détail est dans le **transcript viewer** (`Ctrl+O`) qui « montre l'usage et l'exécution
  détaillés des outils, avec horodatage et modèle sur chaque message de l'assistant » et
  déplie les lignes normalement condensées — par exemple plusieurs appels MCP réduits à
  `Called slack 3 times`. C'est un modèle de **résumé par défaut, détail à la demande** au
  niveau du fil entier, pas seulement du bloc.
- **Modes de permission** en cycle avec `Shift+Tab`, avec un indicateur permanent en barre de
  statut : `⏸ manual mode on` (`default`), `⏵⏵ accept edits on`, `⏸ plan mode on`,
  `⏵⏵ auto mode on`, `⏵⏵ don't ask on`, `⏵⏵ bypass permissions on`.
- **Invite de permission** : options « Yes », « Yes, and don't ask again » (règle sauvegardée,
  ou « pour le reste de la session » selon le type d'outil), « No ». `Esc` décline. `Tab` sur
  Yes ou No ouvre un **champ de commentaire** joint à la réponse — les options « ne plus
  demander » n'en acceptent pas. Les flèches gauche/droite naviguent entre onglets de dialogue.
  Le produit note que les options larges ne sont offertes que « quand l'invite peut montrer
  tout ce qu'elles autoriseraient ».
- **Plan mode** : l'agent lit et explore mais n'édite pas ; les éditions sont bloquées jusqu'à
  approbation. Quand le plan est prêt, il est présenté avec trois choix : **« Yes, and use auto
  mode »** (ou « Yes, auto-accept edits » si auto est indisponible), **« Yes, manually approve
  edits »**, **« No, keep planning »**. `Ctrl+G` ouvre le plan dans l'éditeur pour le corriger
  avant de continuer. Approuver un plan change le mode de permission de la session.
- **Liste de tâches** : `Ctrl+T` bascule la vue, **cinq tâches affichées à la fois**, état
  pending / in progress / complete, persistée entre sessions, repliée quand elle est vide.
- **Interruption** : `Esc` arrête la réponse ou l'appel d'outil en cours en gardant le travail
  fait ; les messages mis en file sont envoyés ensuite. `Esc Esc` sur entrée vide ouvre le menu
  de rewind (checkpoints).

### Cursor — revue des changements

Le diff « montre les changements au fur et à mesure » directement dans l'éditeur, avec un
bouton **Stop** (et `Cmd+Shift+Backspace`) pour arrêter en cours de route. Après coup, un
bouton **Review** puis **Find Issues** lance une relecture ligne à ligne des éditions
proposées ; l'onglet Source Control compare à la branche principale. La documentation
consultée ne détaille pas de mécanisme accept/reject par hunk — non vérifié.

OpenCode (TUI) apporte deux idées utiles : `/details` bascule globalement l'affichage du
détail d'exécution des outils, `diff_style` vaut `auto` ou `stacked`, et un système
d'« attention » (notification bureau + son) prévient sur **question, permission, erreur de
session et session terminée**. Pertinent pour Hemera, qui est une application de bureau.

## 3. Correspondance `session/update` → élément d'UI

ACP transporte tout le déroulé d'un tour dans des notifications `session/update` portant un
discriminant `sessionUpdate`.

| `sessionUpdate` | Charge utile | Élément d'UI | Pièce beui |
|---|---|---|---|
| `agent_message_chunk` | `content` (text), `messageId` stable sur une même logique de message | bulle assistant en flux, markdown rendu, actions à la fin | `streaming-response` dans `message` |
| `agent_thought_chunk` | contenu de raisonnement | bloc « thinking » replié, résumé « Thought for Xs » | `agent-activity` (type reasoning) + `ThinkingShimmer` |
| `user_message_chunk` | contenu utilisateur renvoyé par l'agent | bulle utilisateur (utile en reprise de session) | `message-bubble` variante `tint`, `align:"end"` |
| `tool_call` | `toolCallId`, `title`, `kind`, `status:"pending"`, `rawInput`, `locations` | rangée d'outil repliée, icône selon `kind` | `tool-result` (statut `running`) |
| `tool_call_update` | statut `pending` → `in_progress` → `completed`/`failed`, `content[]`, `rawOutput` | mise à jour de la même rangée par `toolCallId` | `tool-result` ; `collapseOnComplete` |
| contenu `content` | blocs text / image / resource | corps du bloc d'outil | `tool-result` + `code-block` |
| contenu `diff` | `path` absolu, `oldText` (null si fichier neuf), `newText` | diff replié avec compteur +/− | `file-diff` |
| contenu `terminal` | `terminalId`, sortie en direct, persistante après libération | console en direct qui suit le bord vif | **manque** (`tool-result kind:"terminal"` est statique) |
| `plan` | `entries[]` : `content`, `priority` high/medium/low, `status` pending/in_progress/completed ; **le client DOIT remplacer le plan entier** | plan épinglé, cases d'état, compteur | `todo-list` (pas de priorité, à ajouter) |
| `available_commands_update` | `availableCommands[]` : `name`, `description`, `input.hint` optionnel | autocomplétion `/` dans le composer | `prompt-input` (`actions`) — la liste dynamique manque |
| `current_mode_update` | `currentModeId` | indicateur de mode persistant près du composer | **manque** |
| `usage_update` | `used`, `size`, `cost { amount, currency }` | jauge de contexte / coût | **manque** |

`kind` d'un appel d'outil vaut `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`,
`fetch`, `other` — ACP dit explicitement que ce champ sert à choisir icône et traitement
visuel (un `delete` ne se présente pas comme un `read`). Les `locations` (chemin absolu +
ligne optionnelle) existent pour la fonction « follow-along » de Zed : dans Hemera elles
rendent le titre d'un bloc d'outil cliquable.

Ce qui manque côté beui, en clair : **terminal en direct**, **indicateur de mode**, **palette
de commandes dynamique**, **jauge d'usage**, **priorité de plan**, **revue de diff avec
accept/reject**, et **un bloc bloquant qui ne se replie pas**.

## 4. Demandes de permission

ACP : `session/request_permission` porte `sessionId`, un `toolCall` (`ToolCallUpdate`, donc le
titre, le `kind`, et déjà le contenu — y compris un diff) et des `options: PermissionOption[]`.
Chaque option a un `kind` parmi `allow_once`, `allow_always`, `reject_once`, `reject_always`.
La réponse est un `RequestPermissionOutcome` : `selected` avec l'`optionId`, ou `cancelled`
quand un `session/cancel` est passé par là.

UI recommandée pour Hemera :

- **Dans le fil, à la place du bloc d'outil concerné**, pas dans une modale : la demande porte
  sur un appel déjà annoncé, et la modale coupe l'utilisateur du contexte qui la justifie.
  C'est le choix de beui (`tool-approval`), de Zed (allow/deny/confirm dans le fil) et de
  Claude Code.
- **Contenu obligatoire** : le nom de l'outil, une phrase de ce qu'il fera, les paramètres
  décisifs (`parameters` label/valeur, commande ou chemin en code coloré), et le diff complet
  quand le `toolCall` en porte un — on n'approuve pas une édition sans la voir.
- **Boutons dans l'ordre du risque croissant** : `reject_once` en action secondaire,
  `allow_once` en action primaire, `allow_always` en tertiaire explicite et distinct, parce
  qu'il crée une règle persistante. Les options viennent du serveur : l'UI **itère sur
  `options`**, elle ne code pas trois boutons en dur. `reject_always` existe et doit être
  rendu quand il est envoyé.
- **Règle de Claude Code à reprendre** : n'offrir un « toujours » que si l'invite montre
  l'étendue exacte de ce qu'il autorise ; sinon, une seule fois. Et dire où la règle est
  enregistrée (session, ou projet).
- **Raccourcis** : `Enter` sur l'option focalisée, `Esc` = rejet une fois, flèches pour
  changer d'option. Un champ de commentaire facultatif sur le rejet (idée du `Tab` de Claude
  Code) donne à l'agent de quoi corriger sa trajectoire.

**Le fil pendant le blocage** : la carte de permission est le dernier élément et **ne se
replie pas** ; le `message-scroller` défile jusqu'à elle et le focus clavier y va. Les blocs
d'activité en cours passent de `working` à un état neutre « en attente », l'indicateur de
progression s'arrête (il mentirait), et le composer affiche « en attente de votre réponse »
avec le bouton stop toujours actif — `session/cancel` reste possible et se traduira par un
`cancelled`. Une notification bureau + son quand la fenêtre n'a pas le focus, comme OpenCode
le fait pour question et permission. Après réponse, la carte se replie en une ligne portant la
décision et l'horodatage, puis le fil reprend.

## 5. Rendu du texte en flux

- **Markdown par morceaux** : parser à chaque chunk et rendre l'arbre, sans jamais réécrire le
  DOM déjà posé. Le point dur est le markdown incomplet — une clôture de bloc de code ou de
  gras pas encore arrivée. La parade : tolérer les nœuds ouverts (fermer virtuellement en fin
  de buffer) et ne mémoïser que les blocs terminés, repérés par index stable. beui ne documente
  pas de parseur : `streaming-response` prend le contenu déjà rendu en `children` et se
  contente de garantir que « les liens restent cliquables, les listes gardent leur hiérarchie,
  les blocs de code restent lisibles sans layout shift ». Le choix du parseur reste à Hemera.
- **Blocs de code qui se remplissent** : `code-block` avec `status:"streaming"`, Shiki et
  **cache de tokens** pour survivre aux mises à jour rapides, hauteur bornée (`maxHeight` 280)
  et défilement interne — le bloc ne pousse donc jamais le reste du fil.
- **Layout stable** : hauteur réservée par le conteneur, pas par le contenu ; pas d'animation
  de layout sur les blocs qui grandissent (uniquement opacité et transform) ; les actions de
  fin n'apparaissent qu'au statut `complete` et à hauteur réservée, sinon le fil saute à chaque
  fin de réponse.
- **Suivi du bord vif** : `followOutput` reste vrai tant que le lecteur est à moins de
  `followThreshold` (56 px) du bas ; dès qu'il remonte, on relâche — et on montre un bouton
  « revenir en bas » avec le nombre de nouveaux éléments. `onFollowChange` est le crochet.
  Le sous-cas : quand un bloc interne (terminal, code) défile tout seul, il ne doit pas voler
  le défilement du fil.
- **Accessibilité** : `aria-busy="true"` pendant le flux, région live pour annoncer le début et
  la fin de réponse (`announce` chez beui), et un `aria-live` **polite** — pas assertive, sinon
  chaque chunk interrompt le lecteur d'écran.
- **`prefers-reduced-motion`** : défilement instantané au lieu de doux, shimmer et texte
  roulant remplacés par un changement direct, entrées de blocs sans transform, dither et
  animations décoratives coupées. Tous les composants beui branchent un `useReducedMotion` ;
  Hemera doit le faire au niveau des jetons de motion, une fois, pas composant par composant.

## Liste de composants proposée pour Hemera

Un composant par ligne, avec la pièce beui dont il s'inspire.

**`message/`**
- `MessageList` — viewport du fil, suit le bord vif, relâche au scroll, bouton retour bas → `message-scroller`
- `MessageRow` — rangée user/assistant, avatar, en-tête, pied → `message`
- `MessageBubble` — surface de bulle, variantes et alignement → `message-bubble`
- `UserMessage` — bulle utilisateur éditable/reprenable (carte éditable de Zed) → `message-bubble` + `approval-card`
- `AgentResponse` — réponse en flux, statut streaming/complete/error, actions copier/réessayer → `streaming-response`
- `Markdown` — rendu markdown incrémental tolérant aux nœuds ouverts → aucun (à écrire)
- `CodeBlock` — code Shiki, numéros de ligne, remplissage en flux, copie → `code-block`

**`activity/`**
- `ActivityStream` — flux chronologique replié des pensées, recherches et outils d'un tour → `agent-activity`
- `ThoughtBlock` — `agent_thought_chunk` replié, résumé « Thought for Xs » → `agent-activity` + `ThinkingShimmer`
- `ToolCallCard` — une rangée par `toolCallId`, icône selon `kind`, statut, `locations` cliquables → `tool-result`
- `ToolCallGroup` — regroupe les appels consécutifs de même `kind` en « Ran N tools » → `agent-activity`
- `TerminalOutput` — sortie de terminal en direct par `terminalId`, suit le bas, persiste après libération → aucun (à écrire)
- `AgentStatus` — verbe d'action + chrono + glyphe pendant le travail → `agent-loading-states` (`AgentProgress`)
- `Disclosure` — primitive repliable animée, base de tous les blocs ci-dessus → `AgentDisclosure`

**`approval/`**
- `PermissionRequest` — carte bloquante de `session/request_permission`, boutons issus de `options` → `tool-approval`
- `PermissionOptionList` — rendu des `PermissionOption` par `kind`, clavier, portée de la règle → `tool-approval`
- `AgentQuestion` — question libre ou à choix de l'agent, réponse personnalisée → `approval-card`
- `DecisionSummary` — ligne repliée après décision : option retenue, horodatage → `tool-approval` (états finaux)

**`plan/`**
- `PlanPanel` — plan épinglé, remplacé intégralement à chaque `plan`, compteur d'avancement → `todo-list`
- `PlanEntryRow` — une entrée : statut morphé, priorité high/medium/low → `todo-list` (`TodoStatusIcon`)

**`diff/`**
- `FileDiff` — diff d'un fichier, lignes progressives, compteur +/− vif → `file-diff`
- `DiffReview` — revue de l'ensemble des fichiers touchés, accept/reject par hunk et global → aucun (inspiré du multi-buffer de Zed)
- `ChangeSummary` — barre accordéon « N fichiers, M lignes » épinglée → `file-diff` (`ChangeCount`)
- `CheckpointMarker` — point de restauration dans le fil → aucun (inspiré de Zed et Claude Code)

**`composer/`**
- `PromptComposer` — textarea auto-grandissante, submit ↔ stop, pièces jointes → `prompt-input`
- `CommandPalette` — commandes `/` issues d'`available_commands_update`, avec `input.hint` → `prompt-input` (`actions`)
- `ContextMention` — mentions `@` de fichiers, dossiers, symboles → `ai-sidebar` (lignes de ressources)
- `ModeIndicator` — mode courant, changement via `session/set_mode`, mise à jour par `current_mode_update` → aucun (inspiré de la barre de statut Claude Code)
- `UsageMeter` — contexte consommé et coût depuis `usage_update` → aucun (à écrire)
- `BlockedBanner` — état « en attente de votre réponse » du composer pendant un blocage → aucun (à écrire)

## Questions ouvertes

1. **Quel parseur markdown en flux ?** Aucune source consultée n'en recommande un ; beui laisse
   le rendu à l'appelant. À trancher à l'implémentation, avec un test sur markdown tronqué.
2. **Regroupement des appels d'outils** : à quel seuil replier en « Ran N tools » ? Zed et
   Claude Code le font (`Called slack 3 times`) mais aucune règle chiffrée n'est documentée.
3. **Le diff : inline ou panneau ?** Zed offre les deux via `agent.single_file_review`. Hemera
   n'a pas d'éditeur : il faut décider si la revue accept/reject est un panneau latéral, un
   onglet, ou reste dans le fil.
4. **Accept/reject par hunk a-t-il un sens sous ACP ?** Le protocole ne définit pas d'action
   de rejet partiel d'un diff déjà appliqué ; la seule prise est la permission **avant** le
   `tool_call`. À vérifier contre la spec des capacités client (`fs/write_text_file`) et
   contre ce que Zed fait réellement — non vérifié.
5. **Checkpoints** : Zed et Claude Code en ont, ACP n'en parle pas. Fonction propre au client,
   à spécifier séparément ou à écarter.
6. **`usage_update`** : documenté dans la spec, non vu dans les produits observés. À afficher
   ou pas selon la place dans le composer.
7. **Notifications bureau** (question, permission, erreur, fin de session) : reprises
   d'OpenCode, elles touchent le processus main d'Electron, donc un autre chantier.
8. **Vérification Linux** : cette machine est Windows ; le rendu des composants et le
   comportement du défilement n'ont pas été vérifiés sous Linux.
9. **Aucun composant beui n'a été exécuté** : tout ce qui est décrit ici vient des pages de
   documentation du 16 septembre 2026, pas d'un essai en local.

## Sources

- beui, index des composants agents — https://beui.dev/components/agents
- beui, pages consultées sous https://beui.dev/components/agents/ : `message`,
  `message-bubble`, `message-scroller`, `streaming-response`, `citations`, `loading-states`,
  `todo-list`, `agent-activity`, `tool-result`, `code-block`, `file-diff`, `tool-approval`,
  `approval-card`, `ai-sidebar`, `chat-app`, `prompt-input`, `image-generation`. À noter :
  `agent-loading-states` renvoie un 404 ; la page est à `/loading-states` et le paquet
  s'installe sous `@beui/reasoning-text`.
- beui, dépôt et licence MIT — https://github.com/starc007/ui-components
- Zed, Agent Panel — https://zed.dev/docs/ai/agent-panel
- Zed, External Agents (ACP) — https://zed.dev/docs/ai/external-agents
- ACP, Prompt Turn — https://agentclientprotocol.com/protocol/prompt-turn
- ACP, Tool Calls — https://agentclientprotocol.com/protocol/tool-calls
- ACP, Agent Plan — https://agentclientprotocol.com/protocol/agent-plan
- ACP, Session Modes — https://agentclientprotocol.com/protocol/session-modes
- ACP, Slash Commands — https://agentclientprotocol.com/protocol/slash-commands
- ACP, Schema — https://agentclientprotocol.com/protocol/schema
- Claude Code, Interactive mode — https://code.claude.com/docs/en/interactive-mode
- Claude Code, Configure permissions — https://code.claude.com/docs/en/permissions
- Claude Code, Choose a permission mode — https://code.claude.com/docs/en/permission-modes
- Cursor, Review — https://cursor.com/docs/agent/review
- OpenCode, TUI — https://opencode.ai/docs/tui/
