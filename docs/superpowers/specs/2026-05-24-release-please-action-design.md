# Release Please Action Design

Date: 2026-05-24
Status: approved for implementation planning

## Summary

Introduce `googleapis/release-please-action` for this TypeScript GitHub Action repository while keeping the existing weekly merged pull request changelog workflow.

Release Please will own SemVer release pull requests, `CHANGELOG.md`, GitHub Releases, and release tags such as `v0.1.0`. The weekly changelog workflow will keep producing `WEEKLY_MERGED_PULL_REQUESTS`, but its CalVer tags will move to the `weekly-YYYY.MM.DD` namespace so they do not overlap with Release Please's `vX.Y.Z` tags.

## Goals

- Add Release Please automation using `googleapis/release-please-action`.
- Use the same `PULL_REQUEST_CREATOR` GitHub App token source as the weekly changelog workflow.
- Bootstrap releases from `0.0.1` so the first Release PR proposes `0.1.0` from existing Conventional Commit history.
- Keep Release Please PRs manually merged.
- Create GitHub Releases and SemVer tags when Release Please release PRs are merged.
- Update the moving major tag `v0` after each 0.x release.
- Keep weekly merged PR logs separate from release changelogs.
- Keep workflow permissions minimal.

## Non-Goals

- Do not auto-merge Release Please PRs.
- Do not publish to npm.
- Do not regenerate `dist/index.js` as part of Release Please PRs.
- Do not let Release Please manage `pnpm-lock.yaml`.
- Do not replace `WEEKLY_MERGED_PULL_REQUESTS` with `CHANGELOG.md`.
- Do not create `v0.1` moving minor tags.

## Alternatives Considered

### Manifest-Based Release Please With Weekly Tag Prefix Split

This is the selected approach.

Add source-controlled Release Please config files, add a dedicated Release Please workflow, and update the weekly CalVer workflow to pass `tag_prefix: weekly-` to `calver-beacon-action`.

Benefits:

- Explicit release bootstrap through `.release-please-manifest.json`.
- Reviewable release policy in `release-please-config.json`.
- Clean separation between weekly CalVer tags and SemVer release tags.
- Fits the repository's existing SHA-pinned workflow style.

Trade-off:

- Adds two Release Please config files and one workflow.

### Workflow-Input-Only Release Please

This would configure `release-type: node` directly in the workflow and avoid config files. It is not selected because it does not fit the agreed manifest bootstrap as cleanly and spreads release policy into workflow inputs.

### Release PR Only With Separate Release Workflow

This would use Release Please only for release pull requests and create tags/releases elsewhere. It is not selected because the standard Release Please flow already creates releases after release PR merge, and splitting it would add unnecessary moving parts.

## Release Please Workflow

Create `.github/workflows/release-please.yml`.

The workflow runs on:

- `push` to `main`.
- `workflow_dispatch` for manual recovery or initial verification.

Permissions are limited to:

- `contents: write` for release branches, tags, and GitHub Releases.
- `pull-requests: write` for Release Please PR creation and updates.

The workflow does not request `issues: write` because labeling is disabled.

The workflow first creates a GitHub App token using the same source as the weekly changelog workflow:

- `vars.PULL_REQUEST_CREATOR_APP_ID`
- `secrets.PULL_REQUEST_CREATOR_APP_PRIVATE_KEY`

That token is passed to Release Please and later used for checkout and tag push during moving major tag updates.

The Release Please step uses the pinned action reference:

```yaml
uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071 # v4.4.1
```

It points at the source-controlled config files:

```yaml
with:
  token: ${{ steps.pr-creator-token.outputs.token }}
  config-file: release-please-config.json
  manifest-file: .release-please-manifest.json
```

## Release Configuration

Add `release-please-config.json`:

```json
{
  "release-type": "node",
  "include-component-in-tag": false,
  "skip-labeling": true,
  "packages": {
    ".": {
      "release-type": "node",
      "include-component-in-tag": false
    }
  }
}
```

Add `.release-please-manifest.json`:

```json
{
  ".": "0.0.1"
}
```

Release Please manages these files:

- `package.json`
- `.release-please-manifest.json`
- `CHANGELOG.md`

Release Please must not be extended in this change to manage `pnpm-lock.yaml` or regenerate `dist/index.js`.

The initial Release PR should use existing Conventional Commit history. Because Release Please treats `0.0.0` as an initial release that can become `1.0.0`, the manifest starts from `0.0.1` so the existing `feat:` commit proposes `0.1.0`.

## Moving Major Tag

When the Release Please step reports `release_created`, the workflow checks out `steps.release.outputs.sha` using the `PULL_REQUEST_CREATOR` token and updates `v${{ steps.release.outputs.major }}`.

For the initial 0.x release series, this updates `v0`.

The tag update mirrors the Release Please documentation pattern for GitHub Actions, but pins the checkout to the released commit SHA to avoid moving `v0` to a newer `main` commit if the branch advances while the workflow is running:

- Delete local `v0` if present.
- Delete remote `v0` if present.
- Create an annotated `v0` tag at the checked-out release commit.
- Push `v0` to origin.

The workflow does not create or update a moving minor tag such as `v0.1`.

## Weekly Changelog Workflow

Keep `.github/workflows/weekly-changelog-update.yml` and its responsibilities.

Update the `y-writings/calver-beacon-action` reference to the `tag_prefix`-capable main commit:

```yaml
uses: y-writings/calver-beacon-action@0ba68eee60be71b3549212bf896fac07df928d4d
```

Pass the new input:

```yaml
with:
  tag_prefix: weekly-
```

The weekly workflow will create and compare only tags like `weekly-2026.05.24`. It will no longer create `vYYYY.MM.DD` tags, avoiding overlap with Release Please's SemVer tags.

The generated weekly changelog output remains `WEEKLY_MERGED_PULL_REQUESTS`; Release Please owns `CHANGELOG.md`.

## Safety Model

Release Please PRs are human-gated. Merging the Release Please PR is the explicit release decision.

Release Please labeling is disabled to avoid broadening the GitHub App token requirements to issue or label writes.

The workflow uses the repository's existing app-token pattern instead of `GITHUB_TOKEN` so Release Please PRs and releases can trigger normal downstream workflows.

External GitHub Actions remain pinned by commit SHA. Version comments are included where a stable version tag exists.

Weekly CalVer tags and SemVer release tags use separate namespaces to avoid accidental release history detection across the two systems.

## Testing Strategy

Add or update workflow tests under `src/`.

Weekly workflow tests should verify:

- The workflow passes `tag_prefix: weekly-` to `calver-beacon-action`.
- The `calver-beacon-action` reference is the `tag_prefix`-capable SHA.
- The weekly workflow continues to write `WEEKLY_MERGED_PULL_REQUESTS` instead of `CHANGELOG.md`.

Release Please workflow tests should verify:

- The workflow creates a `PULL_REQUEST_CREATOR` GitHub App token from the existing variable and secret names.
- The Release Please action is pinned to `5c625bfb5d1ff62eadeeb3772007f7f66fdcf071` with a `v4.4.1` comment.
- The workflow uses `config-file: release-please-config.json` and `manifest-file: .release-please-manifest.json`.
- The workflow has `contents: write` and `pull-requests: write` but not `issues: write`.
- The workflow updates the moving major tag only when `steps.release.outputs.release_created` is true.

Config tests should verify:

- `release-please-config.json` uses the `node` release type.
- `release-please-config.json` sets `skip-labeling` to `true`.
- `.release-please-manifest.json` bootstraps the root package at `0.0.1`.

Local verification should run `pnpm test` and `pnpm build`.
