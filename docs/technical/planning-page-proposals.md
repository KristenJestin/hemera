# The Planning page: two proposals

Two proposals for the Planning page of a mission, drawn in Storybook under **Explorations ›
Planning › A · The Spec with its rail** and **B · What to settle first**. Both stand inside the
validated mission frame of "Two lines and a rail" (`docs/technical/coming-back.md`): the key, the
title, the stage's action and Cancel; the stage track; the ball with the Planner's Now line, the
marks, the type, the ticket and the Spec. Both play the same journey on the same neutral data: the
Project "Acme" with `api`, `web` and `shared`, the mission `ACME-12` "Export notes as Markdown"
from `acme/shop#41`, and its neighbours `ACME-16` and `ACME-20`.

The page is live in the catalogue: an answer, a dismissal, a dependency accepted, Freeze, Return to
Planning and the rest change it as the engine would, so each story can be played by hand. Light and
dark come from the toolbar; 1920×1080 and 1366×768 from the viewports.

## The journey

Each proposal has the same eighteen stories: the Planner writing the first draft; two waves with a
question open, one waiting on someone with its note and drafted message, a changed answer, and a
withdrawn, a replaced and a moot question; answering by a press and from the keyboard; a discussion
open with the agent's proposed decision; a Probe running beside two that ended; a Probe that does
not reproduce, its report open; the cold read running, reported on an earlier text with findings to
settle, and failed; a proposed dependency; what changed since the last read; the vision; ready to
freeze; Freeze refused with its reasons; frozen in Ready, with Return to Planning; outdated, with
the ticket's difference; and long text in every field.

The data follow the Planning engine's read models (`planning.spec`, `planning.waves`,
`planning.inputs`, `discussions.list`, `probes.list`, `coldRead.list` and `coldRead.freshness`,
`missions.freezeReadiness`, `dependencies.list`), mirrored as plain values in
`packages/ui/src/explorations/planning/model.ts`.

## What both share

- **Freeze** stands in the head only when the engine offers it; before that it is not there. Once
  frozen, the lock is in the stage track and the head's action is Return to Planning.
- **A refused Freeze** names each thing that blocks it, near the top of the page.
- **A question** shows its options, the recommended one with a star and why. A press answers at
  once: there is no Send. "In my own words" opens the mention field. "I'm waiting on someone"
  marks the question with the waiting glyph, keeps the note, and the Planner's drafted message has
  Copy, never Send. A changed answer says "Now B, before A". A withdrawn, replaced or moot question
  stays readable with its reason.
- **Each input** (an answer, the vision) wears a dot: a ring when received, a blue dot when
  delivered to the Planner, a green dot when integrated (CT-26). The words are in the tooltip.
- **A Probe** is a LiveChip with no × and no stop; pressed once ended, its report opens over the
  page.
- **The cold read** shows its chip while it runs, says "The cold read read an earlier text" with
  the changes since, lists its findings by severity with what became of each (asked as a question,
  fixed by the Planner, dismissed), offers Dismiss, and "Run another cold read" is the user's only
  way to launch one.
- **The Spec** is read, never edited: the eight sections with their state, requirements with their
  delta, the living requirement they change ("itself still proposed" when it is), scenarios with
  their Proof block (the output seen today with its key line, "Verified by hand"), and the tasks
  folded at the end.
- **Discuss** shows the conversation at a reading measure, the proposed decision with Accept,
  "Write a decision" and "Close without a decision".

## A · The Spec with its rail

The Spec leads. The page is the document being written, read in the middle at its measure, with
its eight sections in a rail on the left. What changed since the last read is marked where it
changed, with one line on top and Mark as read. The right-hand rail holds what calls for the user,
beside the text it is about: the waves, newest first, compact, the questions answered before you
came back folded to one line with Change; the cold read; the dependencies; and the vision field,
always there. The Probes ride on the head's third line, after the Now line. Discuss and a Probe's
report open as views over the page.

## B · What to settle first

What calls for the user leads. The main column is the list of what is to settle, with its count:
the refusal or the ticket's difference first, what changed since the last read (each item before
and after, and Mark as read), the waves at full width with the details of every option, a
discussion unfolding in place under its question, the cold read's findings, and the dependencies.
A wave whose questions are all settled folds to one line. When nothing has been asked yet (the first
draft) or nothing can be asked (frozen), the Spec itself takes the column. The right-hand rail holds
the Spec as an outline (its eight sections and their state, each opening the Spec as a view), the
Probes, and the vision, given in a view.

## What differs

| | A | B |
|---|---|---|
| What leads | the Spec | the questions and what else is to settle |
| The Spec | the page itself, three columns | an outline in the rail, read as a wide view; the page when nothing calls |
| Questions | compact in the right rail: the options by their labels, the recommendation and its reason | full width, with why it is asked and every option's detail |
| Discuss | a view over the page | in place, under its question |
| What changed since the last read (open question 12) | marks in the text and one line on top | a list, before and after, at the top of what to settle; the marks again in the Spec view |
| The vision (open question 7) | a field always in the rail | "Give it" in the rail, a view with the field and what was given |
| Answered questions | one line with Change, for those answered before you came | the wave folds once settled |
| Probes | on the head's third line | in the rail |
| At 1366×768 | the Spec column is narrow between two rails | two columns, the questions keep their width |

## Recommendation

**B.** The questions are the heart of Planning (#103): they come with their options and the reasons,
and B gives them the room to read both, where A shortens the options to their labels. B keeps the
Spec what it is on every other stage, a view opened from the frame, while still giving it the page
when there is nothing to answer. A discussion in place keeps the question in sight while it is
discussed. At 1366×768, A's three columns leave the Spec narrow; B keeps two.

From A, B could take the marks of what changed in the Spec view, which it already does.

## Open questions for the maintainer

1. **The Spec**: the page (A), or a view with the page given to what is to settle (B)?
2. **What changed since my last read** (open question 12): marks in the text (A), a list before
   and after (B), or both as B does?
3. **The vision** (open question 7): a field always on the page (A), or a view opened from the rail
   (B)?
4. **Discuss**: a view over the page (A), or in place under its question (B)? In both, a closed
   discussion is read again from its question ("Open the discussion").
5. **Answered questions**: folded one by one with Change (A), or the whole wave once it is settled
   (B)?
6. **The needs strip of the frame**: in Planning the questions are the needs, so the page shows them
   once and the strip is not drawn. Is that right?
7. **The input dots**: a ring received, a blue dot delivered, a green dot integrated. Clear enough
   with the words in the tooltip?

Not drawn yet, for the chosen proposal: the Planner's triage answer with Keep planning, a proposed
answer from the ticket (Accept, Edit, Dismiss), a restart in the middle, and the image sequences of
a wave arriving, a dot moving to integrated and Freeze appearing.
