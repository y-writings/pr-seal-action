# pr-seal-action

`pr-seal-action` verifies that a pull request was created by an expected author and only changes allowed files, then seals it by approving it and enabling auto-merge with the verified head SHA.

This action is for tightly scoped automation PRs such as generated changelog updates. It is not a general-purpose auto-approve action.

## What It Does

1. Fetches the target pull request.
2. Requires the pull request to be open.
3. Fetches every changed file with GitHub API pagination bound to a stable GraphQL `headRefOid` before approval.
4. Requires the PR author login to exactly match `expected-author`.
5. Requires every changed file path to exactly match one of `allowed-paths`.
6. Captures the verified pull request node ID and head SHA.
7. Creates an approval review with `approve-token` against the verified head SHA.
8. Enables auto-merge with `merge-token` and `expectedHeadOid` set to the verified head SHA.

If any verification or privileged operation fails, the action fails closed.

## What It Does Not Do

- It does not create GitHub App tokens.
- It does not create pull requests.
- It does not generate changelogs.
- It does not define workflow triggers.
- It does not delete the source branch after merge.
- It does not replace branch protection, required reviews, required checks, or repository auto-merge settings.

Use repository automatic head branch deletion or a separate cleanup workflow if branch cleanup is required.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `repository` | No | Current repository | Repository in `owner/name` format. |
| `pull-request-number` | Yes |  | Pull request number to verify, approve, and enable auto-merge for. |
| `expected-author` | Yes |  | Exact GitHub login expected for the PR author, for example `app/y-writings-pr-creator-bot`. |
| `allowed-paths` | Yes |  | Newline-separated exact file paths the PR may change. Glob syntax is not supported. |
| `approve-token` | Yes |  | Token used only to create the approval review. |
| `merge-token` | Yes |  | Token used to read the PR and enable auto-merge. |
| `merge-method` | No | `squash` | One of `squash`, `merge`, or `rebase`. |
| `approve-body` | No | Automated verification message | Body for the approval review. |

## Outputs

| Name | Description |
| --- | --- |
| `pull-request-id` | GraphQL node ID of the verified pull request. |
| `head-sha` | Verified pull request head SHA. |
| `changed-files` | JSON array of changed file paths considered during verification. |
| `approved` | `true` when an approval review was created. |
| `auto-merge-enabled` | `true` when auto-merge was enabled. |

## Example

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

## Token Guidance

Use separate tokens for approval and auto-merge when branch protection requires review by a different actor.

- `approve-token` should belong to the approver actor and have permission to create pull request reviews.
- `merge-token` should belong to the PR creator or merge actor and have permission to read the PR and enable auto-merge.

Do not use broad organization-wide credentials when a repository-scoped GitHub App token is sufficient.

## Security Notes

This action fails when the PR author differs from `expected-author`, when any changed file is outside `allowed-paths`, when the PR is not open, when the PR node ID or head SHA cannot be resolved, when approval fails, or when GitHub rejects auto-merge enablement.

Auto-merge is enabled with GitHub GraphQL `expectedHeadOid`. If the PR head changes after verification, GitHub rejects the operation instead of enabling auto-merge for a different commit.
