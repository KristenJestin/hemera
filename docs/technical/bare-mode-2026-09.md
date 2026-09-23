# Bare mode for the three ACP agents

Spike written on 21 September 2026 for #18, from primary sources. It answers one question: can each agent be run over ACP with no native tool, while receiving Hemera's tools, and by which means.

Can Claude Code, Codex and OpenCode each be run over ACP with **no native tool loaded** (no file read/write/edit, no shell, no web search, no sub-agents) while still receiving tools from Hemera — and by exactly which means? Secondary question: are the ACP client capabilities (`fs/*`, `terminal/*`) an alternative channel to MCP for that.

Research date 2026-09-21. Primary sources only (GitHub source, official docs, npm). Line numbers are approximate and drift. Where the sources do not answer, the report says **not established**.

## Summary table

| | Means to remove native tools | Exhaustive? | MCP tools kept? | ACP `fs`/`terminal` delegation? | Personal config controllable? |
|---|---|---|---|---|---|
| **Claude Code**<br>`@agentclientprotocol/claude-agent-acp` 0.79.0 | `session/new._meta.claudeCode.options.tools: []` (or legacy `_meta.disableBuiltInTools: true`) | **Yes** — documented "All built-ins are removed". Residue: adapter force-adds `disallowedTools:["AskUserQuestion"]` and `canUseTool` | **Yes** — "Claude can only use your MCP tools" | **No** — the ACP-backed MCP server was deleted 2026-02-18; built-ins run natively in the CLI subprocess | **Yes**: `options.settingSources: []` + `options.env` (`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`). Managed/policy settings still load |
| **Codex**<br>`@agentclientprotocol/codex-acp` 1.12.0 | `CODEX_CONFIG` JSON / `$CODEX_HOME/config.toml`: `[features] shell_tool=false`, `view_image=false`, … + `web_search="disabled"` + `[tools.*] enabled=false` | **No** — ~14 separate defaults to switch off, and `apply_patch` + the three `*_mcp_resource*` tools have no config switch | **Yes** — MCP registration is a separate path from the built-in registry | **No** — the adapter never calls `fs/*` or `terminal/*`; Codex does its own I/O | **Partly**: `CODEX_HOME` isolates the user dir, but project `.codex/config.toml` still layers in; `$CODEX_HOME/requirements.toml` is the only unoverridable floor |
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
  down to the working directory; `CODEX_HOME` moves only the global one, and Hemera's `config.toml`
  does not set `project_doc_max_bytes`. Recorded as read natively and never sent. Codex Sessions are
  refused in any case (below).

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
| `apply_patch` | `:1197-1200` — `environment_mode.has_environment() && model_info.apply_patch_tool_type.is_some()` | **no config key**; model-catalog data only |
| `update_plan` | `:1101-1103` | `[tools.update_plan] enabled` (default **false**) |
| `view_image` | `:1219-1230` | `[features] view_image=false` (default true) |
| hosted `web_search` | `hosted_model_tool_specs` `:593-623` | top-level `web_search="disabled"` (default `cached`) |
| standalone `web.run` | `:991-1000` | `[features] standalone_web_search` (default false) |
| `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` | `:1085-1092`, gated on `mcp.has_servers()` | **no switch** — appear as soon as any MCP server exists |
| `request_user_input` | `:1111-1118` | `[tools.experimental_request_user_input] enabled=false` (default true) |
| `request_permissions` | `:1157-1159` | `[features] request_permissions_tool=false` |
| `new_context`, `get_context_remaining` | `:1161-1164` | `[features] token_budget` |
| `clock.curr_time`, `clock.sleep` | `:1166-1192` | `[features] current_time_reminder`, `sleep_tool=false` (default true) |
| `wait_for_environment` | `:1105-1109` | `[features] deferred_executor` |
| multi-agent (`spawn_agent`, `send_message`, `wait_agent`, …) | `add_collaboration_tools` `:1241+` | `[features] multi_agent`, `multi_agent_v2` = false |
| code-mode `exec`/`wait` | `register_code_mode_executors` `:786` | `[features] code_mode=false` |

There is **no `read_file` built-in**: Codex reads files through `exec_command`. `ConfigShellToolType` has only `UnifiedExec` and `Disabled` (`codex-rs/protocol/src/openai_models.rs:314-318`), so the shell tool *is* removable — but it is on by default, as are `view_image`, `sleep_tool`, `request_user_input` and `web_search`.

### Config surface

`[tools]` has exactly three keys (`codex-rs/config/src/config_toml.rs:650-658`): `web_search` (shape only — the on/off is the top-level `web_search` enum), `experimental_request_user_input`, `update_plan`. The old flat keys (`include_apply_patch_tool`, `include_plan_tool`, `experimental_use_exec_command_tool`, `tools.deep_research`) return zero hits in `openai/codex`. Everything else is `[features]`, a flattened `BTreeMap<String,bool>` of ~148 keys (`codex-rs/features/src/lib.rs:812-816`; specs at `:961-1000`).

`sandbox_mode` and `approval_policy` **remove no tool** — they gate execution and approval. A read-only sandbox still advertises `exec_command` to the model.

```toml
# $CODEX_HOME/config.toml — nearest thing to bare mode
web_search = "disabled"
[tools.update_plan]
enabled = false
[tools.experimental_request_user_input]
enabled = false
[features]
shell_tool = false
view_image = false
sleep_tool = false
current_time_reminder = false
request_permissions_tool = false
token_budget = false
deferred_executor = false
code_mode = false
multi_agent = false
multi_agent_v2 = false
image_generation = false
standalone_web_search = false
tool_suggest = false
```

Irreducible residue: `apply_patch` (model-catalog gated; the documented escape is a custom `model_catalog_json` with `apply_patch_tool_type: null`, **not verified end-to-end**), and the three `*_mcp_resource*` tools, which appear precisely because bare mode requires MCP servers.

There **is** a "permits no tools" ceiling — `ToolPolicy { allowed_tools: Some(vec![]) }` (`codex-rs/ext/extension-api/src/tool_policy.rs:1-33`) — but it is only supplied through `StartThreadOptions::thread_extension_init` when embedding `codex-core` as a Rust library. It has no app-server, CLI or config call site, so **it is not reachable through ACP**. It would also filter MCP tools (`spec_plan.rs:349`).

### Passing config, and isolation

`CODEX_CONFIG` is a JSON object read at `src/index.ts:77-80`, merged into every `thread/start` (`src/CodexAcpClient.ts:743-751`) as `ThreadStartParams.config`, which the app-server treats as `cli_overrides` — the same channel as `-c key=value`. Both nested and dotted shapes work:

```bash
CODEX_CONFIG='{"web_search":"disabled","features":{"shell_tool":false,"view_image":false}}'
CODEX_CONFIG='{"features.shell_tool":false,"web_search":"disabled"}'
```

`CODEX_HOME` redirects the Codex state directory (`codex-rs/core/src/config/mod.rs:4819-4828`); the adapter passes `process.env` straight to the child, and its own tests use that pattern (`src/__tests__/CodexACPAgent/mcp-config-merge.test.ts:37-40`). **Caveat**: `CODEX_HOME` does not isolate project-level `<cwd>/.codex/config.toml`, which still layers in and can re-add `mcp_servers`. `$CODEX_HOME/requirements.toml` `[features]` (`codex-rs/config/src/config_requirements.rs:885-895`, enforced in `core/src/config/managed_features.rs:20-27`) is the only layer project config cannot relax. There is no `--config` flag on the adapter.

### MCP and ACP capabilities

ACP `mcpServers` become an `mcp_servers` config override on `thread/start` (`CodexAcpClient.ts:753-771`); `stdio` and `http` are supported, `sse` and `acp` throw. Name collisions with config.toml silently favour the configured server unless `DISABLE_MCP_CONFIG_FILTERING=true`. MCP tools are registered on a path separate from `add_core_tool_sources` (`spec_plan.rs:150-156`), so they survive built-in gating. Wire names are `mcp__<server>__<tool>` (`core/src/tools/handlers/mcp.rs:100-108`); the `mcp__` prefix can be dropped per server via `[features.non_prefixed_mcp_tool_names]`. Per-server allowlists exist: `enabled_tools`, `disabled_tools`, `omit_tools_from`, `tools.<tool>.approval_mode` (`codex-rs/codex-mcp/src/tools.rs:63-95`).

**The adapter never calls ACP `fs/*` or `terminal/*`.** Grep over `src/` finds those names only in test fixtures. `src/TerminalOutputMode.ts` is an outbound `_meta` streaming extension (`terminal_output` / `terminal_output_delta`), not the ACP terminal client capability. Codex does all file and process I/O itself, in the app-server child, under its own sandbox.

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

**Codex**
- Whether a custom `model_catalog_json` with `apply_patch_tool_type: null` and
  `shell_type: "disabled"` actually removes `apply_patch`. Untested end-to-end.
- Whether `[features] shell_tool = false` survives the app-server path (all Rust citations are
  `openai/codex@main`; the adapter pins `@openai/codex ^0.155.1`, which may lag).
- Whether the three `*_mcp_resource*` tools can be suppressed at all when MCP servers exist.
- **Trial**: spawn `npx @agentclientprotocol/codex-acp` with `CODEX_HOME=<tmp>` containing the
  §2 `config.toml`, and `session/new` carrying one MCP server. Prompt "list every tool you can
  call". Observe: whether `exec_command` is absent, whether `apply_patch` remains, whether
  `mcp__hemera__*` is present.

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
