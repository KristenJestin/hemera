# HTML prototypes — token and motion references

The files in this folder are throwaway prototypes, to be opened in a browser:

- `home-prototype.html`: the Home page (sidebar, Projects bar, cards, composer, dark
  and light themes), source of the mockups in `../design/mockups/`.
- `lot-4-pages-prototype.html`: the lot 4 screens laid on the application shell,
  plus the "Session with an agent" screen. The keys `1`–`9`, `0`, `a`, `k`, `t`, `b`, `n`
  switch screens.
- `spec-panel.html`: the Spec panel of a `define` Session beside the chat (lot 19), in its
  eight states on the keys `1`–`8`; `t` toggles the theme.

They serve **only** as a reference for the tokens (CSS variables `--*`, sizes, radii,
shadows, fonts) and for the motion (durations, curves, transitions). Their markup, their classes and
their inline styles are **never** copied into a component: a component that copies them
is rejected in review. The full rule is in [`../design/README.md`](../design/README.md).
