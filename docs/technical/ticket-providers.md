# Ticket providers

How Hemera 1.0 reads tickets written elsewhere (GitHub issues, Jira tickets), keeps a Spec in a
ticket, and watches the tickets of live missions. This note fixes the interface, the three Spec
modes, credentials, reading, sync and conflicts once, so that the tickets that build them (#95 to
#98, and the settings screens of #104) share one design. Where one of those tickets and this note
differ, the note wins and the pull request says so.

Two kinds of statement appear below. A **rule** is decided by the product and is written as a
rule. A point marked **decided in this note** was left open by the plan; the note settles it, says
why, and the maintainer confirms or changes it while reviewing the note. A point marked **open**
is carried by a later ticket, with the recommendation that ticket builds.

The examples use a Project "Acme" whose missions are `ACME-12`, `ACME-13`…, a GitHub issue
`acme/shop#41` and a Jira ticket `SHOP-7`.

## 1. Vocabulary

- **Provider**: a source of tickets configured on a Project (a GitHub host with its repositories,
  or a Jira site with its project keys), reached through one interface.
- **Ticket**: an item of a provider that a mission can come from: a GitHub issue or a Jira ticket.
- **Ticket reference**: the key or URL the start field recognises in what the user typed
  (`acme/shop#41`, an issue URL, `SHOP-7`, a browse URL), parsed by `parseTicketReference` in
  `@hemera/core` (#84) and stored in its canonical form (`github:github.com/acme/shop#41`,
  `jira:/SHOP-7`).
- **Ticket version**: what Hemera read of a ticket at a given time: its text, status, comments,
  remote update date and fingerprint, with the date Hemera read it.
- **Last known version**: the most recent version Hemera holds for a ticket, whether it read it or
  wrote it itself; the version every change and every write is compared with.
- **Base version**: the version a mission's Spec is built from; it moves only when a change is
  integrated (#97).
- **Watched ticket**: a ticket linked to a live mission of a Project in linked or remote mode;
  the sync checks it.
- **Ticket event**: one change the sync found on a watched ticket (a comment added, edited or
  removed, the description changed, the status changed), stored and delivered as described in
  section 7.
- **Spec mode**: the Project setting that says where a mission's Spec lives: local, remote to
  Hemera's standard, or linked.
- **Linked ticket**: a ticket of any shape that is the base of a local Spec; Hemera only reads it.
- **Remote Spec**: a Spec whose eight sections Hemera writes into a ticket, in remote mode.

## 2. One interface, several providers

### Rules

- Providers have **one interface**. 1.0 has two: **GitHub** (issues) and **Jira**. Bitbucket,
  GitLab and Linear as Spec providers come after 1.0.
- A Project may have **one or several** providers, and **every combination works**: a GitHub issue
  linked to a local Spec; a Jira ticket as the only entry; both in one Project.
- **No badge, screen or path differs by source.** A screen shows "the ticket", its key and its
  link; the provider is visible only in the Project settings and in the link itself.
- A ticket gives **one mission**; a ticket already linked to a mission opens that mission instead
  of creating a second one (#84). There is no splitting of a ticket into several Specs in 1.0.
- The mission shows the ticket it comes from as a link beside its own key (`ACME-12 ↗ SHOP-7`);
  the ticket keeps its own key.

"One mission per ticket" is the rule #84 built: one mission per ticket and per Project, whatever
the mission's stage. What enforces it is the check inside the creation's transaction (#84's
`linkedTo`, under the engine's single write lock): it treats a bare Jira key and a browse URL of
that key as one ticket, and a GitHub short form as the issue of that repository and number on any
host. The unique index on the canonical reference does not: `jira:/SHOP-7` and
`jira:jira.acme.test/SHOP-7` are different canonical forms, so the index only backs up two
creations of the same spelling. A Done or Cancelled mission is still the ticket's mission, and the
start field opens it. #95's "one live mission" wording is read as this rule, not as a second one.

### The interface

The service lives in the engine; its types are Schema types in `@hemera/core`, beside the ticket
references of #84. The shape below is the contract; #95 writes it in Effect and may name the
fields of a struct differently, never their meaning.

```ts
type ProviderKind = 'github' | 'jira'

/** One of the eight sections of a Spec, as the tolerant reading recognised it. */
interface TicketSection {
  // #85's `SpecSectionName` (its seven prose sections: 'why' | 'goals' | 'impact' | 'decisions'
  // | 'risks' | 'migration' | 'open_questions'), and 'requirements', which #85 keeps as rows
  section: SpecSectionName | 'requirements'
  heading: string // as written in the ticket
  text: string
}

/** Text the reading could not map, with the heading it sat under, in order. */
interface UnrecognisedText {
  heading: string | null
  text: string
}

interface TicketComment {
  id: string // stable on the provider: GitHub node id, Jira comment id
  author: string | null // null for a deleted account
  body: string
  createdAt: DateTimeUtc
  editedAt: DateTimeUtc | null
  fingerprint: Fingerprint
}

interface TicketStatus {
  state: 'open' | 'closed'
  wording: string // the provider's own words: 'closed · not planned', 'In review'
}

interface TicketVersion {
  provider: ProviderKind
  reference: CanonicalTicket // #84
  key: string // 'acme/shop#41', 'SHOP-7'
  url: string
  title: string
  description: string // the text as written: Markdown, ADF turned into Markdown, wiki markup
  sections: ReadonlyArray<TicketSection>
  unrecognised: ReadonlyArray<UnrecognisedText>
  status: TicketStatus
  author: string | null
  labels: ReadonlyArray<string>
  comments: ReadonlyArray<TicketComment>
  updatedAt: DateTimeUtc // the provider's update date, on the provider's clock
  readAt: DateTimeUtc // Hemera's clock
  fingerprint: Fingerprint // of the title and the description, see section 5
}

/**
 * What a provider found for the start field: #84's `TicketHit`, without `linkedMission`, and with
 * the ticket's status, as #95 lists it.
 */
interface TicketHit {
  provider: string
  reference: TicketReference
  canonical: CanonicalTicket
  key: string
  title: string
  url: string
  status: TicketStatus
  updatedAt: DateTimeUtc
}

/** A watched ticket and the remote update date of its last known version. */
interface KnownTicket {
  reference: CanonicalTicket
  updatedAt: DateTimeUtc
}

type TicketChange =
  | { _tag: 'Moved'; reference: CanonicalTicket; updatedAt: DateTimeUtc }
  | { _tag: 'Missing'; reference: CanonicalTicket; error: TicketNotFound | TicketForbidden }

interface ProviderStatus {
  state: 'not_configured' | 'missing_cli' | 'not_authenticated' | 'unreachable' | 'ready'
  sentence: string // shown as is: 'GitHub CLI is not logged in to github.com.'
  fix: string | null // the command that fixes it: 'gh auth login --hostname github.com'
}

interface TicketProvider {
  readonly kind: ProviderKind
  readonly status: () => Effect<ProviderStatus>
  readonly read: (ref: TicketReference) => Effect<TicketVersion, TicketError>
  /** At most 20 hits; a reference is read, not searched (see "Searching"). */
  readonly search: (projectId: string, query: TicketQuery) => Effect<
    ReadonlyArray<TicketHit>,
    TicketError
  >
  /** The tickets whose remote update date moved, in one grouped request per host or site. */
  readonly changedSince: (known: ReadonlyArray<KnownTicket>) => Effect<
    ReadonlyArray<TicketChange>,
    TicketError
  >
  /** Remote mode only (#98); absent from a provider that cannot write. */
  readonly write?: (
    ref: TicketReference,
    text: string,
    expected: KnownTicket,
  ) => Effect<TicketVersion, TicketError | TicketMoved | TicketTooLong>
}
```

`TicketQuery` is #84's (`{ text, reference }`). `status()` never fails: a provider that cannot be
reached says so in its status.

### Errors

Every failure is a `Schema.TaggedError`. Each carries the provider's message **as is and masked**:
as is means without rewording, never without masking (#35 replaces known secret values and
recognised secret shapes with `•••` before the message is stored, shown or given to an agent).

| Error | When |
|---|---|
| `TicketNotFound` | the ticket does not exist, or the account cannot see it (GitHub answers both the same way) |
| `TicketForbidden` | the account can see the ticket but not do what was asked (a write without write access) |
| `ProviderUnreachable` | network failure, DNS, TLS, a timeout (30 seconds per call) |
| `ProviderNotAuthenticated` | `gh` not logged in to the host; a Jira token missing, revoked or refused |
| `ProviderCliMissing` | `gh` not found on the user's `PATH` |
| `ProviderLimited` | a rate limit, with the time it resets |
| `TicketUnreadable` | an answer Hemera could not decode; also a GitHub number that is a pull request |
| `TicketMoved` | `write` only: the ticket changed since `expected`, nothing was written (CT-53) |
| `TicketTooLong` | `write` only: the text is longer than the tracker accepts, nothing was written |

`TicketError` is the union of the first seven.

### Searching (settles #84's open question 7)

#84's `TicketSearch` port is the field's view of every provider of a Project, merged. As built in
#84, its stream fails with `TicketSearchError`, and the field turns that failure into one notice.
A stream that fails ends: merging providers into it would let the first provider that fails cut
off the hits of the others still answering.

Decided in this note: **a provider's failure is an element of the merged stream, not its end.**

- The port's `search` becomes `Stream<TicketHit | ProviderFailed, never>`: each provider of the
  Project runs at once (`Stream.mergeAll`, unbounded concurrency), its hits come as soon as it
  answers, and its failure becomes one `ProviderFailed { provider, message }` element; the other
  providers go on. The field turns each `ProviderFailed` into one `SearchNotice`, as it does
  today, and drops its `catchTag`. #95 changes the port and the field together, with no
  compatibility layer.
- There is no order across providers: hits arrive as their provider answers, each provider's hits
  sorted by update date. The field already draws local results first and never waits on a remote
  one (#84).
- Interrupting the stream (the user typed again) interrupts every provider's call, as #84 tests
  with its fake provider.
- A query that is a ticket reference is answered by **reading** that ticket, not by a text search,
  and only by the providers it can belong to: a GitHub reference by the GitHub providers of its
  host; a Jira browse URL by the Jira providers of its site; a bare Jira key by the Jira providers
  whose project keys include its prefix, or every Jira provider of the Project when none does.
  When no provider of the Project can answer it, the field says "No ticket provider of this Project
  reads SHOP-7." beside #84's create choice, and that choice creates the mission from the text,
  with no ticket linked. A reference to a GitHub repository the provider does not list for search
  is still read: the user named it.
- **This note replaces #84's sentence and port.** "No ticket provider of this Project reads
  SHOP-7." replaces #84's "No ticket provider is set for this Project.", and the port loses
  `providers()`: the field no longer asks which kinds of provider a Project has, it asks the port
  whether one of them reads the reference. #95 changes the port, the field and their tests
  together.
- **A GitHub short form names no host.** #84 parses `acme/shop#41` with no host. It resolves
  through the Project's GitHub providers that list the repository `acme/shop`: the host of the
  first of them, in the Project's order (#84's port answers these hosts with `githubHosts`, which
  #95 implements from its providers). When none lists it, the host is `github.com`. The canonical
  form stored on the mission is the resolved host's: `github:git.acme.test/acme/shop#41` on a GitHub
  Enterprise host. To find the mission a short form names, Hemera matches it on owner, repository
  and number on any host, as a bare Jira key matches its ticket on any site; a full URL matches
  only its own host. Why: a team on GitHub Enterprise writes `acme/shop#41` as often as a team on
  github.com, and storing `github.com` for it would link the mission to an issue that does not
  exist.
- The same rule holds for `changedSince` in the sync (section 7): each provider's grouped check
  runs on its own, and one that fails is signalled once without stopping the others.

Why: the field and the sync both serve several providers, and a Project with GitHub and Jira must
not lose GitHub's answers because its Jira site is offline. An error channel cannot carry "one
provider failed, the others go on"; an element can.

## 3. The three Spec modes

### Rules

A Spec always has Hemera's fields and lives in one of three places, according to the mode the
Project chose:

1. **Local**: in Hemera.
2. **Remote, to Hemera's standard**: a GitHub issue or a Jira ticket carries the same fields.
   Hemera writes the text of the eight sections into the ticket (Why; Goals / Non-goals; Impact;
   Requirements, with their WHEN/THEN scenarios; Decisions; Risks & trade-offs; Migration plan;
   Open questions). The Proof blocks, the tasks and the Memory stay local. **Neither a status nor a
   pull request link is ever written into a ticket in 1.0.**
3. **Linked**: any remote ticket, of any shape, is the base of a local Spec. Each keeps its own
   shape. Hemera **only reads** the linked ticket; updating it is the user's gesture (the agent may
   draft a comment, the user writes and sends it; the agent never sends anything). Because the two
   do not correspond one to one, **a change on either side goes through the whole contestation**:
   a ticket change reaches the Planner as an event and becomes questions; a Spec change is the
   user's to carry to the ticket.

### Decided in this note

- **One mode per Project**, applied to every provider of that Project. Why: the settings list one
  Spec mode per Project (#104), and a mode per provider would make a mission's behaviour depend on
  its source, which the "no path differs by source" rule forbids. A Jira Data Center site that
  cannot be written to (if #96 does not build Data Center writes) reads its tickets in linked mode
  and says so in the Project settings.
- **A mission started from a sentence always has a local Spec**, whatever the mode, and **Hemera
  never creates a ticket in 1.0**: the remote mode applies to missions started from an existing
  ticket. Why: creating a ticket picks a repository or a Jira project, an issue type and fields
  the Project has not described, and a mistake there is public and outside Hemera.
- **What a ticket does in local mode.** Local is the default (#95). A ticket reference still finds
  or opens its mission, and a mission created from it keeps the link beside its key. Its version is
  read once at creation and given to the Planner as the idea, stored as the mission's base and last
  known version; the ticket is not watched, so no ticket event reaches the mission. Linked mode
  adds the watch (section 7); remote mode adds the writes (section 8). Why: three modes that each
  add one thing are easy to explain on the settings screen; a ticket the user typed is always read,
  so the Planner never starts from a bare key.
- **Changing the mode** applies to the missions created afterwards, and to the watch at the next
  check: a live mission linked to a ticket starts or stops being watched with its Project's mode.
  A mission already written in remote mode keeps its ticket; Hemera writes it again only at its
  next Freeze if the Project is still in remote mode.

## 4. Credentials

### Rules

- **GitHub goes through `gh`**, which keeps its own authentication. Hemera checks it (`gh auth
  status`) and never reads, stores or passes a GitHub token. Hemera's own `gh` calls use the user's
  real `gh` configuration (agents' commands get an empty one; that defence belongs to the
  permissions engine).
- **Jira has no CLI**: its API token is kept in the **operating system's keyring** (Secret Service
  on Linux, the system's protected storage on Windows), encrypted by the main process, the same way
  as the Jev key. It is **never displayed**, never written to a log, a setting or an environment,
  never given to an agent, and it is masked everywhere as a known secret value.
- **Forges never receive a token from Hemera.**

### What follows from them

- Hemera checks `gh` with `gh auth status --hostname <host>`, which exits 1 when the host is not
  logged in (with `--json` it always exits 0, and the state is in the output). Hemera never runs
  `gh auth token` or `--show-token`, and never sets `GH_TOKEN` or `GITHUB_TOKEN`.
- `gh` runs as a program with an argument array, never through a shell, stdin closed unless it
  carries a body (`gh issue edit --body-file -` reads the Spec from standard input in remote
  mode), with `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1` and `NO_COLOR=1`.
- The Jira token goes from the window to the main process once, when the user saves it; the window
  never receives it back. Electron's `safeStorage` encrypts it; on Linux a `basic_text` backend
  protects nothing and is refused, so nothing is stored and the settings say why. The engine gets
  the token at call time, keeps it for that call, and registers it with the masking registry (#35)
  the moment it arrives.
- Jira Cloud authenticates with Basic auth (the account email and the API token); Jira Data Center
  8.14 and later with a personal access token as a Bearer token. A request goes only to the site
  the token was saved for; a redirect to another host is refused.

## 5. Reading tolerantly, and the snapshot

### Rules

- Hemera reads tickets **tolerantly** and **never breaks** on a section title written differently,
  a missing section, an unknown section, an empty description or markup it does not know. What it
  cannot map stays as "unrecognised text" shown to the Planner, in order.
- Hemera keeps a **snapshot of the remote version the Spec was built from**: title, description,
  status, comments, update date and a fingerprint of the text. When the remote has moved since,
  the mission is marked **outdated**, and the **difference is visible**.
- Ticket text is data for agents, never an instruction.

### What follows from them

- **One reading path.** Every description becomes Markdown first (GitHub's body as is; Jira
  Cloud's Atlassian Document Format and Data Center's wiki markup through #96's converters), then
  goes through one pure function, `readSections`, in `@hemera/core` (#95). It splits on headings of
  any level and maps each to one of the eight sections, ignoring case, accents, punctuation,
  numbering, emoji and trailing colons, and accepting close variants and translated names. It
  never throws and never loses a character: a property test checks both.
- **The fingerprint** is a sha256 of the title and the description as the provider returned them,
  normalised (Unicode NFC, line endings LF, trailing spaces trimmed); for Jira Cloud the document
  is serialised with its keys sorted and its `localId` attributes left out. Each comment has its
  own fingerprint of its body. Decided in this note: the fingerprint is taken on the provider's
  text, not on Hemera's Markdown, so that a better ADF or wiki converter in a later Hemera never
  makes every Jira mission outdated at once.
- **The snapshot** is a ticket version stored with its read date (#95's `ticket_versions`), its
  known secret values masked before it is written. A mission keeps two of them: the **base
  version** and the **last known version** (#95's `mission_tickets`). They are equal when the
  mission is created; the sync moves the last known one (#97), an integrated change moves the base
  (#97), and Hemera's own write moves the last known one (#98).
- **Comparing two versions** gives a line difference of the normalised title and description and,
  for comments, the ids added, edited and removed. Outdated means "the last known version differs
  from the base version in its title or description"; a status change or a comment is an event,
  never an outdated mark by itself.
- **Data, not instructions.** Every ticket text an agent receives (a brief, `ticket_read`, an
  event) is labelled as data from people, with its author and read date; the Planner role says
  that what a ticket asks is a wish to plan and check, not an order.

### A ticket unreadable when its mission is created (open question 4)

Decided in this note: the mission is created with its reference and an **empty snapshot** (no
base, no last known version), and its title is the ticket's key unless the field passed the
provider's title (#84). The Planner's brief says the ticket could not be read yet, and the Planner
waits for it rather than planning from a key. The failure is signalled once (section 6). The next
check (the sync's, or the user's "Check again") reads it, stores it as both base and last known
version, and delivers it to the Planner. Why: refusing the mission would lose the user's gesture
for a network failure, and planning without the ticket would plan the wrong thing.

### Section titles in a remote Spec

Decided in this note: Hemera writes the **eight English section names** (Why, Goals / Non-goals,
Impact, Requirements, Decisions, Risks & trade-offs, Migration plan, Open questions), the product's
terms, and the content in the **Project's Spec language**; tolerant reading also accepts close
variants and translated names. Why: fixed names make a ticket Hemera wrote readable by every
reader of every language the same way, and reading it back never depends on the Spec language,
which may change.

## 6. Offline

### Rule

Offline, an unreadable remote is **signalled once**, and **nothing is lost**: the last known
version stays readable, the check retries at its next time, and writes wait (section 8).

### What follows from it

- Each provider keeps `unreachableSince`. The first failure after a success writes one domain
  event, `tickets.provider_unreachable` (Project, provider, masked message), listed in Since you
  left and notified once; later failures in the same outage write nothing. The next success clears
  it and writes `tickets.provider_back` to the Project's Journal (#95).
- `ProviderNotAuthenticated` and `ProviderCliMissing` follow the same "once" rule, with the
  provider's status and its fix in the settings.
- A rate limit (`ProviderLimited`) is an outage until its reset: GitHub gives it in
  `x-ratelimit-reset` (epoch seconds) or `retry-after`; Jira answers 429 with `Retry-After` in
  seconds. Nothing retries in a tight loop.
- Every reader of a ticket says when it was read ("read 3 hours ago").

## 7. Sync

### Rules

- Only **live missions** are watched: Planning, Ready, Building, Review and Shipping. A Done,
  cancelled or archived mission is no longer watched.
- **One grouped check per Project** ("which of my tickets changed since last time"), **every hour
  by default**, the interval a Project setting, plus a **catch-up at start**. **No webhooks** in
  1.0: they need a server.
- **Each change becomes an event.** A new comment: the agent checks whether it answers a waiting
  question and proposes the answer. The description changed: the mission is marked outdated, with
  the difference. The status changed: a warning that blocks nothing (Since you left and a
  notification).
- **Hemera detects, the agent analyses, the user decides. Nothing is applied on its own.**

### What follows from them

- **"Since" is per ticket, on the provider's clock.** Decided in this note: `changedSince` takes
  each watched ticket with the remote update date of its last known version, and returns the
  tickets whose remote update date differs from it. It never compares a remote date with Hemera's
  clock, so a machine clock that is wrong, or a Jira user's time zone, never hides or invents a
  change. Why: the plan's `changedSince(refs, since)` with one date per Project would compare two
  clocks.
- **One grouped request per host or site.** GitHub: one GraphQL query per host, one alias per
  issue, asking only `updatedAt`, at most 50 issues per query (well under GitHub's node and cost
  limits: a query costs about one point of the 5,000 an hour a user gets). Jira: one JQL search
  `key in (…)`, asking only the `updated` field, at most 50 keys per request, through
  `/rest/api/3/search/jql` on Cloud (the older `/rest/api/3/search` is removed) or
  `/rest/api/2/search` on Data Center. Only the tickets reported as moved are then read in full.
- **A ticket that is gone.** A watched ticket the provider no longer finds (deleted, moved, access
  lost) comes back as `Missing`. Decided in this note: it is signalled once on its mission, like
  an unreadable remote, and its last known version stays; it is never treated as an empty
  description. Why: a lost permission must not look like "someone erased the ticket".
- **Comment edits.** Both trackers move an issue's update date when a comment is added; #95 and
  #96 verify against the real trackers whether editing or deleting a comment moves it too. Where it
  does not, such a change is found the next time the ticket is read in full, and the pull request
  says so.
- **Providers check independently**, as in the search (section 2): one provider failing does not
  stop the check of the other.
- **A version Hemera wrote itself** is recorded as last known at once (#98), so it never produces
  an event.
- The catch-up at start runs after a restore's reconciliation, when there was one (CT-08, section
  8). Checks of one Project never overlap.

### Open (carried by #97)

- **Open question 17**, a ticket that changes along the way. Recommended: in Planning, outdated
  means "a ticket change is not integrated yet", lifted when the Planner integrates it; in Ready,
  the pre-launch check shows it and the user launches anyway or returns to Planning; in Building,
  Review and Shipping it is information only, nothing stops, Ship is not refused for it, and the
  user lifts the mark when they have seen it. The status warning is a Since you left entry and a
  notification, not a mark.
- **Open question 19**, ticket events after Freeze. Recommended: in Planning, the mission's own
  Planner handles them; after Freeze, one short `ticket-event` Planner session per mission and per
  check only analyses them, counted in the Project's cap (CT-13). #85's Planner role is not counted
  in the cap (`countsInCap: false`, as the mission's main session), so this session needs its own
  role entry that is counted (a `ticket-event` role with the Planner's tools for reading), or a
  count decided per session rather than per role; #97 chooses one and says why.
- **Open question 54**, where a proposed answer shows. Recommended: it is not a need; it shows on
  the question, in Home's Questions group and in Since you left, and accepting it makes it the
  user's answer.

## 8. Conflicts

### Rule for remote writes

> **Contract CT-53 · Remote sync without overwriting (proposed default, to confirm before
> launch).** For each ticket, Hemera keeps the last known remote version (update date and
> fingerprint of the text), including after its own writes: what it wrote itself never makes a
> mission outdated. Before writing, Hemera re-reads the ticket; if the version has changed since
> the last known one, it does not write: the mission becomes outdated with the difference, and the
> user decides. Offline, writes wait; when the network is back, the same check applies before
> sending them.

### Rule for the restart after a restored profile

> **Contract CT-08 · Restoring a profile goes through a reconciliation (proposed default, to
> confirm before launch).** After a restore, no automation resumes until reconciliation is
> finished: no session restarted, no delivery step, no approval executed, no sync that writes. For
> each live mission, Hemera re-reads the real world: does the Workspace exist, are the branches
> pushed, do the PRs exist and are they merged, are the versions published, has the ticket moved.
> The restored state is advanced to what is true, with the idempotent checks of the delivery's
> Retry; never moved back. Restored approval requests expire ("restored from a backup"): a human
> answer does not apply to a world that has changed. Restored needs are re-checked and expire if
> they no longer hold. A vanished Workspace gives an environment need on its mission, never a
> silent re-creation. Each mission gets a Journal line ("restored from the backup of
> 2026-10-01"), and the missions whose state was advanced are listed in Since you left.

### Decided in this note

- **When Hemera writes a remote Spec**: at **Freeze**, and again at each new Freeze after a return
  to Planning; nothing is written during Planning. The write is queued in the Freeze's transaction,
  so a Freeze never waits on the network. Why: Planning changes the Spec many times an hour, and a
  ticket that moves with every answer would bury the team in notifications and make every write a
  conflict; Freeze is the moment the Spec is a decision.
- **How much of the ticket Hemera writes**: the **whole description** is the Spec's text in remote
  mode; anything else belongs in comments, which Hemera never writes, edits or deletes. The title,
  status, labels and assignees are never touched. Why: a description split between Hemera's part
  and a human part needs markers that people edit by accident; CT-53 already guarantees that a
  change Hemera has not read is never overwritten.
- **Where the comparison lives.** `write(ref, text, expected)` re-reads the ticket, compares it
  with `expected` (update date and fingerprint), fails with `TicketMoved` without writing when they
  differ, otherwise writes and reads back, and returns the version read back, which becomes the
  last known version. #98's procedure around it (intent and outcome, CT-09) decides what a
  `TicketMoved` does. Why: the provider is the only place that knows how to read and write the same
  ticket the same way.
- **The window CT-53 cannot close.** Neither GitHub nor Jira accepts a conditional write on an
  issue's description (no `If-Match` on the edit), so an edit made between Hemera's re-read and its
  write is overwritten. The window is one request long; both trackers keep the description's edit
  history, so nothing is lost for good. 1.0 accepts that window and does not inspect the history.
- **A text too long for the tracker** (65,536 characters for a GitHub issue body, 32,767 for a Jira
  Cloud description) is never cut: the write fails with `TicketTooLong` ("The Spec is too long for
  SHOP-7's description") and the Spec stays local.

### Open (carried by #98)

- **Open question 18**, a conflict in remote mode. Recommended (CT-53): no write; the mission is
  outdated with the difference, and a decision need offers "Keep the ticket's change" (no write;
  the change is handled as any ticket change) or "Write the Spec over it" (the difference that will
  be lost is shown). Answering runs the write again from the re-read.

## 9. Which ticket builds what

| Ticket | Builds |
|---|---|
| #95 | The provider port and its errors, the GitHub provider over `gh`, a Project's providers and Spec mode (`local`, `linked`), the linked mode, `readSections`, the snapshot (base and last known versions), the `TicketSearch` implementation and the merged search of section 2, the offline signal, `ticket_read` |
| #96 | The Jira provider: the token in the keyring, Cloud (REST v3, ADF) and Data Center if cheap (REST v2, wiki markup), the converters to Markdown |
| #97 | The sync: the grouped check, the interval, the catch-up, ticket events, the outdated mark from a ticket, proposed answers |
| #98 | Remote Specs: the `remote` mode, `write` on both providers, rendering the eight sections, the write procedure with CT-53 and CT-09 |
| #104 | The settings screens: providers and their status, the Spec mode, the sync interval |

Jira Cloud or Data Center (open question 6): the interface supports both; #96 builds Cloud first
and Data Center in the same ticket only if it costs little (same client, REST v2, a Bearer
token, wiki markup). Otherwise Data Center becomes its own ticket, and the settings say "Jira Data
Center is not supported yet".
