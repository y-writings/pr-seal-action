import type { ActionInputs } from "../action/inputs";
import type { GitHubSealAdapter } from "../github/seal-adapter";
import { verifyPullRequestSafety } from "./verify";

export interface SealResult {
  pullRequestId: string;
  headSha: string;
  changedFiles: string[];
  approved: boolean;
  autoMergeEnabled: boolean;
}

export async function sealPullRequest(inputs: ActionInputs, github: GitHubSealAdapter): Promise<SealResult> {
  const { owner, repo, value } = inputs.repository;
  const snapshot = await github.fetchPullRequestSnapshot(owner, repo, inputs.pullRequestNumber);
  const verified = verifyPullRequestSafety(snapshot.pullRequest, snapshot.changedFiles, {
    repository: value,
    pullRequestNumber: inputs.pullRequestNumber,
    expectedAuthor: inputs.expectedAuthor,
    allowedPaths: inputs.allowedPaths,
  });

  await github.approvePullRequest(verified.pullRequestId, verified.headSha, inputs.approveBody);
  await github.enableAutoMerge(verified.pullRequestId, verified.headSha, inputs.mergeMethod);

  return {
    pullRequestId: verified.pullRequestId,
    headSha: verified.headSha,
    changedFiles: verified.changedFiles,
    approved: true,
    autoMergeEnabled: true,
  };
}
