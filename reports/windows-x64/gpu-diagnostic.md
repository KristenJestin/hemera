# GPU diagnostic — Windows x64

`chrome://gpu` read in a development diagnostic window opened with the same Electron binary,
and compared feature by feature with what `env.report` says. Adapter: NVIDIA GeForce RTX 3070
Ti, ANGLE over Direct3D 11, initialisation 205 ms, GPU process sandboxed, in-process GPU false.

## Compositing matériel constaté

| `chrome://gpu` | `env.report` |
|---|---|
| Canvas: Hardware accelerated | `2d_canvas: enabled` |
| Direct Rendering Display Compositor: Disabled | `direct_rendering_display_compositor: disabled_off_ok` |
| Compositing: Hardware accelerated | `gpu_compositing: enabled` |
| Multiple Raster Threads: Enabled | `multiple_raster_threads: enabled_on` |
| OpenGL: Enabled | `opengl: enabled_on` |
| Rasterization: Hardware accelerated | `rasterization: enabled` |
| Raw Draw: Disabled | `raw_draw: disabled_off_ok` |
| Skia Graphite: Disabled | `skia_graphite: disabled_off` |
| TreesInViz: Disabled | `trees_in_viz: disabled_off` |
| Video Decode: Hardware accelerated | `video_decode: enabled` |
| Video Encode: Hardware accelerated | `video_encode: enabled` |
| WebGL: Hardware accelerated | `webgl: enabled` |
| WebGPU: Hardware accelerated | `webgpu: enabled` |
| WebNN: Disabled | `webnn: disabled_off` |

Fourteen features, fourteen agreements. Hardware compositing and GPU rasterisation are both on,
so the scenario *Dégradation nommée* does not apply on this machine and nothing is to report
before lot 1.

## No flag was added

Command line of the application, read from the running process:

```
electron.exe .\apps\desktop
```

Command line of its GPU process: Chromium's own arguments only — `--type=gpu-process`,
`--user-data-dir`, `--gpu-preferences`, feature flags Chromium sets for itself. No
`--no-sandbox`, no `--disable-gpu`, no `--in-process-gpu`, no `--single-process`, no ozone hint.

## Not verified by this file

Linux/Wayland. The same reading has to be done on Arch/Hyprland and on Ubuntu 24.04, where the
backend the GPU process ended up on is also read from its command line — that is task 3.2 of
`lot-0-linux`.
