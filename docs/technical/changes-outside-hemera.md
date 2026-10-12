# Changes outside Hemera

While a mission is in Building or Review, the engine (`apps/desktop/src/engine/building/outside.ts`)
compares each repository of its Workspace with the tree it expects. It compares every 30 s, when
the window regains the focus, before a gate write, before a command launches, and when the
Building page reads.

## Attribution

A compare snapshots the repository first. It then reads what Hemera wrote since the last compare.
Each changed file is explained, in this order, by:

1. a gate write (`fs_write`) whose fingerprint matches the file;
2. a writing command running in that repository, or ended since the last compare, when the file
   is within its declared globs;
3. a `serve` running in that repository, when the file is within its write globs.

A file none of them explains is changed outside Hemera. It is recorded with both sides, marked on
the mission, told in the Journal, and told to the Builder and to the runners whose targets are in
that repository. The found tree becomes the expected tree, so a change is reported once.

The writers are read after the snapshot. Read before it, a write that ends during the snapshot
would be reported as a change made outside.

## The bound of the uncertainty

**While a writing command runs in a repository, a change you make in that repository, within the
command's globs, is attributed to the command.** It is not reported as changed outside Hemera. The
window lasts from the command's launch until Hemera records its end. A `serve` that declares no
write globs explains nothing, so there is no blind window while a service runs.
