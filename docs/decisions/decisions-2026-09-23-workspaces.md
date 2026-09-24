# Decisions of 23 September 2026 — one Spec, one Workspace; branches kept

**Status:** decided by the maintainer while framing issue #20 (Real Workspaces), points 8 and 9
of its Proposal. They prevail over the paragraph of [`core.md`](../product/core.md) that let
several Specs share a Workspace, which is edited in the same pull request. The lot's own design
decisions (D8-01 to D8-17), and those added to it on 24 September, stay in the issue: they do
not cross lots.

## One Spec has one Workspace, in this version

A Spec is associated with one Workspace. A dedicated Workspace belongs to the Spec it was made
for and is not offered to another; a Spec that does not want one of its own reuses `main` or a
Workspace the user created on a folder they picked. Sharing a Workspace between builds — a second
build on the same space waiting explicitly, a Workspace kept as long as another use remains —
is the build lot's to coordinate.

### Why

The wait of a second build needs something to wait on: the holding `build` Session, its phases
and the moment it is done with the space. The `build` mission has no protocol yet; the first
`build` Session, as issue #20 designs it, has no phase and no worker. A wait written now would
end on a guess, and would have to be written again when the build lot says what "done with the
space" means. A dedicated Workspace is also named after its Spec, down to its branches
(`<prefix>/<key>-<slug>`): a second Spec building there would commit onto a branch that names
the first.

### The alternative set aside

Sharing now: several Specs on one Workspace, the second build waiting visibly until the holding
`build` Session is archived, and a cleanup refused as long as another Spec needs the space. It
is the target core.md describes, and it stays so; it is postponed, not refused.

## A cleanup never deletes a branch

Cleaning up a dedicated Workspace is a click of the user: its worktrees are removed, its folder
deleted, and the branches the worktrees were on are kept in every repository. Deleting a branch
stays the separate external action core.md describes in "External actions and delivery", under
the Project's policy.

### Why

A cleanup frees the disk; it must not lose work. Git refuses to remove a worktree that holds
uncommitted changes, which covers what is not committed; what is committed and not merged lives
on the branch alone, and a cleanup is the moment nobody is looking at it. Keeping the branch
makes a cleanup harmless by construction: nothing committed is lost, and the branch is deleted
when the user decides to, where core.md already puts that decision.

### The alternative set aside

Deleting the branches with the worktrees. It leaves the repositories tidy, and it turns a click
meant to free a folder into the loss of every commit that was not merged yet.

— the maintainer
