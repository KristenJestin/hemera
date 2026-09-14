# Traceability — lot-1-demarrage

128 of 154 scenarios are covered by a test named after them.
2 wait on a machine or an act that does not exist here, and say which.

## domain-journal

| Scenario | Test |
|---|---|
| Mutation réussie | `packages/runtime/tests/journal.test.ts` |
| Échec de persistance | `packages/runtime/tests/journal.test.ts` |
| Aucun effet externe dans la transaction | `packages/runtime/tests/journal.test.ts` |
| Ordre total des événements | `packages/runtime/tests/journal.test.ts` |
| Continuité après redémarrage | `packages/runtime/tests/journal.test.ts` |
| Journal append-only | `packages/runtime/tests/journal.test.ts` |
| Lecture par Session | `packages/runtime/tests/journal.test.ts` |
| Auteur humain distingué | `packages/runtime/tests/journal.test.ts` |
| Corrélations prévues non alimentées | `packages/runtime/tests/journal.test.ts` |
| Historique volumineux | `packages/runtime/tests/journal.test.ts` |
| Écriture pendant la pagination | `packages/runtime/tests/journal.test.ts` |
| Curseur invalide | `packages/runtime/tests/journal.test.ts` |
| Redémarrage après enregistrement | `packages/runtime/tests/journal.test.ts` |
| Arrêt non propre | `packages/runtime/system-tests/durability.test.ts` |
| Issue inconnue | `packages/runtime/tests/journal.test.ts` |
| Sortie volumineuse | `packages/runtime/tests/activity.test.ts` |
| Portion non persistée | `packages/runtime/tests/activity.test.ts` |

## project-workspaces

| Scenario | Test |
|---|---|
| Projet de conception | `packages/runtime/tests/workspace-store.test.ts` |
| Chemin unique du Projet | `packages/runtime/tests/project-configuration.test.ts` |
| Dossier inaccessible | _deferred — undefined_ |
| Sources ajoutées plus tard | `packages/runtime/tests/project-configuration.test.ts` |
| Aucune initialisation imposée | `packages/runtime/tests/project-configuration.test.ts` |
| Édition de la configuration | `packages/runtime/tests/project-configuration.test.ts` |
| Aucun fichier écrit dans les sources | `packages/runtime/tests/project-configuration.test.ts` |
| Configuration invalide refusée | `packages/runtime/tests/workspace-store.test.ts` |
| Deux emplacements déclarés | `packages/runtime/tests/project-configuration.test.ts` |
| Aucun dépôt déclaré | `packages/runtime/tests/workspace-store.test.ts` |
| Chemin sortant de la racine | `packages/runtime/tests/workspace-store.test.ts` |
| Bascule entre deux Projets | _deferred — undefined_ |
| Projet actif restauré | _deferred — undefined_ |
| Projet actif devenu indisponible | _deferred — undefined_ |

## sessions

| Scenario | Test |
|---|---|
| Travaux parallèles | `packages/runtime/tests/session-thread.test.ts` |
| Session sélectionnée conservée | _deferred — undefined_ |
| Aucune Session | _deferred — undefined_ |
| Création dans un Projet | `packages/runtime/tests/workspace-store.test.ts` |
| Aucune Spec créée implicitement | `packages/runtime/tests/session-thread.test.ts` |
| Aucun Projet actif | `packages/runtime/tests/session-thread.test.ts` |
| Message enregistré | `packages/runtime/tests/session-thread.test.ts` |
| Ordre des messages | `packages/runtime/tests/workspace-store.test.ts` |
| Échec d'enregistrement | `packages/runtime/tests/session-thread.test.ts` |
| Brouillon non envoyé | _deferred — undefined_ |
| Deux Sessions retrouvées | `packages/runtime/system-tests/durability.test.ts` |
| Arrêt brutal | `packages/runtime/system-tests/durability.test.ts` |
| Titre dérivé du premier message | `packages/runtime/tests/workspace-store.test.ts` |
| Renommage conservé | `packages/runtime/tests/session-thread.test.ts` |
| Session sans message | `packages/runtime/tests/session-thread.test.ts` |
| Session archivée puis restaurée | `packages/runtime/tests/workspace-store.test.ts` |
| Archivage durable | `packages/runtime/tests/session-thread.test.ts` |
| Aucune suppression proposée | _deferred — undefined_ |
| Aucun provider disponible | _deferred — undefined_ |
| Contenu conservé indépendamment | `packages/runtime/tests/session-thread.test.ts` |

## design-system

| Scenario | Test |
|---|---|
| Import métier interdit dans le package d'interface | `tools/boundaries.test.ts` |
| Composition de l'application depuis le package d'interface | `tools/components.test.ts` |
| Cycle de dépendances | `tools/boundaries.test.ts` |
| Couleur en dur détectée | `tools/design-tokens.test.ts` |
| Dimension hors échelle détectée | `tools/design-tokens.test.ts` |
| Clé sémantique manquante dans un thème | `packages/ui/tests/tokens.test.ts` |
| Token manquant pour un besoin réel | `tools/design-tokens.test.ts` |
| Bascule de thème à chaud | _deferred — undefined_ |
| Thème restauré après redémarrage | _deferred — undefined_ |
| Suivi du thème système indisponible | _deferred — undefined_ |
| Préférence de thème absente ou invalide | `packages/ui/tests/lib.test.ts` |
| Police manquante au démarrage | `apps/desktop/tests/fonts.test.ts` |
| Taille de texte hors échelle | `packages/ui/tests/tokens.test.ts` |
| Texte technique en police monospace | _deferred — undefined_ |
| Animation interdite sur un élément dans le flux | `packages/ui/tests/lib.test.ts` |
| Ombre multi-couche refusée | `packages/ui/tests/tokens.test.ts` |
| Espacement hors échelle | `tools/design-tokens.test.ts` |
| Icône absente du catalogue | `packages/ui/tests/icons.test.ts` |
| Emoji utilisé comme icône | `tools/icons.test.ts` |
| Icône sans couleur héritée | _deferred — undefined_ |
| Composant local dupliquant le catalogue | `tools/components.test.ts` |
| État désactivé figé | `packages/ui/tests/lib.test.ts` |
| Variante manquante | `packages/ui/tests/primitives.test.ts` |
| Composant non contrôlé | `tools/components.test.ts` |
| Dossier de composant incomplet | `tools/components.test.ts` |
| Style écrit dans le hook | `tools/components.test.ts` |
| Composant sans démonstration | `apps/desktop/system-tests/showcase-registry.test.ts`, `tools/components.test.ts` |
| Démonstration inaccessible en production | `apps/desktop/tests/showcase.test.ts` |
| Comparaison des deux thèmes | _deferred — undefined_ |
| Focus restauré après fermeture d'un overlay | _deferred — undefined_ |
| Traversée manuelle du clavier | `packages/ui/tests/lib.test.ts` |
| Activation au clavier | `packages/ui/tests/lib.test.ts` |
| Soumission d'un champ multiligne | _deferred — undefined_ |
| Sidebar repliée et largeur persistée | _deferred — undefined_ |
| Largeur hors bornes | _deferred — undefined_ |
| Onglet de Projet actif | _deferred — undefined_ |
| Première mesure de fenêtre ignorée | `apps/desktop/tests/window-size.test.ts` |
| Décorations client disponibles | _deferred — undefined_ |
| Décorations client indisponibles | _deferred — undefined_ |
| Vérification par cible | `tools/environment-report.test.ts` |
| Écran à haute densité | _deferred — human acceptance with a real mouse, recorded in the matrix of D12b_ |
| Mesure de texte interdite | `tools/design-tokens.test.ts` |
| Balisage recopié depuis le prototype | `tools/components.test.ts` |
| Valeur intermédiaire normalisée | `tools/design-tokens.test.ts` |
| Fonctionnalité absente du lot présentée par la maquette | _deferred — undefined_ |
| Style visuel dans un écran | `tools/design-tokens.test.ts` |
| Composant intégré sans test clavier | `tools/components.test.ts` |
| Périmètre livré | `tools/components.test.ts` |
| Composant hors périmètre appelé | `tools/components.test.ts` |

## application-foundation

| Scenario | Test |
|---|---|
| Initialisation du socle | `tools/setup-repos.test.ts` |
| Dossier déjà occupé | `tools/setup-repos.test.ts` |
| Aucun remote configuré | `tools/setup-repos.test.ts` |
| Commit d'agent sur une branche protégée | `tools/git-flow.test.ts` |
| Message hors convention | `tools/git-flow.test.ts` |
| Lint et format en vérification | `tools/toolchain.test.ts` |
| Installation du produit | `tools/toolchain.test.ts` |
| Commandes de développement communes | `tools/turbo-graph.test.ts` |
| Historique du renderer | `tools/gpuix/fork-provenance.test.ts` |
| Tâche à effets sans cache | `tools/turbo-graph.test.ts` |
| Consommateur indépendant du desktop | `tools/boundaries.test.ts` |
| Frontières des packages | `tools/boundaries.test.ts` |
| Vérification après modification partagée | `tools/turbo-graph.test.ts` |
| Squelettes non demandés | `tools/turbo-graph.test.ts` |
| Installation propre | `tools/gpuix/fork-provenance.test.ts`, `tools/gpuix/vendor.test.ts` |
| Empreinte non conforme | `tools/gpuix/fork-provenance.test.ts`, `tools/gpuix/vendor.test.ts` |
| Patch qui ne s'applique pas | `tools/gpuix/fork-provenance.test.ts` |
| Paquet incompatible | `tools/gpuix/native-build.test.ts`, `tools/gpuix/vendor.test.ts` |
| Premier lot sur les deux systèmes | _deferred — no Linux machine is available here; to be run on the Linux target_ |
| Une seule cible vérifiée | `tools/environment-report.test.ts` |
| Dépendance système manquante | `tools/package-desktop.test.ts` |
| Vérification du socle sans fenêtre | `tools/business-suite.test.ts` |
| Démarrage applicatif | `apps/desktop/system-tests/window.test.ts`, `tools/gpuix/native-build.test.ts` |
| Aucune réponse d'agent au lot 1 | _deferred — undefined_ |
| Premier lancement sur chaque système | `packages/runtime/tests/profile.test.ts` |
| Nettoyage d'un Workspace produit | `packages/runtime/system-tests/profile-independence.test.ts` |
| Profil de test | `packages/runtime/tests/profile.test.ts` |
| Copie embarquée | `tools/package-desktop.test.ts` |
| Développement à côté de l'installation | `apps/desktop/tests/showcase.test.ts` |
| Paquet dev distribué | `packages/runtime/tests/profile.test.ts` |
| Surcharge de canal hors test | `packages/runtime/tests/profile.test.ts` |
| Deuxième lancement | `packages/runtime/tests/instance-lock.test.ts` |
| Verrou résiduel après arrêt brutal | `packages/runtime/tests/instance-lock.test.ts` |
| Profils distincts | `packages/runtime/tests/instance-lock.test.ts` |
| Lancement hors checkout | `apps/desktop/system-tests/package.test.ts` |
| Échec de migration | `packages/runtime/tests/database.test.ts` |
| Migration déjà appliquée | `packages/runtime/tests/database.test.ts` |
| Mise à jour du paquet sur un profil existant | `packages/runtime/tests/backup.test.ts` |
| Échec pendant la migration d'un profil existant | `packages/runtime/tests/backup.test.ts` |
| Ancien paquet sur profil récent | `packages/runtime/tests/database.test.ts` |
| Test de migration depuis la version précédente | `packages/runtime/tests/backup.test.ts` |
| Installation dans un dossier choisi | `tools/package-desktop.test.ts` |
| Remplacement du paquet | `apps/desktop/system-tests/package.test.ts` |
| Aucune mise à jour implicite | `tools/package-desktop.test.ts` |
| Textes de l'interface | `apps/desktop/tests/i18n.test.ts`, `tools/i18n.test.ts` |
| Clé de traduction manquante | `apps/desktop/tests/i18n.test.ts`, `tools/i18n.test.ts` |
| Aucune promesse multilingue | `apps/desktop/tests/i18n.test.ts` |
| Réouverture après redémarrage | `packages/runtime/tests/preferences.test.ts` |
| Préférence absente ou invalide | `packages/runtime/tests/preferences.test.ts` |
| Première mesure de fenêtre ignorée | `apps/desktop/tests/window-size.test.ts` |
| Emplacement des préférences | `packages/runtime/tests/preferences.test.ts` |
| Prototype présent dans le fork | `tools/gpuix/fork-provenance.test.ts` |
| Aucune dépendance aux spikes | `tools/gpuix/fork-provenance.test.ts`, `tools/gpuix/vendor.test.ts`, `tools/package-desktop.test.ts` |
| Mesure de spike présentée comme preuve | `tools/package-desktop.test.ts` |
