# AGENTS.md — the desktop application

Read the root `AGENTS.md` first; this file adds the rules for `@hemera/desktop`. Effect code
here (the engine, main) follows `packages/core/AGENTS.md`; the renderer's interface follows
`packages/ui/AGENTS.md`.

## The window and the process model

- **Main process**: ESM, minimal. It takes the single-instance lock and creates the window.
  Anything that must precede `ready` is awaited at the top level of the entry point. Nothing
  blocking, no heavy `require` at module level.
- **Preload**: CommonJS — a sandboxed preload does not support ESM. A few dozen lines that
  expose a narrow API through `contextBridge`, never raw `ipcRenderer`.
- **Renderer**: React 19 served by Vite, sandboxed and isolated, no access to Node.
  `navigator.clipboard` only.
- The window is frameless with Window Controls Overlay, shown immediately on the background
  colour of the system's theme. The renderer marks its drag zone; the controls stay `no-drag`.
- **Refused, and checked by `node tools/window-options.ts`**: any `webPreferences` option
  outside `sandbox`, `contextIsolation`, `nodeIntegration: false`, `backgroundThrottling`,
  `spellcheck` and `preload` — in particular `additionalArguments`, `enableBlinkFeatures`,
  `disableBlinkFeatures`, `experimentalFeatures`, `offscreen` and any non-default partition.
  No `commandLine.appendSwitch`, no ozone flag, no `--no-sandbox`, `--single-process`,
  `--in-process-gpu` or `--disable-gpu`.
- Wayland has no `win.setPosition()` and no `screen.getCursorScreenPoint()` by design of the
  protocol. They are not used.
- What the application says about itself goes to `diagnostic.log` in its data folder (main, the
  engine and the agents' processes, each line saying which one). Read it first when a run
  misbehaves.

## The end-to-end suite

```
pnpm build                                    # first: the suite drives apps/desktop/dist
pnpm --filter @hemera/desktop e2e:headless    # never the visible `e2e`
```

- Headless only, and **one run at a time on a machine**, under the lock folder (root
  `AGENTS.md`). Every spec file has its own data folder, `hemera-e2e-<spec>` in the temporary
  directory, so two runs at once corrupt each other and fail for no reason of their own. Delete
  leftover `hemera-e2e-*` folders before a run if the last one was interrupted.
- Every spec file is one capability. `e2e:headless --spec <file>` runs that file once per
  capability on the wrong data folders: run the full suite, or a local subset config.
- `N passed, M total` from wdio counts spec files × capabilities: "14 passed, 196 total (7%
  completed)" is a full green run of 14 spec files.
- On Linux, an off-screen window means nothing to a Wayland compositor: the headless config
  starts its own weston per worker (`weston --backend=headless --renderer=pixman`, `DISPLAY`
  unset, `WAYLAND_DISPLAY` set to its socket) and never opens a window on the desktop. Do not
  start another weston.
- On Linux, start the suite fully detached (`setsid nohup … &`) and wait on its log: started
  from an agent's background shell it may receive a SIGINT within seconds.
- An interrupted run can leave a half-unpacked chromedriver in `/tmp/chromedriver/linux-<version>`
  (the folder exists, the binary does not), and every later run then fails at once. Delete that
  folder, or download and unzip the driver by hand from chrome-for-testing.

## Running the app

- Never run the app for the maintainer from a worktree an agent is editing: the dev server
  hot-reloads half-written code. Run it from a worktree of its own, detached on the branch under
  test, and update it only on purpose.
- Start the app detached (`setsid nohup pnpm dev … &`). Started from an agent's shell, it dies
  with the session (Electron aborts with "GPU process isn't usable").
- Stopping the shell that started Electron or Storybook can leave their processes alive: kill
  them by port or by command line.
