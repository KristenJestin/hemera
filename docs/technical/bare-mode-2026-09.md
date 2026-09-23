# Bare mode for the three ACP agents

Spike written on 21 September 2026 for #18, from primary sources. It answers one question: can each agent be run over ACP with no native tool, while receiving Hemera's tools, and by which means.

Can Claude Code, Codex and OpenCode each be run over ACP with **no native tool loaded** (no file read/write/edit, no shell, no web search, no sub-agents) while still receiving tools from Hemera — and by exactly which means? Secondary question: are the ACP client capabilities (`fs/*`, `terminal/*`) an alternative channel to MCP for that.

Research date 2026-09-21. Primary sources only (GitHub source, official docs, npm). Line numbers are approximate and drift. Where the sources do not answer, the report says **not established**.

## Summary table

| | Means to remove native tools | Exhaustive? | MCP tools kept? | ACP `fs`/`terminal` delegation? | Personal config controllable? |
|---|---|---|---|---|---|
| **Claude Code**<br>`@agentclientprotocol/claude-agent-acp` 0.79.0 | `session/new._meta.claudeCode.options.tools: []` (or legacy `_meta.disableBuiltInTools: true`) | **Yes** — documented "All built-ins are removed". Residue: adapter force-adds `disallowedTools:["AskUserQuestion"]` and `canUseTool` | **Yes** — "Claude can only use your MCP tools" | **No** — the ACP-backed MCP server was deleted 2026-02-18; built-ins run natively in the CLI subprocess | **Yes**: `options.settingSources: []` + `options.env` (`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`). Managed/policy settings still load |
| **Codex**<br>`@agentclientprotocol/codex-acp` 1.12.0, patched by Hemera (`patches/`) | `session/new._meta.hemera` read by the patch: `environments: []` on `thread/start` and every `turn/start`, Hemera's tools as `dynamicTools`; plus `CODEX_CONFIG` (nested) turning off every tool a key reaches | **Yes, tried** on 23 September 2026 (Windows, codex-cli 0.154.0): the model's `ALL_TOOLS` held the eleven `hemera_*` tools and nothing else. Residue: code mode's `exec`/`wait`, a V8 isolate that reaches only those tools | **No MCP server at all**: Hemera's tools are Codex's own dynamic tools, and the patch answers their calls through Hemera's MCP server | **No** — the adapter never calls `fs/*` or `terminal/*` | **Partly**: `CODEX_HOME` stays the user's (the login lives there); their `config.toml` still loads under Hemera's overrides, their MCP servers are turned off by name |
| **OpenCode**<br>`opencode acp` (anomalyco/opencode 1.18.31) | A custom primary agent with `permission: {"*":"deny", "<ns>_*":"allow"}`, set as `default_agent` | **Yes** for a catch-all deny — the definition is dropped from the provider request. A *granular* deny is call-time refusal only | **Only if re-allowed**: a blanket `"*":"deny"` kills MCP tools too; the namespace re-allow is mandatory | **Almost no** — `fs/write_text_file` used cosmetically for diff preview; `fs/read_text_file` and `terminal/*` never called | **Yes, with residue**: `XDG_CONFIG_HOME` + `OPENCODE_DISABLE_PROJECT_CONFIG` + `OPENCODE_CONFIG_CONTENT`. `$HOME/.opencode` and managed config survive |

One conclusion across all three: **the ACP client capabilities are not a tool channel.** In September 2026 none of the three adapters routes its native tools through the client's `fs/*` or `terminal/*`. Hemera's tools must go through MCP.

---

## 1. Claude Code over ACP

**Current package**: `@agentclientprotocol/claude-agent-acp` 0.79.0, 2026-09-17 (https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp), repo `github.com/agentclientprotocol/claude-agent-acp`. The old `@zed-industries/claude-code-acp` is frozen at 0.16.2 with a materially different architecture — do not use it as a reference. The adapter pins `@anthropic-ai/claude-agent-sdk` 0.3.274.

### The lever

`src/acp-agent.ts:1162-1193` declares the extension point:

```ts
export type NewSessionMeta = {
  claudeCode?: {
    /* Options forwarded to Claude Code when starting a new session.
     * Not forwarded (managed by ACP): cwd, includePartialMessages,
     *   permissionMode, canUseTool, executable. `agent` is ignored.
     * Used and adapted: hooks (merged), mcpServers (merged),
     *   disallowedTools (merged),
     *   tools (passed through; defaults to claude_code preset if not provided) */
    options?: Options;            // the full Claude Agent SDK Options type
    emitRawSDKMessages?: boolean | SDKMessageFilter[];
  };
  additionalRoots?: string[];
};
```

and `src/acp-agent.ts:7940-7948` resolves the tool set:

```ts
const disallowedTools = elicitationSupport.form ? [] : ["AskUserQuestion"];
// Explicit tools array from _meta.claudeCode.options takes precedence.
// disableBuiltInTools is a legacy shorthand for tools: [] — kept for
// backward compatibility but callers should prefer the tools array.
const tools: Options["tools"] =
  userProvidedOptions?.tools ??
  (params._meta?.disableBuiltInTools === true ? [] : { type: "preset", preset: "claude_code" });
```

Tested at `src/tests/create-session-options.test.ts:171`, `:266`, `:289`, `:313`.

In the assembled options (`:8037-8100`), `systemPrompt` and `settingSources` are written **before** `...userProvidedOptions`, so the client can override them; `cwd`, `permissionMode`, `canUseTool`, `mcpServers`, `disallowedTools`, `tools` and two hooks are written after and cannot be suppressed. `_meta.systemPrompt` (`:7877-7894`) takes a string (full replacement) or an object (forced back to the `claude_code` preset); `{type:"custom"}` must go through `options.systemPrompt`.

### Does `tools: []` empty everything and keep MCP?

SDK typings (https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-agent-sdk/sdk.d.ts ~1560): `tools?: string[] | { type: 'preset'; preset: 'claude_code' }`, documented as "`[]` (empty array) - Disable all built-in tools".

The MCP answer is in the docs, https://code.claude.com/docs/en/agent-sdk/custom-tools: `tools: ["Read","Grep"]` → "Unlisted built-ins are removed. **MCP tools are unaffected.**"; `tools: []` → "**All built-ins are removed. Claude can only use your MCP tools.**" That covers `Agent`/`Task`, `WebSearch`, `WebFetch`, `Bash`, `Read`/`Write`/`Edit`, `Glob`/`Grep`, `TodoWrite`, `ExitPlanMode`, `Skill`, `ToolSearch`.

### Enumerable?

Not from code: `sdk.d.ts` exports no tool-name union. It is documented — https://code.claude.com/docs/en/tools-reference tabulates 46 names ("the exact strings you use in permission rules, subagent tool lists, and hook matchers"), from `Agent` and `Bash` to `WebSearch`, `Workflow` and `Write`; `Task` is an alias of `Agent`. A docs table is not a machine-readable contract and can drift between CLI versions.

### Removing a definition vs refusing a call

- `disallowedTools` with a **bare** name removes the tool from the model's context
  (`sdk.d.ts` ~1529; https://code.claude.com/docs/en/agent-sdk/permissions: "Bare-name deny
  rules like `Bash` remove the tool from Claude's context before this evaluation begins").
- A **scoped** rule (`"Bash(rm *)"`) leaves the tool visible and denies matching calls.
- `canUseTool` / `permissionMode` are call-time only. `permissionMode:'dontAsk'` turns prompts
  into denials but un-advertises nothing. Permission is **not** a substitute for `tools: []`.

### Personal configuration

`settingSources` (`sdk.d.ts` ~2145): `'user'|'project'|'local'`, "Pass `[]` to disable filesystem settings (SDK isolation mode)". The adapter writes all three at `:8039`, overridable by the client. Per https://code.claude.com/docs/en/agent-sdk/claude-code-features this is not total isolation: managed/policy settings still load, `~/.claude.json` is "always read" (relocate with `CLAUDE_CONFIG_DIR`), auto-memory still loads (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), and claude.ai MCP connectors load on login (`strictMcpConfig`, `disableClaudeAiConnectors`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`).

Env is merged, not replaced: `{...process.env, ...userProvidedOptions?.env, ...providerEnv, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:"1"}` (`:8017-8028`). `CLAUDE_CONFIG_DIR` is read at `:268`. The adapter never sets `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.

### ACP `fs`/`terminal` delegation is gone

No `createSdkMcpServer` call and no `mcp__acp__*` name anywhere in `src/`. Built-ins run natively in the CLI subprocess against the local filesystem. The client methods survive as unused plumbing (`:1673-1679`, `:6894-6902` forward to `ctx.request(methods.client.fs.…)`); nothing outside `src/tests/` calls them, and there is no `clientCapabilities.fs` check in `src/acp-agent.ts`. Removed by commit `be618f5d`, 2026-02-18, "Switch over to built-in Claude Code tools (#316)", deleting `src/mcp-server.ts` (-911 lines): "we made the decision to just switch back over to the built-in tools".

For contrast, `@zed-industries/claude-code-acp@0.16.2` `dist/acp-agent.js:834-855` did exactly the delegation Hemera hoped for — it disallowed `Read`/`Write`/`Edit`/`Bash` whenever `clientCapabilities.fs.readTextFile` / `.writeTextFile` / `.terminal` were advertised and substituted `mcp__acp__Read` / `Write` / `Edit` / `Bash`. That mechanism no longer exists.

The SDK's `toolAliases` (`sdk.d.ts` ~1535) is the documented bridge for prompts that still name a built-in: `toolAliases: { Bash: 'mcp__hemera__bash' }` — single-hop, does not re-add the tool.

### Minimal bare-mode `session/new`

```jsonc
{
  "cwd": "/abs/path",
  "mcpServers": [{ "name": "hemera", "command": "node", "args": ["./hemera-mcp.js"] }],
  "_meta": { "claudeCode": { "options": {
    "tools": [],
    "settingSources": [],
    "systemPrompt": { "type": "custom", "prompt": "…", "snapshot": true },
    "env": { "CLAUDE_CONFIG_DIR": "/abs/isolated", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
             "ENABLE_CLAUDEAI_MCP_SERVERS": "false" }
  } } }
}
```

This is the spike's proposal, and Hemera does not send `CLAUDE_CONFIG_DIR`, although the
issue's design (D6-02) listed it. The directory it names is where Claude Code keeps its login, as
`.credentials.json` wherever a file holds it. `claude auth status` run with a directory of its
own answers `loggedIn: false` on a machine that is signed in (checked on 23 September 2026,
Windows, Claude Code 2.1.280). Copying or linking the credentials into a directory of Hemera's
would mean handling a secret that is not Hemera's. What the move was for is done without it:
`settingSources: []` reads none of the user's settings files, and `strictMcpConfig: true` loads
no MCP server but Hemera's. What still loads, `~/.claude.json` and the managed and policy
settings, is named as residue under the agent in Settings › Agents (D6-09). Hemera also sends
`strictMcpConfig: true`, `MCP_TOOL_TIMEOUT` in `env`, and `allowedTools` (below).

### The Workspace's instructions under bare mode (added in lot 2b)

Each adapter declares `readsAgentsFile`: whether the agent, run bare, still reads the Workspace's
`AGENTS.md` itself.

- **Claude Code: no.** Claude Code reads `CLAUDE.md`, never `AGENTS.md`, and `settingSources: []`
  loads no project memory at all. The trial of 23 September 2026 showed it: a rule in `AGENTS.md`
  ("End every answer with KESTREL") was ignored by a fresh Session while the Context view listed
  the file as read natively. Hemera now gives the file at the start of the Session, as a resource
  of the first prompt behind its marker, and the Context view lists it as `provided`, reached at
  `session_start`.
- **OpenCode: no.** `session/instruction.ts` (`systemPaths`, v1.18.30) looks for the project's
  `AGENTS.md` only when `OPENCODE_DISABLE_PROJECT_CONFIG` is unset, which bare mode sets; the global
  `AGENTS.md` it reads lives under `XDG_CONFIG_HOME`, which bare mode points at Hemera's directory.
  Given at the start, like Claude Code.
- **Codex: yes.** `codex-rs/core/src/agents_md.rs` collects every `AGENTS.md` from the project root
  down to the working directory, and neither the patch nor `CODEX_CONFIG` changes that. Recorded as
  read natively and never sent.

A change of the file during a Session goes to every agent the same way, as a delivery between two
turns. A `CLAUDE.md` in the Workspace is never sent by Hemera: Claude Code does not read it either
under `settingSources: []`, but the rule that a native instruction file is not injected twice
stands, and Hemera's one file of instructions is `AGENTS.md`.

### Permissions for Hemera's own tools (added in lot 2b)

Emptying the built-ins does not stop Claude Code from asking about the MCP tools that remain.
The adapter passes `permissionMode`, read from its own `SettingsManager`, which reads
`~/.claude/settings.json` and the Workspace's `.claude/settings*.json` whatever `settingSources`
says. It also passes `canUseTool`, which forwards anything the CLI does not allow on its own to
ACP `session/request_permission`, with persistent "always allow" options (`dist/acp-agent.js`,
`canUseTool` and the `options` object built for `query`). In `default` mode Claude Code asks
before an MCP tool runs. Each Hemera call would then meet Claude's permission block before
Hemera's own gate, and an "always allow" would be written into Claude's local settings. D6-05
rules out both.

Hemera does two things about it:

- Its `_meta.claudeCode.options` carry `allowedTools: ["mcp__hemera__*"]`. The adapter spreads
  `userProvidedOptions` into the SDK's `Options`, and `allowedTools` is the SDK's list of "tool
  names that are auto-allowed without prompting" (`sdk.d.ts` ~1496). `mcp__hemera__*` is the
  permission rule for every tool of the server named `hemera`.
- The runtime answers a permission request about one of Hemera's tools itself, with the
  agent's "allow once" option. The tool is read from `_meta.claudeCode.toolName` when the adapter
  sends it, and from the title otherwise. Only a name under an agent's prefix counts
  (`mcp__hemera__*`, `hemera_*`), so a native tool that happens to share a bare name is not
  allowed this way. The call then goes through Hemera's own gate: inside the root on its own,
  outside it through Hemera's block. Nothing is remembered on the agent's side.

The second one also covers an agent or a version that ignores `allowedTools`. Whether Claude
Code 2.1 still prompts with `allowedTools` set has not been run here yet; the phase-3 Windows
trial checks it.

---

## 2. Codex over ACP

**Current home**: `github.com/agentclientprotocol/codex-acp` (active 2026-09-21), npm `@agentclientprotocol/codex-acp` 1.12.0. `zed-industries/codex-acp` is **archived** (`archived: true`, last push 2026-07-22) and its npm package is deprecated: "This package has been replaced by @agentclientprotocol/codex-acp."

Architecture change that dominates everything: the adapter is no longer a Rust binary embedding `codex-core`. It is a TypeScript stdio ACP server that **spawns `codex app-server` as a child process** (`src/CodexJsonRpcConnection.ts:15-27`). Everything it can configure goes through `thread/start`'s `config` map or the environment. `codex-rs/core/src/openai_tools.rs` no longer exists; the registry is `codex-rs/core/src/tools/spec_plan.rs`.

### Built-in tools and their switches

`add_core_tool_sources` (`spec_plan.rs:969-989`) calls `add_shell_tools`, `add_mcp_resource_tools`, `add_core_utility_tools`, `add_collaboration_tools`.

| Model-visible tool | Registered at | Switch that removes it |
|---|---|---|
| `exec_command`, `write_stdin` | `spec_plan.rs:1032-1070` | `[features] shell_tool=false`, or model catalog `shell_type="disabled"`. `unified_exec=false` only downgrades to one-shot |
| `apply_patch` | `:1197-1200` — `environment_mode.has_environment() && model_info.apply_patch_tool_type.is_some()` | **no config key**; `environments: []` (patch, below) |
| `update_plan` | `:1101-1103` | `[tools.update_plan] enabled` (default **false**) |
| `view_image` | `:1219-1230` | `[features] view_image=false` (default true) |
| hosted `web_search` | `hosted_model_tool_specs` `:593-623` | top-level `web_search="disabled"` (default `cached`) |
| standalone `web.run` | `:991-1000` | `[features] standalone_web_search` (default false) |
| `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` | `:1085-1092`, gated on `mcp.has_servers()` | **no switch** — absent when there is no MCP server: Hemera's tools as `dynamicTools` (patch, below) |
| `request_user_input` | `:1111-1118` | `[tools.experimental_request_user_input] enabled=false` (default true) |
| `request_permissions` | `:1157-1159` | `[features] request_permissions_tool=false` |
| `new_context`, `get_context_remaining` | `:1161-1164` | `[features] token_budget` |
| `clock.curr_time`, `clock.sleep` | `:1166-1192` | `[features] current_time_reminder`, `sleep_tool=false` (default true) |
| `wait_for_environment` | `:1105-1109` | `[features] deferred_executor` |
| multi-agent (`spawn_agent`, `send_message`, `wait_agent`, …) | `add_collaboration_tools` `:1241+` | `[features] multi_agent`, `multi_agent_v2` = false, and `[agents] enabled = false`: a model catalogue that names a multi-agent version wins over the two features |
| code-mode `exec`/`wait` | `register_code_mode_executors` `:786` | `[features] code_mode=false` |

There is **no `read_file` built-in**: Codex reads files through `exec_command`. `ConfigShellToolType` has only `UnifiedExec` and `Disabled` (`codex-rs/protocol/src/openai_models.rs:314-318`), so the shell tool *is* removable — but it is on by default, as are `view_image`, `sleep_tool`, `request_user_input` and `web_search`.

### What no key reaches, and the two fields that do

`[tools]` has exactly three keys (`codex-rs/config/src/config_toml.rs:650-658`): `web_search` (shape only — the on/off is the top-level `web_search` enum), `experimental_request_user_input`, `update_plan`. Everything else is `[features]`, a flattened `BTreeMap<String,bool>` (`codex-rs/features/src/lib.rs`). `sandbox_mode` and `approval_policy` remove no tool.

Two families have no configuration key: `apply_patch` (gated on an environment and on the model catalogue's `apply_patch_tool_type`) and the three `*_mcp_resource*` tools (registered as soon as any MCP server exists, which an MCP-only bare mode requires). Nor can Hemera move `CODEX_HOME` to a directory of its own: `auth.json` lives there, and the keyring store is keyed by a hash of that path (`login/src/auth/storage.rs`), so a moved home is a signed-out Codex — `codex login status` said "Not logged in" with a `CODEX_HOME` of its own on a machine that is signed in (23 September 2026).

`codex app-server`'s `thread/start` has two fields behind `experimentalApi` that reach both families (`app-server-protocol` v2, `ThreadStartParams`):

- **`environments: []`** — "Empty disables environment access for turns that do not provide a turn override". The shell, `apply_patch` and `view_image` are all gated on an environment (`core/src/tools/spec_plan.rs`). `turn/start` takes the same field, "for this turn and subsequent turns"; `thread/resume` does not, and a resumed thread gets the default environment back unless each turn says none.
- **`dynamicTools`** — function specs (`name`, `description`, `inputSchema`) Codex offers the model as its own. A call comes back to the client as the server request `item/tool/call` (`{threadId, turnId, callId, namespace, tool, arguments}`), answered with `{success, contentItems}`. With Hemera's tools there, no MCP server exists and the `*_mcp_resource*` tools are never registered. Codex keeps the specs in the thread's rollout and restores them on `thread/resume` (`core/src/session/mod.rs`, `get_dynamic_tools`).

`codex-acp` 1.12.0 sets `experimentalApi: true` but forwards neither field, and does not handle `item/tool/call`.

### Hemera's means: a patch of the adapter, and `CODEX_CONFIG`

**The patch** (`patches/@agentclientprotocol__codex-acp@1.12.0.patch`, applied by `pnpm install` through `pnpm-workspace.yaml` `patchedDependencies`; about 130 changed lines of `dist/index.js`). A `session/new`, `session/load` or `session/resume` whose `_meta` carries `{"hemera": {"bare": true, "toolServer": "hemera"}}`:

- takes the HTTP server named `toolServer` out of `mcpServers`, asks it `tools/list` (a minimal MCP client over `node:http`, not `fetch`: a call may wait on the human past undici's five-minute timeouts) and hands the tools to `thread/start` as `dynamicTools` named `hemera_<tool>`, with `environments: []`;
- sends `environments: []` on every `turn/start` of such a thread, which covers a resumed one;
- turns off by name the MCP servers the user's configuration declares (`config/read`, then `mcp_servers.<name>.enabled = false`);
- answers `item/tool/call` with the server's `tools/call`, the session's bearer header and `_meta: {"hemera/callId": <callId>}` — the id the adapter's own `tool_call` report carries, which Hemera's thread pairs the two by;
- starts no title thread: the adapter otherwise names a session on an ephemeral thread of its own, started with the user's full configuration and an environment.

**`CODEX_CONFIG`** on the adapter's process (`adapters/codex.ts`): `web_search = "disabled"`, `approval_policy = "on-request"`, `tools.update_plan` and `tools.experimental_request_user_input` off, `agents.enabled = false` (the model catalogue asks for the v2 sub-agent tools otherwise), `orchestrator.skills.enabled = false` and `orchestrator.mcp.enabled = false` (`skills__list`, `skills__read`), and `[features]` `shell_tool`, `unified_exec`, `view_image`, `sleep_tool`, `current_time_reminder`, `request_permissions_tool`, `token_budget`, `deferred_executor`, `code_mode`, `multi_agent`, `multi_agent_v2`, `image_generation`, `standalone_web_search`, `tool_suggest`, `apps`, `plugins`, `goals`, `browser_use`, `computer_use` all `false`.

It must be **nested**, never dotted. The adapter adds a `features` table of its own to every thread (`forceGitRootTurnDiffPaths`), and dotted `features.x` keys beside it were lost: the first trial, dotted, still offered image generation and the goal tools.

`CODEX_HOME` is left where the user has it, so the login is theirs and Hemera never touches a file of theirs. The price: Codex still reads their `config.toml` (model, profiles, hooks) beneath Hemera's overrides, their global `AGENTS.md` and skills, and the trusted project's `.codex/config.toml`. That is the agent's private part in the Context view.

### What stays

- **Code mode.** The model catalogue decides it (`model_info.tool_mode` wins over `features.code_mode`, `core/src/tools/mod.rs`), so the model sees `exec` and `wait` at the top level. `exec` "runs raw JavaScript — no Node, no file system, no network access, no console" in a V8 isolate (`code-mode-protocol/src/description.rs`), and its `tools` object holds exactly the registered tools: here the eleven `hemera_*`. It adds no native capability.
- **Two experimental fields.** `environments` and `dynamicTools` can change between Codex releases. Tried on **codex-cli 0.154.0** (the machine's own, through `CODEX_PATH`); a Codex upgrade needs the trial again.
- **Not verified on Linux or macOS.** Nothing in the means depends on the platform, but the trial ran on Windows only.

### The trial (23 September 2026, Windows, codex-cli 0.154.0, the user's signed-in Codex)

Run with `pnpm dev --data-dir <fresh folder> --remote-debugging-port=9333`, driven over `window.hemera`, the adapter's JSON-RPC traffic logged with `APP_SERVER_LOGS`.

- **Tools.** `thread/start` carried `environments: []`, the eleven `hemera_*` names as `dynamicTools`, the nested configuration and `mcp_servers: {"node_repl": {"enabled": false}}` (the user's one declared server); no MCP server started on the thread. Asked to run `exec` with `text(JSON.stringify(ALL_TOOLS.map(t => t.name)))`, the model answered the eleven `hemera_*` names and nothing else; its top-level function was `exec`. No `apply_patch`, no shell, no `*_mcp_resource*`. The same after a restart of the application, on the resumed thread.
- **A read.** "Read notes.md …" gave one `item/tool/call` for `hemera_fs_read`, one `hemera_tool_call` entry "read notes.md (bytes 0-69 of 69)" whose `callId` is the adapter report's `toolCallId`, and the thread drew one Hemera block for it.
- **A write outside the root.** `hemera_fs_write` on a path under `%TEMP%` wrote a `permission_request` ("fs_write asks to act outside the Workspace") and the window showed "Waiting for your permission". Refused, the call ended `failed` after 221 s of waiting, and no file was written.
- **The login.** No `account/login` request; every `account/read` answered the user's ChatGPT account; the diagnostic line reads `agents: Codex started bare for Session … (Hemera's patch of the adapter: …); Hemera's MCP server handed at http://127.0.0.1:… as <digest>`.

### ACP capabilities

**The adapter never calls ACP `fs/*` or `terminal/*`.** Grep over `src/` finds those names only in test fixtures. `src/TerminalOutputMode.ts` is an outbound `_meta` streaming extension (`terminal_output` / `terminal_output_delta`), not the ACP terminal client capability. Codex does all file and process I/O itself, in the app-server child — which, bare, has no environment to do it in.

---

## 3. OpenCode over ACP

`sst/opencode` redirects to **`anomalyco/opencode`**; release 1.18.31, npm `opencode-ai`. Citations at commit `f54ce313`. `opencode acp` starts a full local OpenCode HTTP server in-process and adapts ACP over it (`packages/opencode/src/cli/cmd/acp.ts:20-30`), setting `process.env.OPENCODE_CLIENT = "acp"` — which alone removes the `question` and `plan_exit` tools (`tool/registry.ts:207`, `:248`).

### The registry

`tool/registry.ts:209-249`: `invalid`, `question`*, `bash`, `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, `task` (the subagent tool), `webfetch`, `todowrite`, `websearch`*, `skill`, `execute`*, `lsp`*, `plan_exit`* (* conditional). There is **no `list` tool** — `glob` covers it, though `list` survives as a permission key. Three more are injected in `session/tools.ts:27-31` when a connected MCP server advertises resources: `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`.

### `tools` and `permission` are the same lever

`agent.<name>.tools` is annotated `@deprecated Use 'permission' field instead` (`packages/core/src/v1/config/agent.ts:21-23`) and is **rewritten into permission rules at config-decode time** (`agent.ts:62-81`; top-level equivalent at `packages/opencode/src/config/config.ts:567-578`), folding `write`/`edit`/`patch` into a single `edit` key. Docs confirm (`permissions.mdx:8`): "As of `v1.1.1`, the legacy `tools` boolean config is deprecated and has been merged into `permission`."

### Definition removal vs call-time refusal — the distinction

Neither `registry.tools()` nor `SessionTools.resolve()` filters by permission. The filter is the last step before the provider call (`session/llm/request.ts:208-214`):

```ts
function resolveTools(input) {
  const disabled = Permission.disabled(Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []))
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}
```

and `Permission.disabled` (`permission/index.ts:204-219`) hides a tool **only when the last matching rule is the catch-all pattern**:

```ts
const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
return rule?.pattern === "*" && rule.action === "deny"
```

So: `"bash": "deny"` → definition never sent to the provider. `"bash": {"*":"deny","git *":"allow"}` → definition **is** sent and a non-matching call throws `DeniedError` at execution. `"bash": "ask"` → definition sent, `session/request_permission` round-trip at call time. Last-match-wins is documented (`permissions.mdx:88`) and key order is deliberately preserved (`core/src/v1/config/permission.ts:14-16`).

An agent's own rules are merged last (`agent/agent.ts:265-292`), beating both the built-in defaults and the user's top-level `permission`. OpenCode's own internal `compaction`, `title` and `summary` agents already use `permission: {"*": "deny"}` (`agent.ts:227`, `:243`, `:258`).

### MCP tools do **not** survive a blanket deny

MCP tools land in the same `tools` record (`session/tools.ts:489`) and go through the same filter, so `{"*":"deny"}` hides them too. Names are `<server>_<tool>`, both halves sanitized to `[a-zA-Z0-9_-]` (`mcp/catalog.ts:117-119`). Wildcards work on the permission key as well as the pattern (`util/wildcard.ts`; documented for MCP at `tools.mdx:29-35`), so the re-allow is:

```json
{
  "default_agent": "hemera",
  "agent": {
    "hemera": { "mode": "primary",
      "permission": { "*": "deny", "hemera_*": "allow" } },
    "build": { "disable": true },
    "plan":  { "disable": true }
  }
}
```

Two traps: the three `*_mcp_resource*` tools are folded onto the **`read`** key, so you cannot enable MCP resources without un-hiding native `read`; and wildcard matching is case-**in**sensitive on Windows only (`"si"` regex flag in `util/wildcard.ts`).

### Config delivery and isolation

Precedence (`config/config.ts:380-560`): remote `.well-known/opencode` → global `$XDG_CONFIG_HOME/opencode/*` → `OPENCODE_CONFIG` (single file) → project `opencode.json[c]` (gated by `OPENCODE_DISABLE_PROJECT_CONFIG`) → `.opencode/` dirs + `OPENCODE_CONFIG_DIR` → `OPENCODE_CONFIG_CONTENT` (inline JSON) → managed files → macOS MDM. Then `OPENCODE_PERMISSION` (inline JSON) is `mergeDeep`'d into top-level `permission` (`config.ts:559-565`), then the `tools` → `permission` desugar runs.

`XDG_CONFIG_HOME` is the isolation lever (`packages/core/src/global.ts:3,13` via `xdg-basedir`); it redirects global config, agents, skills, tools, plugins and global AGENTS.md. Residues that survive everything: `$HOME/.opencode` (`config/paths.ts:34-38`, **not** gated by `OPENCODE_DISABLE_PROJECT_CONFIG`), managed config (`C:\ProgramData\opencode`), remote `.well-known/opencode`, and `ensureGitignore` writing into every discovered config dir (`config.ts:449`).

### MCP over ACP, and client capabilities

`session/new.mcpServers` is consumed (`acp/service.ts:184-196`) and registered via `sdk.mcp.add` (`:1032-1042`) — stdio becomes `type:"local"`, so **OpenCode spawns the MCP subprocess itself**; http/sse become `type:"remote"`. Registration errors are `Effect.ignore`d, so a broken server yields a silently tool-less session. `MCP.add` writes instance state, not a file (`mcp/index.ts:641-646`), and that state is instance-scoped, not session-scoped.

ACP client methods used anywhere in `packages/opencode/src/`: `requestPermission` and `writeTextFile` only (`acp/permission.ts:56,62,102,110`). `fs/write_text_file` is used cosmetically — to push a *proposed* edit into the editor buffer while a permission prompt is open; OpenCode reads the file itself and applies the patch in-process. `fs/read_text_file` and `terminal/*` are never called.

Verification without a client: `opencode debug agent <name>` prints the resolved per-tool enabled map using the same `Permission.disabled` call (`cli/cmd/debug/agent.handler.ts:88-97`) — but it feeds from `registry.tools()`, so it shows native/custom/plugin tools only, not MCP tools.

---

## 4. ACP client capabilities vs MCP

ACP v1 (schema 1.23.0, 2026-09-18; TS SDK `@agentclientprotocol/sdk` 1.5.0, `PROTOCOL_VERSION = 1`) defines client capabilities `fs.readTextFile`, `fs.writeTextFile` and `terminal`, with methods `fs/read_text_file`, `fs/write_text_file`, `terminal/create|output|wait_for_exit|kill|release`. The stated rationale (https://agentclientprotocol.com/protocol/file-system) is editor integration — access to "unsaved changes in the editor" and letting clients "track file modifications made during agent execution".

**They are not a tool channel.** The only way a client declares tools to an agent is `session/new.mcpServers`: `NewSessionRequest` has exactly `cwd`, `additionalDirectories`, `mcpServers`, `_meta`, and `PromptRequest` has `sessionId`, `prompt`, `_meta`. `fs/*` and `terminal/*` are *agent-initiated callbacks the agent may choose to implement its own tools on top of* — and, as sections 1–3 show, none of the three adapters does so any more.

The protocol itself has moved the same way. The v2 RFD "v2 Client Filesystem and Terminal Execution Surface" (`docs/rfds/v2/client-filesystem-terminal-capabilities.mdx`) removes `clientCapabilities.fs`, `clientCapabilities.terminal` and all seven methods, because "it has not been widely adopted by both Clients and Agents, and many Agents are moving toward their own sandboxing and execution configuration instead" — and says explicitly: "If clients want to offer specialized tooling in these areas, they can already **expose a special MCP server** to the agent." The v2 schema confirms it: `ClientCapabilities` has only `auth`, `elicitation`, `_meta`, and no `fs/*` or `terminal/*` methods exist. v2 is at `2.0.0-alpha.5` (2026-09-18) and v1 is unchanged, so this is direction, not a migration Hemera must make today.

**Generic refusal is not a substitute.** `session/request_permission` is agent-initiated ("The Agent **MAY** request permission"), the option list is agent-supplied, and the client can only pick an offered option or answer `cancelled`. There is no client-side "refuse everything" channel, and refusal leaves the tool definition in the model's context — burning tokens and turns on tools the model will keep trying.

For Hemera's minimal set (read, edit, write, list, search, run a command):

| | ACP `fs`/`terminal` | MCP server from `session/new` |
|---|---|---|
| Read a file | `fs/read_text_file` with `line`/`limit` | Hemera's own tool |
| Write / edit | `fs/write_text_file` (whole file only — no patch verb) | Hemera's own tools |
| List, search | **no method at all** | Hemera's own tools |
| Run a command | `terminal/create` + `output`/`wait_for_exit`/`kill`/`release` | Hemera's own tool |
| Who decides the tool *exists* | the agent, unilaterally | the client, at `session/new` |
| Supported by the three adapters today | **none** | **all three** |
| Status in ACP v2 | removed | kept |

MCP is the only viable channel. One thing to watch: the **MCP-over-ACP** RFD (`docs/rfds/mcp-over-acp.mdx`) adds `"type": "acp"` as an MCP transport so a client can serve MCP tools "in the client's address space" over the existing ACP connection, with `mcp/connect`, `mcp/message`, `mcp/disconnect`. It exists in `schema/v1/schema.unstable.json` behind `mcpCapabilities.acp`, marked "**UNSTABLE** — not part of the spec yet". Codex explicitly rejects `acp` transport today. Until it stabilises, Hemera's MCP server must be a real stdio child process or an HTTP endpoint.

---

## 5. What is not established

Only a live trial can settle these.

**Claude Code**
- Whether the `claude_code` system-prompt preset prunes its tool-describing sections when
  `tools: []` (the prompt is inside the bundled CLI binary). Docs are silent.
- Whether the agent loop actually runs end-to-end with zero built-ins. The adapter's test
  asserts the options handed to `query()`, not a live run; the docs assert the configuration is
  supported.
- Whether `strictMcpConfig` exists as an SDK `Options` key (found in a docs table, not in
  `sdk.d.ts`).
- **Trial**: run `npx @agentclientprotocol/claude-agent-acp` over stdio, `initialize` with
  `fs`/`terminal` false, `session/new` with the JSON from §1 plus one trivial MCP tool, prompt
  "list the tools you have". Observe: the `SDKSystemMessage` init `tools: string[]` (enable
  `_meta.claudeCode.emitRawSDKMessages: true`), and whether the MCP tool is called.

**Codex** — settled by the trial of 23 September 2026 (§2), on Windows and codex-cli 0.154.0 only.
- Not run on Linux or macOS.
- Not established: whether the two experimental `thread/start` fields keep their meaning in a later
  Codex. Every upgrade of Codex or of the adapter needs the trial again, and an upgrade of the
  adapter needs the patch rewritten against its `dist/index.js`.

**OpenCode**
- Whether `XDG_CONFIG_HOME` really redirects `Global.Path.config` at runtime (it follows from
  the `xdg-basedir` import, but was not executed).
- Whether an MCP server registered at runtime is torn down on `session/close` — `closeClient`
  exists (`mcp/index.ts:657-663`) but no ACP-layer call site was found. Assume it lives for the
  process lifetime, and assume cross-session visibility within one instance.
- Whether `hemera_*` allow beats the `"*"` deny in practice (it follows from `findLast` plus
  preserved key order, but ordering bugs are exactly what a trial catches).
- **Trial**: `opencode debug agent hemera` first (native tools only, no client needed), then
  `opencode acp` with `XDG_CONFIG_HOME` + `OPENCODE_DISABLE_PROJECT_CONFIG=1` +
  `OPENCODE_CONFIG_CONTENT` from §3 and one MCP server at `session/new`. Prompt "list your
  tools". Observe: no native tool named, `hemera_*` present and callable without a permission
  round-trip.

**All three**
- No source states what a model *does* when handed zero familiar tools and one unfamiliar MCP
  set. The quality of the resulting agent behaviour is a product question, not a protocol one,
  and only a trial answers it.
