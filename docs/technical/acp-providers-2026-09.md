# ACP : SDK et agents disponibles — état au 16 septembre 2026

Veille pour Hemera (client ACP Electron), faite le **16 septembre 2026** sur sources primaires uniquement (npm registry, code source GitHub, documentation officielle). Identifiants, noms de paquets et citations en anglais. Machine de relevé : Windows ; aucun paquet installé, rien exécuté — les comportements décrits sont **lus dans le code, non vérifiés à l'exécution**.

## Tableau de synthèse

| | Claude (Anthropic) | Codex (OpenAI) | OpenCode |
|---|---|---|---|
| Paquet adaptateur | `@agentclientprotocol/claude-agent-acp@0.78.0` (2026-09-15) | `@agentclientprotocol/codex-acp@1.12.0` (2026-09-15) | aucun — ACP **natif** dans `opencode-ai@1.18.31` (2026-09-14) |
| Lancement | `npx -y @agentclientprotocol/claude-agent-acp` (bin `claude-agent-acp`), stdio | `npx -y @agentclientprotocol/codex-acp` (bin `codex-acp`), stdio | `opencode acp`, stdio |
| SDK ACP utilisé | `@agentclientprotocol/sdk@1.4.0` | `@agentclientprotocol/sdk@^1.4.0` | `@agentclientprotocol/sdk` |
| `protocolVersion` | 1 | 1 | 1 |
| Auth | `claude-ai-login` (abonnement), `console-login` (Console Anthropic / facturation API), `gateway` + `gateway-bedrock` si annoncé | `api-key`, `chat-gpt`, `chat-gpt-device-code`, `gateway` | une seule méthode : `opencode auth login` en terminal |
| `session/load` | oui | oui | oui |
| `session/resume` | oui | oui | oui |
| `fork` / `list` / `delete` / `close` | oui / oui / oui / oui | oui / oui / oui / oui | oui / oui / **non** / oui |
| `session/cancel` | oui (interrompt la query, `stopReason: "cancelled"`) | oui (`turnInterrupt` puis `turn/completed`) | oui (baseline ACP) |
| MCP au `session/new` | `stdio`, `http`, `sse` | `stdio`, `http` (`sse: false`, `acp: false`) | `stdio`, `http`, `sse` |
| Coût / tokens via ACP | `usage_update` avec `cost` USD + `usage` dans `PromptResponse` | `usage_update` tokens + fenêtre de contexte, **pas** de `cost` | `usage_update` avec `cost` USD |

Les adaptateurs officiels de Claude et de Codex vivent tous deux dans l'organisation [`agentclientprotocol`](https://github.com/agentclientprotocol) ; OpenCode implémente ACP dans son propre dépôt.

## 1. `@agentclientprotocol/sdk` — version, protocole, API client

Sources : <https://registry.npmjs.org/@agentclientprotocol/sdk> et <https://github.com/agentclientprotocol/typescript-sdk>, branche `main` (`CHANGELOG.md`, `src/acp.ts`, `src/schema/index.ts`, `src/schema/types.gen.ts`, `src/examples/client.ts`, `src/node-adapter.ts`).

- **Version `1.4.0`**, publiée le **2026-08-20** (changelog : « Stabilize elicitation APIs »).
- **Version de protocole** : `export const PROTOCOL_VERSION = 1;` (`src/schema/index.ts`) ; schéma
  suivi `1.20.0` (changelog 1.3.0 : « Update to schema v1.20.0 and v2.0.0-alpha.2 »).
- **ACP v2 est un brouillon** : un `src/v2/` parallèle est publié, documenté « ACP v2 is still a
  draft. Its wire protocol and this TypeScript API may change incompatibly in any SDK release ».
  À ignorer aujourd'hui.

### Méthodes exactes

`AGENT_METHODS` (client → agent) : `initialize`, `authenticate`, `logout`, `providers/list`, `providers/set`, `providers/disable`, `session/new`, `session/load`, `session/list`, `session/delete`, `session/fork`, `session/resume`, `session/close`, `session/set_mode`, `session/set_config_option`, `session/prompt`, `session/cancel`, `mcp/message`, plus les familles expérimentales `nes/*` et `document/did*`.

`CLIENT_METHODS` (agent → client, donc à implémenter par Hemera) : `session/request_permission`, `session/update`, `fs/write_text_file`, `fs/read_text_file`, `terminal/create`, `terminal/output`, `terminal/release`, `terminal/wait_for_exit`, `terminal/kill`, `mcp/connect`, `mcp/message`, `mcp/disconnect`, `elicitation/create`, `elicitation/complete`. `PROTOCOL_METHODS` : `$/cancel_request`. `session/cancel` et `session/update` sont des **notifications**, pas des requêtes (`CancelNotification`, `SessionNotification`).

### Forme de `SessionUpdate`

Union discriminée par le champ `sessionUpdate`, 15 variantes (`src/schema/types.gen.ts`), nom → type porté : `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` → `ContentChunk` ; `tool_call` → `ToolCall` ; `tool_call_update` → `ToolCallUpdate` ; `plan` → `Plan` ; `plan_update` → `PlanUpdate` ; `plan_removed` → `PlanRemoved` ; `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update` ; `usage_update` → `UsageUpdate` ; `compaction_update`, `compaction_summary_chunk`.

La notification est `SessionNotification { sessionId, update }`. `ContentChunk` porte `content: ContentBlock` et `messageId?` — « A change in `messageId` indicates a new message has started », c'est la clé pour regrouper les chunks côté UI. `ToolCall` porte `toolCallId`, `title`, `kind?`, `status?`, `content?`, `locations?`, `rawInput?`, `rawOutput?`. Enfin `StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"`.

### API TypeScript côté client

Style « app », celui de l'exemple officiel `src/examples/client.ts` :

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

`ctx.buildSession(cwd)` renvoie un `SessionBuilder` (`withMcpServer`, `withAdditionalDirectories`, `toRequest`, `start`, `withSession`) ; `ActiveSession` expose `prompt(...)`, `nextUpdate()` et `dispose()`, `nextUpdate()` renvoyant un `ActiveSessionMessage` `{ kind: "session_update", notification, update }` ou `{ kind: "stop", response, stopReason }`. La classe historique `ClientSideConnection` (qui implémente l'interface `Agent`) et l'interface `Client` (`requestPermission`, `sessionUpdate`, `readTextFile`, `writeTextFile`, `createTerminal`…) restent exportées ; les adaptateurs s'en servent côté agent (`AgentSideConnection`).

Capacités négociées — client → agent : `clientCapabilities.fs.{readTextFile,writeTextFile}`, `terminal`, `session`, `elicitation`. Agent → client : `AgentCapabilities` = `loadSession?: boolean`, `promptCapabilities {image, audio, embeddedContext}`, `mcpCapabilities {http, sse, acp?}`, `sessionCapabilities {list, delete, additionalDirectories, fork, resume, close}`, `auth {logout}`, `providers?`, `nes?`. Le schéma note que « `session/load` is still handled by the top-level `load_session` capability », à unifier dans une version ultérieure.

### Lancement de l'agent et transport

ndJSON sur stdio ; l'exemple officiel fait le `spawn` à la main :

```ts
const agentProcess = spawn(npxCmd, ["tsx", agentPath], { stdio: ["pipe", "pipe", "inherit"] });
const input  = Writable.toWeb(agentProcess.stdin!);
const output = Readable.toWeb(agentProcess.stdout!) as ReadableStream<Uint8Array>;
const stream = acp.ndJsonStream(input, output);
```

**Le SDK n'offre aucun helper de spawn** : `src/node-adapter.ts` n'exporte que `createNodeHttpHandler` et `createNodeWebSocketUpgradeHandler`. Hemera devra écrire son propre superviseur de processus enfant (spawn, `stderr`, mort du processus, relance). Le SDK fournit en revanche des transports HTTP, SSE et WebSocket (`http-stream.ts`, `server-sse.ts`, `ws-stream.ts`) si l'agent cesse un jour d'être un enfant local.

## 2. Claude comme agent ACP

Sources : <https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp> et <https://github.com/agentclientprotocol/claude-agent-acp> (`README.md`, `src/acp-agent.ts`, `src/resumed-session.ts`).

- **`@agentclientprotocol/claude-agent-acp`, version 0.78.0, publiée le 2026-09-15.** Binaire
  `claude-agent-acp` ; dépendances épinglées `@agentclientprotocol/sdk@1.4.0`,
  `@anthropic-ai/claude-agent-sdk@0.3.270`, `zod@4.6.5` ; canal `@preview` publié à chaque push sur
  `main`.
- **L'ancien `@zed-industries/claude-code-acp` est déprécié** : dernière version `0.16.2` du
  2026-02-17, message npm « This package has been renamed to
  `@agentclientprotocol/claude-agent-acp`. Please migrate to continue receiving updates. » Resté sur
  `@agentclientprotocol/sdk@0.14.1` : ne pas l'utiliser.
- **Ce n'est pas le CLI `claude`** mais le **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`,
  0.3.273 sur npm au 2026-09-15). Le CLI `@anthropic-ai/claude-code` (2.1.273, 2026-09-15) n'expose
  pas de sous-commande `acp` d'après les paquets publiés, et aucune source officielle annonçant un
  mode ACP natif côté Anthropic n'a été trouvée.

Réponse à `initialize` (`src/acp-agent.ts`, ~l. 2093) : `protocolVersion: 1`, `promptCapabilities { image: true, embeddedContext: true }`, `mcpCapabilities { http: true, sse: true }`, `auth { logout: {} }`, `providers: {}`, `loadSession: true`, `sessionCapabilities { additionalDirectories, close, delete, fork, list, resume, subagents }` (tous à `{}`). Extensions hors spec dans `_meta` : `steering` (injecter un message dans un tour en cours), `goal`, `authStatus` (`_auth/status_update`), les extensions AIR de JetBrains (session failure, file change report, subagents natifs, async tasks, recommended config values), `promptQueueing: true` sous `_meta.claudeCode`.

Le README annonce : @-mentions de contexte, images, tool calls avec demandes de permission, following, revue d'édition, listes TODO, transcripts de sous-agents imbriqués, terminaux interactifs et d'arrière-plan, slash commands personnalisées, serveurs MCP fournis par le client. Les modes de permission passent par `session/set_mode`, le modèle et l'effort par `session/set_config_option`, les slash commands par `available_commands_update`.

**Authentification** : `claude-ai-login` (« Use Claude subscription », `type: "terminal"`, `args: ["--cli", "auth", "login", "--claudeai"]`) ; `console-login` (« Use Anthropic Console (API usage billing) », même mécanique) ; `gateway` et `gateway-bedrock` seulement si le client annonce `clientCapabilities.auth._meta.gateway === true`. Les deux premières sont de type `terminal` : **elles ne sont proposées que si le client sait exécuter une commande d'auth dans un terminal** (`supportsTerminalAuth` ou l'extension `_meta["terminal-auth"]`) ; sinon il faut s'authentifier hors de Hemera avec le CLI `claude`. `logout` est supporté.

**Limites lues dans le code** : les sous-agents natifs demandent une négociation bilatérale et retombent sinon sur un tool call ordinaire ; `goal`, `steering` et `session failure` sont hors spec et peuvent bouger ; un minuteur de « force cancel » existe parce que `query.interrupt()` peut ne pas faire revenir la boucle du SDK (`DEFAULT_FORCE_CANCEL_GRACE_MS`, issue #680 citée en commentaire) — l'annulation n'est donc pas garantie instantanée.

## 3. Codex (OpenAI) comme agent ACP

Sources : <https://registry.npmjs.org/@agentclientprotocol/codex-acp> et <https://github.com/agentclientprotocol/codex-acp> (`README.md`, `src/CodexAcpServer.ts`, `src/CodexAuthMethod.ts`, `src/CodexEventHandler.ts`, `src/TokenCount.ts`).

Il existe un adaptateur **officiel et activement maintenu**, dans la même organisation que celui de Claude.

- **`@agentclientprotocol/codex-acp`, version 1.12.0, publiée le 2026-09-15.** Binaire `codex-acp` ;
  dépendances `@agentclientprotocol/sdk@^1.4.0`, `@openai/codex@^0.154.0` (0.154.0 publiée le
  2026-09-09), `vscode-jsonrpc`, `diff`, `zod`.
- **Architecture** : « `codex-acp` is a stdio ACP agent server. It starts the Codex App Server,
  translates ACP requests into Codex operations, and maps Codex events back into the client. » Le
  binaire Codex est embarqué comme dépendance npm ; `CODEX_PATH` permet d'en imposer un autre.
- **Variables** : `CODEX_API_KEY`, `OPENAI_API_KEY`, `CODEX_PATH`, `CODEX_CONFIG` (JSON fusionné
  dans la config de session), `MODEL_PROVIDER`, `DEFAULT_AUTH_REQUEST`, `INITIAL_AGENT_MODE`
  (`read-only`, `agent`, `agent-full-access`), `NO_BROWSER`, `APP_SERVER_LOGS`.

Réponse à `initialize` (`src/CodexAcpServer.ts`, ~l. 353) : `protocolVersion: acp.PROTOCOL_VERSION`, `auth { logout: {} }`, `providers: {}`, `loadSession: true`, `promptCapabilities { embeddedContext: true, image: true }`, `sessionCapabilities { resume, list, close, delete, fork, additionalDirectories, subagents }`, `mcpCapabilities { acp: false, http: true, sse: false }`.

**Authentification** (`getCodexAuthMethods`) : `api-key` toujours proposée (clé lue dans `CODEX_API_KEY` puis `OPENAI_API_KEY`, ou passée dans `_meta["api-key"].apiKey` de la requête `authenticate`) ; `chat-gpt`, connexion ChatGPT par navigateur, masquée si `NO_BROWSER` est défini ; `chat-gpt-device-code`, proposée seulement si le client supporte l'élicitation d'URL (`clientSupportsUrlElicitation`) — utile pour Hemera si l'on ne veut pas ouvrir un navigateur système ; `gateway` (passerelle compatible OpenAI) si le client annonce `auth._meta.gateway === true`.

Slash commands exposées : `/status`, `/mcp`, `/skills`, `/goal`, `/review`, `/review-branch`, `/review-commit`, `/compact`, `/logout`, plus les skills configurées.

**Limite notable** : `sse: false` et `acp: false` côté MCP — un serveur MCP en SSE n'est pas acceptable pour Codex, il faut du stdio ou du streamable HTTP. Adaptateurs tiers repérés, non retenus ni audités : `Xuanwo/acp-claude-code`, `beyond5959/acp-adapter` (Go), `cola-io/codex-acp`.

## 4. OpenCode comme agent ACP

Sources : <https://opencode.ai/docs/acp/>, <https://github.com/anomalyco/opencode> branche `dev` (`packages/opencode/src/cli/cmd/acp.ts`, `src/acp/service.ts`, `src/acp/usage.ts`), <https://registry.npmjs.org/opencode-ai>.

- **ACP est natif** : la sous-commande `opencode acp` (« start ACP (Agent Client Protocol) server »)
  construit un `ndJsonStream` sur `process.stdin`/`stdout` et un `AgentSideConnection` du SDK ACP.
  Aucun paquet adaptateur à installer.
- **`opencode-ai@1.18.31`, publiée le 2026-09-14** (binaire `opencode`). Le dépôt a **déménagé de
  `sst/opencode` vers `anomalyco/opencode`** (redirection de l'API GitHub, branche par défaut `dev`).
- **Architecture** : `opencode acp` démarre d'abord un serveur HTTP OpenCode local
  (`Server.listen`) et se parle à lui-même via `createOpencodeClient` ; l'état de session vit dans
  le stockage d'OpenCode, pas dans le processus ACP.

Réponse à `initialize` (`src/acp/service.ts`, ~l. 112) : `protocolVersion: 1`, `loadSession: true`, `mcpCapabilities { http: true, sse: true }`, `promptCapabilities { embeddedContext: true, image: true }`, `sessionCapabilities { close: {}, fork: {}, list: {}, resume: {} }` — ni `delete`, ni `additionalDirectories`, ni `subagents`.

- **Auth** : une seule méthode, `{ id: AuthMethodID, name: "Login with opencode", description: "Run
  \`opencode auth login\` in the terminal" }`, avec `_meta["terminal-auth"]` si le client l'annonce ;
  `authenticate` échoue pour tout autre `methodId`.
- **Modèles et fournisseurs** : configurés dans la configuration OpenCode, pas par ACP. Modèle,
  variante et mode sont exposés comme `configOptions` ACP (`session/set_config_option`) et restaurés
  au chargement de session.
- **Parité annoncée par la doc** : « OpenCode works the same via ACP as it does in the terminal. All
  features are supported », avec une exception citée : « Some built-in slash commands like `/undo`
  and `/redo` are currently unsupported. » Les serveurs MCP de la config OpenCode, les règles
  `AGENTS.md`, les agents et le système de permissions fonctionnent.

## 5. Durabilité des sessions

**Les trois annoncent `loadSession: true` et `sessionCapabilities.resume`.** La règle « la session survit au fournisseur » est donc tenable sur les trois, mais les deux méthodes diffèrent.

- `session/load` (`LoadSessionRequest { sessionId, cwd, mcpServers, additionalDirectories? }`) →
  l'agent **rejoue l'historique** en notifications `session/update` avant de répondre. Explicite
  dans les trois implémentations : `replaySessionHistory(...)` (Claude),
  `streamThreadHistory(sessionId, thread)` (Codex), `replayMessages(events, messages)` (OpenCode).
  Le client reconstruit son transcript depuis le flux, sans stockage propre obligatoire.
- `session/resume` (`ResumeSessionRequest { sessionId, cwd, mcpServers?, additionalDirectories? }`)
  → rattache la session sans rejeu ; utile quand Hemera a déjà le transcript en base.

Où vit l'état : **Claude** dans les transcripts locaux du Claude Agent SDK — `readResumedSession` appelle `getSessionMessages(sessionId)` en cherchant « all project directories, matching `replaySessionHistory` », puis relance la query avec `resume: sessionId`, et **l'identifiant de session ACP est l'identifiant de session Claude** (« `resume` names the Claude session, which shares the ACP session id »), donc un `session/load` sur un id inconnu du CLI échoue ; **Codex** dans les threads de son App Server, énumérés par `session/list` avec pagination par curseur et reconstruits par `getOrCreateSessionWithHistory` ; **OpenCode** dans son propre stockage, relu par `session.get` et `session.messages` puis rejoué — l'état survit trivialement à la mort du processus ACP.

**Conséquence** : Hemera doit persister, par conversation, le triplet (`agentId`, `sessionId`, `cwd`) — `cwd` est obligatoire dans `load` comme dans `resume` et doit correspondre au `cwd` de la session. Si un agent a perdu sa session côté disque, le repli est un `session/new` suivi d'un prompt de contexte : **aucun des trois n'accepte d'injecter un historique dans une session neuve**, il n'y a pas de champ pour ça dans `NewSessionRequest` (`cwd`, `additionalDirectories?`, `mcpServers`, `_meta` seulement). Non vérifié : la rétention réelle des transcripts (purge, compaction, rotation), qu'aucune des sources lues ne documente.

## 6. MCP : passer le serveur MCP de Hemera à l'agent

`NewSessionRequest.mcpServers: Array<McpServer>` est **obligatoire** (tableau vide accepté) ; `LoadSessionRequest.mcpServers` l'est aussi, sur `ResumeSessionRequest` il est optionnel. L'union :

```ts
type McpServer =
  | (McpServerHttp & { type: "http" })   // { name, url, headers: HttpHeader[] }
  | (McpServerSse  & { type: "sse" })    // { name, url, headers: HttpHeader[] }
  | (McpServerAcp  & { type: "acp" })    // { name, serverId } — EXPERIMENTAL
  | McpServerStdio;                      // { name, command, args, env: EnvVariable[] }
```

La forme **stdio est la variante par défaut, sans champ `type`** — le seul transport que tout agent doit accepter, avec `command` = « Absolute path to the MCP server executable ». Les autres formes dépendent de `mcpCapabilities` : Claude et OpenCode annoncent `http` et `sse`, Codex `http` seulement. La variante `acp` (serveur MCP porté par le canal ACP lui-même, via `mcp/connect`, `mcp/message`, `mcp/disconnect`) est marquée **UNSTABLE** et n'est annoncée par aucun des trois. **Donc** : pour être accepté partout, le serveur MCP de Hemera doit être exposé en **stdio** (chemin absolu vers un exécutable) ou en **streamable HTTP** (URL locale plus en-têtes) ; ne pas compter sur SSE, refusé par Codex, ni sur le transport `acp`.

Côté SDK TypeScript MCP (<https://github.com/modelcontextprotocol/typescript-sdk>, <https://registry.npmjs.org/@modelcontextprotocol/server>, <https://registry.npmjs.org/@modelcontextprotocol/node>) : le SDK a été **scindé en v2**, publiée le **2026-07-27**, « released alongside the 2026-07-28 spec » — `@modelcontextprotocol/server@2.0.0` (serveurs ; dépend de `@modelcontextprotocol/core@2.0.0` et `zod@^4.2.0`), `@modelcontextprotocol/client@2.0.0`, `@modelcontextprotocol/node@2.0.0` (streamable HTTP pour `IncomingMessage`/`ServerResponse`), plus les intégrations `/express`, `/fastify`, `/hono`. L'ancien monopaquet `@modelcontextprotocol/sdk` est en **1.30.0** (2026-07-27) et reste sur la branche `v1.x` : « v1.x continues to receive bug fixes and security updates for at least 6 months after v2's release », soit fin janvier 2027 au minimum.

Serveur stdio minimal (README v2, verbatim) :

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

En streamable HTTP sur `node:http` (README de `@modelcontextprotocol/node`) : `NodeStreamableHTTPServerTransport` puis `transport.handleRequest(req, res, req.body)`, avec les gardes `localhostHostValidation()` et `localhostOriginValidation()` composées devant le transport quand on câble `node:http` à la main (les factories `createMcpExpressApp`, `createMcpHonoApp`, `createMcpFastifyApp` les appliquent d'office) ; pour un runtime web standard, `WebStandardStreamableHTTPServerTransport` vient de `@modelcontextprotocol/server`. Pour mémoire, l'adaptateur Claude déprécié embarquait `@modelcontextprotocol/sdk@1.26.0` : le choix de version côté Hemera est indépendant de celui des agents, nos serveurs MCP ne partagent pas de code avec eux.

## 7. Interruption et coût

La spec (<https://agentclientprotocol.com/protocol/prompt-turn>) : l'agent « **SHOULD** stop all language model requests and all tool call invocations as soon as possible », puis « after all ongoing operations have been successfully aborted and pending updates have been sent, the Agent **MUST** respond to the original `session/prompt` request with the `cancelled` stop reason ».

- **Claude** : `cancel()` marque `session.cancelled = true`, annule les rendus d'usage en cours,
  termine les sous-agents natifs en `"cancelled"`, puis interrompt la query ; un minuteur de secours
  force le tour à se conclure en `"cancelled"` si la boucle du SDK ne rend jamais la main. Les tool
  calls interrompus sont remontés en `tool_call_update` avec un statut dérivé du texte
  (`/\b(?:cancelled|canceled|interrupted|stopped|killed)\b/` → `"cancelled"`).
- **Codex** : `cancel()` appelle `interruptSessionTurn(...)` ; commentaire du code : « After
  `turnInterrupt()`, Codex will send `turn/completed`, which naturally completes
  `awaitTurnCompleted()` ». Une session inconnue fait un no-op silencieux.
- **OpenCode** : capacité baseline ACP dans `packages/opencode/src/acp/` ; le détail de l'arrêt des
  outils en cours **n'a pas été vérifié** ligne par ligne.

Dans les trois cas l'annulation est *coopérative* : Hemera ne peut pas garantir qu'un outil s'arrête au milieu, seulement que le tour se soldera par `stopReason: "cancelled"`.

Pour les tokens et le coût, deux canaux — `session/update` avec `sessionUpdate: "usage_update"` → `UsageUpdate { used, size, cost?: { amount, currency } }` (`used` = tokens actuellement dans le contexte, `size` = taille de la fenêtre) ; et `PromptResponse.usage?: Usage`, marqué **UNSTABLE** dans le schéma, = `{ totalTokens, inputTokens, outputTokens, thoughtTokens?, cachedReadTokens?, cachedWriteTokens? }`.

- **Claude** : `usage_update` à plusieurs moments du tour (résultat, compaction,
  `rate_limit_event`), avec `cost: { amount: message.total_cost_usd, currency: "USD" }` en fin de
  tour, et un `PromptResponse.usage` complet (`sessionUsage`) incluant les tokens de cache ; quotas
  dans `_meta.quota` et `_meta["_claude/rateLimit"]`.
- **Codex** : `usage_update` avec `used` (tokens du dernier tour) et `size`
  (`modelContextWindow`) — **pas de champ `cost`**. `toPromptUsage` remplit `PromptResponse.usage`
  (`cachedInputTokens` → `cachedReadTokens`, `reasoningOutputTokens` → `thoughtTokens`) ; rate
  limits dans `_meta` (`account/rateLimits/updated`).
- **OpenCode** : `usage_update` avec `used`, `size` et
  `cost: { amount: totalSessionCost(messages), currency: "USD" }`, coût cumulé de la session agrégé
  depuis le champ `cost` de ses propres messages assistants.

**Le coût monétaire n'est donc disponible que pour Claude et OpenCode**, et seulement en USD ; pour Codex, Hemera ne peut afficher que des tokens et une occupation de fenêtre.

## Conséquences pour Hemera

Acquis :

- **Le socle ACP est stable** : `@agentclientprotocol/sdk@1.4.0`, `protocolVersion: 1`, schéma
  1.20.0. Cibler v1, ignorer `src/v2`.
- **Les trois fournisseurs visés ont un agent ACP vivant**, tous publiés dans les 48 h avant ce
  relevé, tous en stdio, tous en `protocolVersion: 1`.
- **Hemera écrit son propre superviseur de processus** : pas de helper de spawn dans le SDK —
  `spawn`, `Writable.toWeb`/`Readable.toWeb`, `acp.ndJsonStream`, `stderr` à part.
- **La règle « la session survit au fournisseur » tient** : `session/load` existe chez les trois et
  rejoue l'historique en `session/update` ; persister (`agentId`, `sessionId`, `cwd`) suffit. Pas de
  repli par injection d'historique : session perdue = session neuve plus un prompt de contexte
  rédigé par Hemera, à afficher comme telle.
- **Le serveur MCP de Hemera doit être stdio ou streamable HTTP** ; SSE est refusé par Codex et le
  transport `acp` est instable.
- **SDK MCP : partir sur la v2** (`@modelcontextprotocol/server@2.0.0`, plus
  `@modelcontextprotocol/node@2.0.0` si HTTP) ; la v1 n'est maintenue en correctifs que jusqu'à fin
  janvier 2027 au plus tôt.
- **Capacités client à implémenter** : `fs/read_text_file`, `fs/write_text_file`,
  `session/request_permission`, la famille `terminal/*` et `elicitation/*`. La capacité terminal
  n'est pas un luxe : sans elle l'adaptateur Claude ne propose pas ses méthodes d'auth par
  abonnement, et OpenCode ne peut pas proposer son `opencode auth login`.
- **Coût** : afficher `usage_update.cost` quand il vient (Claude, OpenCode) et se rabattre sur les
  tokens pour Codex ; ne pas construire l'UI sur un coût universel.

Incertain ou non vérifié :

- Aucune vérification à l'exécution, ni sur Windows ni sur Linux : tout est lu dans le code.
- La rétention réelle des transcripts côté agents n'est pas documentée : un `session/load` peut
  échouer sur une session ancienne.
- OpenCode : le détail de l'arrêt des outils sur `session/cancel` n'a pas été lu.
- Les extensions hors spec (`steering`, `goal`, `session failure`, sous-agents natifs, async tasks)
  sont portées par Claude et Codex mais pas par OpenCode, et vivent dans `_meta` : s'en servir crée
  une dépendance à deux agents sur trois.
- Le déménagement du dépôt OpenCode (`sst/opencode` vers `anomalyco/opencode`) est récent ; la
  gouvernance du projet mériterait un point avant d'en dépendre.
- Aucune déclaration officielle d'Anthropic ou d'OpenAI sur un mode ACP natif dans leurs CLI : les
  deux passent par un adaptateur hébergé par le projet ACP.
