# Hemera design — references

## Mockups

- `mockups/2026-09-13-home-dark.png` and `mockups/2026-09-13-home-light.png`: target visual
  look validated by the maintainer on 13 September 2026 (Home page, sidebar, Projects bar,
  cards, composer, mission tags, dark and light themes).
- Source of the mockup: `../prototypes/home-prototype.html` (self-contained HTML/CSS).
- `../prototypes/lot-4-pages-prototype.html` (16 September 2026): the lot 4 screens
  laid on the lot 2 shell: first launch, Project creation, Home without an agent,
  `free` Session (thread and empty), Journal, Project settings, archived Sessions, Mod+K palette,
  application settings, bell, and the lot 5 "Session with an agent" screen (key `a`). Keys `1`–`9`, `0`, `a`, `k`, `t`, `b`, `n`. Same rule:
  tokens and layout, never the markup.

## What the mockups decide, and what they do not

**Decided (look)**: palette and light/dark themes, Inter + JetBrains Mono typography,
lucide icons, radii, density, style of the Project tabs, of the sidebar, of the cards, of the
mission badges (`define`, `build`, `free`), of the composer, of the Journal timeline.

**Not decided (content)**: the content of the mockup's sidebar is not adopted. The
navigation remains that of the [core](../product/core.md): Sessions directly present in the
sidebar (session-first). The "Needs you", "Running", "Specs" cards, the model selector,
the notifications bell, ⌘K and the attachments are references of style and
of component patterns; their presence and their content belong to the lots that deliver them.

**Title bar**: goal = the Projects bar acts as the title bar (frameless window,
like Zed). Feasibility to be verified with the renderer on Windows and Linux; fallback = native
OS bar above.

## Rule for using the HTML prototype

The prototype serves **only** to extract the tokens (CSS variables `--*`, sizes, radii,
shadows, fonts). It is **forbidden** to copy its markup, its classes, its inline styles
or its structure into the application. Every component is written according to the design system
rules (`packages/ui`, tokens in three layers, headless hook + styled component, showcase and test per
component).
A development that copies the prototype is rejected in review.
