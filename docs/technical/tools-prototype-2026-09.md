> The note on the maintainer's prototype of 22 September 2026 (`acp-chat`), compared with #18, kept as it was written.

# acp-chat prototype vs #18: tools, commands, permission classifier

Written 2026-09-22. Sources: prototype `D:\Projects\hemera\inbox-2b\acp-chat` (8 commits, `6aba157`..`06975c7`; `P:` below = `src/main/`), branch `feature/18-agent-tools` in `D:\Projects\hemera\wt-18` (`B:` = `apps/desktop/src/engine/`), issue #18 (D6-01..D6-12, Spec, Decided), PR #50 comments, `docs/technical/bare-mode-2026-09.md` (read from `d013a06`), docs.typesafe.ai (fetched 2026-09-22).
Not re-run here: the prototype has no `node_modules`, so its tests and smoke scripts were read, not run. Its behaviour below comes from the code and tests.

## 1. What the prototype shows working

**Bare Claude Code + MCP loop.** One `claude-agent-acp` process. Each `session/new` carries `_meta.claudeCode.options` with `tools: []`, `settingSources: []`, `strictMcpConfig: true` (`P:acp/agent-host.ts:142-144`) and one `http` MCP server with the bearer in `headers` (`agent-host.ts:133`). The server is loopback, stateless (a fresh `McpServer` and transport per request, `P:mcp/server.ts:93`), and it refuses any request with an `Origin`, a non-127.0.0.1 `Host`, or a wrong bearer (`server.ts:54-56`). A gate `deny` goes back as an MCP `isError` result that the model reads (`server.ts:84`). `scripts/tools-smoke.ts` runs five turns end to end on haiku: list tools, grep+read, edit, background server with its port, kill. It auto-allows every prompt (`tools-smoke.ts:52`), so it proves the loop, not the gate.
Two choices differ from #18 and matter:
- The CLI keeps the **real** `CLAUDE_CONFIG_DIR`, "that is where its login lives" (`agent-host.ts:151-152`). Only the adapter gets a temp dir (`:95`).
- `MCP_TOOL_TIMEOUT` is set to 10 min "because tool calls may wait on the user's permission answer" (`agent-host.ts:153-154`).

**Tool semantics.**
- `bash`: `/bin/bash -lc` in its own process group (`P:processes/registry.ts:45-47`). Default wait is 30 s, max 10 min (`P:tools/bash.ts:5-6`). `background: true` returns at once (`:40`). A foreground command still running at the timeout is left in the background with its output so far (`:47`); the model is never blocked or killed on a slow check. The result carries the last 30 KiB (`:8`). A non-zero exit becomes an MCP error that includes the output (`:51`).
- `output`: status, exit code, listening ports, run time, then the last `tailBytes` (default 16 KiB) (`P:tools/output.ts:4,29`).
- `kill`: kills the whole group (`P:tools/kill.ts:19`).
- `read`: line-based with numbered lines. Default 2000 lines, `offset`/`limit`, 10 MB cap, refuses binaries through a NUL probe (`P:tools/read.ts:6-7,78`).
- `write`: whole file, creates the folders it needs.
- `edit`: exact `old_string`. Zero matches is refused. More than one match is refused unless `replace_all` is set, and the refusal gives the count. An identical old/new is refused (`P:tools/edit.ts:25,39-42`).
- `grep`: `@vscode/ripgrep --json` (`P:tools/grep.ts:31`) with regex, `glob`, `ignore_case` and every level of `.gitignore`. Default 100 matches, max 500, each line cut at 300 chars (`:8-10`). Exit 1 means "No matches." (`:68`). Caveat: it kills rg at the cap (`:57`), so the "N more matches not shown" count (`:59`) only counts lines already buffered. It is a race, not a total.

**Process registry.** Per process: a 256 KiB in-memory ring (`registry.ts:11`), a full log file under `tmpdir()/acp-chat/processes/<id>.log` (`:38`), and stdout and stderr merged in arrival order (`:62-63`). Ports are found by polling every 1 s (`:14,69`): `/proc/net/tcp{,6}` LISTEN inodes are matched against `/proc/<pid>/fd` for the whole process group, minus the app's own sockets (`P:processes/ports.ts:17,34`). Linux only (`ports.ts:9`). To kill: SIGTERM to `-pid`, then SIGKILL after 2 s (`registry.ts:16,181`). `killAll` runs at quit (`P:index.ts:151`). UI events are batched every 80 ms.

**Gate, three stages** (`P:permissions/gate.ts`):
1. Tools. `read/grep/output/kill` are allowed as "read-only" (`:12`). `write/edit` are allowed inside the cwd and ask outside it (`:67`).
2. `bash` goes through `classifyCommand` (`P:permissions/rules.ts:94`):
   - A regex deny-list: rm -rf on / ~ $HOME .., mkfs, dd to a device, fork bomb, writes to ~/.ssh ~/.gnupg /etc, curl|sh, force-push to main, shutdown, killall… (`:10`).
   - A tokenizer that sends to review any `$`, backtick, subshell, redirection or heredoc, any assignment prefix, and any escape hatch (eval, exec, sudo, xargs, sh/bash…) (`:48`).
   - Otherwise a per-segment allow-list: cat/ls/grep/…, git read-only subcommands, `sed -n 'N,Mp'`, `find` without -exec/-delete, `<tool> --version` (`:41-92`).
   - 35 review cases, 25 deny cases and 15 allow cases are tested (`rules.test.ts`).
3. On `review`: first the "remembered" set, an exact `tool+JSON(input)` match that lives in memory and exists only for `bash` (`gate.ts:79,106`). Then the judge (`:83`). Then the user through `PermissionCard` (Allow / Allow & remember / Deny), which times out to deny after 10 min (`:8,97`).

**Judge contract** (`P:permissions/judge.ts`). `judge(request, rulesReason) → {decision: allow|ask|deny, by: "judge", reason}`. The request is tool, input, cwd and the last 5 user messages (`P:index.ts:28`), never tool results (`types.ts:10`). Any failure falls back to `ask` (`judge.ts:153`).
- `SessionJudge`: a bare Claude session with `JUDGE_SYSTEM_PROMPT` (`:10`). It keeps the last JSON object of the reply. Model haiku, one long-lived session, calls run one at a time (`P:index.ts:60-75`).
- `JevJudge`: POST to `JEV_URL` (`:27`) with `jev-latest`, a 10 s timeout (`:28`) and four questions:
  - `risk`: a score on 4 levels.
  - `approval`, `user_requested`, `from_untrusted`: nouls.

  The thresholds are deny if `risk ≥ 2.5` or `untrusted ≥ 0.7`, and ask if `risk ≥ 1.5` or `approval ≥ 0.75` while `user_requested < 0.6` (`:107-108`).
  - 16 unit tests with a faked fetch and session (`judge.test.ts`).
  - The last commit wires the real API and loads `.env` (`P:index.ts:20,44`).
  - No recorded run shows its real verdicts or latency.

## 2. Tool-by-tool against #18 (D6-03)

| #18 tool | Prototype | Better in the prototype | Better in #18 | Carry over into #18 |
|---|---|---|---|---|
| `fs.read` (bytes, 256 KiB page, `B:tools/catalogue.ts:422-456`) | `read` (lines) | Numbered lines and line offset, which is what `fs.edit` needs to quote text exactly. Binary refusal. A size cap. | Byte cursor that is correct on UTF-8 boundaries (`:433-437`). Provenance. realpath containment (`B:tools/paths.ts:167-175`; the prototype has no realpath, so a symlink inside the root escapes it, `read.ts:86`) | Add an optional `lines: {from, count}` mode with numbered output, and a NUL-probe refusal. Keep bytes as the cursor. |
| `fs.edit` (exactly once, `catalogue.ts:485-491`) | `edit` + `replace_all` | `replace_all`. "Identical old/new" refused. | Idempotency key. Matches the Spec as decided. | Keep "exactly once" (Decided 9). Add the identical-text refusal. `replace_all` needs the maintainer's call (outside Decided 9). |
| `fs.write`, `fs.list` | `write` / none | — | Key, provenance, listing | Nothing to take. |
| `search` (substring, case-insensitive, 200 matches / 1 MiB, cursor; `B:tools/search.ts`) | `grep` via ripgrep | Regex, glob, nested `.gitignore`, speed | A cursor, and a scan budget that is declared (D6-04). No binary. | Keep D6-04 now, as decided. Fix three gaps the prototype exposes: (a) the whole file list is walked before the budget applies (`search.ts:71`), so a huge tree is unbounded; (b) only the root `.gitignore` is read and `!` negations are dropped (`:223`); (c) no regex. Put `@vscode/ripgrep` behind the same port in a later lot. It is a per-platform binary; its packaging (download at install, asar unpack) is not checked here, and it goes against the maintainer's "nothing to install, no external ripgrep" comment on #18. |
| `commands.run` (catalogue name or one-off `line`, `catalogue.ts:583-636`; runner `B:commands/service.ts`) | `bash` | Shell semantics (pipes, quotes, env, `&&`). Wait-then-background: a `check` returns its exit code in one call. `timeout`. Stderr since day one. | One process owned by Hemera and shared with the panel. An `app` is joined, not started twice (`service.ts:518`). Scoped per Session. Rows survive a restart. Key. | (1) **Wait semantics**: `run` returns immediately (`service.ts:611`), so a `check` needs polling. Add `wait_ms` (default ~30 s, max 10 min) that returns on exit or on timeout with the run left going, as the prototype does. (2) **Argument parsing**: `line.split(/\s+/)` (`service.ts:549`) breaks quoted arguments (`git commit -m "a b"`) and, with no shell, cannot start `.cmd` shims on Windows (`pnpm test`, `npm run`). The `shell: win32` fix of `532aaae` is only in `B:agents/installer.ts:135`. Decide between a shell per platform and a real argv parser plus `.cmd` handling. (3) **Permission**: see below. |
| `commands.output` (tail 200 lines, 64 KiB kept, `service.ts:48`) | `output` + `tailBytes` | Tail size set by the caller. Ports in the status. | Bounded storage, `dropped` counted, readable after exit | Add `tail` as a parameter. Show detected ports in the same line as the URL. |
| `commands.stop` (by tree: taskkill `/T /F` on Windows, `B:agents/supervisor.ts:303`; group on POSIX) | `kill` | — | Works on Windows. 5 s grace. Session-scoped. The prototype's `kill` and `output` accept any id of any session (`P:tools/kill.ts:16-19`, one context `sessionId: "app"`, `P:index.ts:132`). | Nothing. #18 is ahead here. |
| URL detection: `https?://localhost:<port>` only (`packages/core/src/domain/commands.ts:98`) | Port polling through `/proc` | Catches servers that print nothing, or print 127.0.0.1/0.0.0.0/[::1] | Portable | Widen the regex to 127.0.0.1, 0.0.0.0 and [::1], and strip ANSI first. Add port polling as a Linux enhancement. On Windows it would need `netstat -ano`/`GetExtendedTcpTable`, which the prototype does not show. |
| `project.get`, `session.get` | none | — | Business reads | — |
| Idempotency, provenance | none; `console.log` of every verdict with the full command (`P:index.ts:51`) | — | `hemera_tool_call` entry and a Journal event with caller digest and timing (`catalogue.ts:222-274`) | — |

**MCP server and adapters.**
- #18 puts the token in the URL query (`B:tools/server.ts:190`). The PR comment says this is because ACP makes `headers` mandatory, but the prototype shows `headers: [{Authorization}]` works over ACP (`agent-host.ts:133`). **Recommendation: send the bearer header and drop `?t=`.** A URL ends up in agent configs and logs.
- D6-01 names `localhostOriginValidation`, but the branch only calls `localhostHostValidation` (`server.ts:162`). The prototype's `Origin` refusal is one line (`server.ts:54`).
- **Claude login.** `B:agents/adapters/claude.ts:79` moves `CLAUDE_CONFIG_DIR` to a Hemera-owned folder. The same file says the login is `.credentials.json` inside that folder (`claude.ts:45-47`). The prototype avoided exactly this. **Recommendation: phase 3 must prove a subscription login survives.** Otherwise keep the user's folder and rely on `settingSources: []` + `strictMcpConfig: true` + `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, and let D6-09 report `~/.claude.json` as residue.
- `MCP_TOOL_TIMEOUT` is set nowhere on the branch, while `ToolPermissions.askOutside` waits "for as long as they take" (`B:tools/permissions.ts:36`). What Claude Code's default does to a pending human answer is not established here. Set it in `_meta.claudeCode.options.env` as the prototype does, and check the equivalent on OpenCode and Codex.

**The reviewer's finding holds.** In `catalogue.ts:601-606`, a one-off `line` with no `folder` runs in the root without any question. D6-05 checks only the working folder, never what the command touches: `rm -rf /home/kris/…` or `curl … -d @~/.ssh/id_rsa` as a one-off line run unasked. The shell escape does not stop it, because the argv is spawned directly. In the prototype the same call reaches the rules and then review.

## 3. The classifier question

**What rules + judge add over the Workspace-root rule.** D6-05 is one test on a path. It cannot see:
- what a command does (the finding above);
- deny-grade actions inside the root (`git push --force origin main`, `rm -rf .git`);
- intent ("did the user ask for this?");
- planted instructions.

The prototype's stage 2 tells read-only from unknown commands deterministically and at no cost. Stage 3 grades the rest, so the human is asked only when it matters. Because all three agents are bare and every action goes through Hemera's MCP catalogue, **a classifier in `ToolCatalogue.call` is by construction one classifier for Claude, Codex and OpenCode**. No per-agent work is needed, which is the maintainer's "one unified thing".

**Where it plugs in.** A `Classifier` port `(session, tool, parsed args, intent) → {decision, by: rules|judge|user, reason}`, placed in `catalogue.ts` between `parseCall` and `perform`:
- The D6-05 root rule becomes one rule of stage 1.
- `ask` raises the existing D5-09 block (`permission_request` / `permission_decision` rows, `OUTSIDE_OPTIONS` allow_once/reject_once, `catalogue.ts:58-61,321-366`), with `by` and `reason` added to the payload so the thread shows why.
- `deny` becomes a `refused` outcome with its reason. It is already recorded like any call (`catalogue.ts:299-300`).
- Catalogue commands are written by the user, so a classifier would only look at one-off lines (and the paths of `fs.*`).
- POSIX rules do not cover Windows (`del /s`, `rd /s /q`, `Remove-Item -Recurse`, `format`). A Windows rule set is new work.

**Jev (typesafe.ai "System One").**
- What it is: a decision model, not a chat model. You send a `state` and typed questions (choice / score / noul) and get calibrated numbers back; score and choice answers also carry a `confidence` (docs.typesafe.ai/api). It is "not a drop-in replacement for the LLM behind Claude Code" (/introduction/coding-agents).
- Model: `jev-1.13.0`. `jev-latest` is an alias that moves, and TypeSafe advises pinning a version once thresholds are tuned (/models).
- Price: $0.042 per Mtok of input, output free (/models). A prototype request is a few hundred tokens, so about $0.00002 per verdict.
- Limits: 1,200 requests/min and 250k tok/s, "adjusting dynamically" (/models). 32k tokens of `state`.
- Latency: the homepage shows "Completed in 0.114s". The prototype never measured it and allows 10 s.
- Data: account data falls under a DPA ("retained for as long as necessary"). Zero data retention is for enterprise only (/legal). There is no offline or self-hosted mode in the public docs.
- Offline behaviour in the prototype: `ask` (`judge.test.ts` "asks when the call fails").
- Keys: `TYPESAFE_API_KEY` from `.env` in the process cwd (`P:index.ts:20,43`). Hemera would need `safeStorage` and a setting.
- What it sees: tool, raw input (command text, file contents of a `write`), absolute cwd (the user name), the last 5 user messages. It never sees tool results.
- Gaps: it ignores `rulesReason` and the `confidence` field. `from_untrusted` is asked without the content that could have planted anything, so it is a guess.
- Upside: it does not depend on the agent, so it is the same for every model.

**Haiku session judge.**
- Needs no new vendor, key or bill: it uses the user's Claude login.
- It exists only when Claude Code is installed and signed in, so a Codex- or OpenCode-only user has no judge. Running the judge on the Session's own agent would split the classifier by model.
- Cost is subscription usage, a whole agent turn per verdict: seconds, not measured.
- `ask()` has no timeout (`judge.ts:131`), and one judge queue serves every Session (`P:index.ts:60-66`).
- It is **one persistent session** (`index.ts:72-74`), so past cases and any injected text stay in its context.
- It reads free text, so the agent-written `Input:` line (`judge.ts:120-127`) can address it directly.

**Recommendation.**
- **In #18, now:** only the deterministic part. Take a one-off `commands.run {line}` out of the auto-approve path:
  - send it through a port of `rules.ts` (deny-list → refused, read-only allow-list → allowed, anything else → the D5-09 block);
  - or, simpler, always ask for a one-off line (D6-12 already makes it visible in the thread).

  Either one changes D6-05 as decided ("commands inside the root are auto-approved"), so the maintainer must say which, in the issue.
- **Judge (Jev or Haiku) later, as its own lot**, after #18 ships and the agents run bare on Windows. It brings a vendor or subscription dependency, a privacy statement, thresholds nobody has calibrated, and a logging format. None of that is decided, and none of it blocks #18.
- **Not "not at all"**: the finding shows the root rule alone is not a safety model.

**Decisions for the maintainer.**
1. One-off lines in #18: always ask, or rules then ask?
2. Which judge: Jev (same for every model, third party, key, sends command text and user messages off-machine), Haiku (Claude users only), or none. It must be opt-in per machine either way.
3. What the rules allow by default. The prototype's allow-list includes `cat`, `grep` and `git -C` on **any** path, `env` (`rules.ts:70`, `rules.test.ts:15,22`), and `ps`/`du`/`df`. That is wider than D6-05's root rule. Should allow also require "inside the root"?
4. "Remember". Prototype semantics: exact input, bash only, in memory for the process, all Sessions. D6-05 says nothing "always" is memorised, so: forbidden, per Session, or per Project and shown in the settings?
5. What is logged: the verdict (`by`, `reason`, scores) in the thread entry and Journal? The judge's input? Never the key, and never the full command text sent to a third party without the user knowing?
6. Whether the judge sees user messages at all, and how many.

## 4. Risks the prototype ignores and Hemera cannot

- **Windows.**
  - `/bin/bash -lc` does not exist (`registry.ts:45`), and `-l` sources the user's profile.
  - `process.kill(-pid)` is POSIX-only (`registry.ts:181`). The port finder reads `/proc`.
  - `resolveInCwd` compares case-sensitively on a case-insensitive filesystem and never realpaths, so junctions and symlinks escape (`read.ts:86`).
  - The branch has its own Windows gap: no shell, so `.cmd` shims such as `pnpm`/`npm`/`npx` do not start (`service.ts:549`).
- **Secrets on disk and in the environment.**
  - Every command's full output is written to `tmpdir()/acp-chat/processes/*.log` (`registry.ts:38`). It is never deleted and has default permissions; `tmpdir()` is shared on Linux.
  - Children inherit `process.env`, including the `TYPESAFE_API_KEY` loaded from `.env` (`index.ts:20`; `spawn` without `env`, `registry.ts:45`), and bare `env` is on the allow-list. So the agent can print the judge's key without any prompt.
  - With the default `ACP_CWD` (the app's cwd), `.env` is inside the workspace and `read` is auto-allowed.
  - The gate logs full commands to stdout (`index.ts:51`).
- **The judge sees user messages and commands.** Jev sends them to a third party. Neither judge redacts tokens in commands (`curl -H "Authorization: …"`). The Haiku session keeps all of it in one context.
- **Prompt injection.**
  - Tool results reach the model with no marking. The judge never sees them, so `from_untrusted` cannot actually detect a planted instruction.
  - The agent writes the judge's input. For `SessionJudge` it is inlined free text, and the persistent session lets a poisoned case bias later ones.
  - The read-only allow-list can read outside the root (`cat ~/.ssh/id_rsa` is "allow"), so an injected "read and print" gets past everything.
  - #18's root rule would ask for `fs.read` outside the root, but not for a one-off `cat` line.
- **Auto-approval at the ACP layer.** The prototype approves every ACP `requestPermission` whenever a tool server is set (`agent-host.ts:117`). #18 must check that the adapters do not also send ACP permission requests for `mcp__hemera__*` calls, which would ask twice or bypass D5-09.
- **Host check.** `startsWith("127.0.0.1")` also accepts `127.0.0.1.attacker.tld` (`server.ts:55`). The bearer and the `Origin` refusal cover it. The branch uses the SDK validator instead.
