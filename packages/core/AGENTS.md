# AGENTS.md — Effect and Schema

Read the root `AGENTS.md` first; this file adds the rules for Effect code. They apply wherever
Effect is written: here, in `packages/ipc`, in the engine and main process of `apps/desktop`,
and in the hook layer of the renderer.

## Effect

- Effect 4 stable in the engine: Schema for every value that crosses a boundary, RPC between
  the processes.
- For Effect code, read `node_modules/effect/AGENTS.md` and its `ai-docs/` first.
- Effect is pinned exactly; an upgrade is its own pull request.
- No zod: the lint refuses its import. Effect `Schema` replaces it everywhere.
- Components stay plain React: they receive values and call functions. A thin layer of hooks
  between the components and the engine may use Effect (RPC calls, streams, interruption, and
  possibly Effect's Atom for interface state). No `Effect`, `Layer`, `Stream` or fiber inside a
  component. Schema types, decoders and the form helper (`toFormSchema`) are allowed anywhere
  in the interface.
- The `anti-slop-effect` lint rules (root `AGENTS.md`, code style) hold the shape of errors,
  tags, services and branches.

## The conventions of `@hemera/core/schema`

Each is proven by a test:

- a value crosses a process link through `Schema.toCodecJson` (bytes as base64, dates as ISO
  strings);
- an MCP tool takes its input schema from `toToolInputSchema` only;
- a parse error reaches a person only through `formatSchemaError` or `toFormSchema`, never as
  Schema's raw message.
