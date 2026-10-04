# AGENTS.md — the design system

Read the root `AGENTS.md` first; this file adds the rules for `@hemera/ui` and for every
interface of the app, the renderer of `apps/desktop` included. Before creating or changing any
component, story, token or motion kind here, read `.agents/skills/storybook/SKILL.md` (the
catalogue's structure, how a story is written and tested) and the other skills in
`.agents/skills/`.

## UI rules

- Every visual value comes from the design system's CSS tokens, `packages/ui/src/theme.css`.
  **No hex colors, no px sizes, no inline styles outside the token files.** Sizes, radii and
  durations are steps of the theme's scales (`node tools/scales.ts`), and nothing sizes a zone by
  measuring text (`node tools/text-measure.ts`). Until the window wears the design system, the
  empty shell wears the system colours (`Canvas`, `CanvasText`).
- Motion lives in `packages/ui/src/motion.ts` as a short, closed set of named kinds (`press`,
  `arrival`, `morph`, `instant`, `hover`, `expand` and `collapse` on `fold`, `crossfade`, `ping`,
  `check`, `wipe`, and `face`, the beats the face's own player eases its strokes on); no component
  writes its own spring, duration, curve or keyframe, and `node tools/motion-presets.ts` refuses
  one that does. Components read a kind through `useTransition(kind)`, which answers the
  reduced-motion preference with the end state for every property; the CSS transitions of the
  theme stop under `prefers-reduced-motion: reduce`. A movement the set has no kind for is added
  there, named and explained.
- A layout animation only animates an element's own size. Layout animations replayed on every
  re-render make whole screens "pop": no position projection on list rows, disclosures or
  buttons.
- Keyboard: declared tab order per page, visible focus ring, focus restored after overlays.
- Components are plain React: values in, callbacks out. No Effect inside a component
  (`packages/core/AGENTS.md`).

## Interface conventions (1.0)

- Never the engine's vocabulary on screen (revision, snapshot, attempt, stale, attestation):
  plain words. A repository modified outside Hemera is "Changed outside Hemera".
- States as icons and dots, not word badges or explanatory sentences. Each mark's legend is a
  tooltip on the glyph (`Legend`), never a panel. Drop any sentence the interface can show.
- What appears or disappears pushes the content smoothly (the container animates its size), and
  nothing that should stay still moves: not what sits behind a modal, not the siblings of a
  growing element, not a thread when a card in it is pinned or answered.
- A choice made by the user is not a typed message: a question card stays in place, answered.
- The user is never asked twice for the same thing: once they have chosen, act on it without a
  second confirmation.
- Hide an action that cannot be done yet rather than refusing it in red.
- Errors in words. A silent turn says so. Agents' errors and unanswered requests are shown. A
  start has a maximum delay.
- Skeletons for rows whose shape is known; for what has none, the face's loading state
  (`Loading`, `<Face state="loading">`): there is no other spinner.
- What goes on (a run, a service, a helper, a Probe) is a `LiveChip` and nothing beside it: its
  actions (Restart, Stop, Run again, details) live in the glance the chip opens, never as
  buttons on the line.
- A reading measure of 70 to 80 characters for prose (the Spec page, the Chat, Discuss); code,
  tables and command output may be wider.
- Designs at 1920×1080 and 1366×768, light and dark.
- Design on real cases, never on placeholder data. Stories in this public repository use neutral
  examples: a Project "Acme" with repositories `api`, `web` and `shared`, or Hemera itself.
- The Spec is never edited by hand: the agent writes, the user reads and answers.
- The frozen state is said once, by the stage chip in the header: no padlock per section, no
  completeness bar.
- Navigation in a mission: a base (the current stage's page) that keeps its state, and views
  opened over it with one contract (title and icon, width, header actions, body) and a
  breadcrumb. Going back finds the base intact.
- The model picker and the mention field follow their own rules, written with those components.

## Testing the interface

- The story tests only play the reduced-motion path. Motion is checked with Playwright image
  sequences of the catalogue (`pnpm --filter @hemera/ui frames`, see the skill), reading every
  frame: several real bugs (a pop, a jumping thread, a dragged card) were only found that way.
- `npx vp test run --project storybook-light` and `--project storybook-dark`, never watching.
- After an agent edited files, a running Storybook can serve a stale HMR or optimizer cache
  ("Element type is invalid", "error loading dynamically imported module"). Restart it (kill the
  process on its port), clear `node_modules/.cache/storybook` if needed, hard-reload the page,
  and check the stories headless with a small Playwright script before calling something broken.
