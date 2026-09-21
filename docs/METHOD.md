# Method: from an issue to shipped code

How a need becomes code in this repository. Four artefacts, tested scenarios, tasks ticked only after their verification ran, evidence attached. Everything lives in the issues and pull requests of this repository; the code holds only code, its documentation and its `AGENTS.md`. Everything is in English.

## 0. Who does what

- **The maintainer** decides: which issue is retained, the open points, the UI gate, the merge.
- **The framing assistant** (a coding assistant on the maintainer's machine, in conversation with them) writes the Proposal, Design, Spec and Tasks sections with the maintainer, and later reviews the pull request against the Spec.
- **The developer agent** (`hermes-krisnet[bot]`) implements a Framed issue: branch, commits under the maintainer's identity, draft pull request after phase 0, tasks ticked after their verification, pull request ready after phase 3. It never frames, never merges.

## 1. The issue: the intention

An issue says **what is wanted, where it applies, how we will know it is done**, and what triggered it, with the headings of the issue templates (`.github/ISSUE_TEMPLATE/`). It contains no solution. Its labels say its type (`type:idea`, `type:bug`, `type:debt`, `type:research`) and its area (`area:sessions`, `area:agents`, …); its milestone says the version that will ship it; its state is the **Status** field of the [GitHub project "Hemera"](https://github.com/users/KristenJestin/projects/7).

The states, in the project:

| State | What it means | Who acts |
|---|---|---|
| Backlog | received, prioritised, not engaged | the maintainer |
| To frame | retained; the framing assistant writes the Proposal, Design, Spec and Tasks sections in the issue with the maintainer, and ends with the points to decide; the issue stays there until the maintainer has decided | framing assistant, then maintainer |
| Framed | decided, nothing started: the queue the developer agent picks from | developer agent |
| In progress | branch open, tasks ticking, UI gate of phase 0, pull request in draft then ready and reviewed; at most three at a time | developer agent, then the maintainer on the pull request |
| Done | pull request merged, or abandonment said in a comment | — |

## 2. Proposal, Design, Spec: three sections of the issue

At framing time, the framing assistant adds **three sections** to the issue, under the intention, with the exact headings of [`docs/templates/framing.md`](templates/framing.md):

- **Proposal**: Why, What changes, Capabilities touched, Impact (packages, migrations, tests), and the points to decide with one recommendation each. The maintainer decides; the assistant records the decision in a "Decided" section.
- **Design**: the numbered decisions `D<lot>-01`, `D<lot>-02`… with their reason and the alternative set aside. This is what the code cites in comments.
- **Spec · <capability>** (one per capability): requirements `Hemera SHALL …` with their scenarios `WHEN … THEN …`. **Every scenario becomes a test named after it.** A scenario without a test is a defect.

These sections are the truth of the lot; the code conforms to them, and if a section is wrong it is said in a comment instead of silently deviating. A decision that crosses lots goes to [`docs/decisions/`](decisions/README.md).

## 3. The tasks: checklists in the issue

One task list per phase (0 · UI first, 1 · engine, 2 · wiring, 3 · acceptance), as laid out in [`docs/templates/framing.md`](templates/framing.md), one item per task, each item naming its **verification** ("…; check `pnpm check` green and scenario X"). **An item is ticked only after its verification ran and its output was seen.**

Phase 0 ends with a human gate: the developer agent pushes the branch, opens a **draft pull request** against `dev` and mentions the maintainer; the maintainer validates in Storybook, both themes, with the keyboard, and says so in a comment. The issue stays In progress meanwhile; phase 1 waits for that validation.

## 4. The evidence: attachments and comments

The real outputs (`pnpm check`, end-to-end, package, screenshots) are **attached to the pull request**; a comment sums up what was run, on which OS, and what was not. What was not run is said, never assumed. A Linux verification not run on Linux is "not verified", not green.

## 5. Delivery

Branch `feature/<topic>` from `dev`, Angular commits under the maintainer's identity. At the end of phase 3 the pull request goes from draft to ready: title = a plain Angular subject (semantic-release reads it to decide the version), description ending with `Closes #<n>`. The review happens on the pull request: it carries the state (draft, ready, approved). After acceptance, **squash merge**; `Closes #<n>` closes the issue and the project moves it to Done. One `dev` → `main` merge per version (the milestone) sets the tag and the Release.

## 6. The documents

- [`docs/product/core.md`](product/core.md) prevails over everything else; [`docs/decisions/`](decisions/README.md) refines it; [`docs/technical/`](technical/) holds the research; [`docs/design/`](design/README.md) and [`docs/prototypes/`](prototypes/README.md) are references for tokens and motion, never markup to copy.
- A proposal that changes a product rule edits the document in the same pull request and says so in the issue.
- An issue names in "References" the documents it needs.
