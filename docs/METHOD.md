# Méthode : d'une issue au code livré

Comment un besoin devient du code dans ce dépôt. Quatre artefacts, des scénarios testés, des tâches cochées seulement après vérification, des preuves jointes. Tout vit dans les issues et les pull requests de ce dépôt ; le code ne contient que du code, sa documentation et son `AGENTS.md`. Les documents sont en français ; les issues, les pull requests et le code en anglais.

## 1. L'issue : l'intention

Une issue dit **ce qu'on veut, où ça s'applique, comment on saura que c'est fait**, et ce qui l'a déclenchée. Elle ne contient pas de solution. Elle est écrite en anglais, comme tout ce qui est public dans le dépôt. Ses labels disent son type (`type:idea`, `type:bug`, `type:debt`, `type:research`) et son domaine (`area:sessions`, `area:agents`, …) ; son milestone dit la version qui la livrera ; son état est le champ **Status** du [projet GitHub « Hemera »](https://github.com/users/KristenJestin/projects/7).

Les états, dans le projet :

| État | Ce que ça veut dire | Qui agit |
|---|---|---|
| Backlog | reçue, priorisée, pas engagée | le mainteneur |
| To frame | retenue ; l'agent écrit les sections Proposal, Design et Spec et les checklists dans l'issue, et finit par les points à trancher ; l'issue y reste tant que le mainteneur n'a pas tranché en commentaire | agent puis mainteneur |
| Framed | tranchée, rien de commencé : c'est la file où l'on pioche | libre |
| In progress | branche ouverte, checklists qui se cochent, gate UI de phase 0 ; au plus trois en même temps | dev |
| In review | pull request prête, validation humaine | le mainteneur |
| Done | pull request fusionnée, ou abandon dit en commentaire | — |

## 2. Proposal, Design, Spec : trois sections de l'issue

Au cadrage, l'agent ajoute **trois sections** à l'issue, sous l'intention, en anglais :

- **Proposal** : Why, What changes, Capabilities touchées, Impact (packages, migrations, tests), et les points à trancher avec une recommandation chacun. Le mainteneur tranche en commentaire ; l'agent reporte la décision dans une section « Tranché ».
- **Design** : les décisions numérotées `D<lot>-01`, `D<lot>-02`… avec leur raison et l'alternative écartée. C'est ce que le code cite en commentaire.
- **Spec · <capacité>** (une par capacité) : des exigences `Hemera SHALL …` avec leurs scénarios `WHEN … THEN …`. **Chaque scénario devient un test nommé d'après lui.** Un scénario sans test est un défaut.

Ces sections sont la vérité du lot ; le code s'y conforme, et si une section a tort on le dit en commentaire au lieu de dévier en silence. Une décision qui traverse les lots va dans [`docs/decisions/`](decisions/README.md).

## 3. Les tâches : des checklists dans l'issue

Une liste de cases à cocher par phase (0 · UI d'abord, 1 · moteur, 2 · branchement, 3 · recette), un item par tâche, chaque item nommant sa **vérification** (« … ; vérifier `pnpm check` vert et le scénario X »). **Un item n'est coché qu'après avoir lancé sa vérification et vu la sortie.**

La phase 0 finit par une gate humaine : le dev pousse sa branche, ouvre une **pull request en brouillon** vers `dev` et mentionne le mainteneur ; celui-ci valide dans Storybook, deux thèmes, au clavier, et le dit en commentaire. L'issue reste In progress pendant ce temps ; la phase 1 attend cette validation.

## 4. Les preuves : pièces jointes et commentaires

Les sorties réelles (`pnpm check`, E2E, paquet, captures) sont **jointes à la pull request** ; un commentaire résume ce qui a été joué, sur quel OS, et ce qui ne l'a pas été. Ce qui n'a pas été joué est dit, jamais supposé. Une vérification Linux non faite sur Linux est « non vérifiée », pas verte.

## 5. La livraison

Branche `feature/<sujet>` depuis `dev`, commits Angular sous l'identité du mainteneur. Fin de phase 3, la pull request passe de brouillon à prête : titre = sujet Angular pur (semantic-release le lit pour décider la version), description terminée par `Closes #<n>`. L'issue passe In review. Après la recette, **fusion par squash**, l'issue se ferme. Une fusion `dev` → `main` par version (le milestone) pose le tag et la Release.

## 6. Les documents

- [`docs/product/core.md`](product/core.md) prévaut sur tout le reste ; [`docs/decisions/`](decisions/README.md) le précise ; [`docs/technical/`](technical/) porte les recherches ; [`docs/design/`](design/README.md) et [`docs/prototypes/`](prototypes/README.md) sont des références de tokens et de mouvement, jamais de balisage à copier.
- Une proposal qui change une règle produit modifie le document dans la même pull request et le dit dans l'issue.
- Une issue nomme dans « Références » les documents dont elle a besoin.
