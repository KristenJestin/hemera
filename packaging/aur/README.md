# AUR packages

Two packages install Hemera on Arch Linux from its GitHub releases:

| Package | Follows | Installs |
|---|---|---|
| `hemera-bin` | the release of each `vX.Y.Z` tag on `main` | `/opt/hemera`, `/usr/bin/hemera` |
| `hemera-beta-bin` | the pre-release of each `vX.Y.Z-beta.N` tag on `dev` | `/opt/hemera`, `/usr/bin/hemera` |

Both repackage the release's deb: it already holds the application, its `.desktop` entry and its
icons, and it is unpacked with `bsdtar` without running anything. The AppImage would have to be
executed to be extracted.

The two install to the same place — `/opt/hemera`, `/usr/bin/hemera`, `hemera.desktop` and the
`hemera` icon — and both `provide` and `conflict` with `hemera`, so installing one replaces the
other. They share one data folder (`~/.hemera`) and one Electron profile, so only one of them is
ever installed. The beta's deb names its files `hemera-beta`; `hemera-beta-bin` installs them
under `hemera`, and its launcher keeps the name the deb gives it, "Hemera Beta".

The betas and the releases follow one version line: `dev` publishes the next version as
`vX.Y.Z-beta.N`, and merging into `main` publishes `vX.Y.Z`. pacman takes no dash in a `pkgver`,
so a beta's is its version with the dash and the dot taken out: `v0.5.0-beta.1` becomes
`0.5.0beta1`. pacman orders a version with letters after its numbers before the same numbers
alone, so `vercmp` answers `0.4.0` < `0.5.0beta1` < `0.5.0beta2` < `0.5.0beta10` < `0.5.0`, and
installing the release over a beta of the same version is an upgrade. The older `beta-<describe>`
pre-releases stay on the Releases page; nothing reads them any more.

## How they are updated

`node tools/aur-publish.ts <package> <tag>` writes the version, `pkgrel=1`, the checksum of the
deb it downloads and the matching `.SRCINFO`. With `--out <folder>` it writes them there instead of
here; with `--push` it commits them to `ssh://aur@aur.archlinux.org/<package>.git`, using the
private key in the `AUR_SSH_KEY` environment variable.

- `release.yml` runs it once the packages of a tag are attached to its release: for
  `hemera-bin` after a `vX.Y.Z`, for `hemera-beta-bin` after a `vX.Y.Z-beta.N`. Run by hand with
  a `tag`, it builds an existing tag again and publishes its package the same way;
- `aur.yml` builds both, updated to the newest version tag each follows that has a deb attached,
  with `makepkg` and `namcap` in an Arch Linux container on every pull request that touches
  them. It publishes nothing. Before the first beta of the line is out, it only checks the
  committed `.SRCINFO` of `hemera-beta-bin`, whose checksum is `SKIP` until then.

Without the `AUR_SSH_KEY` secret, the publishing steps print a notice and succeed.

## The first time

1. Create an account on <https://aur.archlinux.org> and give it a new SSH public key made for
   this purpose only (`ssh-keygen -t ed25519 -C hemera-aur -f hemera-aur`).
2. Push each package once, which creates it on the AUR:

   ```sh
   git clone ssh://aur@aur.archlinux.org/hemera-bin.git
   cp packaging/aur/hemera-bin/PKGBUILD packaging/aur/hemera-bin/.SRCINFO hemera-bin/
   cd hemera-bin && git add PKGBUILD .SRCINFO && git commit -m "Initial import" && git push origin HEAD:master
   ```

   `hemera-beta-bin` is pushed the same way once a `vX.Y.Z-beta.N` release carries its deb,
   with `node tools/aur-publish.ts hemera-beta-bin <tag>` run first so it holds that version.
3. Add the private key as the repository secret `AUR_SSH_KEY`
   (Settings, Secrets and variables, Actions).

From then on, every release and every beta updates its package.

## Changing a PKGBUILD

Edit it here, then write its `.SRCINFO` again with `makepkg --printsrcinfo > .SRCINFO` in its
folder. The next release or beta carries the change to the AUR.
