# The living spec and the ticket and Spec settings

The validated design for the screens of #101: the living spec of a Project, and the Project
settings sections for tickets and Specs. They are drawn as Storybook stories under
**Explorations**, on the neutral Project "Acme" (repositories `api`, `web` and `shared`, missions
`ACME-12` and `ACME-14`, the GitHub repositories `acme/api` and `acme/web`, the Jira site
`acme.atlassian.net`). The data is in the shapes the engine answers (`livingSpec.*`, `tickets.*`,
`resources.*`). The building of the screens is #104.

| Screen                   | Stories                                                      |
| ------------------------ | ------------------------------------------------------------ |
| Living spec              | `Explorations/Living spec/Domain by domain`                  |
| Ticket and Spec settings | `Explorations/Ticket and Spec settings/Rows and dialogs`     |

The files are in `packages/ui/src/explorations/living-spec/` and
`packages/ui/src/explorations/ticket-settings/`.

## The living spec

The living spec is a page of its own, `Acme › Living spec`, under the window's header. It is
reached from a "Living spec" entry in the list of the settings sections and from the Project page.

**Page header.** The first reading shows as a `LiveChip` in the header, with a bell on it once
proposals wait.

**Before any domain exists.** The page says why: nothing read yet, a reading waiting for a free
slot, a reading under way, a reading that failed, or no model for the role (a need of the Project
that opens Models by role). A reading waiting for a free slot is said in words where the chip
would be; the chip has no waiting state.

**Domains.** The domains are a list down the left, as the settings list their sections, each with
its mark (validated, or waiting for you) and a count. One domain is open beside the list, with its
actions at its head: Validate this domain, Reject this domain, Re-read this domain. What is
validated is always the domain in sight.

**The limit.** Under each domain's head, beside Re-read: "Hemera does not see behaviour changed
outside a mission. If this domain changed by hand, re-read it."

**Requirements.** A validated requirement is a sentence with its id and its origin (`bootstrap`,
`ACME-12`, `ACME-12, round 1`), the origin being a link to the mission's archived Spec. Its history
folds open in place, under it.

**Proposed requirements.** A proposed requirement is a dashed outline in the warning tone, with
nothing under it but its doubt. Its words are quiet and a pencil glyph comes before it. It has a
Drop action. It is never drawn as a fact.

**Re-read.** A re-read puts what it proposes beside what holds today, in two columns: "Today", and
"Proposed instead" or "Proposed for removal".

## The ticket and Spec settings

Two sections join the Project settings page of #10, and keep its rules: a section with a problem
carries the glyph in the list; the token is never shown once saved (only "Token saved in the system
keyring", "Jira refused the saved token", "No token saved" or "No protected storage on this
system", with Replace and Remove); the command that fixes GitHub is shown with Copy and Check
again; a removal refused names the missions; the prefix says "only the next missions change" and
shows its refusal under the field; the resources say "only these commands are protected" and that
a change applies to the missions launched after it.

**Tickets and Specs.**

- A provider is one line, like a repository: its state glyph, its mark (GitHub or Jira) and host,
  and what it covers. A provider in trouble also says its sentence on its line, as well as the
  glyph, and "unreachable since 08:12" when it is. Pressing the line opens its dialog: the
  sentence, the command, Check again, the details, the Jira token and Remove.
- Adding is a menu, GitHub or Jira, each opening its form in the dialog. Jira's form has Cloud and
  Data Center as tabs, preselected from what the site reports (`tickets.jiraDeployment`).
- Under the providers, one frame of Spec fields: where Specs live (a select, with what the mode
  does under it), the Spec language (a short list), the sync interval with the last check (only
  for linked Specs), and the key prefix. The "remote" mode is not offered until #98 is merged.

**Exclusive resources.** A resource is one line: its commands, its restore or "no restore: a need
opens at the start", and who holds it. Pressing it opens its dialog.

## Decisions

- Both screens follow the first proposal: the living spec "Domain by domain", the settings "Rows
  and dialogs".
- The living spec is its own page, reached from a "Living spec" entry in the settings section list
  and from the Project page.
- A proposed requirement is a dashed draft with its doubt, never shown as a fact.
- The limit line ("Hemera does not see behaviour changed outside a mission") stands under each
  domain's head.
- A requirement's history folds open in place.
- The Jira form has Cloud and Data Center as tabs, preselected from what the site reports.
- A reading waiting for a free slot is said in words. The `LiveChip` gets no new state for now.
- A provider in trouble shows its sentence on its line as well as the glyph.
- The "remote" Spec mode is hidden until #98 is merged.
- The Spec language is a short list.
- The GitHub and Jira brand icons are kept.

## Still to come from the engine

The sync interval and the last check (`tickets.syncInterval`, `tickets.lastCheck`, #97) and the key
prefix setter (#34) are not in the IPC yet. The Spec language is `planning.specLanguage` (a
language tag). The interval's minimum is the engine's to say.
