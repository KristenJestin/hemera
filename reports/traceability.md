# Traceability — lot-0-socle

18 of 23 scenarios are covered by a test named after them.
5 wait on a machine or an act that does not exist here, and say which.

## desktop-foundation

| Scenario | Test |
|---|---|
| Cœur importé hors d'Electron | `packages/core/tests/standalone.test.ts` |
| Importation interdite | `tools/boundaries.test.ts` |
| Code hérité isolé | `tools/boundaries.test.ts` |
| Ouverture sous Windows à l'échelle 150 % | `apps/desktop/e2e/window.e2e.ts` |
| Ouverture sous Linux en Wayland natif | _deferred — no Linux machine is available here; to be run on the Linux target_ |
| Échelle fractionnaire par écran | `apps/desktop/e2e/target.e2e.ts` |
| Aucun flash blanc | _deferred — observed by capturing what the screen showed, recorded under reports/_ |
| Compositing matériel constaté | `apps/desktop/e2e/target.e2e.ts` |
| Dégradation nommée | `apps/desktop/e2e/target.e2e.ts` |
| Appel typé nominal | `apps/desktop/e2e/window.e2e.ts`, `apps/desktop/tests/bridge.test.ts`, `packages/ipc/tests/typed-call.test.ts` |
| Message non conforme | `apps/desktop/e2e/window.e2e.ts`, `apps/desktop/tests/bridge.test.ts` |
| Émetteur inconnu | `apps/desktop/tests/bridge.test.ts` |
| Renderer sans Node | `apps/desktop/e2e/window.e2e.ts` |
| Transition à la fréquence de l'écran | `apps/desktop/e2e/window.e2e.ts` |
| Mouvement réduit respecté | _deferred — a system setting or a real mouse, recorded in the walkthrough of the target_ |
| Propriétés autorisées seules | `apps/desktop/tests/witness.test.ts`, `tools/motion-properties.test.ts` |
| Rapport Windows | `tools/environment-report.test.ts` |
| Rapport Linux | `tools/environment-report.test.ts` |
| Lancement depuis un dossier avec espaces | _deferred — observed on a package run outside the sources, recorded under reports/_ |
| Sandbox conservée sous Ubuntu 24.04 | _deferred — no Linux machine is available here; to be run on the Linux target_ |
| Locales réduites | `tools/package-desktop.test.ts` |
| Commit hors convention | `tools/git-flow.test.ts` |
| Vérification unique | `tools/verification.test.ts` |
