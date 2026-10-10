# How Hemera's sessions use the prompt cache

Every request of a session sends its whole context again; the provider's prompt cache is what makes
that cheap. This page records what was read in the sources, what was measured on real sessions,
and what to change. Measured on 10 October 2026 with `claude` 2.1.295 on a Claude subscription,
mostly on `claude-haiku-5-5`. The sources are the versions pinned in the lockfile:
`@agentclientprotocol/claude-agent-acp` 0.79.0, `@anthropic-ai/claude-agent-sdk` 0.3.274 (and its
`claude-agent-sdk-linux-x64` binary, `claude` 2.1.274), `@agentclientprotocol/codex-acp` 1.12.0,
`codex` 0.158.0.

Prices are in units of the plain input price: a cache read costs 0.1, a five-minute write 1.25, a
one-hour write 2.

## How it was measured

`apps/desktop/scripts/prompt-cache/probe.ts` starts a session the way Hemera does: the options
`claude.bareOptions` builds (`apps/desktop/src/engine/agents/adapters/claude.ts`), Hemera's own
instructions for the Probe role, Hemera's own MCP tool server with a gate that answers "ok", in a
new temporary folder. It drives the Agent SDK's `query()` directly rather than the ACP adapter,
because the adapter adds up a turn's usage and drops the split between five-minute and one-hour
writes (`claude-agent-acp/dist/acp-agent.js:3455-3457`, reported at `:6531-6535`); the options are
the same, since the adapter spreads `_meta.claudeCode.options` into `query()`
(`acp-agent.js:5934`, `:6027`, `:6045`). Each request's usage is read off the SDK's assistant
message (`apps/desktop/scripts/prompt-cache/usage.ts`, tested in
`apps/desktop/tests/prompt-cache-usage.test.ts`).

```
node apps/desktop/scripts/prompt-cache/probe.ts lifetime --owner 'mission LIFE-1'
node apps/desktop/scripts/prompt-cache/probe.ts lifetime --owner 'mission LIFE-2' --ttl 5m \
  --model claude-haiku-4-5
node apps/desktop/scripts/prompt-cache/probe.ts resume --gap 330 --owner 'mission RESUME-1'
node apps/desktop/scripts/prompt-cache/probe.ts prefix --owner 'mission PREFIX-1'
```

It spends the quota of the account `claude` is signed in with: each run is a handful of requests on
a context of about 9,000 tokens, each turn asking for the single word "ok". Give every run its own
`--owner`: two runs with the same one read what the other wrote. A turn can take two requests: the
Probe's instructions make the model call a tool first (a `tool_use` request, which the probe does
not answer), and the second request is what a session does after it. Both are kept.

What a Probe session sends before its first message is about 8,700 tokens: mostly the tool
list (5,781 tokens), then Hemera's instructions (2,921). The first message
and what Claude Code adds to it come after, about 600 more. In the tables below, the 5,781 first
tokens are often read rather than written, because an earlier run had written them: that block is
the same for every session of the role, whatever its instructions.

## 1. The cache lifetime a Claude session gets

**From the sources.** The adapter does not mention a lifetime anywhere. The SDK documents two
settings, `promptCacheTtl` for the main conversation and `subagentPromptCacheTtl` for the rest:
unset, the main conversation gets one hour on a Claude subscription within its usage limits, and
five minutes on an API key, Bedrock, Vertex or Foundry; `CLAUDE_CODE_PROMPT_CACHE_TTL` takes
precedence (`claude-agent-sdk/sdk.d.ts:8458-8464`). The `claude` binary decides it per request in
one function (`claude-agent-sdk-linux-x64/claude`, minified, near byte 197363623):

1. `FORCE_PROMPT_CACHING_5M` set: five minutes.
2. For the main conversation (query sources `repl_main_thread*`, `sdk`, …),
   `CLAUDE_CODE_PROMPT_CACHE_TTL`, then the `promptCacheTtl` setting; for any other source,
   `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, then `subagentPromptCacheTtl`. Then
   `ENABLE_PROMPT_CACHING_1H` gives one hour.
3. Not a subscriber, or a subscriber spending extra usage beyond the plan: five minutes.
4. A subscriber: one hour when the query source is in an allow-list, else five minutes. The
   allow-list is remote configuration (`tengu_prompt_cache_1h_config`); its default is the
   main-conversation sources.

Hemera's sessions are of the `sdk` source, so on a subscription they get one hour. Hemera can
choose: `_meta.claudeCode.options.env` reaches the process (`acp-agent.js:6027`), and so does
`_meta.claudeCode.options.settings` (`acp-agent.js:6003`), where `promptCacheTtl` could be set (not
measured). Hemera's own environment reaches it too (`acp-agent.js:6026`): a user who exports
`CLAUDE_CODE_PROMPT_CACHE_TTL` or `FORCE_PROMPT_CACHING_5M` changes every session. Pinning the
variable also skips the extra-usage fallback of step 3.

**Measured** (`probe.ts lifetime`, no variable set): every write was a one-hour write.

| request                | read  | write 5m | write 1h |
| ---------------------- | ----: | -------: | -------: |
| turn 1                 | 5,781 |        0 |    2,921 |
| turn 1, after the tool | 8,702 |        0 |      789 |
| turn 2, right after    | 9,491 |        0 |      217 |
| turn 3, after 360 s    | 9,708 |        0 |       42 |

The same run with `--ttl 5m` wrote only five-minute entries, which proves the variable is the
switch (second table of section 2). That the entry really lives an hour was not run for 65 minutes:
the usage labels the write, and a 360 s pause was read back in full.

## 2. What a long wait costs

A session with the five-minute lifetime (`--ttl 5m`, what an API key or the end of the plan's limits
gives), then a pause of 360 s with the process alive. Run alone, on `claude-haiku-4-5`, so that no
other session keeps a block warm:

| request             |  read | write 5m | cost of the input |
| ------------------- | ----: | -------: | ----------------: |
| turn 1              |     0 |    7,226 |             9,043 |
| turn 2, right after | 7,226 |       98 |               855 |
| turn 3, after 360 s |     0 |    7,404 |             9,265 |

Everything is written again: 10.8 times what the request before cost. With the one-hour lifetime
the same pause cost 1,077 (the table of section 1). A first run on `claude-haiku-5-5` showed only
3,980 tokens written after the pause, because other sessions had kept the shared 5,781 tokens
warm; a real mission has no such help for its own conversation.

A one-hour write costs 0.75 more than a five-minute one, and an expired context costs 1.15 more than
a read. So one hour pays as soon as 65 % of what a session writes would otherwise expire once. A
session that waits on a command, on the user (a tool call may wait ten minutes, `TOOL_WAIT_MS`) or
on a Probe passes five minutes routinely, so one hour is the right lifetime for every role Hemera
runs today. Keeping a five-minute cache warm with a ping is not worth building: each ping is a full
request, and one hour needs none.

Closing the process and resuming the session from its transcript (`probe.ts resume`, what Hemera
does after an idle release of five minutes, `agents/idle.ts`, or a restart) loses nothing: after
330 s the resumed request read 9,582 tokens and wrote 210. The system prompt is recorded once and
reused (`snapshot: true`, `sdk.d.ts:2241-2262`), and the new MCP token Hemera mints at each start
travels in a header, not in the prompt.

## 3. Whether the prefix stays stable

What a request starts with, in order: the tool list, the system prompt (Claude Code's own leading
text, then Hemera's instructions), then the conversation, whose first message is Hemera's brief.

| part | where | within a session | between two sessions of a role |
| --- | --- | --- | --- |
| `_meta` options, environment | `adapters/claude.ts:55-78` | stable | stable |
| tool list | `tools/server.ts:100-112`, order of `TOOL_NAMES` | stable | differs with tester mode |
| base instructions | `sessions/base.ts`, kept at `sessions/provider.ts:76,107` | stable | the mission key (`base.ts:10`), the two languages (`:73-74`), the tester paragraph (`:94-95`) |
| role layer | `planning/*-role.ts` | stable | languages only |
| project layer | `sessions/instructions.ts:112-137` | stable | when a `CLAUDE.md` or `AGENTS.md` changes |
| brief, first message | `sessions/brief.ts:63-86`, the role's `brief` | stable | always: the Spec, the Memory, the Journal tail |
| resume block | `sessions/brief.ts:83-84` | — | always: `stoppedAt` and the last Journal line |

No date, random id or masked secret is in the system prompt or the tool list; the token and the
port of the MCP server are in its entry, not in the prompt. `claude` adds a header with per-request
ids (`cc_prev_req`, `cc_prompt_id`), and it does not break the cache: a session started again with
the same instructions read all 8,702 tokens and wrote none.

The brief differing between sessions is expected: it is the conversation. What costs is a change
early in the prefix, because everything after it is written again, and the provider matches a cache
at the end of a block, never inside one. Measured with `probe.ts prefix`, the first request of each
new session (letters are the variants of the script):

| new session | read | write |
| --- | ---: | ---: |
| A. reference, first of the run | 5,781 | 2,921 |
| B. same instructions, another brief | 8,080 | 622 |
| C. another mission key | 5,781 | 2,924 |
| D. tester mode (two more tools), first ever | 0 | 10,015 |
| E. key after a cache boundary, first | 0 | 8,714 |
| F. key after a cache boundary, another mission | 8,077 | 640 |
| H. key last in one text, first | 5,781 | 2,934 |
| I. key last in one text, another mission | 5,781 | 2,937 |
| G. the reference again | 8,702 | 0 |

(A to G are from one run; H and I from a second run, where the cache already held the first run's
entries: there D read 6,830 and wrote 3,185, and E read 8,077 and wrote 637.)

- **The mission key** sits on the instructions' fourth line, so each new mission writes the 2,900
  tokens of base and role again, for each role: about 5,800 units at one hour (C). Moving the key to
  the end of one text does not help (I): the provider reads a block whole or not at all. The SDK
  takes the system prompt as blocks split by `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, the blocks before it
  cached across sessions (`sdk.d.ts:2187-2191`, `:2286-2287`): with the key after it, another
  mission read 8,077 and wrote 640 (F). The first session of that form pays the full 8,714 once
  (E), because the blocks sit in a cache space of their own.
- **Tester mode** changes the tool list, which comes before the instructions: nothing after the
  tools can be read, and the tool list is its own cache entry. The grant is computed at each process
  start from the preference (`tools/index.ts:126,142`), so turning the mode on or off while a
  session is idle makes its next start miss the whole conversation, and the kept instructions then
  disagree with its tools.
- **The commands of the Probe brief's resources** are read without `ORDER BY`
  (`resources/declarations.ts:48-57`). The brief is built once per session, so it only matters when
  it is built again (compaction, replacement); in practice SQLite returns insertion order, but the
  order is not guaranteed.

One thing outside the prefix: the adapter asks Claude Code for a generated title at the end of the
turns until one is settled (`claude-agent-acp/dist/session-titles.js`). That is a separate small
request, with the other lifetime setting; it was not measured.

## 4. Codex

From the sources and the documentation only; nothing was run.

- **It caches.** The OpenAI Responses API caches automatically from 1,024 tokens, by prefix
  ([OpenAI, prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)). Codex
  sends the session's id as `prompt_cache_key` on every request
  ([`codex-rs/core/src/client.rs:585-596` and `:986`](https://github.com/openai/codex/blob/rust-v0.158.0/codex-rs/core/src/client.rs#L585-L596),
  tag `rust-v0.158.0`), which routes the requests of one conversation together.
- **For how long.** Codex sends no retention: `prompt_cache_retention` appears in its binary only
  in a migration note, and the request struct has neither it nor `prompt_cache_options`
  (`client.rs:1000-1016`). The provider's default applies: for models before GPT-5.6, `24h` for an
  organisation without zero data retention (typically 30 minutes, up to 24 hours) and `in_memory`
  (5 to 10 minutes idle, at most an hour) with it; from GPT-5.6, `prompt_cache_options.ttl` of
  `30m`, the only value.
- **What it costs.** Before GPT-5.6, a cached input token is billed at a model-dependent rate and a
  write is free; from GPT-5.6, a write costs 1.25 and a read 0.1 (the same shape as Claude's
  five-minute cache).
- **What Hemera sees.** The adapter reports cached input per turn as `usage.cachedReadTokens`
  (`codex-acp/dist/index.js:22156-22172`, `:34991-34995`).
- **What Hemera can change.** Nothing about the lifetime: the adapter merges `CODEX_CONFIG` into
  every thread's configuration (`index.js:35285-35288`) and no key of it sets a retention. The
  prefix is stable in Hemera's hands: its configuration is a constant (`adapters/codex.ts:32-63`),
  and the instructions travel once, inside the first message (`agents/runtime.ts:252-262`,
  `index.js:29155-29162`).

## 5. Recommendations

Is it optimised today? On a subscription, mostly yes: the lifetime is the right one, nothing
expires during a long wait, and a resumed session reads its cache. What is left is a cost at each
session start (the mission key and the tester mode), and that Hemera cannot see its cache at all.

1. **Keep the one-hour lifetime; do not ping; set nothing.** Measured above: after a pause past five
   minutes, one hour costs 1,077 units where five minutes costs 9,265, and Hemera's sessions wait
   that long routinely. Subscriptions already get it, so no code. A session spending extra usage
   beyond its plan, or on an API key, drops to five minutes; pinning
   `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` in the `_meta` environment would hold it there too, at twice
   the write price. That is a pricing choice for the maintainer, not a fix, and stays out of the
   drafts below.
2. **Show the cache in a session's usage.** Hemera's `usageOf` keeps the total, the input, the
   output and the thought tokens and drops `cachedReadTokens` and `cachedWriteTokens`
   (`agents/client.ts:684-691`), which both adapters report. Without them the share of cache reads
   in a mission's cost cannot be seen, and no change on this page can be checked in the application.
   Draft below.
3. **Put the mission key, the languages and the tester paragraph after a cache boundary.** Expected
   effect, measured: about 2,300 tokens fewer written per new session of another mission (2,924
   against 640), one 8,714-token write per role and hour for the new form. Draft below.
4. **Keep the tool list of a running session fixed.** Expected effect: no full miss for a session
   started again after tester mode was turned on or off. Draft below.
5. **Codex: nothing to change.** Its cache is automatic and keyed per thread, and its lifetime is
   not Hemera's to choose.

Not verified: the extra-usage fallback to five minutes (it needs an account past its limits), the
`promptCacheTtl` setting through `_meta` (the variable was used), API-key accounts, models other
than the two Haiku, Windows, 65 minutes of idle, and everything about Codex beyond the sources. The
remote allow-list can change what "unset" means; the per-request label in recommendation 2 is how
that would be noticed.

### Draft: keep the cache tokens of a session's usage

Both Claude's and Codex's adapters report cached tokens per turn, and Hemera keeps only the input
and output (`apps/desktop/src/engine/agents/client.ts:684-691`, `sessions/usage.ts`), so the cost
of reading a context back, most of a long session's cost, is invisible.

What I want:

1. A turn's usage keeps `cachedReadTokens` and `cachedWriteTokens` next to the input and output,
   in the schema, the database and the diagnostic log.
2. A mission's usage shows the share of its input that was read from the cache.

How to verify: a test with a fake agent that reports cached tokens finds them in the session's
usage; the diagnostic log shows them for a real turn.

### Draft: put what varies per session after the system prompt's cache boundary

The Claude adapter sends Hemera's instructions as one block, and the mission key is on their fourth
line, so a new mission writes the whole base and role layer again (about 2,900 tokens for a Probe,
measured in `docs/technical/prompt-cache.md`).

What I want:

1. The instructions are sent as blocks: the parts every session of a role shares (the base text
   without the mission key, the role layer), `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, then what belongs to
   the session (the mission key, the languages, the tester paragraph, the project layer).
2. The other adapters still receive one text, the same as today.
3. A session started before the change keeps its recorded prompt (`snapshot: true`).

How to verify: `probe.ts prefix` shows a session of another mission reading all but its own part;
a unit test shows the blocks and the boundary in the options `claude.bareOptions` builds.

### Draft: keep a session's tools fixed across its restarts

The tools granted to a session are computed at each process start from the tester-mode preference
(`apps/desktop/src/engine/tools/index.ts:126,142`), while its instructions are kept from its first
start. Turning tester mode on or off changes the tool list of an idle session at its next start:
the whole cached conversation is lost, and its tools disagree with its instructions.

What I want:

1. A session keeps the tester tools it started with until it is replaced or compacted.
2. The commands of the resources in the Probe brief are read in a fixed order
   (`apps/desktop/src/engine/resources/declarations.ts:48-57`).

How to verify: a test turns tester mode on between two starts of the same session and finds the
same tool list; a test builds the Probe brief twice over rows returned in another order and finds
the same text.
