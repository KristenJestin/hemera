# Decision of 22 September 2026 — motion goes where the UX needs it

**Status:** decided by the maintainer. Replaces **D0-06** for the whole product. It prevails
over any older document that repeats the compositor-only rule, starting with the UI rules of
`AGENTS.md`.

## What D0-06 said

Only the four properties a compositor animates on its own were allowed to be animated:
`transform`, `opacity`, `filter` and `clip-path`. Anything else — a height, a width, a margin,
a colour — was refused, because it asks the main thread to lay the page out again on every
frame. `tools/motion-properties.ts` enforced it over the renderer and the design system, with
one measured exception by name for the sidebar's width.

The rule held the frame rate and cost the interface its movement. A tool card's body could not
grow, so it was uncovered by a clip-path behind a fixed box; a menu panel could not change
height, so every stage of it was padded out to the tallest one; a block that grew could not
push its neighbours, so the column under it was redrawn between two frames or nailed in place.
Each of those is the animation the screen actually wanted, replaced by the animation the lint
allowed.

## What replaces it

**Motion goes wherever the UX needs it.** A height, a width, a push on the neighbours, a
colour: if that is the movement the screen reads best, that is the movement it plays.

The invariant is no longer the property. It is **consistency**:

- Every animation is a **named kind** of the preset, `packages/ui/src/motion.ts`. A component
  never invents one.
- A kind that does not exist yet **is added there**, named and explained, and then read by
  name. That is the whole procedure: the answer to "the preset has no slide" is a `slide` in
  the preset, not a constant in the component.
- **No duration, ease, spring, keyframe or delay number is written outside `motion.ts`.** In
  the design system's stylesheets the same rule points at `packages/ui/src/theme.css`, which
  is where the duration tokens are declared.
- **Reduced motion is honoured everywhere.** Components read `useTransition(kind)`, which
  answers the preference with the end state and no journey, for every property at once; the
  tree still runs under `MotionConfig reducedMotion="user"` as the net under anything that
  forgets the hook.

`tools/motion-presets.ts` replaces `tools/motion-properties.ts` and checks exactly that: a
`transition` that is not read from the preset, a motion value written in a component, a
`motion.*` element that moves without a transition at all. It no longer reads the list of
properties being animated, and `LAYOUT_EXCEPTIONS` disappears with it — the sidebar's width
needs no exception once no property is forbidden.

## Why

A UX that reads well is worth more than compositor purity. Thirty-six thousand different
animations is what a design system must never have; four allowed properties is not how you
avoid it — a closed, named set of kinds is, and that set is what the preset already was.

The performance concern does not vanish, it changes hands: it becomes a **review concern, per
kind**. When a kind that animates a layout property is added to the preset, its cost is argued
once, there, where the kind is written down — instead of being pre-judged for every screen by
a lint that cannot see what the screen is doing.

## The alternative set aside

Keeping D0-06 and widening its list of exceptions file by file. It was already how the
sidebar's width got in. It scales to one exception per screen, which is the rule collapsing
one name at a time while pretending to hold.

— the maintainer
