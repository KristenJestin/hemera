# End-to-end run — Windows x64

`pnpm --filter @hemera/desktop e2e`, driving the built application with
`@wdio/electron-service` 10.3.0 on Electron 44.3.0 / Chromium 152.0.7977.78.
Result: **9 passing, 2 skipped**, 2 spec files. Full output in `e2e-output.txt`.

**Linux/Wayland is not verified by this file.** The same suite has to be run on Arch/Hyprland
and on Ubuntu 24.04 before tasks 3.3 and 7.1 can close.

## What ran

| Scenario | Suite |
|---|---|
| Renderer sans Node | no `require`, no `process`, no `module`, no `ipcRenderer`, no `Buffer`; one bridge with one key |
| Appel typé nominal | `env.report` answers with the versions and the displays of this machine |
| Message non conforme | `window.command` with an undeclared command is refused, naming the channel and the field |
| Ouverture sous Windows à l'échelle 150 % | one frameless window, `#12141a` background, drag strip `drag` and its control `no-drag` |
| Transition à la fréquence de l'écran | no frame above two display periods |
| Compositing matériel constaté | `gpu_compositing` and `rasterization` enabled, adapter named |

## What skipped, and why

- **Échelle fractionnaire par écran** — the three displays were all at scale 1 when the suite
  ran. The scenario was verified by hand earlier the same day at 100% and 150%, with captures
  recorded in `window-verification.md`; the suite covers it on a machine that keeps two scales.
- **Dégradation nommée** — this machine composites in hardware, so there is no degradation to
  name. The suite covers it on a machine whose driver refuses acceleration.

A skipped suite keeps its name, so the traceability table still reads it as the test of the
scenario it is named after.
