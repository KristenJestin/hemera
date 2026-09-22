# How the ACP adapters ship and start — 22 September 2026

Companion to `acp-providers-2026-09.md`, which says what the two adapters are. This one says how
Hemera carries them and how it runs them, because a package cannot do either the way a
development run does. Everything below was verified on this machine (Windows 11, Electron 44.3.0)
against the package `pnpm package` builds; Linux and macOS are **not verified**.

## Why `utilityProcess` and not `spawn`

A bundled adapter is a Node script. A packaged Hemera has no Node to run one with:
`process.execPath` is Electron, and `electron-builder.yml` sets the fuse `runAsNode: false` so
that a packaged application cannot be talked into being a Node interpreter by whoever exports an
environment variable. Spawning `process.execPath` with `ELECTRON_RUN_AS_NODE=1` — what the engine
did before — starts a second copy of the application in a package, not a script.

`utilityProcess.fork` is Electron's own answer: a script on Node, in a process of its own, with
that fuse untouched. It lives in the main process, and the engine is itself a utility process, so
there is a seam:

1. the engine asks over the port it was forked with (`src/engine/agents/adapter-process.ts`);
2. the main process forks **this application's own bootstrap** and nothing the asker names
   (`src/main/adapter-host.ts`), then hands one end of a `MessageChannelMain` to each side;
3. the two talk directly. Nothing of ACP crosses the main process.

The bootstrap (`src/adapter/index.ts`, built as the fifth bundle, `dist/adapter/index.js`) exists
for one reason: **a utility process has no standard input**. Electron refuses any `stdio[0]` but
`ignore` — "stdin value other than ignore is not supported" — and the `process.stdin` it hands the
child has already ended, is a getter, and is not configurable. ACP is a conversation over standard
input and output, so the bootstrap runs the adapter in a **worker thread**, which Node does give a
real `stdin`, `stdout` and `stderr` (`new Worker(script, { stdin: true, … })`), and wires those
three pipes to the port as whole lines. Lines, not chunks: an ACP answer runs to tens of
kilobytes and a pipe cuts where it likes.

The supervisor of D5-04 is unchanged above that seam. What it is told is that a script is not a
process group of its own: on Windows the adapter's process is a real tree — `claude.exe` is its
child — and `taskkill /PID <pid> /T /F` takes it down exactly as it does a spawn; on POSIX there
is no group to signal, so the escalation is a `SIGKILL` on the pid, and the graceful stop (closing
the adapter's input, which makes it dispose of the agent it started) is what takes the children
with it. An agent that speaks ACP itself — `opencode acp` — is still spawned as a command.

## Which agent an adapter runs

Left to itself, each adapter runs an agent it carries as an optional dependency of its own, as a
platform binary: `@anthropic-ai/claude-agent-sdk-win32-x64` weighs 223 MB on this machine and
`@openai/codex` more. Hemera ships neither — the agent is the one the reader installed and signed
in (D5-21) — so discovery hands each adapter the path it found on the `PATH`, in the variable that
adapter reads:

| Adapter | Variable | Read in |
|---|---|---|
| `@agentclientprotocol/claude-agent-acp` | `CLAUDE_CODE_EXECUTABLE` | `dist/acp-agent.js`, `claudeCliPath()` — checked before anything else, and the error when it is unset names it |
| `@agentclientprotocol/codex-acp` | `CODEX_PATH` | `dist/index.js`, `startCodexConnection()` — when set, it spawns `<CODEX_PATH> app-server` directly; when unset it resolves `@openai/codex/bin/codex.js` |

So `codex-acp` **can** be told where `codex` is, and `@openai/codex` is never loaded. It is still
declared as a plain dependency of the adapter, so the packaging step cuts it out of the closure by
name rather than tripping over it.

## What a package carries

`tools/package-desktop.ts` walks the runtime closure of the two adapters — `dependencies` only,
never `optionalDependencies` — from each package's own folder, because pnpm keeps a dependency
next to the package that declares it. Every package is copied without its own nested
`node_modules`, which is what keeps the platform binaries out, into
`apps/desktop/adapters/node_modules/` as a flat tree Node resolves like an installed one.
`electron-builder.yml` then carries that folder as `extraResources`, outside the `asar`, because a
script has to be a file on disk to be forked.

Two traps, both paid for once:

- `extraResources` whose `from` sits above the project directory matches nothing at all, silently.
  The folder is therefore built inside `apps/desktop/`.
- electron-builder refuses to copy an entry called `node_modules` at the root of a fileset,
  whatever the pattern. So `node_modules` is named on both sides of the `from`/`to` pair.

`inspectPackage` checks the result on the package rather than on the configuration: the two
adapters' manifests must be under `resources/adapters/`, `dist/adapter/index.js` must be in the
archive, and no `@anthropic-ai/claude-agent-sdk-*` or `@openai/codex*` may be anywhere in there.
The adapters' folder is the one exception to the rule that a package carries no `node_modules`.

**Measured on this machine**, `dev` channel, Windows x64:

- the closure is 19 packages and **19 MB** on disk (23 MB as the package lays it out);
- `win-unpacked` is **347 MB**. It was 1.1 GB before this change, because electron-builder
  collected the production `node_modules` of `apps/desktop` on its own and those hold the two
  agents as platform binaries. The bundles import nothing but `node:` and `electron`, so
  `files` now excludes `node_modules` outright and the adapters are the only thing carried
  beside the archive.

## What was verified

`pnpm package` on Windows, then the packaged application started from `dist/package/win-unpacked`
with `--data-dir` on a throwaway folder. Picking Claude Code in a Project's composer started the
adapter and got its real model list back. Its `diagnostic.log`:

```
[engine] …\win-unpacked\resources\adapters\node_modules\@agentclientprotocol\claude-agent-acp\dist\index.js (22888): [session/create] … phase=sdk-initialize durationMs=733 totalMs=776
[engine] …\claude-agent-acp\dist\index.js (22888): [session/create] … phase=register durationMs=1 totalMs=778
```

Process 22888 is the adapter's utility process, and `claude.exe` was its child — the tree
`taskkill /T` walks. Codex was not exercised: this machine has Claude Code signed in.
