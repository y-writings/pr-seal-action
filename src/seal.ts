import type { ActionInputs } from "./inputs";
import {
  approvePullRequest,
  enableAutoMerge,
  fetchPullRequestSnapshot,
  type GitHubClients,
} from "./github";
import { verifyPullRequestSafety } from "./verify";

export interface SealResult {
  pullRequestId: string;
  headSha: string;
  changedFiles: string[];
  approved: boolean;
  autoMergeEnabled: boolean;
}

export async function sealPullRequest(inputs: ActionInputs, clients: GitHubClients): Promise<SealResult> {
  const { owner, repo, value } = inputs.repository;
  const snapshot = await fetchPullRequestSnapshot(clients.mergeGraphql, owner, repo, inputs.pullRequestNumber);
  const verified = verifyPullRequestSafety(snapshot.pullRequest, snapshot.changedFiles, {
    repository: value,
    pullRequestNumber: inputs.pullRequestNumber,
    expectedAuthor: inputs.expectedAuthor,
    allowedPaths: inputs.allowedPaths,
  });

  await approvePullRequest(clients.approveGraphql, verified.pullRequestId, verified.headSha, inputs.approveBody);
  await enableAutoMerge(clients.mergeGraphql, verified.pullRequestId, verified.headSha, inputs.mergeMethod);

  return {
    pullRequestId: verified.pullRequestId,
    headSha: verified.headSha,
    changedFiles: verified.changedFiles,
    approved: true,
    autoMergeEnabled: true,
  };
}
