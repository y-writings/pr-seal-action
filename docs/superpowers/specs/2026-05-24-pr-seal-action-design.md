# pr-seal-action Design

Date: 2026-05-24
Status: approved for implementation planning

## Summary

`pr-seal-action` is a reusable GitHub Action that verifies a pre-existing pull request, approves it with a separate actor, and enables auto-merge only when the pull request satisfies strict safety conditions.

The action does not create pull requests, generate changelogs, create GitHub App tokens, or define workflow triggers. Those responsibilities remain in the caller workflow. This action owns the safety-critical post-processing step: verify, approve, and enable auto-merge for a known pull request.

The first production use case is the post-processing section from `y-writings/calver-beacon-action`'s weekly changelog workflow, where a generated `CHANGELOG.md` pull request is approved by a different GitHub App and queued for auto-merge.

## Goals

- Verify that a target pull request was opened by an expected author.
- Verify that the pull request only changes explicitly allowed file paths.
- Fetch all changed files with pagination before deciding whether the PR is safe.
- Fix the verified PR head SHA and use that exact SHA for approval and auto-merge.
- Approve the PR with `approve-token` only after all verification passes.
- Enable auto-merge with `merge-token` only after approval succeeds.
- Fail closed on missing data, API errors, validation failures, or head SHA mismatch.
- Provide useful outputs for logs, diagnostics, and downstream workflow steps.

## Non-Goals

- Do not generate changelogs.
- Do not create or update pull requests.
- Do not create GitHub App tokens.
- Do not define scheduling, dispatch, or other workflow triggers.
- Do not validate changelog contents semantically.
- Do not implement glob, regex, label, title, or body matching in the initial version.
- Do not delete the source branch after merge in the initial version.
- Do not replace branch protection, required checks, required reviews, or repository auto-merge settings.

## Alternatives Considered

### TypeScript JavaScript Action With Bundled dist

This is the selected approach.

The action is implemented in TypeScript, tested as normal Node code, and bundled into `dist/index.js` for GitHub Actions runtime execution. It uses `@actions/core` and `@actions/github` instead of shelling out to `gh`.

Benefits:

- Strong input parsing and validation.
- Testable API orchestration.
- Explicit handling for REST and GraphQL errors.
- Correct changed-files pagination.
- No dependency on runner-provided `gh` CLI behavior.

Trade-off:

- Requires a build step and committed `dist/index.js`.

### Plain JavaScript Action Without Bundling

This would avoid a TypeScript build pipeline, but it would weaken type safety and make the action contract easier to drift. It is not selected because this action handles security-sensitive approve and auto-merge behavior.

### Composite Action With shell and gh CLI

This would be closest to the existing workflow snippet, but it preserves the current copy-paste shell shape and depends on `gh` CLI behavior. It is not selected because pagination, GraphQL error handling, and input validation are easier to test and maintain in TypeScript.

## Action Contract

The action accepts a repository, pull request number, expected author, allowed paths, an approval token, and a merge token. It performs verification first, then performs approval and auto-merge as one guarded flow.

Verification and execution must stay in the same action. Splitting verification, approval, and auto-merge into separate actions would let callers accidentally ignore verification outputs or apply them to a different PR head SHA.

The guarded order is fixed:

1. Parse and validate inputs.
2. Resolve repository owner and name.
3. Fetch the pull request.
4. Require the pull request to be open.
5. Fetch every changed file with pagination.
6. Verify the author login equals `expected-author`.
7. Verify every changed path is present in `allowed-paths`.
8. Capture the PR GraphQL node ID and head SHA.
9. Create an approval review against the verified head SHA.
10. Enable auto-merge with the verified head SHA.
11. Set success outputs.

If any step fails, the action fails and does not continue to later privileged operations.

## Inputs

### `repository`

Optional `owner/name` repository identifier. Defaults to the current `github.repository` context value.

### `pull-request-number`

Required pull request number.

The value must parse as a positive integer.

### `expected-author`

Required GitHub login expected for the PR author.

The value is compared exactly with the login returned by the GitHub API. For GitHub App authored pull requests, callers should pass values such as `app/y-writings-pr-creator-bot`.

### `allowed-paths`

Required newline-separated list of allowed file paths.

Initial semantics are exact path matches only. Blank lines are ignored. Glob syntax is not supported in this input.

Example:

```text
CHANGELOG.md
```

### `approve-token`

Required token used only to create the approval review.

The intended caller should provide a GitHub App token for an approver actor that differs from the PR creator actor.

### `merge-token`

Required token used only to enable auto-merge.

The intended caller should provide the PR creator token or another token authorized to enable auto-merge for the PR.

### `merge-method`

Optional merge method. Accepted values are `squash`, `merge`, and `rebase`. The default is `squash`.

### `approve-body`

Optional approval review body. If omitted, the action uses a concise default message that identifies the approval as automated and verification-gated.

## Outputs

### `pull-request-id`

GraphQL node ID of the verified pull request.

### `head-sha`

Verified pull request head SHA.

### `changed-files`

JSON array of changed file paths considered during verification.

### `approved`

`true` if an approval review was created. `false` is only expected before approval succeeds or when the action fails.

### `auto-merge-enabled`

`true` if auto-merge was enabled. `false` is only expected before auto-merge succeeds or when the action fails.

## GitHub API Design

The implementation uses `@actions/github` clients for both REST and GraphQL calls.

REST API responsibilities:

- Fetch the target pull request.
- Fetch all changed files with pagination.

GraphQL responsibilities:

- Add an approval review with the verified pull request node ID and verified head SHA.
- Enable auto-merge with the verified pull request node ID, selected merge method, and verified head SHA.

The auto-merge operation must preserve the safety property of `gh pr merge --match-head-commit`: if the PR head changes after verification, the merge operation must fail instead of applying to the new head.

The action does not expose a `delete-branch` input in the initial version. GitHub's GraphQL `enablePullRequestAutoMerge` mutation supports `expectedHeadOid`, but does not provide the same branch-deletion flag as `gh pr merge --auto --delete-branch`. Because auto-merge completes asynchronously after checks and branch protection pass, this action cannot safely delete the branch before completion. Callers that need branch cleanup should use the repository's automatic head branch deletion setting or a separate cleanup workflow.

## Security Model

The action is fail-closed. Ambiguous or unexpected state is treated as unsafe.

The action fails when:

- Required inputs are missing.
- `repository` is not in `owner/name` format.
- `pull-request-number` is not a positive integer.
- `merge-method` is not one of the supported values.
- The pull request cannot be fetched.
- The pull request is not open.
- The PR author differs from `expected-author`.
- Any changed file is not listed in `allowed-paths`.
- The PR node ID or head SHA is missing.
- Approval review creation fails.
- Auto-merge enablement fails.
- GitHub reports a head SHA mismatch during auto-merge enablement.

The action must not log token values, private keys, or authorization headers. Error messages should include safe diagnostic data such as repository, PR number, expected author, actual author, allowed paths, changed paths, and head SHA availability.

The action requires branch protection and repository auto-merge settings to be configured by the repository. It is an automation guard, not a replacement for those controls.

## Implementation Structure

The implementation is a minimal TypeScript action project with the runtime entrypoint kept separate from the PR seal domain modules and the GitHub adapter.

Current files:

- `action.yml`: GitHub Action metadata, inputs, outputs, and `runs.using: node24` with `dist/index.js`.
- `package.json`: scripts, runtime dependencies, development dependencies, and package metadata.
- `pnpm-lock.yaml`: locked dependency graph.
- `tsconfig.json`: TypeScript configuration for source and tests.
- `src/main.ts`: thin bundled entrypoint.
- `src/action/run.ts`: action wiring, secret masking, outputs, and top-level failure handling.
- `src/action/inputs.ts`: input parsing and validation.
- `src/pr-seal/verify.ts`: pull request safety checks.
- `src/pr-seal/seal.ts`: verification, approval, and auto-merge orchestration.
- `src/github/seal-adapter.ts`: GitHub GraphQL adapter for snapshot, approval, and auto-merge operations.
- `src/repo-workflows/*.test.ts`: tests for this repository's release and changelog workflows.
- `src/**/*.test.ts`: unit tests for inputs, verification, pagination, failure ordering, and GraphQL payloads.
- `dist/index.js`: bundled action entrypoint committed for consumers.
- `README.md`: usage, security contract, input/output reference, and workflow example.

The implementation should keep modules small, but avoid needless abstractions. The GitHub seal adapter seam exists to make GitHub calls mockable and to keep security logic easy to test.

## Testing Strategy

Unit tests will cover the safety contract and failure ordering.

Required cases:

- Valid inputs parse correctly.
- Missing required inputs fail.
- Invalid repository, PR number, and merge method fail.
- Author match passes.
- Author mismatch fails before approval.
- Exact allowed path match passes.
- Unexpected changed path fails before approval.
- Changed files pagination collects all pages.
- Closed PR fails before approval.
- Missing PR node ID or head SHA fails before approval.
- Approval failure prevents auto-merge.
- Auto-merge receives the verified head SHA.
- Outputs are set on success.

Build verification must ensure TypeScript compiles, tests pass, and `dist/index.js` is regenerated from source.

## Caller Workflow Shape

Callers create GitHub App tokens separately, create or find a pull request separately, then invoke this action.

Example:

```yaml
- name: Verify, approve, and enable auto-merge
  uses: y-writings/pr-seal-action@v1
  with:
    repository: ${{ github.repository }}
    pull-request-number: ${{ steps.changelog-pull-request.outputs.pull-request-number }}
    expected-author: app/y-writings-pr-creator-bot
    allowed-paths: |
      CHANGELOG.md
    approve-token: ${{ steps.approver-token.outputs.token }}
    merge-token: ${{ steps.pr-creator-token.outputs.token }}
    merge-method: squash
    approve-body: Automated approval for CHANGELOG.md-only release PR.
```

## Initial Scope

Version 1 implements exact author matching, exact path matching, approval, and auto-merge enablement with verified head SHA.

Future additions such as glob path matching, multiple authors, label gates, title/body gates, retry policy tuning, and semantic changelog validation are intentionally excluded from the initial implementation. If needed later, glob support should be added as a separate input such as `allowed-patterns` rather than changing `allowed-paths` semantics.

Branch deletion is also excluded from version 1. It can be reconsidered later only if GitHub exposes an API that safely requests branch deletion for asynchronous auto-merge, or if the action grows a separate post-merge cleanup mode with explicit safeguards.
