# Design d'Hemera — références

## Maquettes

- `mockups/2026-09-13-home-dark.png` et `mockups/2026-09-13-home-light.png` : allure visuelle
  cible validée par le mainteneur le 13 septembre 2026 (page Home, sidebar, barre de Projets,
  cartes, composer, tags de mission, thèmes sombre et clair).
- Source de la maquette : `../prototypes/home-prototype.html` (HTML/CSS autonome).
- `../prototypes/lot-4-pages-prototype.html` (16 septembre 2026) : les écrans du lot 4
  posés sur la coquille du lot 2 : premier lancement, création de Projet, Home sans agent,
  Session `free` (fil et vide), Journal, réglages du Projet, Sessions archivées, palette Mod+K,
  réglages de l'application, cloche, et l'écran « Session avec agent » du lot 5 (touche `a`). Touches `1`–`9`, `0`, `a`, `k`, `t`, `b`, `n`. Même règle :
  tokens et disposition, jamais le balisage.

## Ce que les maquettes décident, et ce qu'elles ne décident pas

**Décidé (allure)** : palette et thèmes light/dark, typographie Inter + JetBrains Mono,
icônes lucide, rayons, densité, style des onglets de Projet, de la sidebar, des cartes, des
badges de mission (`define`, `build`, `free`), du composer, de la timeline du Journal.

**Non décidé (contenu)** : le contenu de la sidebar de la maquette n'est pas repris. La
navigation reste celle du [noyau](../product/core.md) : Sessions directement présentes dans la
sidebar (session-first). Les cartes « Needs you », « Running », « Specs », le sélecteur de
modèle, la cloche de notifications, ⌘K et les pièces jointes sont des références de style et
de motifs de composants ; leur présence et leur contenu relèvent des lots qui les livrent.

**Barre de titre** : objectif = la barre de Projets fait office de barre de titre (fenêtre sans
cadre, comme Zed). Faisabilité à vérifier avec le renderer sur Windows et Linux ; repli = barre
OS native au-dessus.

## Règle d'usage du prototype HTML

Le prototype sert **uniquement** à extraire les tokens (variables CSS `--*`, tailles, rayons,
ombres, polices). Il est **interdit** de copier son balisage, ses classes, ses styles inline
ou sa structure dans l'application. Tout composant est écrit selon les règles du design system
(`packages/ui`, tokens en trois couches, hook headless + composant stylé, showcase et test par
composant).
Un développement qui recopie le prototype est refusé en revue.
