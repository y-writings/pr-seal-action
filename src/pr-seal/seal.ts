import type { ActionInputs } from "../action/inputs.js";
import type { GitHubSealAdapter } from "../github/seal-adapter.js";
import { verifyPullRequestSafety } from "./verify.js";

export interface SealResult {
  pullRequestId: string;
  headSha: string;
  changedFiles: string[];
  approved: boolean;
  autoMergeEnabled: boolean;
  merged: boolean;
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

  let autoMergeEnabled = false;
  let merged = false;
  try {
    await github.enableAutoMerge(verified.pullRequestId, verified.headSha, inputs.mergeMethod);
    autoMergeEnabled = true;
  } catch (error) {
    if (!isCleanPullRequestAutoMergeError(error)) {
      throw error;
    }
    await github.mergePullRequest(verified.pullRequestId, verified.headSha, inputs.mergeMethod);
    autoMergeEnabled = false;
    merged = true;
  }

  return {
    pullRequestId: verified.pullRequestId,
    headSha: verified.headSha,
    changedFiles: verified.changedFiles,
    approved: true,
    autoMergeEnabled,
    merged,
  };
}

function isCleanPullRequestAutoMergeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Pull request is in clean status");
}
