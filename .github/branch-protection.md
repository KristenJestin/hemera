# Branch protection

`main` and `dev` are protected. Locally, the versioned `pre-commit` hook refuses any commit
made directly on them; run `bun tools/install-hooks.ts` once after cloning to enable it.

On a remote, the same rule is configured as a server-side protection rule on `main` and `dev`
(no direct push, pull request required). No remote is a prerequisite for local development,
and none is configured yet.
