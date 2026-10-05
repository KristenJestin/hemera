# Third-party notices

What Hemera ships that it did not make, where it comes from, and under which licence. Code that
is only vendored into the tooling (`tools/oxlint/*`, `.agents/skills/*`) carries its licence in
its own folder.

## Sound styles: UI SFX

The sound styles other than "Hemera" (`apps/desktop/sounds/<style>/`) are taken from
[UI SFX](https://github.com/romainsimon/uisfx), version 0.4.0, commit
`9950fe66f993a6660dab9c2651dcbcd899ffd83b`, files `packages/uisfx/sounds/<pack>/<cue>.ogg`.

- Audio: CC0 1.0 Universal, dedicated to the public domain by Yuki Capital
  (<https://creativecommons.org/publicdomain/zero/1.0/legalcode>). Code: MIT, none of it shipped.
- Only the 36 files below are shipped, never the library. Each was converted from Ogg to a
  mono 16-bit WAV at 32 kHz, since Windows' player reads only WAV, with nothing else changed:
  `ffmpeg -i <cue>.ogg -ac 1 -ar 32000 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact <sound>.wav`.
- Each style is one of UI SFX's packs, and the same cue serves each of Hemera's sounds in every
  pack: `mention` (the user is directly addressed) for "needs you", `error` (an action failed
  and needs attention) for "error", `complete` (a multi-step process reaches its final state)
  for "done".

| Style | Pack | Needs you | Error | Done |
|---|---|---|---|---|
| Minimal | `minimal` | `mention` | `error` | `complete` |
| Soft | `soft` | `mention` | `error` | `complete` |
| Glass | `glass` | `mention` | `error` | `complete` |
| Arcade | `arcade` | `mention` | `error` | `complete` |
| Mechanical | `mechanical` | `mention` | `error` | `complete` |
| Organic | `organic` | `mention` | `error` | `complete` |
| Dreamy | `dreamy` | `mention` | `error` | `complete` |
| Sci-fi | `scifi` | `mention` | `error` | `complete` |
| Rubber | `rubber` | `mention` | `error` | `complete` |
| Cinematic | `cinematic` | `mention` | `error` | `complete` |
| Studio | `studio` | `mention` | `error` | `complete` |
| Zen | `zen` | `mention` | `error` | `complete` |

The "Hemera" style (`apps/desktop/sounds/hemera/`) is Hemera's own.
