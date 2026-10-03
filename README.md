# Hemera

Hemera is a desktop application for driving coding agents: it gives each piece of work a place,
runs the agents that do it, and keeps what they decided, wrote and proved where you can read it.
Electron and React, built as a pnpm monorepo.

1.0 is being rebuilt; the previous code is archived in
[`KristenJestin/hemera-legacy`](https://github.com/KristenJestin/hemera-legacy).

## Development

```
pnpm install --frozen-lockfile
pnpm dev          # the desktop application
pnpm check        # typecheck, lint, fmt:check and test
```

See [`AGENTS.md`](AGENTS.md) for the working rules.
