# Prototypes HTML — références de tokens et de motion

Les deux fichiers de ce dossier sont des prototypes jetables, à ouvrir dans un navigateur :

- `home-prototype.html` : la page Home (sidebar, barre de Projets, cartes, composer, thèmes
  sombre et clair), source des maquettes de `../design/mockups/`.
- `lot-4-pages-prototype.html` : les écrans du lot 4 posés sur la coquille de l'application,
  plus l'écran « Session avec agent ». Les touches `1`–`9`, `0`, `a`, `k`, `t`, `b`, `n`
  changent d'écran.

Ils servent **uniquement** de référence pour les tokens (variables CSS `--*`, tailles, rayons,
ombres, polices) et pour le motion (durées, courbes, transitions). Leur balisage, leurs classes et
leurs styles inline ne sont **jamais** recopiés dans un composant : un composant qui les recopie
est refusé en revue. La règle complète est dans [`../design/README.md`](../design/README.md).
