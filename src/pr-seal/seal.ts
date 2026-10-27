import type { ActionInputs } from "../action/inputs.js";
import type { GitHubSealAdapter } from "../github/seal-adapter.js";
import { evaluateRegularFiles } from "./file-mode.js";
import { IneligiblePullRequestError, verifyPullRequestSafety, type VerifiedPullRequest } from "./verify.js";

export interface SealResult {
  pullRequestId: string;
  headSha: string;
  changedFiles: string[];
  approved: boolean;
  autoMergeEnabled: boolean;
  merged: boolean;
  eligible: boolean;
  reason: string;
}

const STALE_APPROVAL_MESSAGE =
  "Dismissed because the pull request changed after the verified head was approved.";

export async function sealPullRequest(inputs: ActionInputs, github: GitHubSealAdapter): Promise<SealResult> {
  const { owner, repo, value } = inputs.repository;
  const snapshot = await github.fetchPullRequestSnapshot(owner, repo, inputs.pullRequestNumber);
  const subject = `${value}#${inputs.pullRequestNumber}`;

  let verified: VerifiedPullRequest;
  try {
    verified = verifyPullRequestSafety(snapshot.pullRequest, snapshot.files, {
      repository: value,
      pullRequestNumber: inputs.pullRequestNumber,
      expectedAuthors: inputs.expectedAuthors,
      allowedPaths: inputs.allowedPaths,
      allowedPatterns: inputs.allowedPatterns,
      deniedPatterns: inputs.deniedPatterns,
      pathPreset: inputs.pathPreset,
    });
  } catch (error) {
    return rethrowUnlessSkipped(inputs, snapshot, error);
  }

  if (inputs.requireRegularFiles) {
    const filesWithModes = await github.fetchFileModes(
      owner,
      repo,
      verified.headSha,
      verified.baseSha,
      snapshot.files,
    );
    const decision = evaluateRegularFiles(subject, filesWithModes);
    if (!decision.ok) {
      if (decision.hard || inputs.onIneligible === "fail") {
        throw new Error(decision.reason);
      }
      return ineligibleResult(snapshot, decision.reason);
    }
  }

  await assertStillPinned(github, owner, repo, inputs.pullRequestNumber, verified);

  const reviewId = await github.approvePullRequest(verified.pullRequestId, verified.headSha, inputs.approveBody);
  try {
    await assertStillPinned(github, owner, repo, inputs.pullRequestNumber, verified);
  } catch (error) {
    await dismissStaleApproval(github, reviewId, error);
  }

  let autoMergeEnabled = false;
  let merged = false;
  if (inputs.autoMerge) {
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
  }

  return {
    pullRequestId: verified.pullRequestId,
    headSha: verified.headSha,
    changedFiles: verified.changedFiles,
    approved: true,
    autoMergeEnabled,
    merged,
    eligible: true,
    reason: "",
  };
}

function rethrowUnlessSkipped(
  inputs: ActionInputs,
  snapshot: Awaited<ReturnType<GitHubSealAdapter["fetchPullRequestSnapshot"]>>,
  error: unknown,
): SealResult {
  if (inputs.onIneligible === "skip" && error instanceof IneligiblePullRequestError) {
    return ineligibleResult(snapshot, error.message);
  }
  throw error;
}

function ineligibleResult(
  snapshot: Awaited<ReturnType<GitHubSealAdapter["fetchPullRequestSnapshot"]>>,
  reason: string,
): SealResult {
  return {
    pullRequestId: snapshot.pullRequest.id,
    headSha: snapshot.pullRequest.headSha,
    changedFiles: snapshot.files.map((file) => file.path),
    approved: false,
    autoMergeEnabled: false,
    merged: false,
    eligible: false,
    reason,
  };
}

async function assertStillPinned(
  github: GitHubSealAdapter,
  owner: string,
  repo: string,
  pullRequestNumber: number,
  verified: VerifiedPullRequest,
): Promise<void> {
  const subject = `${owner}/${repo}#${pullRequestNumber}`;
  const refs = await github.fetchPullRequestRefs(owner, repo, pullRequestNumber);
  if (refs.state !== "open") {
    throw new Error(`Refusing to seal ${subject} because the pull request is ${refs.state}`);
  }
  if (refs.headSha !== verified.headSha) {
    throw new Error(
      `Refusing to seal ${subject} because the pull request head SHA changed from ${verified.headSha} to ${refs.headSha} after verification`,
    );
  }
  if (refs.baseSha !== verified.baseSha) {
    throw new Error(
      `Refusing to seal ${subject} because the pull request base SHA changed from ${verified.baseSha} to ${refs.baseSha} after verification`,
    );
  }
}

async function dismissStaleApproval(github: GitHubSealAdapter, reviewId: string, error: unknown): Promise<never> {
  try {
    await github.dismissPullRequestReview(reviewId, STALE_APPROVAL_MESSAGE);
  } catch (dismissError) {
    const dismissMessage = dismissError instanceof Error ? dismissError.message : String(dismissError);
    const originalMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`${originalMessage}. Also failed to dismiss the approval: ${dismissMessage}`);
  }
  throw error;
}

function isCleanPullRequestAutoMergeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Pull request is in clean status");
}
