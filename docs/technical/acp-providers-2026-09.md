# ACP: SDK and available agents — state as of 16 September 2026

Research for Hemera (Electron ACP client), done on **16 September 2026** from primary sources only (npm registry, GitHub source code, official documentation). Identifiers, package names and quotations in English. Survey machine: Windows; no package installed, nothing executed — the behaviours described are **read in the code, not verified at run time**.

## Summary table

| | Claude (Anthropic) | Codex (OpenAI) | OpenCode |
|---|---|---|---|
| Adapter package | `@agentclientprotocol/claude-agent-acp@0.78.0` (2026-09-15) | `@agentclientprotocol/codex-acp@1.12.0` (2026-09-15) | none — ACP is **native** in `opencode-ai@1.18.31` (2026-09-14) |
| Launch | `npx -y @agentclientprotocol/claude-agent-acp` (bin `claude-agent-acp`), stdio | `npx -y @agentclientprotocol/codex-acp` (bin `codex-acp`), stdio | `opencode acp`, stdio |
| ACP SDK used | `@agentclientprotocol/sdk@1.4.0` | `@agentclientprotocol/sdk@^1.4.0` | `@agentclientprotocol/sdk` |
| `protocolVersion` | 1 | 1 | 1 |
| Auth | `claude-ai-login` (subscription), `console-login` (Anthropic Console / API billing), `gateway` + `gateway-bedrock` if advertised | `api-key`, `chat-gpt`, `chat-gpt-device-code`, `gateway` | a single method: `opencode auth login` in a terminal |
| `session/load` | yes | yes | yes |
| `session/resume` | yes | yes | yes |
| `fork` / `list` / `delete` / `close` | yes / yes / yes / yes | yes / yes / yes / yes | yes / yes / **no** / yes |
| `session/cancel` | yes (interrupts the query, `stopReason: "cancelled"`) | yes (`turnInterrupt` then `turn/completed`) | yes (ACP baseline) |
| MCP at `session/new` | `stdio`, `http`, `sse` | `stdio`, `http` (`sse: false`, `acp: false`) | `stdio`, `http`, `sse` |
| Cost / tokens over ACP | `usage_update` with `cost` in USD + `usage` in `PromptResponse` | `usage_update` tokens + context window, **no** `cost` | `usage_update` with `cost` in USD |

The official Claude and Codex adapters both live in the [`agentclientprotocol`](https://github.com/agentclientprotocol) organisation; OpenCode implements ACP in its own repository.

## 1. `@agentclientprotocol/sdk` — version, protocol, client API

Sources: <https://registry.npmjs.org/@agentclientprotocol/sdk> and <https://github.com/agentclientprotocol/typescript-sdk>, branch `main` (`CHANGELOG.md`, `src/acp.ts`, `src/schema/index.ts`, `src/schema/types.gen.ts`, `src/examples/client.ts`, `src/node-adapter.ts`).

- **Version `1.4.0`**, published on **2026-08-20** (changelog: "Stabilize elicitation APIs").
- **Protocol version**: `export const PROTOCOL_VERSION = 1;` (`src/schema/index.ts`); schema
  tracked `1.20.0` (changelog 1.3.0: "Update to schema v1.20.0 and v2.0.0-alpha.2").
- **ACP v2 is a draft**: a parallel `src/v2/` is published, documented as "ACP v2 is still a
  draft. Its wire protocol and this TypeScript API may change incompatibly in any SDK release".
  To be ignored today.

### Exact methods

`AGENT_METHODS` (client → agent): `initialize`, `authenticate`, `logout`, `providers/list`, `providers/set`, `providers/disable`, `session/new`, `session/load`, `session/list`, `session/delete`, `session/fork`, `session/resume`, `session/close`, `session/set_mode`, `session/set_config_option`, `session/prompt`, `session/cancel`, `mcp/message`, plus the experimental families `nes/*` and `document/did*`.

`CLIENT_METHODS` (agent → client, hence to be implemented by Hemera): `session/request_permission`, `session/update`, `fs/write_text_file`, `fs/read_text_file`, `terminal/create`, `terminal/output`, `terminal/release`, `terminal/wait_for_exit`, `terminal/kill`, `mcp/connect`, `mcp/message`, `mcp/disconnect`, `elicitation/create`, `elicitation/complete`. `PROTOCOL_METHODS`: `$/cancel_request`. `session/cancel` and `session/update` are **notifications**, not requests (`CancelNotification`, `SessionNotification`).

### Shape of `SessionUpdate`

Union discriminated by the `sessionUpdate` field, 15 variants (`src/schema/types.gen.ts`), name → carried type: `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` → `ContentChunk`; `tool_call` → `ToolCall`; `tool_call_update` → `ToolCallUpdate`; `plan` → `Plan`; `plan_update` → `PlanUpdate`; `plan_removed` → `PlanRemoved`; `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`; `usage_update` → `UsageUpdate`; `compaction_update`, `compaction_summary_chunk`.

The notification is `SessionNotification { sessionId, update }`. `ContentChunk` carries `content: ContentBlock` and `messageId?` — "A change in `messageId` indicates a new message has started", which is the key for grouping chunks on the UI side. `ToolCall` carries `toolCallId`, `title`, `kind?`, `status?`, `content?`, `locations?`, `rawInput?`, `rawOutput?`. Finally, `StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"`.

### Client-side TypeScript API

"App" style, the one of the official example `src/examples/client.ts`:

```ts
const promptResult = await acp
  .client({ name: "example-client" })
  .onRequest(acp.methods.client.session.requestPermission, (ctx) => client.requestPermission(ctx.params))
  .onRequest(acp.methods.client.fs.readTextFile, (ctx) => client.readTextFile(ctx.params))
  .connectWith(stream, async (ctx) => {
    const initResult = await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    return ctx.buildSession(process.cwd()).withSession(async (session) => {
      session.prompt("Hello, agent!");
      for (;;) {
        const message = await session.nextUpdate();
        if (message.kind === "stop") return message.response;
        await client.sessionUpdate(message.notification);
      }
    });
  });
```

`ctx.buildSession(cwd)` returns a `SessionBuilder` (`withMcpServer`, `withAdditionalDirectories`, `toRequest`, `start`, `withSession`); `ActiveSession` exposes `prompt(...)`, `nextUpdate()` and `dispose()`, with `nextUpdate()` returning an `ActiveSessionMessage` `{ kind: "session_update", notification, update }` or `{ kind: "stop", response, stopReason }`. The historical `ClientSideConnection` class (which implements the `Agent` interface) and the `Client` interface (`requestPermission`, `sessionUpdate`, `readTextFile`, `writeTextFile`, `createTerminal`…) remain exported; the adapters use them on the agent side (`AgentSideConnection`).

Negotiated capabilities — client → agent: `clientCapabilities.fs.{readTextFile,writeTextFile}`, `terminal`, `session`, `elicitation`. Agent → client: `AgentCapabilities` = `loadSession?: boolean`, `promptCapabilities {image, audio, embeddedContext}`, `mcpCapabilities {http, sse, acp?}`, `sessionCapabilities {list, delete, additionalDirectories, fork, resume, close}`, `auth {logout}`, `providers?`, `nes?`. The schema notes that "`session/load` is still handled by the top-level `load_session` capability", to be unified in a later version.

### Launching the agent and transport

ndJSON over stdio; the official example does the `spawn` by hand:

```ts
const agentProcess = spawn(npxCmd, ["tsx", agentPath], { stdio: ["pipe", "pipe", "inherit"] });
const input  = Writable.toWeb(agentProcess.stdin!);
const output = Readable.toWeb(agentProcess.stdout!) as ReadableStream<Uint8Array>;
const stream = acp.ndJsonStream(input, output);
```

**The SDK offers no spawn helper**: `src/node-adapter.ts` exports only `createNodeHttpHandler` and `createNodeWebSocketUpgradeHandler`. Hemera will have to write its own child-process supervisor (spawn, `stderr`, process death, restart). The SDK does, however, provide HTTP, SSE and WebSocket transports (`http-stream.ts`, `server-sse.ts`, `ws-stream.ts`) should the agent one day stop being a local child.

## 2. Claude as an ACP agent

Sources: <https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp> and <https://github.com/agentclientprotocol/claude-agent-acp> (`README.md`, `src/acp-agent.ts`, `src/resumed-session.ts`).

- **`@agentclientprotocol/claude-agent-acp`, version 0.78.0, published on 2026-09-15.** Binary
  `claude-agent-acp`; pinned dependencies `@agentclientprotocol/sdk@1.4.0`,
  `@anthropic-ai/claude-agent-sdk@0.3.270`, `zod@4.6.5`; a `@preview` channel published on every push to
  `main`.
- **The former `@zed-industries/claude-code-acp` is deprecated**: last version `0.16.2` from
  2026-02-17, npm message "This package has been renamed to
  `@agentclientprotocol/claude-agent-acp`. Please migrate to continue receiving updates." Stuck on
  `@agentclientprotocol/sdk@0.14.1`: do not use it.
- **It is not the `claude` CLI** but the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`,
  0.3.273 on npm as of 2026-09-15). The `@anthropic-ai/claude-code` CLI (2.1.273, 2026-09-15) exposes
  no `acp` subcommand according to the published packages, and no official source announcing a
  native ACP mode on Anthropic's side was found.

Response to `initialize` (`src/acp-agent.ts`, ~l. 2093): `protocolVersion: 1`, `promptCapabilities { image: true, embeddedContext: true }`, `mcpCapabilities { http: true, sse: true }`, `auth { logout: {} }`, `providers: {}`, `loadSession: true`, `sessionCapabilities { additionalDirectories, close, delete, fork, list, resume, subagents }` (all set to `{}`). Off-spec extensions in `_meta`: `steering` (inject a message into a turn in progress), `goal`, `authStatus` (`_auth/status_update`), JetBrains' AIR extensions (session failure, file change report, native subagents, async tasks, recommended config values), `promptQueueing: true` under `_meta.claudeCode`.

The README announces: context @-mentions, images, tool calls with permission requests, following, edit review, TODO lists, nested subagent transcripts, interactive and background terminals, custom slash commands, client-provided MCP servers. Permission modes go through `session/set_mode`, the model and effort through `session/set_config_option`, slash commands through `available_commands_update`.

**Authentication**: `claude-ai-login` ("Use Claude subscription", `type: "terminal"`, `args: ["--cli", "auth", "login", "--claudeai"]`); `console-login` ("Use Anthropic Console (API usage billing)", same mechanism); `gateway` and `gateway-bedrock` only if the client advertises `clientCapabilities.auth._meta.gateway === true`. The first two are of type `terminal`: **they are offered only if the client can run an auth command in a terminal** (`supportsTerminalAuth` or the `_meta["terminal-auth"]` extension); otherwise one must authenticate outside Hemera with the `claude` CLI. `logout` is supported.

**Limits read in the code**: native subagents require a bilateral negotiation and otherwise fall back to an ordinary tool call; `goal`, `steering` and `session failure` are off-spec and may move; a "force cancel" timer exists because `query.interrupt()` may fail to make the SDK loop return (`DEFAULT_FORCE_CANCEL_GRACE_MS`, issue #680 cited in a comment) — cancellation is therefore not guaranteed to be instantaneous.

## 3. Codex (OpenAI) as an ACP agent

Sources: <https://registry.npmjs.org/@agentclientprotocol/codex-acp> and <https://github.com/agentclientprotocol/codex-acp> (`README.md`, `src/CodexAcpServer.ts`, `src/CodexAuthMethod.ts`, `src/CodexEventHandler.ts`, `src/TokenCount.ts`).

There is an **official and actively maintained** adapter, in the same organisation as Claude's.

- **`@agentclientprotocol/codex-acp`, version 1.12.0, published on 2026-09-15.** Binary `codex-acp`;
  dependencies `@agentclientprotocol/sdk@^1.4.0`, `@openai/codex@^0.154.0` (0.154.0 published on
  2026-09-09), `vscode-jsonrpc`, `diff`, `zod`.
- **Architecture**: "`codex-acp` is a stdio ACP agent server. It starts the Codex App Server,
  translates ACP requests into Codex operations, and maps Codex events back into the client." The
  Codex binary is bundled as an npm dependency; `CODEX_PATH` allows imposing another one.
- **Variables**: `CODEX_API_KEY`, `OPENAI_API_KEY`, `CODEX_PATH`, `CODEX_CONFIG` (JSON merged
  into the session config), `MODEL_PROVIDER`, `DEFAULT_AUTH_REQUEST`, `INITIAL_AGENT_MODE`
  (`read-only`, `agent`, `agent-full-access`), `NO_BROWSER`, `APP_SERVER_LOGS`.

Response to `initialize` (`src/CodexAcpServer.ts`, ~l. 353): `protocolVersion: acp.PROTOCOL_VERSION`, `auth { logout: {} }`, `providers: {}`, `loadSession: true`, `promptCapabilities { embeddedContext: true, image: true }`, `sessionCapabilities { resume, list, close, delete, fork, additionalDirectories, subagents }`, `mcpCapabilities { acp: false, http: true, sse: false }`.

**Authentication** (`getCodexAuthMethods`): `api-key` always offered (key read from `CODEX_API_KEY` then `OPENAI_API_KEY`, or passed in `_meta["api-key"].apiKey` of the `authenticate` request); `chat-gpt`, ChatGPT login through a browser, hidden if `NO_BROWSER` is set; `chat-gpt-device-code`, offered only if the client supports URL elicitation (`clientSupportsUrlElicitation`) — useful for Hemera if one does not want to open a system browser; `gateway` (OpenAI-compatible gateway) if the client advertises `auth._meta.gateway === true`.

Exposed slash commands: `/status`, `/mcp`, `/skills`, `/goal`, `/review`, `/review-branch`, `/review-commit`, `/compact`, `/logout`, plus the configured skills.

**Notable limit**: `sse: false` and `acp: false` on the MCP side — an SSE MCP server is not acceptable for Codex; it has to be stdio or streamable HTTP. Third-party adapters spotted, neither retained nor audited: `Xuanwo/acp-claude-code`, `beyond5959/acp-adapter` (Go), `cola-io/codex-acp`.

## 4. OpenCode as an ACP agent

Sources: <https://opencode.ai/docs/acp/>, <https://github.com/anomalyco/opencode> branch `dev` (`packages/opencode/src/cli/cmd/acp.ts`, `src/acp/service.ts`, `src/acp/usage.ts`), <https://registry.npmjs.org/opencode-ai>.

- **ACP is native**: the `opencode acp` subcommand ("start ACP (Agent Client Protocol) server")
  builds an `ndJsonStream` on `process.stdin`/`stdout` and an `AgentSideConnection` from the ACP SDK.
  No adapter package to install.
- **`opencode-ai@1.18.31`, published on 2026-09-14** (binary `opencode`). The repository has **moved from
  `sst/opencode` to `anomalyco/opencode`** (GitHub API redirect, default branch `dev`).
- **Architecture**: `opencode acp` first starts a local OpenCode HTTP server
  (`Server.listen`) and talks to itself through `createOpencodeClient`; the session state lives in
  OpenCode's storage, not in the ACP process.

Response to `initialize` (`src/acp/service.ts`, ~l. 112): `protocolVersion: 1`, `loadSession: true`, `mcpCapabilities { http: true, sse: true }`, `promptCapabilities { embeddedContext: true, image: true }`, `sessionCapabilities { close: {}, fork: {}, list: {}, resume: {} }` — no `delete`, no `additionalDirectories`, no `subagents`.

- **Auth**: a single method, `{ id: AuthMethodID, name: "Login with opencode", description: "Run
  \`opencode auth login\` in the terminal" }`, with `_meta["terminal-auth"]` if the client advertises it;
  `authenticate` fails for any other `methodId`.
- **Models and providers**: configured in the OpenCode configuration, not through ACP. Model,
  variant and mode are exposed as ACP `configOptions` (`session/set_config_option`) and restored
  when the session is loaded.
- **Parity announced by the docs**: "OpenCode works the same via ACP as it does in the terminal. All
  features are supported", with one cited exception: "Some built-in slash commands like `/undo`
  and `/redo` are currently unsupported." The MCP servers of the OpenCode config, the
  `AGENTS.md` rules, the agents and the permission system all work.

## 5. Session durability

**All three advertise `loadSession: true` and `sessionCapabilities.resume`.** The rule "the session outlives the provider" is therefore tenable on all three, but the two methods differ.

- `session/load` (`LoadSessionRequest { sessionId, cwd, mcpServers, additionalDirectories? }`) →
  the agent **replays the history** as `session/update` notifications before answering. Explicit
  in all three implementations: `replaySessionHistory(...)` (Claude),
  `streamThreadHistory(sessionId, thread)` (Codex), `replayMessages(events, messages)` (OpenCode).
  The client rebuilds its transcript from the stream, with no storage of its own required.
- `session/resume` (`ResumeSessionRequest { sessionId, cwd, mcpServers?, additionalDirectories? }`)
  → reattaches the session without replay; useful when Hemera already has the transcript in its database.

Where the state lives: **Claude** in the local transcripts of the Claude Agent SDK — `readResumedSession` calls `getSessionMessages(sessionId)` searching "all project directories, matching `replaySessionHistory`", then relaunches the query with `resume: sessionId`, and **the ACP session identifier is the Claude session identifier** ("`resume` names the Claude session, which shares the ACP session id"), so a `session/load` on an id unknown to the CLI fails; **Codex** in the threads of its App Server, enumerated by `session/list` with cursor pagination and rebuilt by `getOrCreateSessionWithHistory`; **OpenCode** in its own storage, re-read by `session.get` and `session.messages` then replayed — the state trivially survives the death of the ACP process.

**Consequence**: Hemera must persist, per conversation, the triplet (`agentId`, `sessionId`, `cwd`) — `cwd` is mandatory in `load` as in `resume` and must match the session's `cwd`. If an agent has lost its session on disk, the fallback is a `session/new` followed by a context prompt: **none of the three accepts injecting a history into a fresh session**; there is no field for that in `NewSessionRequest` (`cwd`, `additionalDirectories?`, `mcpServers`, `_meta` only). Not verified: the actual retention of transcripts (purge, compaction, rotation), which none of the sources read documents.

## 6. MCP: handing Hemera's MCP server to the agent

`NewSessionRequest.mcpServers: Array<McpServer>` is **mandatory** (empty array accepted); `LoadSessionRequest.mcpServers` is too, and on `ResumeSessionRequest` it is optional. The union:

```ts
type McpServer =
  | (McpServerHttp & { type: "http" })   // { name, url, headers: HttpHeader[] }
  | (McpServerSse  & { type: "sse" })    // { name, url, headers: HttpHeader[] }
  | (McpServerAcp  & { type: "acp" })    // { name, serverId } — EXPERIMENTAL
  | McpServerStdio;                      // { name, command, args, env: EnvVariable[] }
```

The **stdio form is the default variant, with no `type` field** — the only transport every agent must accept, with `command` = "Absolute path to the MCP server executable". The other forms depend on `mcpCapabilities`: Claude and OpenCode advertise `http` and `sse`, Codex `http` only. The `acp` variant (an MCP server carried by the ACP channel itself, through `mcp/connect`, `mcp/message`, `mcp/disconnect`) is marked **UNSTABLE** and is advertised by none of the three. **Therefore**: to be accepted everywhere, Hemera's MCP server must be exposed over **stdio** (absolute path to an executable) or over **streamable HTTP** (local URL plus headers); do not count on SSE, refused by Codex, nor on the `acp` transport.

On the MCP TypeScript SDK side (<https://github.com/modelcontextprotocol/typescript-sdk>, <https://registry.npmjs.org/@modelcontextprotocol/server>, <https://registry.npmjs.org/@modelcontextprotocol/node>): the SDK has been **split in v2**, published on **2026-07-27**, "released alongside the 2026-07-28 spec" — `@modelcontextprotocol/server@2.0.0` (servers; depends on `@modelcontextprotocol/core@2.0.0` and `zod@^4.2.0`), `@modelcontextprotocol/client@2.0.0`, `@modelcontextprotocol/node@2.0.0` (streamable HTTP for `IncomingMessage`/`ServerResponse`), plus the `/express`, `/fastify`, `/hono` integrations. The former monopackage `@modelcontextprotocol/sdk` is at **1.30.0** (2026-07-27) and stays on the `v1.x` branch: "v1.x continues to receive bug fixes and security updates for at least 6 months after v2's release", that is, end of January 2027 at the minimum.

Minimal stdio server (v2 README, verbatim):

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'greeting-server', version: '1.0.0' });
server.registerTool('greet',
  { description: 'Greet someone by name', inputSchema: z.object({ name: z.string() }) },
  async ({ name }) => ({ content: [{ type: 'text', text: `Hello, ${name}!` }] }));
const transport = new StdioServerTransport();
await server.connect(transport);
```

Over streamable HTTP on `node:http` (README of `@modelcontextprotocol/node`): `NodeStreamableHTTPServerTransport` then `transport.handleRequest(req, res, req.body)`, with the `localhostHostValidation()` and `localhostOriginValidation()` guards composed in front of the transport when wiring `node:http` by hand (the `createMcpExpressApp`, `createMcpHonoApp`, `createMcpFastifyApp` factories apply them by default); for a standard web runtime, `WebStandardStreamableHTTPServerTransport` comes from `@modelcontextprotocol/server`. For the record, the deprecated Claude adapter bundled `@modelcontextprotocol/sdk@1.26.0`: the version choice on Hemera's side is independent of the agents', as our MCP servers share no code with them.

## 7. Interruption and cost

The spec (<https://agentclientprotocol.com/protocol/prompt-turn>): the agent "**SHOULD** stop all language model requests and all tool call invocations as soon as possible", then "after all ongoing operations have been successfully aborted and pending updates have been sent, the Agent **MUST** respond to the original `session/prompt` request with the `cancelled` stop reason".

- **Claude**: `cancel()` sets `session.cancelled = true`, cancels the usage renderings in progress,
  ends the native subagents as `"cancelled"`, then interrupts the query; a fallback timer
  forces the turn to conclude as `"cancelled"` if the SDK loop never yields. Interrupted tool
  calls are reported as `tool_call_update` with a status derived from the text
  (`/\b(?:cancelled|canceled|interrupted|stopped|killed)\b/` → `"cancelled"`).
- **Codex**: `cancel()` calls `interruptSessionTurn(...)`; code comment: "After
  `turnInterrupt()`, Codex will send `turn/completed`, which naturally completes
  `awaitTurnCompleted()`". An unknown session is a silent no-op.
- **OpenCode**: ACP baseline capability in `packages/opencode/src/acp/`; the detail of how running
  tools are stopped **has not been verified** line by line.

In all three cases cancellation is *cooperative*: Hemera cannot guarantee that a tool stops midway, only that the turn will end with `stopReason: "cancelled"`.

For tokens and cost, two channels — `session/update` with `sessionUpdate: "usage_update"` → `UsageUpdate { used, size, cost?: { amount, currency } }` (`used` = tokens currently in the context, `size` = window size); and `PromptResponse.usage?: Usage`, marked **UNSTABLE** in the schema, = `{ totalTokens, inputTokens, outputTokens, thoughtTokens?, cachedReadTokens?, cachedWriteTokens? }`.

- **Claude**: `usage_update` at several points of the turn (result, compaction,
  `rate_limit_event`), with `cost: { amount: message.total_cost_usd, currency: "USD" }` at the end of the
  turn, and a complete `PromptResponse.usage` (`sessionUsage`) including cache tokens; quotas
  in `_meta.quota` and `_meta["_claude/rateLimit"]`.
- **Codex**: `usage_update` with `used` (tokens of the last turn) and `size`
  (`modelContextWindow`) — **no `cost` field**. `toPromptUsage` fills `PromptResponse.usage`
  (`cachedInputTokens` → `cachedReadTokens`, `reasoningOutputTokens` → `thoughtTokens`); rate
  limits in `_meta` (`account/rateLimits/updated`).
- **OpenCode**: `usage_update` with `used`, `size` and
  `cost: { amount: totalSessionCost(messages), currency: "USD" }`, the cumulative session cost aggregated
  from the `cost` field of its own assistant messages.

**Monetary cost is therefore available only for Claude and OpenCode**, and only in USD; for Codex, Hemera can display only tokens and a window occupancy.

## 8. Bare mode

Added on 23 September 2026 for #18. The research is [`bare-mode-2026-09.md`](bare-mode-2026-09.md)
(21 September 2026); this section says the means each adapter declares as implemented in
`apps/desktop/src/engine/agents/adapters/`, which is what the Agents section shows. The per
platform `qualified` flag is what those declarations say; the real trials of phase 3 set it.

- **Claude Code** (qualified): `session/new._meta.claudeCode.options` with `tools: []`,
  `settingSources: []`, `strictMcpConfig: true`, a custom `systemPrompt` carrying Hemera's base,
  and an `env` with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `ENABLE_CLAUDEAI_MCP_SERVERS=false` and
  `MCP_TOOL_TIMEOUT` at ten minutes, so a tool call waiting on the human is not cut short.
  `CLAUDE_CONFIG_DIR` is left where the user has it: the login lives there, and a directory of
  Hemera's reads as signed out. Managed and policy settings and `~/.claude.json` still load.
- **OpenCode** (qualified): `OPENCODE_CONFIG_CONTENT` with a primary agent of Hemera's as
  `default_agent`, `permission: { "*": "deny", "hemera_*": "allow" }`, `build` and `plan` disabled;
  `XDG_CONFIG_HOME` pointed at a directory of Hemera's and `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
  The wildcard is matched case-insensitively on Windows. The base goes as an embedded resource of
  the first prompt. `$HOME/.opencode`, managed configuration and a remote `.well-known/opencode`
  still load.
- **Codex** (not qualified): `CODEX_HOME` at a directory of Hemera's with a `config.toml` that
  turns off about fourteen features, from `web_search` to `shell_tool`, `view_image`,
  `sleep_tool`, `multi_agent` and `code_mode`. `apply_patch` has no key and the three
  `*_mcp_resource*` tools appear as soon as an MCP server exists, so no Session is made on it:
  `sessions.create` refuses it with that reason, and so does a start. Moving `CODEX_HOME` also
  moves the login (`auth.json`), which a trial that qualifies Codex has to settle first.

## Consequences for Hemera

Established:

- **The ACP foundation is stable**: `@agentclientprotocol/sdk@1.4.0`, `protocolVersion: 1`, schema
  1.20.0. Target v1, ignore `src/v2`.
- **The three targeted providers have a living ACP agent**, all published within the 48 hours before this
  survey, all over stdio, all at `protocolVersion: 1`.
- **Hemera writes its own process supervisor**: no spawn helper in the SDK —
  `spawn`, `Writable.toWeb`/`Readable.toWeb`, `acp.ndJsonStream`, `stderr` handled separately.
- **The rule "the session outlives the provider" holds**: `session/load` exists in all three and
  replays the history as `session/update`; persisting (`agentId`, `sessionId`, `cwd`) is enough. No
  fallback by history injection: a lost session = a fresh session plus a context prompt
  written by Hemera, displayed as such.
- **Hemera's MCP server must be stdio or streamable HTTP**; SSE is refused by Codex and the
  `acp` transport is unstable.
- **MCP SDK: start on v2** (`@modelcontextprotocol/server@2.0.0`, plus
  `@modelcontextprotocol/node@2.0.0` if HTTP); v1 is maintained with fixes only until the end of
  January 2027 at the earliest.
- **Client capabilities to implement**: `fs/read_text_file`, `fs/write_text_file`,
  `session/request_permission`, the `terminal/*` family and `elicitation/*`. The terminal capability
  is not a luxury: without it the Claude adapter does not offer its subscription auth methods,
  and OpenCode cannot offer its `opencode auth login`.
- **Cost**: display `usage_update.cost` when it comes (Claude, OpenCode) and fall back on
  tokens for Codex; do not build the UI on a universal cost.

Uncertain or not verified:

- No run-time verification, neither on Windows nor on Linux: everything is read in the code.
- The actual retention of transcripts on the agents' side is not documented: a `session/load` may
  fail on an old session.
- OpenCode: the detail of how tools are stopped on `session/cancel` has not been read.
- The off-spec extensions (`steering`, `goal`, `session failure`, native subagents, async tasks)
  are carried by Claude and Codex but not by OpenCode, and live in `_meta`: using them creates
  a dependency on two agents out of three.
- The move of the OpenCode repository (`sst/opencode` to `anomalyco/opencode`) is recent; the
  project's governance would deserve a check before depending on it.
- No official statement from Anthropic or OpenAI about a native ACP mode in their CLIs: both
  go through an adapter hosted by the ACP project.
