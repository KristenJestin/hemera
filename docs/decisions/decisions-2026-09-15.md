# Decisions of 15 September 2026: abandoning GPUiX, Electron foundation

**Status:** decisions taken by the maintainer after lot 1 on GPUiX, the review of the
Electrobun issues, three Electron watch reports (foundation, backend, performance) and a
throwaway animation prototype. They complement [`core.md`](../product/core.md) and
[`decisions-2026-09-13.md`](./decisions-2026-09-13.md) and prevail over any mention of GPUiX
or Bun in earlier documents, including the technical reconciliation and the synthesis of the
GPUiX and ACP spikes, which remain archives of observations.

## Why

- The exit point written on 12 September concerned the health of the gpuix project. Lot 1
  reached it: five Rust patches in the fork for basic needs (fonts, line height, compositor,
  window commands, SVG rotation), a single maintainer, unsolicited PRs forbidden, and twelve
  tasks of lot 1 still open, almost all of them holes in the renderer.
- Electrobun was reassessed on 15 September: WebKitGTK rendering by default (Tauri's engine,
  the origin of the 5 fps observed on the development machine), CEF mode forcing X11, Linux
  HiDPI open (#510), native Wayland PR closed without merge on 2 August, Chromium frozen since
  June, GPU disabled by default on Linux. Spike on Arch/Hyprland: works under XWayland with a
  hand-injected scale, GPU to be re-enabled by flags. Set aside.
- Electron 44 is natively Wayland without a flag since 38.2, handles client-side decorations
  and per-window HiDPI since 41, and ships optimised start-up (Node snapshot, V8 bytecode,
  warmed-up renderer) since 43 and 44.

## Technical decisions

| Subject | Decision |
|---|---|
| Renderer | **Electron 44.x**, embedded Chromium, native Wayland, frameless window with Window Controls Overlay. No ozone flag. Major bump roughly every two months, never more than two majors behind. |
| Runtime | **Node** (Electron's). Bun is no longer used, neither as runtime nor as tooling. |
| Processes | Database and MCP server in **one named `utilityProcess`**; ACP agents in `child_process.spawn`, one per Session; CPU work in `worker_threads`; nothing blocking in the main process. |
| Database | **Drizzle 1.0-rc** pinned to an exact version, **`node:sqlite`** adapter (no native module). Fallback `better-sqlite3` on the same line, one import away. Schema and queries import only `sqlite-core`; only `database.ts` knows the adapter. |
| PTY and terminal | `@lydell/node-pty` (prebuilds per platform, N-API). Rendering behind a `TerminalRenderer` port; xterm.js 6 + WebGL by default, wterm evaluated in lot 5. |
| ACP and MCP | `@agentclientprotocol/sdk` 1.x, protocol v1; Claude adapter pinned and launched as a binary, never linked. MCP SDK v2 split (`@modelcontextprotocol/server` + `/node`). |
| Monorepo | **pnpm** + **Vite+** (replaces Turborepo; oxlint, oxfmt, vitest, tsdown integrated). |
| IPC | Typed in-house: shared channel interface, generic `invoke`/`handle`, Zod validation, `senderFrame` check. No third-party library. |
| Packaging | electron-builder 26.x; NSIS on Windows, zstd AppImage + deb on Linux, AppArmor profile shipped, never `--no-sandbox`. `electronLanguages: ["en-US"]`. |
| Tests | Vitest for logic and components; `@wdio/electron-service` for E2E. |
| Effect | **Effect** for all code outside the renderer from lot 3 on: services as `Layer`, life cycle in `Scope`, typed errors end to end, one `runPromise` per boundary (`ipcMain.handle`, `utilityProcess` entry, agent processes). The React renderer does not use it. Lot 0 stays as is: `decide`/`handle` and `collectReport` are the boundaries Effect will inhabit, without changing their contracts. To settle in lot 3: `@effect/sql-drizzle` or the Effect drivers of Drizzle 1.0; the five Effect anti-slop rules come in with that lot. |
| Linux target | glibc ≥ 2.41 not required thanks to `node:sqlite`; to be confirmed in lot 0 on Arch and Ubuntu 24.04. |

## Design and animation decisions

| Subject | Decision |
|---|---|
| Animation | **motion.dev**, the heart of the application. "Calme" personality validated on the prototype, exposed in code under the name `spring` (a name that says what it is, not a mood): soft springs (`stiffness 170, damping 26`), cascading entrances, no bounce; shared indicator (`layoutId`) for Project selection and sidebar navigation. Gooey effect not retained. Rule: transform, opacity, filter, clip-path only; `will-change` on one or two elements per view. |
| Component foundation | **Base UI** (unstyled, accessibility and focus handled). Popup opening animations in CSS via `data-starting-style` / `data-ending-style`. |
| Styles | **Tailwind 4**. **A single source of colours**: the theme file; no colour value duplicated anywhere else, neither in TS, nor in CSS, nor in SVG (lot 0's `window-colors.ts` and `application.css` disappear in lot 1). Checked by `@shadcn/lint` on oxlint (`no-raw-colors`, `no-arbitrary-values`, `no-inline-styles`, `require-static-classes`, `no-unknown-classes`, `no-restyle`), active from lot 0 on. CSS file based on the coss ui model: tokens `--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`, `--sidebar-*` in `:root` / `.dark`, borders in `--alpha()`, `@theme inline` mapping to `--color-*` and `--font-*`. The values come from the tokens extracted from the HTML prototype. |
| Components | Rebuilt in-house, never imported from a registry. Base UI as the foundation, cva + `cn` shadcn-style for the variants (shadcn's `cn` package replaces clsx and tailwind-merge), the prototype's look, **beui**'s animations (stateful Button included). Spectrum UI and transitions.dev as pattern books. Shared loading: a grid of dots with a concentric ripple, same look as dotmatrix's "Origin Wave", written in-house without their code (proprietary licence). |
| Icons | **Tabler Icons**. |
| Fonts | **Fontsource** for Inter and **Fira Code** as mono (variable npm packages, loaded by the bundle), no more TTF files in the repository. |
| Migrations | **Generated by `drizzle-kit generate`** and applied by the Drizzle migrator; no hand-written SQL migration. The 13 September rule (forward-only, cumulative per lot, prior backup, test from the previous version's fixture) stands. |
| Code repository | Contains code only: neither the specifications (agents are launched from the documentation folder), nor `reports/` (generated, ignored; the evidence is archived with the lot's documentation), nor legacy code (`legacy/` removed after the lot 0 review). |
| Design system | **Storybook** with the Vitest addon, shipped and validated by the maintainer **before** any page of the application. |
| Density | Base text **16 px**, controls 32 / 36 / 44 (decided in lot 2; lot 1 at 14 px was too small). |
| Shell | A single chrome bar as the title bar: left segment aligned with the sidebar carrying the collapse button, Projects bar to its right, OS buttons via WCO. Sidebar on the model of **beui's animated sidebar** rewritten on Base UI: collapsed icon rail, width that morphs on a spring. The sidebar width is the only animated layout dimension, a named exception in the lint and measured at every acceptance review. |
| Shortcuts | **TanStack Hotkeys** (`@tanstack/react-hotkeys`, alpha, pinned): `Mod` per platform, field exclusion, conflicts detected, display formatting. `Kbd` primitive shaped like a key, thick bottom edge. |

## Re-splitting of the lots

Lot 1 on GPUiX mixed fork, window, design system, database, Project/Session and packages.
Each new lot is closed by a validation from the maintainer before the next one:

| Lot | Content | Gate |
|---|---|---|
| 0 · foundation | pnpm + Vite+ monorepo, Electron 44, empty frameless window on Windows and Linux/Wayland in HiDPI, typed IPC, portable package per OS, one motion.dev animation at 60 fps | crisp window, `chrome://gpu` accelerated, human acceptance review |
| 1 · design system | tokens in CSS, Base UI + motion.dev, Storybook, eight components at most | validation in Storybook |
| 2 · shell | Projects bar, sidebar, panels, gutters, transitions | human acceptance review with the mouse |
| 3 · profile and database | port of `runtime` into a `utilityProcess`, migrations, backup | migration tests |
| 4 · Project and Session | the former lot 1 on the business side, on the real pages | human acceptance review |

The former lots 2 to 8 are renumbered 5 to 11 (done on 15 September); their proposals remain
valid in substance, their mentions of GPUiX and Bun are obsolete.

## What survives from the GPUiX code

`packages/core` (domain), `packages/runtime/storage` except the driver (schema, SQL migration,
workspace-store, journal, preferences, backup), `packages/runtime/platform` (profile, lock,
diagnostics, channel), `packages/ui/tokens` and the traceability, boundaries, i18n and
migration tools. All GPUiX rendering, `apps/desktop`, `tools/gpuix` and `tools/package-desktop`
are abandoned. The GPUiX fork is no longer used.

## Reference prototype

The animation prototype (Vite + React + Base UI + motion.dev + Tailwind 4, browser only) is
the primary source of the "Calme" verdict. It stays throwaway: never imported, never copied.
