# The Planning page: what waits, what happens, where the Spec stands

Design of #193, drawn in Storybook under `Explorations/Planning`. The ticket that builds it follows
this note; the exploration is deleted once it is built.

## The problem

On a real mission the Planning page read as a pile. The head's Now line looked like a link and
led nowhere visible, the face never changed, an answer scrolled the view past the next question,
and a cold read of seven paragraphs, five permission rows above the Spec, two Probes, eight
questions and the vision field all asked for attention at once.

## What the user needs, in order

1. **What waits for me**, because an agent may be blocked on it.
2. **What happens now**, to know whether to wait or to act.
3. **Where the Spec stands**, to know how far Freeze is.

Everything else is history: one click away, folded.

## The recommendation: "For you" (`Explorations/Planning/For you`)

The Spec keeps the middle, its sections the left. The rail reads top to bottom as the three
questions above, in an order that never changes:

- **The Planning card: what happens.** Hemera's face, in the expression of what happens; one
  line that says it (the Planner's own line while it works, then the facts); what the Planner does
  next; the chips of what runs (the cold read, the Probes); the four steps, one line each, with
  their count at the end. Nothing in the card leads elsewhere: what waits is right under it.
- **For you: what waits.** One line per kind, the agents blocked first: the permissions, the
  questions, the findings to settle. A line unfolds to one line per item; an item unfolds to the
  whole of it (a permission to its need card, a finding to its paragraph and Dismiss). The
  questions stand open, because answering them is the work of the page: one question whole, the
  others one line each. Nothing waits: "Nothing waits for you"; only Freeze left: "Only Freeze is
  left".
- **The rest**, one quiet line each, folded: the questions answered (and how many the Planner
  still takes in), what the cold read settled, the Probes that ended, the dependencies, the vision.

Why this one: the user sees at once how much waits and of which kind, decides the order, and
nothing grows unless they open it. A cold read of seven paragraphs is one line until it is read.

### The header

The Now line leaves the header: it is the Planning card's line now, plain text, never a button.
The header keeps who has the ball as a status mark and its word, never the face, so the face is
drawn once on the page (`MissionFrame`'s `ballFace`).

### The Needs you rows

On Planning, the mission's needs are not drawn above the Spec: they are For you's permissions
line. The other stages keep them where they are.

### The face

The face follows what happens, by what matters first, and holds still in it:

| What happens | Face |
|---|---|
| The Planner writes a section | `writing` |
| The Planner takes answers in | `thinking` |
| The Planner reads (at work, nothing being written) | `reading` |
| A permission waits | `permission` |
| A question or a finding waits | `question` |
| The cold read reads | `reading` |
| A Probe runs, nothing waits | `running` |
| Only Freeze is left, or frozen | `done` |
| The Planner stopped, or the cold read failed | `error` |
| The Planner gave no sign, or a question waits on someone | `blocked` |
| Nothing runs, nothing waits | `asleep` |

It changes through the face's own movement, once per change; a waiting face keeps the face's
slow blink at long intervals and nothing else: no loop for attention.

### Answering keeps the view

The answered question folds to its line where it stands; the next question to answer opens
right under it and takes the focus, without scrolling: it is where the user already looks, since
they just pressed an option of the answered question. Nothing measures the page to decide a
scroll. The story `Answering keeps the view` checks the answered question does not move by a
pixel and the next one is in view with the focus.

## The alternative: "Next first" (`Explorations/Planning/Next first`)

Same card, same folded rest; in place of For you, only the next thing stands whole (the first
permission, else the first question, else the first finding) and what follows it is counted on
one line ("Then: 4 questions"). Calmer, but the user cannot see what waits behind the first thing
nor choose the order; a permission blocks every question behind it. Not recommended.

## Decisions taken by default

- The four steps are status only, no longer buttons: For you, right under them, holds what they
  led to.
- Dependencies, the triage answer and a ticket's change follow the same rule (a proposed
  dependency or the triage is one For you line, a change of the ticket too); they are not drawn in
  the exploration, whose mission has none waiting.
- A finding's line truncates its first sentence to one line; unfolded, the line wraps whole.

## Not settled here

- Where For you takes the permissions of a mission from: the build ticket wires the mission's
  needs into the page.
- The face's state is read from the facts the page has; the Planner's tool calls (reading or
  writing) would say "reading" more precisely than "at work, nothing being written".
