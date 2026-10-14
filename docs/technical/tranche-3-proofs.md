# The real-system proofs of tranche 3

Tranche 3 (Building) was merged on tests with a fake agent, temporary Git repositories and fake
`gh` and `bkt`. Each ticket also asked for one proof on the real system, and none was done: the
closing comments leave them to the maintainer. This note lists them, once, with steps a person can
follow on a real machine. #314 plans the proof of the end of a Building (B9) in this same file: it adds
its own section here, and this note leaves it that room.

**Nothing here is run by an agent**: no real agent, no real `gh` or `bkt`, no real repository. The
maintainer runs it, on a temporary profile, and writes the results in the tables below.

| Proof | Issue                   | What it proves                                                 | OS               | Real agents      | Needs                           |
| ----- | ----------------------- | -------------------------------------------------------------- | ---------------- | ---------------- | ------------------------------- |
| B1    | #139                    | The pre-launch check, the launch and the preparation           | Linux, Windows   | one (Planner)    | Ready page (#151)               |
| B2    | #140                    | The history of a mission survives the cleanup of its Workspace | Windows          | one (Builder)    | Building page (#151)            |
| B3    | #141                    | The Builder runs the tasks and resumes after a restart         | Linux            | Claude Code      | Building page (#151)            |
| B4    | #142                    | A kill during a real command; a formatter beside other writes  | Linux, Windows   | one (Builder)    | Building page (#151)            |
| B5    | #143                    | The checks on Windows: `.cmd` shim, coverage, Cancel           | Windows          | one (Builder)    | Building page (#151)            |
| B7    | #145                    | Helpers at depth 2 and the Prototyper on the three agents      | Linux            | all three        | Building page (#151)            |
| B10   | #148                    | Changes outside Hemera and the mission's services              | Linux, Windows   | one (Builder)    | Building page (#151)            |
| A9    | #40 (CT-15)             | A long Building on Codex and OpenCode, past 80 % of the window | Linux            | Codex, OpenCode  | Building page (#151)            |
| R4    | #253                    | The forge port over the real `gh` and `bkt`                    | Linux, Windows   | none             | Part A now; part B waits (R12)  |

B9 (#314, the end of a Building with both reviewers) is not repeated here: #314 writes its section
in this file. B6 and B8 are not in this note either: their tickets asked for no proof on the real
system.

## 0. Read this first

### What can be run today

The engine of all these proofs is merged, but **no screen shows a Ready or a Building mission yet**:
the pages of #151 (designed in #149) do not exist, and a stage with no page shows an empty base
with its name. So:

- everything that checks a mission, launches it, watches its tasks, cancels it or starts its
  services is written below in terms of the **Ready page** and the **Building page**, with the
  buttons and sentences the tickets give (Build, Launch, Launch anyway, Back to Planning, Check
  again, Retry, Cancel, Start, Stop, Restart). If the design of #149 names one differently, follow
  the screen and correct this note in the same pull request;
- those proofs wait for #151 to merge. They are written now so that nothing waits for this note
  the day it does;
- part A of R4 needs no screen and can be run today.

What the window already shows, and what the steps lean on beside the pages:

- the **Journal** of a mission, and the same lines in `<data folder>/missions/<KEY>/journal.md`
  (`<KEY>` is the mission key, `ACME-1`);
- the **diagnostic log**, `<data folder>/diagnostic.log`: Settings › Developer › show the log;
- the **Needs you** of a mission and of Home;
- the **Settings of the Project**: Repositories, Workspaces, Commands, Preparation, Variables,
  Services, Models by role, Cap and budget, Instructions, Tickets and Specs, Exclusive resources,
  Checks, Documentation;
- the **disk**: the Workspaces folder of the Project, the snapshot store
  `<data folder>/snapshots/<project-id>.git`, and Git itself.

There is no window for the ACP traces: their preference exists in the engine but no switch turns it
on yet. Where a step would read a trace, "not observed" is an acceptable answer.

### Rules for every proof

1. **A temporary profile, always.** Start Hemera with `--user-data-dir=<scratch>/profile-<name>`
   (see "Starting Hemera"). The first line of `diagnostic.log` says `data folder <path>`: read it
   before anything else, and stop if it is not the temporary folder. Never your real profile.
2. **Neutral data only.** The Project is Acme, with repositories `api` and `web`, built by the
   script in "The Acme fixture". Never a repository of your own or of work. The only exception is
   B2, which uses a throwaway **copy** of a public repository, and R4, which uses the CLIs you are
   signed in with.
3. **Real accounts, real quota.** A real agent costs real tokens. Run the proofs one at a time, in
   the order of the table at the end of this section, and stop an agent that loops (Cancel the
   mission).
4. **Write down what happened, not what was expected.** Each proof ends with a table with an empty
   `Result` column. Fill it with what you saw, with versions. A failure is a result: write
   "failed" and what failed, then open **one issue per failure** (`fix(building): …`) naming the
   proof and the step. A step you could not run is "not run" with the reason, never left empty.
5. **Record in this file, in a pull request** that only fills the tables (`docs(building): record
   the real-system proofs of …`). The tables carry no account name, login, host name, path of your
   machine or token: write "matches" or "does not match" where a login would go.
6. **Versions to note in every table**: Hemera (the commit of `feature/1.0` you built, and the
   channel), the OS, Git, Node, and each agent's version (`claude --version`, `codex --version`,
   `opencode --version`).

### Starting Hemera

From a checkout of the commit under test (note its `git rev-parse --short HEAD`), on each OS:

```
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @hemera/desktop dev --user-data-dir=<scratch>/profile-b1
```

or, to run what a user runs, `pnpm package` (the portable package lands in `dist/package`) and start
that application with the same `--user-data-dir=<scratch>/profile-b1` argument. Start it from a
terminal in which `git`, `node`, `pnpm` and the agents resolve (an Electron started from a desktop
icon may lack `~/go/bin` or `~/.local/bin`). Never two Hemera on one profile; one profile per proof
(`profile-b1`, `profile-b3`, …) so that a proof starts clean.

The first start of a new profile runs the first-launch setup: connect the agent(s) the proof names
(Settings › Agents), and give them the account you use for them.

**Finding the process to kill.** Several steps cut Hemera hard. Its main process is the one with your
profile argument and without `--type=`:

```
# Linux
ps -eo pid,args | grep -- "--user-data-dir=<scratch>/profile-b1" | grep -v -- "--type=" | grep -v grep
kill -9 <pid>

# Windows (PowerShell)
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*--user-data-dir=<scratch>\profile-b1*' -and $_.CommandLine -notlike '*--type=*' } |
  Select-Object ProcessId, CommandLine
Stop-Process -Id <pid> -Force
```

A "normal quit" is the one you use every day. After either, check that no process with your profile
argument remains before starting again.

### The Acme fixture

One script makes the two repositories and their bare remotes, the same on Linux and Windows. Save it
**outside any repository** (in `<scratch>`, next to the folders it makes) and run it with
`node make-acme.mjs <scratch>`.

```js
// make-acme.mjs <scratch>: Acme's api and web, each with a bare remote named <name>-remote.git.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const scratch = resolve(process.argv[2])
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'inherit' })
const write = (file, text) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

const SERVER = `// A dev server that prints its URL the way Vite does, with a child process of its own.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
const port = Number(process.env.PORT ?? 5199)
createServer((_, response) => response.end('Acme web\\n')).listen(port, () => {
  console.log('  ➜  Local:   http://localhost:' + port + '/')
})
`
const PAUSE = `// node scripts/pause.js <seconds>: waits, so a slow command leaves a window to act in.
setTimeout(() => {}, Number(process.argv[2] ?? 20) * 1000)
`
const MIGRATE = `// A "migration": notes each start in a file outside the repository, then takes 90 seconds.
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const log = join(tmpdir(), 'acme-proof-migrate.log')
appendFileSync(log, 'started ' + new Date().toISOString() + '\\n')
setTimeout(() => appendFileSync(log, 'finished ' + new Date().toISOString() + '\\n'), 90_000)
`

for (const name of ['api', 'web']) {
  const work = join(scratch, name)
  const remote = join(scratch, `${name}-remote.git`)
  write(
    join(work, 'package.json'),
    JSON.stringify(
      {
        name: `acme-${name}`,
        private: true,
        type: 'module',
        scripts: {
          test: 'node --test',
          lint: 'node -e "process.exit(0)"',
          build: 'node -e "console.log(\'built\')"',
        },
      },
      null,
      2,
    ) + '\n',
  )
  write(join(work, 'src', 'notes.js'), `export const notes = () => ['first note', 'second note']\n`)
  write(
    join(work, 'test', 'notes.test.js'),
    `import { test } from 'node:test'\nimport assert from 'node:assert'\nimport { notes } from '../src/notes.js'\n\ntest('notes lists two notes', () => assert.equal(notes().length, 2))\n`,
  )
  write(join(work, '.gitignore'), '.env\nnode_modules\n')
  write(join(work, '.env.example'), 'ACME_SETTING=\n')
  write(join(work, '.env'), 'ACME_SETTING=not-a-secret\n')
  write(join(work, 'scripts', 'pause.js'), PAUSE)
  if (name === 'api') write(join(work, 'scripts', 'migrate.js'), MIGRATE)
  if (name === 'web') write(join(work, 'scripts', 'serve.js'), SERVER)
  git(work, 'init', '-q', '-b', 'main')
  git(work, 'config', 'user.name', 'Acme Proof')
  git(work, 'config', 'user.email', 'proof@acme.test')
  git(work, 'add', '.')
  git(work, 'commit', '-q', '-m', 'chore(repo): start Acme ' + name)
  git(scratch, 'init', '-q', '--bare', '-b', 'main', remote)
  git(work, 'remote', 'add', 'origin', remote)
  git(work, 'push', '-q', '-u', 'origin', 'main')
}
```

Then, in Hemera (on the temporary profile):

1. **Add the Project** "Acme" with the two repositories `<scratch>/api` and `<scratch>/web`; the
   delivery remote of each is `origin`, its base branch `main`.
2. **Settings › Workspaces**: set the Workspaces folder to `<scratch>/workspaces`.
3. **Settings › Commands**: the catalogue lines the proofs name, added as they are needed:
   `test` (`npm test`, in each repository), `lint` (`npm run lint`), `build` (`npm run build`),
   `migrate` (`node scripts/migrate.js`, in `api`), `serve` (`node scripts/serve.js`, in `web`).
4. **Settings › Models by role**: the Planner and the Builder on the agent the proof names.

**The reference mission.** Most proofs need a mission that is **Ready**, which means a real Planner
run and a Freeze. In the start field, create a mission in Acme with this description:

> Add a Markdown export of the notes. In `api`, `src/notes.js` gets `toMarkdown()` (a bullet list
> of the notes) and `toNumberedMarkdown()` (a numbered list); both change that same file. In `web`,
> a new `src/export.js` calls `toMarkdown()` and returns the text. Each function has a test.

Answer the Planner's questions, then check the Spec **before** Freeze: it must have **three tasks or
more, at least two of which target `api/src/notes.js`**, and one in `web`. If it does not, tell the
Planner what is missing. The proof is about the tasks, not about the feature; a Spec without these
tasks proves less. Each proof below names the extra the Spec must have (a task that runs `migrate`,
a task that runs `format`, …): ask the Planner for it in the same way. Freeze. The mission is Ready.
Keep its key (`ACME-1`) in the table.

### The order

1. R4 part A (no Hemera, no agent).
2. B1 (one Planner run, no Builder cost beyond the start).
3. B5, B10, B4 (one Builder, short missions), on Windows, then Linux for B4 and B10.
4. B2 (needs a larger repository), B3, B7, A9 (the long ones, the most tokens).

---

## B1 · #139 — the pre-launch check and the launch

**What it proves.** On a real remote and real Git, the check lists what moved since the Freeze;
offline it says "not fetched since" and does not block; the launch builds the Workspace from the
commit the check read, copies an environment file and runs a recipe step; a preparation cut by a
quit or a kill resumes by itself, once. The tests prove this with temporary folders; this proof is
the first one with the real application, the real Git of each OS, and a real Planner session for the
check's agent.

**Needs.** Linux and Windows. One agent for the Planner (Claude Code is enough). The Ready page.

**Set up (once per OS).**

1. Acme and the reference mission, **Ready** (see 0). Settings › Models by role: Planner on the
   agent you chose. The Builder can be any agent: a Builder is started at the end of each launch and
   you will Cancel it (B1 is not about it).
2. Two more **tiny** missions, each Ready with one task ("add a comment line to `api/src/notes.js`"),
   for C and D below: a launch that reaches Building cannot be launched again, so each cut in the
   middle of a preparation needs a mission of its own.
3. **Settings › Preparation**, a recipe of two steps, in this order:
   1. copy `.env` from the main checkout of each repository into its worktree;
   2. a command that fails on purpose for now: `node -e "process.exit(1)"`.
4. Note `git --version` and `git -C <scratch>/api rev-parse origin/main` (call it `BASE0`).

**Steps.**

*A. The check, online, with something moved* (reference mission).

1. In a second clone, make the base move after the Freeze, then push it:

   ```
   git clone <scratch>/api-remote.git <scratch>/api-other
   # edit src/notes.js (any line a task of the Spec targets), commit, push
   # edit package.json (add a script), commit, push
   ```

2. On the Ready page, press **Build**. The check opens and runs.
3. See: the file you edited in `src/notes.js` listed as moved with its `+added −removed`; the mission
   carries the **outdated** mark; **Launch anyway** and **Back to Planning** are offered, and a
   plain Launch is not. The manifest change (`package.json`) is handed to the check's agent: the
   check may say "waiting for a free agent slot" briefly, then shows the agent's report, saying for
   each file whether it matters and why. Note both.
4. In the Journal: the lines of the check, one of them naming the agent's report.

*B. The check, offline* (same mission).

5. Rename `<scratch>/api-remote.git` to `<scratch>/api-remote-away.git`. Press **Check again**.
6. See: the check does not fail and does not block; `api` is read from its last known tracking ref
   and says **not fetched since** a date. Rename the folder back and press **Check again**.

*D. A step that fails* (same mission).

7. **Launch anyway**. Step 2 of the recipe fails.
8. See: a **Needs you** of the kind environment on the mission, with the failing step's words and
   **Retry**; the mission stays Ready and says "Preparation failed: step 2 of 2". The need says what
   stays on disk (the worktrees made so far).
9. Change step 2 of the recipe to a working one that takes a minute: `node -e "setTimeout(() => {}, 60000)"`,
   and press **Retry**. See: the recipe resumes at step 2 (the `.env` copy of step 1 is not made
   again), the Journal says "The Workspace is ready.", the mission is **Building**.
10. On disk, check there is one Workspace and one worktree per repository:

    ```
    git -C <scratch>/api worktree list
    git -C <scratch>/web worktree list
    git -C <scratch>/api branch --list
    ```

    Each shows one worktree under `<scratch>/workspaces`, on one branch named from the Project's
    branch prefix and a slug of the key and title (`…/acme-1-export-notes-as-markdown`). The `.env`
    exists in each worktree. The worktree starts from the commit the check read, **not** from the
    main checkout's:

    ```
    git -C <workspace>/api rev-parse HEAD
    git -C <scratch>/api-remote.git rev-parse main
    ```

11. **Cancel** the mission, confirm. See the Workspace removed and the branches deleted (the same
    three commands show nothing left).

*C. A quit, then a kill, in the middle of a preparation* (the two tiny missions).

12. Take the first tiny mission. Press **Build**, then **Launch** (or **Launch anyway**). While the
    page says "Preparing the Workspace (step 2 of 2)", you have a minute: **quit Hemera normally**.
13. Start Hemera again on the same profile. Do nothing. See: the preparation continues by itself and
    ends; the Journal says "The Workspace is ready." **once**; the mission is **Building**; the
    commands of step 10 show **one** worktree per repository. **Cancel** the mission.
14. Do 12 and 13 with the second tiny mission, but **kill** Hemera hard in step 12 (see "Finding the
    process to kill") instead of quitting. The result must be the same.

**Record.**

| OS | Git | Case | Expected | Result |
| -- | --- | ---- | -------- | ------ |
|    |     | A · targeted file moved | listed with `+/−`, outdated, Launch anyway + Back to Planning |  |
|    |     | A · manifest changed | handed to the agent, report names it, says if it matters |  |
|    |     | B · offline | "not fetched since", not blocking |  |
|    |     | C · quit in the middle of step 2 | resumes alone, "The Workspace is ready." once, Building |  |
|    |     | C · kill in the middle of step 2 | the same |  |
|    |     | D · failing step, then Retry | environment need with Retry; resumes at the failed step |  |
|    |     | D · base commit of the worktree | the commit the check read, not the main checkout |  |
|    |     | D · `.env` copied | present in each worktree, copied once |  |

Also write the Journal lines you saw in your own words if they differ from the ones quoted: they
feed the review of the wording.

---

## B2 · #140 — snapshots and checkpoints, on Windows

**What it proves.** CT-01: the history of a mission (every attempt's diff, every checkpoint) outlives
its Workspace. Hemera writes its snapshots into a Git object store of its own that borrows the
objects of your repository as an **alternate**; once the Workspace and its branch are gone and
`git gc --prune=now` has run, the borrowed objects are gone, and every diff must read back from
Hemera's own database, byte for byte. CI proves this with a small repository on Windows. What only
the real system shows is a real Windows checkout of thousands of files: its `core.autocrlf`
setting, long paths, the `;` that separates alternate object directories there, and how long a
snapshot takes. **Linux was done by hand in #156**, on a public repository of 7,252 files (Git
2.55.0): snapshots 32–39 ms, capture 49 ms, checkpoint 99 ms, read back 43 ms; this proof gives the
Windows column of the same table.

**Needs.** Windows. One agent as Builder (Claude Code is enough). The Building page, and the diff
view of an attempt.

**Set up.**

1. A **throwaway copy of a public repository** of a few thousand files (any open-source project
   with some history and a few images in it), never one of yours:

   ```
   git clone <public-url> <scratch>\big
   git clone --bare <scratch>\big <scratch>\big-remote.git
   git -C <scratch>\big remote set-url origin <scratch>\big-remote.git
   git -C <scratch>\big fetch origin
   git -C <scratch>\big ls-files | Measure-Object -Line
   git -C <scratch>\big config core.autocrlf
   ```

   Note the number of files, the Git version and `core.autocrlf` (empty means unset).
2. A Project "Acme" with that single repository `big`. Add to Settings › Commands a `test` command that just exits 0 (`node -e "process.exit(0)"`),
   so the Builder has nothing to wait for.
3. A mission in this Project, planned with the real Planner, whose Spec has **two tasks**, written so
   that the attempts hold what CT-01 lists: a text file modified, a **binary** file (a PNG) replaced,
   a file **deleted**, a file **renamed**, a new file whose name has a space, and `.env.local`
   created with the line `ACME_SETTING=not-a-secret` (a sensitive place: its content must never be
   copied). Say it in the description in those words; the Planner turns it into tasks. Freeze.

**Steps.**

1. Check, **Launch**, and let the Builder finish its two tasks. Go on to step 2 when the mission has
   reached **Review** (the review checkpoint is taken at its entry), or, if the Building does not
   get there, when both attempts are done.
2. **Before any cleanup, write down what Hemera shows.** For each attempt and for the checkpoint,
   open the diff view and save the file list with the status, `+added −removed` and size of each file
   (select, copy, paste in a text file under `<scratch>\before\`). Note that `.env.local` reads
   **content withheld: .env.local** with its path only.
3. The snapshot store exists and holds the trees:

   ```
   git --git-dir=<data folder>\snapshots\<project-id>.git for-each-ref refs/hemera/
   ```

   You should see `…/<attempt>/start`, `…/<attempt>/end` and `…/checkpoints/<id>` refs. (The
   `<project-id>` is the only `.git` folder in `snapshots`.)
4. **Time a snapshot by hand**, with the same steps Hemera uses (a copy of the index, `git add -A`,
   `git write-tree`), in the Workspace's `big` worktree. In PowerShell:

   ```
   $index = Join-Path $env:TEMP 'acme-proof-index'
   Copy-Item (git -C <workspace>\big rev-parse --git-path index) $index
   $env:GIT_INDEX_FILE = $index
   Measure-Command { git -C <workspace>\big add -A ; git -C <workspace>\big write-tree } | Select TotalMilliseconds
   Remove-Item Env:GIT_INDEX_FILE ; Remove-Item $index
   ```

   Run it three times and keep the three times.
5. **Make the borrowed objects real, then clean up as CT-01's test does.** Hemera does not commit
   during Building, so the worktree holds uncommitted changes and Git has nothing to collect. Commit
   them by hand in the Workspace, as the automated test does, and note the commit:

   ```
   git -C <workspace>\big add -A
   git -C <workspace>\big commit -m "proof"
   git -C <workspace>\big rev-parse HEAD
   ```

   Then **Cancel** the mission and confirm. Hemera removes the Workspace and keeps the branch (it
   moved since the launch; the Journal says it kept it). Delete the branch yourself, expire the
   reflog and collect:

   ```
   git -C <scratch>\big worktree list
   git -C <scratch>\big branch -D <the mission's branch>
   git -C <scratch>\big reflog expire --expire=now --all
   git -C <scratch>\big gc --prune=now
   git -C <scratch>\big cat-file -e <the commit you noted>
   ```

   The last command must **fail**: the commit and the objects it borrowed are gone from your
   repository, the base (committed in `main`) stays.
6. Open the same diff views again, attempt by attempt and the checkpoint. Save the same lists under
   `<scratch>\after\` and compare:

   ```
   fc /b <scratch>\before\attempt-1.txt <scratch>\after\attempt-1.txt
   ```

   They must be identical, the binary shows the same sizes before and after, the deleted file still
   shows its old content, the rename its two paths, and `.env.local` still reads "content withheld".

**Record.**

| What | Linux (#156) | Windows |
| ---- | ------------ | ------- |
| Git version | 2.55.0 | |
| Files in the repository | 7,252 | |
| `core.autocrlf` | | |
| Files changed: attempt 1 / attempt 2 / checkpoint | 41 / 2 / 41 | |
| Object gone after `git gc --prune=now` | yes | |
| Every diff identical after the cleanup, binary byte for byte | yes | |
| `.env.local` withheld (path and fingerprint only) | | |
| Snapshot time, 3 runs (ms) | 32–39 | |
| Whatever looked different on Windows | | |

If a diff differs after the cleanup, that is CT-01 failing: open the issue with the file, the side
(before or after), and the first differing bytes.

---

## B3 · #141 — tasks, claims and the Builder, with a restart

**What it proves.** A real Claude Code as Builder starts the tasks through `task_start` and nothing
starts on its own; two tasks that target the same file never run together; a write to a file another
running task holds is refused naming that task; and quitting Hemera in the middle of a task, then
starting it again, resumes the Building with no human action (a new Builder given the resume block,
the same task states, the attempt still open).

**Needs.** Linux. Claude Code, signed in, as the Builder (Settings › Models by role). The Building
page.

**Set up.** Acme and the reference mission, **Ready**, with three tasks or more, two of which target
`api/src/notes.js` (it is the shape of the reference mission). Check, then **Launch**.

**Steps.**

1. Watch the Building page from the launch on. See: the tasks that do not wait for another are
   **available**, none is **in progress** until the Builder calls `task_start`; a task becomes **in
   progress** only then, and two tasks that both target `api/src/notes.js` are never in progress at
   once: the second stays available, "held back by" the first, and starts once the first is done.
   Write down, in order, what each task did and when (the Journal's lines give the times).
2. A write to a file another running task holds is refused naming that task. You cannot ask the
   Builder to do it; if it tries, the Journal says it. Write down whether it happened. If a whole
   Building goes by without it, write "not provoked": that is a result, not a failure. (The test
   suite proves the refusal; this step proves it can happen with a real Builder.)
3. When one task is **in progress** (the page shows it, and its attempt open), **quit Hemera**, and
   once the process is gone, start it again on the same profile.
4. Do not touch anything. See, in the following minutes:
   - the Journal says "The Building resumed after a restart.";
   - a **new Builder session** is working (the Journal says the Builder's session was replaced or
     the sessions list shows a fresh one), it carries on with the task that was in progress;
   - the tasks keep the same states they had, nothing is started twice, and the attempt of the
     in-progress task is still the one open (not a second attempt for the same work).
5. Let the Building run until every task is done (the end of the Building belongs to B9, #314; stop
   here once the Journal says "Every task of the plan is done or skipped."), or until you have what
   you need and **Cancel**.
6. Check the repositories: no commit, push, merge or tag was made by the Builder (the Builder has no
   such tool; Hemera does not commit during Building).

   ```
   git -C <scratch>/api log --oneline -3
   git -C <workspace>/api status --short
   ```

**Record.** Agent and version, OS, and one line per step.

| Step | Expected | Result |
| ---- | -------- | ------ |
| 1 · nothing starts but through `task_start` | tasks available, started one by one by the Builder | |
| 1 · overlapping tasks | never in progress together; the second waits and is delivered after the first | |
| 2 · write refused by a claim | refused naming the holder (or "not provoked") | |
| 3–4 · restart in the middle of a task | resumes alone; new Builder with the resume block; same states; attempt still open | |
| 5 · no commit or push by the Builder | none | |

---

## B4 · #142 — a kill during a real command, and a formatter beside other writes

**What it proves.** When Hemera is cut during a **real command** of a Building, the resume does not
run the command again and does not guess: the result is **indeterminate**. A command declared on an
**exclusive resource** (a migration) opens a decision need asking whether it ran; a plain command
tells its runner to check the real state. And a **real formatter** running in a repository makes the
other tasks' writes in it wait, then go through, with its changes attributed to the task that ran it.

**Needs.** Linux and Windows. One agent as Builder. The Building page.

**Set up (per OS).**

1. Acme. In `web`, install a formatter so the proof uses a real one, and push it:
   `npm install --save-dev prettier`, commit `package.json` and the lockfile (not `node_modules`),
   push to `origin`. Run `npx prettier --version` once by hand.
2. **Settings › Commands**:
   - `migrate`: `node scripts/migrate.js`, in `api` (it notes each start in
     `acme-proof-migrate.log` under your temporary folder, then takes 90 s);
   - `build`: `node scripts/pause.js 60 && npm run build`, in `api` (the pause gives time to cut it);
   - `format`: `node scripts/pause.js 20 && npx prettier --write src`, in `web`, with **no declared
     write globs** (the 20 s pause only widens the window).
3. **Settings › Exclusive resources**: a resource "Acme database" whose commands are `migrate`; no
   reset command. (Answer the question Hemera asks at the start of the Building about reserving it:
   confirm.)
4. Delete the log from earlier runs: `acme-proof-migrate.log` in the system temporary folder.
5. A Ready mission whose Spec has, besides the reference tasks: a task in `api` that **runs
   `migrate`**, a task in `api` that **runs `build`**, and two independent tasks in `web` of which
   one **runs `format`** at its end.

**Steps.**

*A. A kill during a migration on an exclusive resource.*

1. Launch. When the Building page shows the migrate task **in progress** and its command running
   (the log has a `started` line and no `finished` one), **kill Hemera hard**.
2. Check the migration process is a left-over and see what Hemera does about it: after you start
   Hemera again (same profile), the left-over process is ended by Hemera at its start (no `node
   scripts/migrate.js` remains: `ps` or Task Manager).
3. See: the Journal says `migrate` of the task "was cut by a restart and may have run: the user is
   asked whether it ran", and a **decision** need is waiting on the mission. The log still has **one**
   `started` line: the command was **not** run again.
4. Answer the need. See the Building continue as you said it did or did not run; if you said it did
   not, the command may be run again, and the log then has a second `started`.

*B. A kill during a plain build command.*

5. Wait for the build task. While its command runs (60 s pause), **kill Hemera hard**; start it.
6. See: the Journal says `build` "was cut by a restart and may have run: its runner is told to check
   the real state", no decision need is opened (the command is on no resource), and the Builder is
   told. The command is not run by Hemera by itself.

*C. A formatter beside another task's writes.*

7. Let the two `web` tasks run in parallel. While the `format` command pauses (20 s), the other
   task writes a file in `web`.
8. See: the Journal says "A write waited N s for `format` (…), which writes in web." and the write
   then **succeeds**; a second writing command started meanwhile waits too. The files Prettier
   rewrote are in the attempt of the task that ran `format` and in no other's.
9. If Prettier rewrote a file the other task holds, the Journal says it was "rewritten by `format` of
   <task> while <other task> held it", the change stays, and the other task's runner is told.

**Record.**

| OS | Case | Expected | Result |
| -- | ---- | -------- | ------ |
|    | A · after the kill | left-over process ended at start; "cut by a restart"; decision need; command not run again | |
|    | A · answer | the Building goes on as answered | |
|    | B · after the kill | "check the real state" to the runner; no need; not run again | |
|    | C · writes during `format` | waited, then went through | |
|    | C · attribution | Prettier's changes in the formatting task's attempt only | |
|    | C · conflict (if it happened) | Journal line and the other runner told, or "not provoked" | |

---

## B5 · #143 — the Project's checks, on Windows

**What it proves.** On Windows, a check whose command goes through a **`.cmd` shim** (`pnpm`, `npm`)
runs and gives the right verdict; a check that reads a **real coverage report** compares its value
with the minimum; and **Cancel** kills a check and its whole process tree.

**Needs.** Windows (run it on Linux too if you want a control). One agent as Builder. The Building
page and Settings › Checks.

**Set up.**

1. Acme on Windows. Node ≥ 22 (its test runner prints coverage). `pnpm` installed (a `.cmd` shim).
2. `api`'s `lint` script stays `node -e "process.exit(0)"`: it is run through `pnpm`, not by it.
3. **Settings › Commands**:
   - `lint`: `pnpm lint`, in `api`;
   - `coverage`: `node --test --experimental-test-coverage`, in `api`;
   - `hang`: `node -e "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'inherit' }); setTimeout(() => {}, 600000)"`, in `api`.
4. **Settings › Checks**: let Hemera propose checks from the catalogue and accept them; then add
   a check on `coverage` that reads a value: run the command once by hand, look at the line that
   carries the percentage (`# all files | 64.20 | …`), write a pattern with **one capture group**
   for that number, and a minimum above it (70). Add the check `hang` as a **task** check.
5. A Ready mission whose Spec has a task in `api` (for example the reference mission's first task).

**Steps.**

1. Launch. Hemera runs the checks as the Project set them: after a task, once a requirement's tasks
   are done, and at the end; let the Building run until the checks you added have run. When the
   task is finished, Hemera runs its checks. See: `lint` through `pnpm` runs and is
   green (no "not found", no hang on the `.cmd`), its result holds the line it ran and exit 0.
2. For the red case, cancel the mission, change `scripts.lint` in `api` to `node -e "process.exit(1)"`,
   commit and push it, and run a second Ready mission: the check is red with "exited with 1" and
   the verdict loop opens a new attempt for the task.
3. The coverage check: with the pattern and a minimum of 70 it reads 64.2 (or whatever you see) and
   is red with "64.2 < 70". Lower the minimum below the value in **Settings › Checks** and run the
   check again on a new mission: green.
4. Enable `hang`. When its check starts, look at the process tree:

   ```
   Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*setTimeout*600000*' } | Select ProcessId, ParentProcessId
   ```

   Two `node` processes. **Cancel** the mission and confirm. Run the same command again: **none**
   remains.

**Record.**

| Case | Expected | Result |
| ---- | -------- | ------ |
| `pnpm lint` through the `.cmd` shim, green | runs, exit 0, no hang | |
| `pnpm lint` red | "exited with 1" | |
| Coverage below the minimum | red "<value> < 70" | |
| Coverage above the minimum | green | |
| Cancel on `hang` | both `node` processes gone | |

---

## B7 · #145 — helpers at depth 2, and the Prototyper, on the three agents

**What it proves.** On each real agent (Claude Code, Codex, OpenCode) as Builder: a helper launched
by the Builder, tied to a task, becomes its runner and its result reaches the Builder; a helper may
launch a helper (depth 2), and that second helper has no way to launch another; the **Prototyper**
writes only in `missions/<KEY>/prototypes/<n>/` and nothing in the Workspace.

**Needs.** Linux. The three agents, signed in. The Building page.

**Set up.** Acme and the reference mission, **Ready**, three times (one mission per agent, or the
same one cancelled and made again). In the Spec of each, the description of one task says it is
**best done with helpers**: "split this task: a helper writes `toMarkdown()`, and that helper uses a
helper of its own for the test"; and a task or a decision says "a prototype of the Markdown layout
is needed before the web part: use the Prototyper". The Builder decides; Hemera cannot force it.
Settings › Models by role: Builder on the agent under test. Settings › Cap and budget: the helpers
cap at 3 (the default) and a budget large enough.

**Steps (once per agent).**

1. Launch. Watch the Building page for helper chips under the Builder.
2. A **free helper** is launched on a task. See: it works on that task, takes its claims (the Builder
   no longer runs that task), and when it ends its result reaches the Builder, which carries on.
3. The helper launches a helper of its own (**depth 2**). See: it is accepted and runs; the Journal
   names both. See that this second helper does not launch another: a third level is refused, or
   the helper simply has no tool for it ("a helper of a helper cannot launch helpers").
4. The **Prototyper** runs once. See its files appear in
   `<data folder>/missions/<KEY>/prototypes/1/` and nowhere in the Workspace:

   ```
   ls <data folder>/missions/<KEY>/prototypes/1/
   git -C <workspace>/api status --short
   git -C <workspace>/web status --short
   ```

   Its files are also listed as evidence of the mission. The Workspace holds none of them.
5. The cap: if the Builder tries a fourth helper at once, it is refused with the cap's sentence.
   Write whether it happened.
6. Cancel the mission once you have seen what you can. The running helpers end as failed.

**Record.** If the Builder never launched a helper, or never reached depth 2, write "not launched"
for that agent: that is a finding about the agent's role text, not a failure of Hemera, and the
wording of the Spec is worth a second try.

| Agent and version | Free helper tied to a task | Result reached the Builder | Depth 2 accepted | Third level refused or impossible | Prototyper folder only | Workspace unchanged |
| ----------------- | -------------------------- | -------------------------- | ---------------- | --------------------------------- | ---------------------- | ------------------- |
| Claude Code       |                            |                            |                  |                                   |                        |                     |
| Codex             |                            |                            |                  |                                   |                        |                     |
| OpenCode          |                            |                            |                  |                                   |                        |                     |

---

## B10 · #148 — changes outside Hemera, and the mission's services

**What it proves.** While a mission is in Building, a change you make in the Workspace with **your
own editor** is noticed and said ("Changed outside Hemera"), a file Hemera itself wrote is not
reported, a **real formatter** that overwrites your change is recorded with your version kept, and
the mission's **services** (a real dev server) start, stop and restart from the mission with their
whole process tree gone after Stop.

**Needs.** Linux and Windows. One agent as Builder. The Building page, its services list.

**Set up (per OS).**

1. Acme as in B4 (Prettier installed in `web`, `format` as `node scripts/pause.js 20 && npx prettier --write src`, in `web`, no declared globs).
2. **Settings › Commands**: `serve`: `node scripts/serve.js`, in `web` (it prints
   `Local: http://localhost:5199/` like Vite and starts a child process).
3. A Ready mission whose Spec has: two or three tasks in `api`, and a **last task in `web` that runs
   `format`** (so there is time to act before it).

**Steps.**

*A. A change made in my editor.*

1. Launch. Note the Workspace folder of `web`: `<scratch>/workspaces/<…>/web`.
2. When no command runs in `web`, open `src/notes.js` of that worktree **in your editor**, add a line
   and save.
3. Within 30 seconds, or at once when you focus the Hemera window, see: the mission carries the
   **Changed outside Hemera** mark naming `web`; the Journal has one line for the change. It is
   reported **once**, not every 30 s.
4. A file the Builder writes itself through its tools is not reported: watch for a minute that no
   mark names a file the Builder wrote.

*B. With a server running.*

5. In the services list of the mission, **Start** `serve`. See its state go to starting then ready,
   and its URL appear. Open the URL in a browser: "Acme web".
6. Edit another file of `web` in your editor and save. See it reported (a running `serve` with no
   declared write globs does not blind the detector).
7. **Restart** the server: the old process tree ends, a new one starts, the URL appears again. Then
   **Stop**: look that no process remains:

   ```
   # Linux
   ps -eo pid,ppid,args | grep -E "serve.js|setInterval" | grep -v grep
   ss -ltn 'sport = :5199'

   # Windows
   Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*serve.js*' -or $_.CommandLine -like '*setInterval*' }
   netstat -ano | findstr :5199
   ```

   Both empty. A **running** service cannot be dismissed from the list; a stopped one can.

*C. A formatter that overwrites my change.*

8. Before the formatting task starts (the page shows it available or about to start), edit a file of
   `web/src` in your editor so that Prettier will change it (mix tabs and spaces, remove a
   semicolon), and save. Wait for the mark.
9. Let the `format` task run (20 s pause, then Prettier). See in the Journal: `format` "overwrote a
   change made outside Hemera to <file>; the user's version is kept", and the Builder told. Hemera
   records "overwritten by format".
10. **Cancel** the mission and confirm the cleanup (the Workspace is gone). Open the diff of the mission
    or its attempt: **your version of the file is still readable**, as well as Prettier's.
11. If the editing and the formatting did not overlap in your first try, repeat the mission; timing is
    yours to arrange and a miss is "not provoked".

*D. The base moves (a minute's extra).*

12. During the Building, push a commit to `api-remote.git` from the second clone. Within 15 minutes,
    or when you focus the window, see: the Journal says "The base of api moved: N file(s) changed,
    none of them a target" (or the targets among them), and the Building goes on.

**Record.**

| OS | Case | Expected | Result |
| -- | ---- | -------- | ------ |
|    | A · edit in my editor | mark naming `web`, one Journal line, once | |
|    | A · the Builder's own writes | not reported | |
|    | B · edit with `serve` running | reported | |
|    | B · Start / Restart / Stop | URL once ready; old tree ended at Restart; no process and no listener after Stop | |
|    | B · dismiss a running service | refused | |
|    | C · formatter over my change | "overwrote a change made outside Hemera", my version readable after the Workspace is gone | |
|    | D · the base moves | recorded and said, the Building goes on | |

---

## A9 · #40 (CT-15) — compaction on a long Building, Codex and OpenCode

**What it proves.** CT-15 says the instructions must survive a compaction. Hemera's adapters
declare what each agent tells: **Claude Code** reports a compaction (Hemera then sends the three
instruction layers and the brief again as `[hemera:instructions]`); **Codex** and **OpenCode** are
declared as giving **no reliable signal**, so Hemera replaces their session when the context passes
**80 %** of the window the agent announced ("saturated"). Nobody has watched either agent do this on
a long Building. This proof does, and checks the declaration for Codex and OpenCode against what
they really do.

**Needs.** Linux. Codex and OpenCode, signed in, one run each. The Building page, and a **long**
Building.

**Set up.**

1. **Make the window small, or the Building long.** The cheapest lever is the model: in Settings ›
   Models by role, give the Builder the model of the agent with the **smallest context window**
   offered. If every model has a large window, make the input large instead: add to `api` a folder
   `notes-archive/` of 40 text files of 50 KB each and commit it to the base:

   ```
   node -e "const fs=require('fs');fs.mkdirSync('notes-archive',{recursive:true});for(let i=1;i<=40;i++)fs.writeFileSync('notes-archive/part-'+String(i).padStart(2,'0')+'.txt',('Acme note '+i+' line of text. ').repeat(1800))"
   ```

2. A Ready mission with **many tasks that each read several of those files**: "for each of the 40
   parts, in order, read it in full and add one line to `api/src/index-of-notes.js` summarising it",
   ten tasks of four parts each. Freeze.

**Steps (once per agent: Codex, then OpenCode).**

1. Launch. Watch the Building page for as long as it takes, and the Journal.
2. When the Builder's conversation passes 80 % of the window the agent announced, see the Journal
   say **"The Builder's session was replaced: its conversation filled most of its window."**, and a
   **fresh Builder** pick up with the resume block: the done tasks stay done, the task in progress
   carries on, nothing starts twice. Note how many tasks were done when it happened.
3. If the Builder is **replaced before 80 %**, or **not replaced** by the end of the Building,
   that is the finding. Write which.
4. **What the agent itself says on a compaction.** Look in Settings › Developer for a switch that
   writes the ACP traces. If there is one, turn it on before the run and, after it, search the trace
   of the Builder's session for a compaction message:

   ```
   grep -il -E "compact" <data folder>/traces/*
   ```

   Note what each agent sends (or "nothing"). If there is no switch yet, write **"not observed"**
   and why; do not guess.
5. After the replacement, ask the question that matters: did the new Builder still follow
   Hemera's instructions (no push, no commit, tasks started through `task_start`)? Read the next
   Journal lines and `git -C <workspace>/api log --oneline -3`.

**Record.**

| Agent and version | Model and announced window | Tasks done at the replacement | Reason in the Journal | New Builder continued correctly | Compaction signal seen | Replaced early or never |
| ----------------- | -------------------------- | ----------------------------- | --------------------- | -------------------------------- | ---------------------- | ----------------------- |
| Codex             |                            |                               |                       |                                  |                        |                         |
| OpenCode          |                            |                               |                       |                                  |                        |                         |

If an agent turns out to send a reliable compaction signal, the adapter's `signalsCompaction` is
wrong for it: open an issue with the message it sent.

---

## R4 · #253 — the forge port over the real `gh` and `bkt`

**What it proves.** The forge port decides what a repository's forge allows, and whether its CLI is
`ready`, `missing`, `signed-out` or `unreachable`, from the CLIs' own output. It parses
`gh auth status` by the text of its error and `bkt auth status --json` by its fields, and writes
through `bkt` only with `--context`. It was built from reading `gh` 2.100.0 and the source of `bkt`
at commit `5068ddc`. R6, R7, R8, S2 and S4 rest on these readings being true. This proof checks them
against the real tools, in two parts.

**Part A needs no screen and no Hemera**: it runs the CLIs themselves. **Part B** runs the same cases
through Hemera and waits for the screen that draws the CLI state in the Project's delivery rules
(R12): `forge.status` and `forge.currentUser` have no other way to be read from the window today.

**Needs.** Linux and Windows. `gh` signed in on `github.com`. For Bitbucket: `bkt` and a Bitbucket
Cloud account with a **throwaway workspace** holding an empty test repository (`acme-proof`); a Data
Center instance only if you have one that is not a work one. No repository of yours is written.

### Part A · the CLIs

Record `gh --version` and `bkt --version` first (for `bkt`, the commit it was built from if it shows
one; the readings below are at `5068ddc`).

**1. `gh`, signed in** (Linux and Windows):

```
gh --version
gh auth status --hostname github.com
echo $?               # PowerShell: $LASTEXITCODE (here and below)
gh api --hostname github.com user --jq .login
```

Expected: exit 0 for the status, a login for the last one. Write "matches your account" or not; never
the login.

**2. `gh`, signed out**, **without touching your real sign-in**: point `gh` at an empty configuration
folder for the command only.

```
# Linux
GH_CONFIG_DIR=$(mktemp -d) gh auth status --hostname github.com ; echo $?

# Windows (PowerShell)
$env:GH_CONFIG_DIR = (New-Item -ItemType Directory -Path (Join-Path $env:TEMP "gh-empty-$(Get-Random)")).FullName
gh auth status --hostname github.com ; $LASTEXITCODE
Remove-Item Env:GH_CONFIG_DIR
```

Expected: a non-zero exit and a stderr that says there is no logged-in account for the host. **Copy
the stderr exactly** into the table: the port tells `signed-out` from `unreachable` by a pattern on
that text, and this is the one real output that decides whether the pattern holds. Do the same with
the network cut (airplane mode, Wi-Fi off) and the real config: write what `gh auth status` prints
when it cannot reach `github.com`. Is that text different from the signed-out one?

**3. `gh` absent from `PATH`**: run `command -v gh` (Linux) or `Get-Command gh` (Windows) in a shell
whose `PATH` has no `gh` (Linux: `env PATH=/usr/bin:/bin sh -c 'command -v gh'` if `gh` lives
elsewhere; otherwise start a shell with the folder removed). Expected: not found. Then note the
install line Hemera offers for the OS (Linux: `sudo pacman -S github-cli` where `pacman` exists,
`sudo apt install gh` otherwise; Windows: `winget install --id GitHub.cli`): **do they work as
written?** (Run `winget search GitHub.cli` and `apt-cache policy gh` / `pacman -Si github-cli`; do not
reinstall.)

**4. `bkt`, installed and not signed in** (Linux and Windows). The install lines Hemera offers are
`brew install bitbucket-cli` (Linux and macOS) and `winget install AvivSinai.Bitbucket-CLI`
(Windows): install `bkt` with them and note whether they are right.

```
bkt --version
bkt auth status --json ; echo $?
```

With nothing configured: the exit must be **0**, and the JSON must read `{"hosts":[…]}` with no host
(copy it). If it exits non-zero or prints something else, that is a finding: the port reads exit 0 as
"asked fine".

**5. `bkt`, signed in on Bitbucket Cloud**: log in as `bkt auth login` says (an API token), then:

```
bkt auth status --json
```

Expected: `{"hosts":[{"key":"api.bitbucket.org","base_url":"https://api.bitbucket.org/2.0",…}],"contexts":null}`
(`contexts` is `null` when none exists). Copy the real JSON with the token fields blanked. Check:

- the host key for Cloud is `api.bitbucket.org` (the port matches `bitbucket.org` remotes to it);
- what `bkt` shows as the user for that host: **your nickname, or the Atlassian email?** The port's
  `currentUser` returns what `bkt` stores for the host. Write which. (R8 recognises your own
  comments by it.)

**6. `bkt` contexts**: create the context Hemera's fix line would give, then read it back:

```
bkt context create acme-proof-bitbucket.org --host api.bitbucket.org --workspace <your-throwaway-workspace>
bkt auth status --json
```

Expected: `"contexts":[{"name":"acme-proof-bitbucket.org","host":"api.bitbucket.org","active":…}]`. Note
`active` and the exact field names. Note too whether `--workspace` and `--project` exclude each other
and what `bkt` says when you give both.

**7. `--context` on `pr` and `pipeline` — the question the whole of R6, S2 and S4 rests on.** On
`bkt` at `5068ddc`:

```
bkt pr create --help
bkt pr edit --help
bkt pr merge --help
bkt pipeline run --help
bkt api --help
```

For each, write whether `--context`, `--workspace` / `--project`, `--repo` are accepted, and whether
the flags of the registered shapes exist: `--source`, `--target`, `--title`, `--description`,
`--draft` (create); `--title`, `--description` (edit); `--strategy`, `--message`, `--close-source`
(merge: Hemera always passes `--close-source=false`); `--ref`, `--selector-type`,
`--selector-pattern` (pipeline run). And that **`bkt api` has no `--host`**. Then a call that proves
the flag is *parsed* without writing anything, on a repository that does **not** exist:

```
bkt pr create --context acme-proof-bitbucket.org --workspace <your-throwaway-workspace> --repo acme-proof-does-not-exist --source a --target b --title "no"
```

Expected: an error from the Bitbucket API (repository not found), not "unknown flag". A success here
would mean you named a repository that exists: stop and look.

**8. `gh`, the flags of the registered shapes** (no write):

```
gh pr create --help
gh pr merge --help
gh workflow run --help
gh run rerun --help
```

Write whether `--repo`, `--base`, `--head`, `--title`, `--body-file`, `--draft`, `--squash`,
`--match-head-commit`, `--ref` and `--failed` exist in the version you run.

**Record, Part A.**

| OS | CLI and version | Case | Expected | Result (copy the output where it says so) |
| -- | --------------- | ---- | -------- | ----------------------------------------- |
|    | gh | signed in, status | exit 0 | |
|    | gh | `gh api user --jq .login` | the account | |
|    | gh | signed out (empty `GH_CONFIG_DIR`) | non-zero; **stderr copied** | |
|    | gh | network cut | **stderr copied**; differs from signed out? | |
|    | gh | absent from `PATH` | not found; install line right? | |
|    | bkt | `auth status --json`, nothing configured | exit 0, no host; **JSON copied** | |
|    | bkt | `auth status --json`, Cloud signed in | `hosts[{key,base_url}]`; `contexts: null`; **JSON copied** | |
|    | bkt | the user it shows for the host | nickname or email? | |
|    | bkt | `context create … --host … --workspace` | `contexts[{name,host,active}]` | |
|    | bkt | `--context` on `pr create/edit/merge`, `pipeline run` | accepted | |
|    | bkt | the flags of the registered shapes | all exist | |
|    | bkt | `bkt api` has no `--host` | true | |
|    | bkt | the install lines | work | |
|    | gh | the flags of the registered shapes | all exist | |

If a reading is wrong, the port must change before R6 builds on it: open `fix(forges): …` naming the
line and pasting the real output.

### Part B · through Hemera (waits for R12)

When a screen reads `forge.status`, run these cases with a Project whose repositories have the
remotes below; for `signed-out` start Hemera with `GH_CONFIG_DIR=<an empty folder>` in its
environment (Hemera runs `gh` in your own environment and does not set it), and for `missing` start
it with a `PATH` that lacks `gh`.

| OS | CLI and version | Forge | Host | Case | Expected | Result |
| -- | --------------- | ----- | ---- | ---- | -------- | ------ |
| Linux | gh | GitHub | github.com | signed in | `ready`, version shown; the account matches yours | |
| Windows | gh.exe | GitHub | github.com | signed in | `ready`; the account matches yours | |
| Linux | gh | GitHub | github.com | signed out | `signed-out`, fix `gh auth login --hostname github.com` | |
| Linux | — | GitHub | github.com | `gh` not on `PATH` | `missing`, the install line | |
| Linux | bkt | Bitbucket Cloud | bitbucket.org | signed in, a context | `ready`; the account is what Part A step 5 showed | |
| Linux | bkt | Bitbucket Cloud | bitbucket.org | signed in, no context | `signed-out`, with the `bkt context create …` line to copy | |
| any | bkt | Bitbucket Data Center | its host | forced as `bitbucket-datacenter` | `ready`, or `signed-out` with `bkt auth login https://<host>`; or "no Data Center available" | |
| Windows | bkt.exe | Bitbucket Cloud | bitbucket.org | signed in | `ready` | |

Also: **an Electron started from a desktop icon** may lack `~/go/bin` or `~/.local/bin` in its
`PATH`, so a `bkt` installed there reads `missing`. Start Hemera once from the icon (or the launcher
you use) and once from a terminal and write whether `bkt` is found in each.

---

## When everything is recorded

1. The pull request that fills the tables says, for each proof, **run**, **failed** (with the issue
   opened) or **not run** (with why).
2. The issues #139, #140, #141, #142, #143, #145, #148 and #253 are already closed; their "not
   verified" lines are settled by this note, not reopened. A failure becomes a new issue, not a
   reopened one.
3. #314 (B9) records its own table in the same folder; the maintainer's acceptance of tranche 3
   reads this note and that one together.
