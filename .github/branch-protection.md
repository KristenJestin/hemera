# Branch protection

`main` and `dev` are protected. Locally, the versioned `pre-commit` hook refuses any commit
made directly on them; run `bun tools/install-hooks.ts` once after cloning to enable it.

On a remote, the same rule is configured as a server-side protection rule on `main` and `dev`
(no direct push, pull request required). No remote is a prerequisite for local development,
and none is configured yet.

## Merge method (to set on the repository)

Two settings, both under *Settings → General → Pull Requests*, and neither of them something a
commit can enforce:

- **Allow squash merging only.** Merge commits and rebase merging are turned off, so every
  change reaches `main` and `dev` as exactly one commit.
- **Squash merge commit message: “Pull request title and description”.** The title of the pull
  request becomes the subject of that commit, which is why the title is a plain Angular subject
  and why the ticket is named in the footer as `Refs: HEM-n`. semantic-release reads those
  subjects on `main` to decide the version (design D3-10).
