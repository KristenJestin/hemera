---
name: storybook
description: How Hemera's design system and its Storybook catalogue are built. Read it before creating or changing any component, block, surface or shell piece in packages/ui, any story file, the theme tokens or the motion kinds, and before reviewing such a change. It holds the catalogue's structure, how a story is written and tested, and the rules every component follows.
---

# Hemera's design system in Storybook

A modified copy of the `storybook` skill of `mindrally/skills` (Apache-2.0; see `LICENSE` beside
this file), rewritten for this repository. It is not an upstream install and is not tracked in
`skills-lock.json`: it is edited here, by hand. Where this file and `AGENTS.md` disagree,
`AGENTS.md` wins and this file is fixed.

The design system lives in `packages/ui`. Storybook is where it is designed, reviewed and
tested: a component exists in the catalogue, in every state, before anything wires it.

## Before you start

- Read `AGENTS.md` and `packages/ui/AGENTS.md` (UI rules and the 1.0 interface conventions)
  and the skills `frontend-design`, `review-animations` and `vercel-react-best-practices` in
  `.agents/skills/`.
- Look for an existing component before writing one: the catalogue is the inventory. Extend a
  component through its props, never by restyling it through `className` from outside.
- A component is plain presentational React: values in, callbacks out. No Effect, no RPC, no
  engine call inside a component; that belongs to the thin hook layer above it.

## Where things go

- Five roots in this order, and a sixth last; `storySort` in `packages/ui/.storybook/preview.tsx`
  forces it, and `packages/ui/tests/stories.test.ts` holds it:
  - **Foundations**: tokens, icons, motion;
  - **Components**: the primitives, flat and alphabetical, each titled `Components/<Name>` in
    one PascalCase word (`Components/LiveChip`), which the tests enforce;
  - **Blocks**: composed pieces that are not a screen, grouped by family (the families are named
    by the design tickets);
  - **Surfaces**: one entry per screen, never one per variant;
  - **Shell**: the window frame;
  - **Explorations**: a design question drawn in several variants, deleted once the chosen
    variant is built.
- A story file sits next to its component, in lower case with dashes:
  `src/components/live-chip/live-chip.tsx` and `live-chip.stories.tsx`. Every folder of
  `src/components/` holds stories, and the component is exported from `src/index.ts`.

## Writing stories

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ThingRow } from './thing-row.tsx'

/** One sentence: what the component is for, and the rule it keeps. */
const meta = {
  title: 'Blocks/Things/Thing row',
  component: ThingRow,
  tags: ['autodocs'],
  args: { name: 'api', onOpen: fn() },
} satisfies Meta<typeof ThingRow>

export default meta
type Story = StoryObj<typeof meta>

export const Filled: Story = {}

export const Loading: Story = { args: { loading: true } }

export const Error: Story = {
  args: { error: 'Git cannot read this repository: not a git repository.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/cannot read/)).toBeVisible()
  },
}
```

- **One story per state, named after the state**: `Empty`, `Loading`, `Error`, `Filled`,
  `Dense`, `Disabled`, `Stuck`… Never a `Default` story and a pile of `Variant` stories.
- **Every state the design asks for**, including the awkward ones: empty, loading (skeletons),
  error in words, dense (many items), and long text in every field (a long name, a long path, a
  long command line).
- **Sizes are Storybook's viewports**: a screen is rendered full-bleed in the canvas
  (`layout: 'fullscreen'`), and the 1920×1080 and 1366×768 viewports of the toolbar give its two
  sizes. Never draw a size frame or a size control inside a story; sizes are Storybook's
  viewports.
- **Both themes**: the story tests play every story once in light and once in dark; check both
  by eye at 1920×1080 and 1366×768.
- **Neutral data only**: this repository is public. Use a Project "Acme" with repositories
  `api`, `web` and `shared` (and `ui-kit`, `billing` when dense), mission `ACME-12`, or Hemera
  itself. Never a real private case, a real person, a real domain or a real ticket.
- **Tags**: `autodocs` only. Never write `new` or `updated`: those badges are computed from Git
  (`packages/ui/.storybook/badges.ts`, against `origin/feature/1.0` or `HEMERA_STORYBOOK_BASE`),
  and the tests refuse any other tag.
- **Args, not wrappers**: drive states through `args`; callbacks are `fn()`. A decorator only
  for what a component truly needs around it (a room of a given width, a provider).
- A comment above `meta` says what the component is for in one or two sentences, in plain words.

## Testing in stories

- **The story is the test**: write the story (and its `play`) that fails first, then the
  component. `play` checks behaviour through roles and accessible names (`getByRole`,
  `getByLabelText`), never through classes or test ids when a role exists.
- **Keyboard and focus**: a play test walks the keyboard path (Tab order, Enter, Escape, arrows
  where they apply), checks the focus ring is visible and that focus returns after an overlay.
- **Accessibility**: the a11y addon runs on every story as a test (`a11y.test: 'error'` in
  `preview.tsx`); fix every violation, never silence it.
- **Motion**: the story tests play the reduced-motion path only. What appears, disappears or
  changes state is checked with Playwright image sequences of a running catalogue
  (`pnpm storybook`, port 6006):

  ```sh
  pnpm --filter @hemera/ui frames --story components-livechip--running \
    --set state=finished --set endedAt=now --frames 12 --every 40 --out /tmp/live-chip
  ```

  `--story` is the story's id, `--set name=value` changes an arg mid-flight (`now`, `null` and
  numbers are read as such), `--theme dark` draws the dark theme, `--url` names another port.
  Look at every frame: nothing that should stay still may move.
- A play that waits for a change uses `waitFor`; a story that shows a change over time (a state
  turning into another) holds its own state and offers a way to play it again.
- Run `npx vp test run --project storybook-light` and `npx vp test run --project storybook-dark`
  (always `vp test run`, never watching), plus `pnpm lint`, `pnpm typecheck` and
  `npx vp test run --project repository` (the theme and catalogue tests live there).

## Rules every component follows

- **Tokens only**: every colour, size, radius, shadow and duration comes from
  `packages/ui/src/theme.css` and its scales. No hex, no px, no arbitrary Tailwind value, no
  inline style, no class built at run time (`@shadcn/lint` enforces it; `node tools/scales.ts`
  and `node tools/text-measure.ts` hold the scales). A value the theme lacks is added to the
  theme, named, in both themes (`tests/theme.test.ts` refuses a role declared in one theme
  only). The primary fills a surface with its gradient (`primary-fill`), never the flat colour;
  focus is the theme's `focus-ring`; whatever changes colour under the hand wears `hover-motion`.
- **Motion kinds only**: read a kind through `useTransition(kind)` from `motion.ts`; never your
  own spring, duration, curve or keyframe (`node tools/motion-presets.ts` refuses it). A movement
  with no kind is added to `motion.ts`, named and explained.
- **States as glyphs**: icons and small marks, never word badges or explanatory sentences. A
  task's state is a `StatusMark` (compact, `size="sm"`, where a dot would stand: there is no
  separate status dot); what goes on is a `LiveChip` (a helper's holds its letter avatar; its actions are in the
  glance it opens, `glance`, never beside it), whose state is its
  background (a breath while running, one sweep in the colour of the state they change to);
  who it is, a `LetterAvatar`; Hemera itself, its `Face`. A mark's legend is a tooltip on the
  glyph (`Legend`), never a panel.
- **Hide what cannot be done** rather than refusing it in red. Errors are said in words.
- **Skeletons** for rows whose shape is known, drawn by the row itself in its loading mode and
  hiding the real content entirely; for what has no known shape, the face's loading state
  (`Loading`, `<Face state="loading">`): there is no other spinner.
- **Prose** at a reading measure of 70 to 80 characters.
- **Never the engine's vocabulary** on screen: plain words ("Changed outside Hemera", not
  "stale").

## When a component changes

- Update every story of that component, and every story of the blocks and surfaces that use it,
  in the same change.
- If a change alters how something looks or moves in a validated screen, say so in the pull
  request and show the before and after.
- Remove the stories of an exploration's rejected variants before the merge.
