# Working on Nookstacks

## Branches

- **`main`** is what people have installed. Nothing lands here by accident: a
  push to `main` deploys nookstacks.io, and a tag on `main` publishes a release
  that every installed copy will offer to download.
- **`dev`** is where work happens. Builds run there, nothing is published, and
  nothing reaches a user until it is merged.

Work on `dev`, or on a branch cut from it. Merge into `dev` freely. Merge
`dev` into `main` only to cut a release.

## Versions

`MAJOR.MINOR.PATCH`, and the number says what happened:

| Change | Bump | Example |
| --- | --- | --- |
| New thing the user can do | **MINOR** | `0.3.0` → `0.4.0` |
| Behaviour of an existing thing changes | **MINOR** | `0.3.0` → `0.4.0` |
| A fault is repaired, nothing new | **PATCH** | `0.4.0` → `0.4.1` |
| A translation, a typo, a dependency bump | **PATCH** | `0.4.1` → `0.4.2` |

A fix is never a reason to move the middle number. If a release contains one new
feature and nine repairs, it is a MINOR: `0.4.0`, not `0.3.10`.

While 0.x, the first number stays put: 0.9.0 comes before 1.0.0, and 1.0.0 is
reserved for the point where the file format and the vault layout are frozen.

## Cutting a release

1. On `dev`: bump `version` in `src-tauri/Cargo.toml` **and**
   `src-tauri/tauri.conf.json` to the same number, and update `Cargo.lock`.
2. Write the changelog entry: what a user can now do, and what stopped being
   broken.
3. Merge `dev` into `main` (`git checkout main && git merge --no-ff dev`).
4. Tag it: `git tag -a v0.4.0 -m "0.4.0"` and push the tag.
5. CI builds the installers, writes `latest.json`, and publishes. Installed
   copies offer the update on their next check. nookstacks.io redeploys from the
   same merge.

A release is not a save point. If `dev` is half-way through something, it does
not go to `main`; cut the release from the last commit where everything works.

## Trying a build before it ships

Tag with a pre-release suffix: `v0.4.0-rc1`. CI publishes it as a GitHub
**pre-release**, which `/releases/latest` does not return — so nobody's app
offers it, but the installers are there to download by hand.

Local work needs no version bump at all. Bump once, at the point of release.
