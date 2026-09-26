# Third-party marks vendored in this package

Everything the design system draws comes from Tabler, through `src/icons.ts`, except the brand
marks below. Tabler ships a handful of brand icons and the agents Hemera runs are not among
them, so a mark that may be redistributed is copied in here as a path rather than fetched: a
window that opens offline must not open with holes in it.

Each mark is redrawn in `currentColor` and nothing else, at the sizes of the icon scale. That is
a reproduction, not a redesign: the outline is the one the owner publishes.

## OpenCode — `IconBrandOpencode`

- **Source**: `packages/identity/mark.svg` of <https://github.com/anomalyco/opencode>, branch
  `dev`.
- **Licence**: MIT — `Copyright (c) 2025 opencode`. The MIT licence permits use, copying,
  modification and redistribution, provided the notice above travels with it, which is what this
  file is.
- **What was changed**: only the outer even-odd path is kept. The grey block the original sets
  inside the ring is a second colour, this catalogue draws in one, and the ring is what the mark
  is recognised by at sixteen pixels.
- **Note**: the MIT licence covers the file, not the trademark. The mark is used here to name
  OpenCode inside a control that chooses it, which is nominative use and not branding of Hemera.

## Claude — `IconBrandClaude`

- **Source**: `icons/claude.svg` of Simple Icons 16.32.0 (<https://simpleicons.org/?q=claude>,
  <https://github.com/simple-icons/simple-icons>).
- **Licence of the artwork**: CC0 1.0 Universal. Simple Icons releases its SVG paths into the
  public domain; the path is copied as published, in `currentColor`.
- **The mark itself** is a trademark of Anthropic, PBC. It is drawn here to identify the Claude
  Code agent inside the control that chooses it, next to the marks of the other agents: a
  nominative use that names what a Session runs on. It is not part of Hemera's own name or logo,
  and nothing here suggests that Anthropic built, endorses or is partnered with Hemera.
- **Decision**: the maintainer's, 22 September 2026, after reading Anthropic's Claude Code
  terms (<https://code.claude.com/docs/en/legal-and-compliance>), which allow saying in plain
  text that a product runs Claude Code and reserve the logo for other uses. Identifying the
  agent by its mark was judged to be that plain statement, made with a picture. Should Anthropic
  ask for its removal, `AgentMark` falls back to the `CC` monogram by deleting one entry.

## Hemera Auto — `IconBrandHemeraAuto`

- **Source**: the SVG supplied by the maintainer in issue #59, D59-12. Its initial artwork is
  Tabler Outline `shield-lock` from <https://tabler.io/icons/icon/shield-lock> (MIT).
- **Licence**: MIT, Copyright (c) 2020-2026 Paweł Kuna. The supplied geometry is embedded
  directly in `src/icons.ts` with `currentColor` and the catalogue's size scale. The icon has
  its own local definition so Hemera can replace the artwork without changing its consumers.

## TypeSafe AI — `IconBrandTypeSafe`

- **Source**: the symbol supplied by the maintainer in issue #59, D59-13, retraced from
  TypeSafe AI's published [light](https://mintcdn.com/ts-docs/yUH7wuFx44xePApg/logo/light.png)
  and [dark](https://mintcdn.com/ts-docs/yUH7wuFx44xePApg/logo/dark.png) logos at
  <https://docs.typesafe.ai>.
- **Attribution**: the mark belongs to TypeSafe AI. It identifies its Jev service beside the
  credential and data disclosure, and does not brand Hemera. Replace the retraced vector if
  TypeSafe AI publishes an official SVG.
