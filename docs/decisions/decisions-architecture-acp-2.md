# Multi-agent chat architecture with ACP

State of the decisions as of 8 September 2026.

This document gathers the orientations retained and the technical elements verified to build a chat interface that connects Claude, Codex and OpenCode, selects their models and uses custom tools. It keeps the corrections made during the research and distinguishes established possibilities from the points that remain to be tested in implementation.

## 1. Objective and main constraint

The user must be able to connect their accounts, select an agent and a model, then switch from one to the other in a common interface.

**Using the Claude and ChatGPT subscriptions is an indispensable condition.** A solution that would impose separate API billing only does not meet the need.

The product must make it possible to define one's own tools and workflows, while delegating protocols, authentication and execution as much as possible to the agents' maintained components.

## 2. Architecture retained

**ACP v1 is the common integration base.** A single ACP client drives several agents; their adapters translate the requests and events specific to each engine. ACP v2 remains experimental and is not the foundation retained. [S1, S2]

| Component | Integration retained | Engine used |
|---|---|---|
| Common TypeScript client | `@agentclientprotocol/sdk` | ACP communication |
| Claude | `@agentclientprotocol/claude-agent-acp` | Claude Agent SDK and Claude Code engine |
| Codex | `@agentclientprotocol/codex-acp` | Codex App Server |
| OpenCode | `opencode acp` | OpenCode and its configured providers |

The former `@zed-industries/codex-acp` adapter is replaced by `@agentclientprotocol/codex-acp`. The historical repository is archived and points to the new project. [S3–S6]

### Code split

Three layers keep provider-specific conditions to a minimum:

1. **Per-agent configuration**: program to launch, arguments, environment, versions and advanced options specific to the engine.
2. **Common ACP client**: transport, messages, events, permissions, settings and sessions.
3. **Product logic**: connected accounts, aggregated catalogue, active selection, common history and context transfer.

Ordinary behaviours must depend on the capabilities announced by the agent. Deep configuration differences stay isolated in the integration modules.

A local or remote process must run the agents. A browser alone does not replace this environment. The local or desktop option is the starting recommendation; the final packaging choice is not settled.

## 3. Subscriptions and authentication

### OpenAI

Codex distinguishes the ChatGPT login, which grants the subscription's entitlements, from the API-key login billed per use. App Server can drive the ChatGPT flow, keep the tokens and renew them automatically. The application can thus delegate the authentication cycle to the official engine. [S7, S8]

The classic OpenAI API SDK is not the solution retained to consume the ChatGPT plan. For a rich interface around Codex, App Server is the official underlying interface used by the new ACP adapter. [S4, S8]

### Claude

**The billing clarification to keep is the one from the Anthropic help centre updated in June 2026: the Claude SDK, `claude -p` and third-party applications continue to consume the subscription's usage limits.** The plan to separate them into a distinct monthly credit has been suspended. The rest of that article keeps the old announcement for historical purposes; it must not be read as the active measure. [S9]

This possibility does not turn Claude.ai credentials into universal API keys. The integration conditions notably require using the Claude Code binary unmodified, a personal login by the user through the Anthropic flow, preserving the authentication methods, and no resale or intermediation of usage. The Agent SDK page also keeps a restriction on offering Claude.ai login or quotas in a third-party product without approval. [S10, S11]

**Status retained: access to the quotas is documented; authorisation of every conceivable architecture is not established.** The product must keep the official login and must not collect the tokens to reuse them in its own inference service.

### The T3 Code case

The T3 Code code examined uses the Claude Agent SDK, calls `query()` and passes it the path of the Claude Code binary through `pathToClaudeCodeExecutable`. Its website announces the use of existing subscriptions. No particular exemption was established during the research. T3 Code is an integration reference, not proof of an authorisation transferable to another product. [S12, S13]

### OpenCode does not replace the official Claude path

The path retained for the Claude subscription is Claude ACP. The OpenCode documentation states that plugins reusing Claude Pro/Max subscriptions in its engine are forbidden by Anthropic and are no longer integrated since OpenCode 1.3.0. Putting ACP in front of OpenCode does not change that situation. [S14]

### Consequences for the interface

- Distinguish subscription login from API login when the information is available.
- Do not treat a successful login as proof that every request is included in the plan.
- Keep quota limits and errors visible to the user.
- Do not silently fall back to a paid API route.

## 4. What is shared through ACP

| Function | Common mechanism | Product responsibility |
|---|---|---|
| Initialisation | `initialize` | Start the connection and retain the capabilities |
| Authentication | Methods announced in `authMethods` | Present the appropriate flow |
| New session | `session/new` | Bind the session to the chat |
| Sending a message | `session/prompt` | Input and routing |
| Streaming and progress | `session/update` | Display messages and actions |
| Permissions | `session/request_permission` | Present and relay the decisions |
| Stopping a turn | `session/cancel` | Stop button and interface state |
| Configuration | `configOptions` and `session/set_config_option` | Build the selectors |
| Resumption | `session/load` or `session/resume`, depending on support | Persist the references and restore |

These names are those of the protocol methods; the exact TypeScript methods depend on the SDK version. Some functions are optional: their presence must be checked, not inferred from the agent's name alone. [S1, S15–S17]

Login is not an off-the-shelf widget. ACP notably describes agent-driven flows and flows requiring an interactive terminal, followed by a reconnection. The client must implement these kinds of flows and honour the announced capabilities. [S15]

## 5. Models and settings

### Generic selection

Agents can expose their settings in `configOptions`, with an identifier, a label, a current value and possible choices. Categories can identify the model, the mode or the reasoning level.

The client can generate the controls from this data, then send a selection with `session/set_config_option`. The agent returns the full updated state; notifications can also change the options. This makes it possible to reflect the dependencies between model and settings. [S16]

The implementations examined of Claude ACP, Codex ACP and OpenCode have session option handling. Coverage in the versions actually distributed still needs to be checked. [S18–S20]

### Product catalogue

The application aggregates the models announced by the active connections. Each choice keeps at least the identity of the connection, that of the agent and the model identifier.

**Agent and model remain two distinct notions.** OpenCode is an engine that can use several providers. The same model name reachable through two engines guarantees neither the same tools, nor the same instructions, nor the same billing mode.

The selector must show the models exposed by the agent in its context, not promise access to the provider's whole commercial catalogue. Presence in a list guarantees neither a successful request nor an available quota.

## 6. Shared conversation and agent switching

### Model change within the same agent

The change concerns an option of the existing session. The initial recommendation is to apply the selection to the next message, after the current turn has ended or been cancelled, to keep the behaviour understandable.

### Switching from Claude to Codex or OpenCode

**ACP offers no universal memory migration between agents.** Loading a session means asking its engine to restore a session it knows; the identifier of a Claude session is not a memory Codex can use directly. [S17]

The application must have its own shared history and handle context transfer. The recommended data schema includes:

| Object | Role |
|---|---|
| Conversation | Shared visible thread |
| Messages and events | Content kept with its provenance |
| Agent session | Link between conversation, connection and engine session |
| Synchronisation point | Last item of the thread sent to each session |
| Active selection | Connection, agent and model of the next turn |

Example of operation: the user chats with Claude, selects Codex, then the application creates or resumes the Codex session and gives it the relevant items of the thread. When returning to Claude, it sends what was added since its last turn.

This strategy is an application architecture to implement. The transfer may include objective, decisions, relevant messages, tool results and file state. It consumes tokens and does not copy internal reasoning, in-flight processes or all of the engine's private state. A shared directory helps share files, not conversational memory.

## 7. Custom tools and advanced configuration

### Level of control retained

**Building our interface, our instructions, our tools and our orchestration is feasible. Fully replacing the engines' internal loop is not a general capability of ACP.**

The Claude loop, for example, keeps calling the model, running the tools and feeding the results back. Events expose the activity; they do not automatically give the client control over each request and the exact content of its context. [S21]

### Claude ACP

The verified code accepts extensions at session creation:

| Parameter | Use |
|---|---|
| `_meta.systemPrompt` | Custom system prompt |
| `_meta.claudeCode.options.tools` | Selection of the built-in tools; `[]` disables them |
| `_meta.claudeCode.options.disallowedTools` | Tool exclusions |
| `mcpServers` | MCP tools brought by the client |
| `_meta.claudeCode.options.settingSources` | Control of the settings sources loaded |

The former `_meta.disableBuiltInTools` is a shortcut kept for compatibility. These options are specific to Claude ACP. Some SDK fields are controlled or overridden by the adapter: one must not assume that every SDK option passes freely through ACP. JavaScript callbacks do not serialise into a JSON request. [S18, S22]

`allowedTools` is a pre-authorisation list, not an exclusive list of the visible tools. To remove the built-in tools while keeping the MCP tools, the selection `tools: []` is appropriate; `disallowedTools: ["*"]` would also remove the MCP tools. Refusing an execution and removing a tool definition are two different operations. [S23]

### Codex ACP

The engine exposes settings for permissions, sandbox, models and MCP. The adapter notably accepts `CODEX_CONFIG`. The Codex configuration includes controls for the shell, web search and MCP tool filtering. **The exhaustive removal of all built-in tools has not been validated.** A read-only environment does not mean the model no longer sees the tools. [S4, S24]

### OpenCode

OpenCode allows custom agents with prompts, per-tool permissions and additional tools. The `permission` field is to be preferred; the former `tools` field is deprecated. Customisations go through the OpenCode configuration, even when the interface uses ACP. [S25, S26]

### Common tools through MCP

MCP is the recommended format to expose the business tools common to the different engines: document search, data access, project modification, information request or task delegation.

The tool server controls access, input validation and the effects executed. The engine remains responsible for the decision loop. With the Claude Agent SDK directly, TypeScript tools can also be exposed in the same process; with an external ACP adapter, a separate MCP server is a natural integration. [S27]

## 8. Product harness and separation of responsibilities

The business harness belongs to the application. ACP remains the communication layer with Claude, Codex and OpenCode; MCP is the common format to expose the tools; the product keeps the state, the workflow rules, the artifacts, the validations and the user experience.

```text
Application and workflow engine
    → selection of the role, the provider and the model
    → creation or resumption of an ACP session
    → tools made available through MCP
    → collection of events, artifacts and results
    → application of gates and state transitions
```

The role of an agent must not be coupled to its provider. The same operation can be run by Claude, Codex or OpenCode without changing the business workflow:

```ts
runAgent({
  role: "dev",
  mode: "review",
  runtime: { agent: "claude", model: "opus" },
  targetRevision: "build-42"
});
```

Launch and configuration differences stay confined to the ACP adapters. The workflow handles capabilities, roles and artifacts, not scattered conditional branches of the `if Claude / else if Codex` kind.

### The three agents retained

Three agent definitions are enough. The various activities are **execution modes**, not new agents.

| Agent | Responsibility | Main modes | Writes allowed by default |
|---|---|---|---|
| **Spec Agent** | Understand, research, challenge and formalise the intent | `draft`, `clarify`, `research`, `revise`, `validate` | Specs, decisions and acceptance criteria |
| **Dev Agent** | Design technically, prototype, implement, test and review | `plan`, `prototype`, `implement`, `review`, `fix` | Plans, tasks, code and tests |
| **Doc Agent** | Document the state actually delivered and detect divergences | `draft`, `sync`, `audit` | Documentation, guides and changelog |

An agentic code review is a new run of the Dev Agent in `review` mode, in a session isolated from the implementation session. When possible, the product can select another model or provider. The important separation is between runs and their context, not in multiplying personas.

The Dev Agent does not directly modify an approved spec. If it finds a contradiction, it creates an amendment proposal that goes back to the Spec Agent or to the user. The Doc Agent must not invent the product's behaviour: it compares the approved spec, the accepted diff and the verified product.

## 9. Spec-driven development

GitHub Spec Kit is a source of methodological inspiration, not a central dependency. Its workflow separates constitution, specification, plan, tasks, implementation and convergence. It also offers clarification, consistency analysis, checklists and an extension dedicated to bugs. [S30–S34]

### Concepts taken from Spec Kit

- Separate the functional need from the technical plan.
- Define observable, testable acceptance criteria.
- Version the artifacts and the decisions.
- Keep traceability between requirements, tasks, code and tests.
- Provide clarification and consistency-check operations.
- Use common project principles without building a monolithic prompt.
- Check convergence between spec, implementation and tests.
- For bugs, separate diagnosis, fix and verification.

### Elements not taken as is

- The proliferation of slash commands and prompts installed differently in each agent.
- The explosion into mandatory Markdown files for every intermediate step.
- Rigid templates whose every field would always be mandatory.
- Tasks represented only by Markdown checkboxes.
- Convergence loops with no limit on iterations, time or tokens.
- Coupling between the application's business state and a precise filesystem layout.

The product reimplements these concepts as business objects, transitions and UI surfaces. Markdown representations remain exportable and versionable, but are not the only application data store.

### Feature spec

A functional spec describes the **what** and the **why**:

- problem, context and expected outcome;
- users and journeys concerned;
- scope and out of scope;
- functional requirements;
- acceptance criteria;
- edge cases;
- non-functional requirements;
- product, security and compliance constraints;
- open questions and human decisions;
- associated prototypes.

The framework, the files to modify, the migrations and the breakdown into tasks belong to the technical plan produced by the Dev Agent. This separation takes up the principle of Spec Kit's `spec.md` and `plan.md` templates without imposing their exact structure. [S31, S32]

### Feature workflow

```text
DRAFT
→ NEEDS_INPUT
→ SPEC_REVIEW
→ SPEC_APPROVED
→ PROTOTYPING or PLANNING
→ BUILDING
→ AGENT_REVIEW
→ HUMAN_REVIEW
→ ACCEPTED
→ DOCUMENTING
→ DONE
```

`CHANGES_REQUESTED` sends back to the last step able to resolve the request: spec revision, prototype modification, code fix or documentation update. Small changes can skip the prototype, but not the definition of the expected outcome nor the validations required by their risk level.

### Bug-specific spec and workflow

A bug has a shorter, more factual artifact than a feature spec:

| Field | Expected content |
|---|---|
| Observed behaviour | Symptom actually observed |
| Expected behaviour | Functional reference or desired outcome |
| Reproduction | Steps, environment and frequency |
| Evidence | Logs, traces, screenshots, requests and files concerned |
| Impact | Users, data and severity |
| Cause | Status `suspected` or `confirmed`, with evidence |
| Fix constraints | Invariants to preserve and scope limits |
| Regression risks | Areas and journeys to re-check |
| Acceptance criteria | Reproduction result and expected tests |
| Documentation impact | None, internal or user-visible |

```text
REPORTED
→ REPRODUCING
→ DIAGNOSED
→ FIX_PLANNED
→ FIXING
→ VERIFYING
→ AGENT_REVIEW
→ HUMAN_REVIEW
→ DOCUMENTING
→ DONE
```

The Spec Agent does not modify code during diagnosis. The Dev Agent does not present a merely suspected cause as confirmed. A regression test is required by default; if it is impossible, its absence must be justified. A reproduction that was not run stays explicitly `not-run` or `partial`, never `verified`.

Spec Kit already applies useful safeguards: the evaluation and test steps do not modify code, only the fix step does, and a result that was not actually tested cannot be overrated. [S34]

## 10. Prototypes and reviews as first-class objects

A prototype is not just a branch. It references at least a spec revision, a variant, a commit, an environment, a preview URL, screenshots and the feedback received.

```ts
interface Prototype {
  id: string;
  specRevisionId: string;
  variant: string;
  branch: string;
  environmentId: string;
  commitSha: string;
  previewUrl?: string;
  screenshots: ArtifactReference[];
  status: "creating" | "ready" | "under-review" |
          "selected" | "rejected" | "archived";
}
```

The product can thus produce several isolated proposals, display them side by side, collect human annotations, request iterations, promote the retained variant and archive the others. Prototype feedback becomes decisions or a new spec revision; it does not stay locked in the chat.

### Common review model

Human and agentic reviews use the same structure and differ by their author:

```ts
interface Review {
  id: string;
  targetType: "spec" | "prototype" | "build" | "documentation";
  targetRevision: string;
  reviewer: {
    type: "human" | "agent";
    id: string;
    provider?: "claude" | "codex" | "opencode";
    model?: string;
  };
  verdict: "approved" | "changes-requested" | "commented";
  findings: Finding[];
}
```

A finding keeps severity, category, message, evidence, optional location, proposed fix and resolution state. A new review never deletes previous comments. The UI must show the answer given, the change made and the resolution or rejection decision.

### Central business model

```text
Project
├── ProjectPolicy
├── WorkItem
│   ├── type: FEATURE | BUG
│   ├── SpecRevision[]
│   ├── Decision[]
│   ├── PlanRevision[]
│   ├── Task[]
│   ├── Prototype[]
│   ├── Build[]
│   ├── Review[]
│   ├── Artifact[]
│   └── AgentRun[]
└── Environment[]
```

Each run keeps the spec revision used, the starting commit, the provider, the model, the agent configuration, the allowed tools, the environment, the artifacts produced, the limits and the result. This provenance is necessary to reproduce and explain the agent's decisions.

## 11. Development environments and DevFlow

DevFlow corresponds to the harness's isolated-environments layer, not to the agent protocol nor to the workflow engine. Its model provides a worktree, ports, a Postgres database, `.env` files, dependencies, servers and logs specific to each branch. Its non-interactive interface, its JSON outputs, its structured errors and its persistent logs suit agents. [S38]

The LITE/FULL distinction is retained as a principle:

| Activity | Recommended environment |
|---|---|
| Repository reading by the Spec Agent | LITE |
| Doc Agent analysis | LITE |
| Static review | LITE |
| Implementation | FULL |
| Runnable prototype | FULL |
| Browser or E2E review | FULL |

The product must nevertheless remain the owner of the state. An agent does not silently create an environment through a Bash command that the UI would discover after the fact. It requests the operation from the harness; the orchestrator executes it, publishes the events and returns an identifier, the paths and the URL to the agent.

```ts
interface EnvironmentManager {
  create(input: CreateEnvironmentInput): Promise<Environment>;
  promote(id: string): Promise<Environment>;
  start(id: string): Promise<void>;
  logs(id: string, options?: LogOptions): Promise<LogChunk>;
  diff(id: string): Promise<DiffArtifact>;
  destroy(id: string): Promise<void>;
}
```

DevFlow can be used behind this interface, or its concepts can be reimplemented. The UI and the business model do not depend directly on the CLI. The current limits noted in its README—development mainly on macOS, no Windows support, Postgres orientation and detection optimised for certain monorepos—must be factored into the portability plan. [S38]

## 12. Technical building blocks of the harness

### Code search: `tgrep`

`tgrep` is retained as a possible engine for large repositories. Its trigram index and its local server greatly speed up repeated regex searches; its JSON stream eases integration from TypeScript. It replaces neither semantic search nor symbol analysis. On small repositories, or when absolute freshness is required, `ripgrep` or the index-less mode remain preferable. [S35, S36]

The model calls a stable product tool, for example `code_search`, and the harness chooses the implementation. The initial build and the freshness state of the index must be checked before treating an absence of results as final.

### Document ingestion: MarkItDown

MarkItDown is retained as the input converter from PDF, DOCX, PPTX, XLSX, HTML, images, audio and other formats to a Markdown meant for LLMs. The recommended integration is an isolated Python worker behind a typed harness tool. MarkItDown is not a solution for editing or high-fidelity reconstruction of documents; deliverable generation keeps a dedicated layer. Untrusted files are processed in a sandbox with minimal privileges. [S37]

### Context compression: Headroom

Headroom remains an optional experiment, not a critical dependency. Its TypeScript library, its MCP server and its reversible compression mechanisms are interesting for large tool outputs and long sessions. The proxy that intercepts the internal communications of Claude or Codex is not retained as the foundation of subscription access. [S39]

The first integration, if evaluations justify it, applies only to data controlled by the product: the raw result is kept as an artifact, a compact version is sent to the model and the model can retrieve the original. A feature flag and evaluations compare success, omissions, tokens, latency and retrieval frequency. The canonical memory of specs and decisions stays in the product's storage.

### Harness principles retained

The works consulted converge on several principles: an agent is the model plus its whole execution environment; every recurring failure must improve the harness; instructions guide, while tests, linters, hooks and other sensors verify; deterministic checks come before judgement by another LLM. [S40–S43]

These principles lead to keeping rules short and traceable, exposing useful documentation progressively, making environments and results observable, and turning review feedback into lasting improvements rather than one-off fixes in the chat.

## 13. Reimplementation scope

The differentiating core to reimplement includes:

- workflow engine and state transitions;
- spec model and revision management;
- agent roles, modes and tool policies;
- decisions, tasks, artifacts and provenance;
- validation gates;
- human and agentic reviews;
- prototype management and comparison;
- environment and preview registry;
- real-time events, observability and UI;
- synchronisation between spec, code and documentation.

Commodity building blocks remain replaceable behind interfaces: ACP for agents, MCP for tools, Git and worktrees for versioning, Docker for isolation, MarkItDown for document extraction and `ripgrep`/`tgrep` for text search.

**Structuring decision: three stable agents, several execution modes, two initial work item types (`FEATURE` and `BUG`), reviews as gates and prototypes as runnable artifacts of the spec.**

## 14. Limits and points to test

The validations of this phase are documentary and also rely on reading code. They do not yet constitute an end-to-end validation with connected accounts.

The following points remain to be verified during the prototype:

- Actual consumption of the quotas of both subscriptions, with the versions and login methods retained.
- Compatibility of the precise product flow with the Anthropic conditions; no general guarantee drawn from the T3 Code example alone.
- Actual coverage of models, options, resumptions and cancellations in the distributed versions of the adapters.
- Effective disabling of the desired tools, particularly on the Codex side.
- Installation, update and isolation of configurations and accounts.
- Quality, cost and strategy of the context transfer between agents.
- Handling of non-standard extensions and unknown events.

Not yet settled: interface framework, desktop packaging or web with a local companion, database, hosting and the exact conversation summarisation policy.

## 15. Other libraries examined

**Sandbox Agent** provides a common interface with a TypeScript SDK and an HTTP/SSE server for several agents, locally or in a remote environment. It is an alternative to evaluate if remote execution becomes central; it is neither a settled dependency nor a guarantee of subscription access. [S28]

**spawn-agent** offers a Vercel AI SDK-compatible interface on top of ACP. It can speed up a prototype, but its maturity has not been established enough to make it the central dependency. [S29]

The foundation kept in this document is therefore the official ACP client and the current adapters, with a product layer for chat continuity and a configuration layer specific to each engine.

## Sources

Sources consulted during the research, as of 8 September 2026. Links to `main` or `dev` evolve: versions and commits will have to be frozen at implementation.

- **S1** — [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview)
- **S2** — [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- **S3** — [Claude Agent ACP](https://github.com/agentclientprotocol/claude-agent-acp)
- **S4** — [Maintained Codex ACP](https://github.com/agentclientprotocol/codex-acp)
- **S5** — [ACP support in OpenCode](https://opencode.ai/docs/acp/)
- **S6** — [Former Codex adapter and migration notice](https://github.com/zed-industries/codex-acp)
- **S7** — [Codex authentication](https://learn.chatgpt.com/docs/auth)
- **S8** — [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- **S9** — [Using the Claude Agent SDK with a subscription and suspension of the billing change](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- **S10** — [Claude Code integration and authentication conditions](https://code.claude.com/docs/en/legal-and-compliance)
- **S11** — [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- **S12** — [T3 Code Claude adapter](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/ClaudeAdapter.ts)
- **S13** — [T3 Code website](https://t3.codes/)
- **S14** — [OpenCode providers and Claude restriction](https://opencode.ai/docs/providers/#anthropic)
- **S15** — [ACP authentication](https://agentclientprotocol.com/protocol/v1/authentication)
- **S16** — [ACP session options](https://agentclientprotocol.com/protocol/v1/session-config-options)
- **S17** — [ACP session creation and resumption](https://agentclientprotocol.com/protocol/v1/session-setup)
- **S18** — [Claude ACP implementation](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/acp-agent.ts)
- **S19** — [Codex ACP model configuration](https://github.com/agentclientprotocol/codex-acp/blob/main/src/ModelConfigOption.ts)
- **S20** — [OpenCode ACP implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/acp/agent.ts)
- **S21** — [Claude Agent SDK execution loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- **S22** — [ACP extensions](https://agentclientprotocol.com/protocol/v1/extensibility)
- **S23** — [Claude permissions and tool selection](https://code.claude.com/docs/en/agent-sdk/permissions)
- **S24** — [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- **S25** — [OpenCode custom agents](https://opencode.ai/docs/agents/)
- **S26** — [OpenCode tools](https://opencode.ai/docs/tools/)
- **S27** — [Claude Agent SDK custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools)
- **S28** — [Sandbox Agent](https://github.com/rivet-dev/sandbox-agent)
- **S29** — [spawn-agent](https://github.com/millionco/spawn-agent)
- **S30** — [GitHub Spec Kit](https://github.com/github/spec-kit)
- **S31** — [Spec Kit feature spec template](https://github.com/github/spec-kit/blob/main/templates/spec-template.md)
- **S32** — [Spec Kit technical plan template](https://github.com/github/spec-kit/blob/main/templates/plan-template.md)
- **S33** — [Spec Kit tasks template](https://github.com/github/spec-kit/blob/main/templates/tasks-template.md)
- **S34** — [Spec Kit bug extension](https://github.com/github/spec-kit/tree/main/extensions/bug)
- **S35** — [`tgrep`](https://github.com/microsoft/tgrep)
- **S36** — [`tgrep` guide for coding agents](https://github.com/microsoft/tgrep/blob/main/AGENTS.md)
- **S37** — [Microsoft MarkItDown](https://github.com/microsoft/markitdown)
- **S38** — [DevFlow—README provided for the analysis](https://github.com/leoleducq/devflow)
- **S39** — [Headroom](https://github.com/headroomlabs-ai/headroom)
- **S40** — [Mitchell Hashimoto — My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey)
- **S41** — [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/)
- **S42** — [Birgitta Böckeler — Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)
- **S43** — [Addy Osmani — Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/)
