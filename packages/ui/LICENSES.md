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

## Claude Code — **not vendored**

Anthropic's Claude mark is deliberately absent, and `AgentMark` draws the `CC` monogram for
Claude Code instead.

Anthropic's Claude Code terms say: "You can accurately say, in plain text, that your product has
Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or
Anthropic names or logos as part of your own product, feature, or company name, in your own
logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product.
Any other use of Anthropic's names or logos is governed by our Trademark Guidelines and requires
our written permission."
(<https://code.claude.com/docs/en/legal-and-compliance>, read 22 September 2026.)

Copying the mark into this repository and shipping it inside the application is "any other use".
It needs Anthropic's written permission, which this lot does not have, so the monogram stays
until somebody obtains one.
