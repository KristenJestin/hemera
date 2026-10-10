# The Project page, the mission frame and coming back

The validated design for the Project page, the mission frame and Home, now built. The screens are
drawn in Storybook on a neutral journey: a Project "Acme" with `api`, `web` and `shared`, missions
`ACME-5` to `ACME-19`, the ticket `acme/shop#41`, and Hemera as a second Project on Home. Light
and dark come from the toolbar; 1920×1080 and 1366×768 from the viewports.

| Screen        | Stories                                                     |
| ------------- | ----------------------------------------------------------- |
| Project page  | `Surfaces/Project page`                                     |
| Start field   | `Blocks/Start/StartField`                                   |
| Sidebar       | `Shell/Sidebar`                                             |
| Mission frame | `Surfaces/Mission`                                          |
| Home          | `Surfaces/Home`                                             |
| The window    | `Shell/Window`, every screen in the sidebar and its header  |

## What the screens share

- The start field searches first and creates last: missions, then tickets, then "Create a mission"
  always last. The results unfold under the field and push the page down.
- The triage answer stands under the field with its way out ("Start a mission anyway").
- The marks are six glyphs: blocked, waiting, needs you, outdated, changed outside Hemera, fixing.
  Blocked and waiting write their cause after the glyph ("Blocked by ACME-9", "Waiting on CI on
  acme/shop#52"), because a block always names its cause. The other marks stay glyphs, with their
  legend in a tooltip.
- Cancel is a visible button at every stage before Done. It asks once, saying the work is kept
  until the cleanup is confirmed.
- The needs of a mission stay at the top of its page.
- The Questions group is drawn only while a question waits.
- The frozen Spec is said once, by a lock in the stage.

## Project page

Two columns. The missions take two thirds; a rail on the right holds what belongs to the Project
but is not a mission.

- **Start field** at the top of the missions column.
- **Missions** grouped by stage (Shipping, Review, Building, Planning, Ready, with Done folded) as
  framed lists. A mission is two lines: the key, title and time; then the ball, the last event, and
  the marks.
- **Rail**: the living spec as a card showing its domains, and the Chats.

## Mission frame

Three lines.

1. Key, title, the stage's action and Cancel.
2. The stage as a track of the six stages, the current one lit, with the lock on Planning once the
   Spec is frozen.
3. The ball with its words (Hemera's face when the agent works), the marks, the type, the ticket
   link, the branch and the Spec.

The needs of the mission stand right under the frame.

## Home

Since you left leads, two thirds wide: each mission that moved is a card with its events, newest
first. Recent stands under it. Needs you and Questions stand in the right column. Since you left
has no read state; it is what happened since Home was last looked at. An empty Home is one quiet
state, Hemera asleep.

## Sidebar

The sidebar follows the two-line row of the Project page. It is drawn with the screen itself;
where Cancelled missions go is settled there.

## Decisions

- **Design**: two lines and a rail is the chosen design.
- **Since you left** counts from the last look at Home. There is no read state: no unread dot, no
  "Mark all read".
- **Home** leads with what happened while the user was away. Needs you and Questions stand in the
  right column.
- **Who has the ball in Shipping and Review**: "Waiting on someone" plus a waiting mark naming what
  it waits on (CI, an approval) is enough. There is no new ball value.
- **The living spec** is a card with its domains in the side column of the Project page.
- **The sidebar** follows the two-line row, drawn by the screen itself.
