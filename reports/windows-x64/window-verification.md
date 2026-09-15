# Window verification — Windows x64

Target: Windows 11 Pro 10.0.26200, Electron 44.3.0, Chromium 152.0.7977.78, Node 24.20.0.
Three displays: two at 1920×1080 (one at scale 1, one at scale 1.5) and one at 1080×1920.

**Linux/Wayland is not verified by this file.** Tasks 2.2, 2.3 and 2.4 stay open until the same
acts have been performed on Arch/Hyprland and on Ubuntu 24.04.

## Ouverture sous Windows à l'échelle 150 %

The window was placed on the display scaled at 150% and driven there.

| Act | Observed |
|---|---|
| Frame | No system title bar; the system draws its own buttons in the overlay (`window-scale-150.png`) |
| Minimize | `IsIconic` true after clicking the button |
| Maximize | `IsZoomed` true after clicking the button |
| Restore | `IsZoomed` false after clicking it again |
| Drag strip | Dragging the strip moved the window from `1980,60` to `2109,189` |
| Witness text | Sharp at 1.5, no upscaled edges (`window-scale-150.png`) |

## Échelle fractionnaire par écran

The window was moved from the display at scale 1 to the display at scale 1.5.

| Display | Scale reported by the platform | Page pixel ratio | Window rect |
|---|---|---|---|
| 1920×1080, primary | 1 | 1 (`window-scale-100.png`) | 900×620 |
| 1920×1080, second | 1.5 | 1.5 (`window-scale-150.png`) | 1050×675 for the same logical size |

The page reads its ratio again when it changes, so the figure in the witness text is the one of
the display the window is on, not the one it started on.

## Aucun flash blanc

Cold start, sampling the pixel at the centre of the window rect every 20 ms from the moment the
window handle exists.

| Time since start | Colour at the window's centre |
|---|---|
| 164 ms | the window handle exists |
| 220–456 ms | what is behind the window, still visible through its place |
| 468 ms onwards | `#12141A`, the application's background colour |

No white frame at any point. The window's own first image is the application's background
colour; before that, nothing of the window is painted at all.
