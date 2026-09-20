# Décisions du 15 septembre 2026 : abandon de GPUiX, socle Electron

**Statut :** décisions du mainteneur prises après le lot 1 sur GPUiX, la relecture des issues
Electrobun, trois rapports de veille Electron (socle, backend, performances) et un prototype
d'animation jetable. Elles complètent [`core.md`](../product/core.md) et
[`decisions-2026-09-13.md`](./decisions-2026-09-13.md) et prévalent sur toute mention de GPUiX
ou de Bun dans les documents antérieurs, y compris le rapprochement technique et la synthèse
des spikes GPUiX et ACP, qui restent des archives d'observations.

## Pourquoi

- Le point de sortie écrit le 12 septembre portait sur la santé du projet gpuix. Le lot 1 l'a
  atteint : cinq patches Rust dans le fork pour des besoins de base (polices, hauteur de ligne,
  compositeur, commandes de fenêtre, rotation SVG), un mainteneur seul, PR non sollicitées
  interdites, et douze tâches du lot 1 encore ouvertes, presque toutes des trous du renderer.
- Electrobun a été réévalué le 15 septembre : rendu WebKitGTK par défaut (moteur de Tauri, à
  l'origine des 5 fps observés sur la machine de développement), mode CEF forçant X11, HiDPI
  Linux ouvert (#510), PR Wayland natif fermée sans fusion le 2 août, Chromium figé depuis juin,
  GPU désactivé par défaut sous Linux. Spike sur Arch/Hyprland : fonctionne en XWayland avec
  échelle injectée à la main, GPU à réactiver par flags. Écarté.
- Electron 44 est Wayland natif sans flag depuis la 38.2, gère les décorations client et le
  HiDPI par fenêtre depuis la 41, et embarque le démarrage optimisé (snapshot Node, bytecode V8,
  renderer préchauffé) depuis les 43 et 44.

## Décisions techniques

| Sujet | Décision |
|---|---|
| Renderer | **Electron 44.x**, Chromium embarqué, Wayland natif, fenêtre frameless avec Window Controls Overlay. Aucun flag ozone. Bump de majeure tous les deux mois environ, jamais plus de deux majeures de retard. |
| Runtime | **Node** (celui d'Electron). Bun n'est plus utilisé, ni en runtime ni en outillage. |
| Processus | Base et serveur MCP dans **un `utilityProcess` nommé** ; agents ACP en `child_process.spawn`, un par Session ; travaux CPU en `worker_threads` ; rien de bloquant dans le process principal. |
| Base | **Drizzle 1.0-rc** épinglé en version exacte, adaptateur **`node:sqlite`** (aucun module natif). Repli `better-sqlite3` sur la même ligne, à une importation près. Schéma et requêtes n'importent que `sqlite-core` ; seul `database.ts` connaît l'adaptateur. |
| PTY et terminal | `@lydell/node-pty` (prebuilds par plateforme, N-API). Rendu derrière un port `TerminalRenderer` ; xterm.js 6 + WebGL par défaut, wterm évalué au lot 5. |
| ACP et MCP | `@agentclientprotocol/sdk` 1.x, protocole v1 ; adaptateur Claude épinglé et lancé comme binaire, jamais lié. MCP SDK v2 scindé (`@modelcontextprotocol/server` + `/node`). |
| Monorepo | **pnpm** + **Vite+** (remplace Turborepo ; oxlint, oxfmt, vitest, tsdown intégrés). |
| IPC | Typé maison : interface partagée des canaux, `invoke`/`handle` génériques, validation Zod, vérification du `senderFrame`. Aucune librairie tierce. |
| Packaging | electron-builder 26.x ; NSIS sous Windows, AppImage zstd + deb sous Linux, profil AppArmor livré, jamais `--no-sandbox`. `electronLanguages: ["en-US"]`. |
| Tests | Vitest pour la logique et les composants ; `@wdio/electron-service` pour l'E2E. |
| Effect | **Effect** pour tout le code hors renderer à partir du lot 3 : services en `Layer`, cycle de vie en `Scope`, erreurs typées de bout en bout, un `runPromise` par frontière (`ipcMain.handle`, entrée du `utilityProcess`, processus agents). Le renderer React n'en utilise pas. Le lot 0 reste tel quel : `decide`/`handle` et `collectReport` sont les frontières qu'Effect habitera, sans changer leurs contrats. À trancher au lot 3 : `@effect/sql-drizzle` ou les drivers Effect de Drizzle 1.0 ; les cinq règles Effect d'anti-slop entrent avec ce lot. |
| Cible Linux | glibc ≥ 2.41 non requis grâce à `node:sqlite` ; à confirmer au lot 0 sur Arch et Ubuntu 24.04. |

## Décisions design et animation

| Sujet | Décision |
|---|---|
| Animation | **motion.dev**, cœur de l'application. Personnalité « Calme » validée sur le prototype, exposée en code sous le nom `spring` (un nom qui dit ce que c'est, pas une humeur) : ressorts doux (`stiffness 170, damping 26`), entrées en cascade, aucun rebond ; indicateur partagé (`layoutId`) pour la sélection de Projet et la navigation de la sidebar. Effet gooey non retenu. Règle : transform, opacity, filter, clip-path seulement ; `will-change` sur un ou deux éléments par vue. |
| Socle de composants | **Base UI** (sans style, accessibilité et focus gérés). Animations d'ouverture des popups en CSS via `data-starting-style` / `data-ending-style`. |
| Styles | **Tailwind 4**. **Une seule source de couleurs** : le fichier de thème ; aucune valeur de couleur dupliquée ailleurs, ni en TS, ni en CSS, ni en SVG (`window-colors.ts` et `application.css` du lot 0 disparaissent au lot 1). Vérifié par `@shadcn/lint` sur oxlint (`no-raw-colors`, `no-arbitrary-values`, `no-inline-styles`, `require-static-classes`, `no-unknown-classes`, `no-restyle`), actif dès le lot 0. Base du fichier CSS sur le modèle coss ui : tokens `--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`, `--sidebar-*` en `:root` / `.dark`, bordures en `--alpha()`, mapping `@theme inline` vers `--color-*` et `--font-*`. Les valeurs viennent des tokens extraits du prototype HTML. |
| Composants | Refaits maison, jamais importés d'un registre. Base UI comme socle, cva + `cn` façon shadcn pour les variantes (le paquet `cn` de shadcn remplace clsx et tailwind-merge), l'allure du prototype, les animations de **beui** (Button stateful compris). Spectrum UI et transitions.dev comme livres de patterns. Loading commun : une grille de points à ondulation concentrique, même allure que « Origin Wave » de dotmatrix, écrite maison sans leur code (licence propriétaire). |
| Icônes | **Tabler Icons**. |
| Polices | **Fontsource** pour Inter et **Fira Code** en mono (paquets npm variables, chargés par le bundle), plus de fichiers TTF dans le dépôt. |
| Migrations | **Générées par `drizzle-kit generate`** et appliquées par le migrator Drizzle ; aucune migration SQL écrite à la main. La règle du 13 septembre (forward-only, cumulative par lot, sauvegarde préalable, test depuis la fixture de la version précédente) reste. |
| Dépôt de code | Ne contient que du code : ni les spécifications (les agents sont lancés depuis le dossier documentaire), ni `reports/` (généré, ignoré ; les preuves sont archivées avec la documentation du lot), ni code hérité (`legacy/` supprimé après revue du lot 0). |
| Design system | **Storybook** avec l'addon Vitest, livré et validé par le mainteneur **avant** toute page de l'application. |
| Densité | Texte de base **16 px**, contrôles 32 / 36 / 44 (décidé au lot 2 ; le lot 1 à 14 px était trop petit). |
| Coquille | Une seule barre de chrome comme barre de titre : segment gauche aligné sur la sidebar avec le bouton de repli, barre de Projets à sa droite, boutons OS par WCO. Sidebar sur le modèle de la **sidebar animée de beui** réécrite sur Base UI : rail d'icônes replié, largeur qui morphe au ressort. La largeur de la sidebar est la seule dimension de disposition animée, exception nommée dans le lint et mesurée à chaque recette. |
| Raccourcis | **TanStack Hotkeys** (`@tanstack/react-hotkeys`, alpha, épinglé) : `Mod` par plateforme, exclusion des champs, conflits détectés, formatage d'affichage. Primitive `Kbd` en forme de touche, rebord inférieur épais. |

## Redécoupage des lots

Le lot 1 sur GPUiX mélangeait fork, fenêtre, design system, base, Projet/Session et paquets.
Chaque nouveau lot est fermé par une validation du mainteneur avant le suivant :

| Lot | Contenu | Gate |
|---|---|---|
| 0 · socle | monorepo pnpm + Vite+, Electron 44, fenêtre vide frameless sur Windows et Linux/Wayland en HiDPI, IPC typé, paquet portable par OS, une animation motion.dev à 60 fps | fenêtre nette, `chrome://gpu` en accéléré, recette humaine |
| 1 · design system | tokens en CSS, Base UI + motion.dev, Storybook, huit composants maximum | validation dans Storybook |
| 2 · coquille | barre de Projets, sidebar, panneaux, gutters, transitions | recette humaine à la souris |
| 3 · profil et base | port de `runtime` dans un `utilityProcess`, migrations, sauvegarde | tests de migration |
| 4 · Projet et Session | l'ancien lot 1 côté métier, sur les pages réelles | recette humaine |

Les anciens lots 2 à 8 sont renumérotés 5 à 11 (fait le 15 septembre) ; leurs proposals restent
valables sur le fond, leurs mentions de GPUiX et de Bun sont caduques.

## Ce qui survit du code GPUiX

`packages/core` (domaine), `packages/runtime/storage` hors driver (schéma, migration SQL,
workspace-store, journal, préférences, sauvegarde), `packages/runtime/platform` (profil, verrou,
diagnostics, canal), `packages/ui/tokens` et les outils de traçabilité, frontières, i18n et
migrations. Tout le rendu GPUiX, `apps/desktop`, `tools/gpuix` et `tools/package-desktop`
sont abandonnés. Le fork GPUiX n'est plus utilisé.

## Prototype de référence

Le prototype d'animation (Vite + React + Base UI + motion.dev + Tailwind 4, navigateur seul) est
la source primaire du verdict « Calme ». Il reste jetable : jamais importé, jamais copié.
