export interface PullRequestDetails {
  id: string;
  number: number;
  state: string;
  authorLogin: string;
  headSha: string;
}

export interface SafetyInputs {
  repository: string;
  pullRequestNumber: number;
  expectedAuthor: string;
  allowedPaths: string[];
}

export interface VerifiedPullRequest {
  pullRequestId: string;
  headSha: string;
  changedFiles: string[];
}

export function verifyPullRequestSafety(
  pullRequest: PullRequestDetails,
  changedFiles: string[],
  inputs: SafetyInputs,
): VerifiedPullRequest {
  const subject = `${inputs.repository}#${inputs.pullRequestNumber}`;

  if (pullRequest.state !== "open") {
    throw new Error(`Refusing to seal ${subject} because the pull request is ${pullRequest.state}`);
  }

  if (pullRequest.number !== inputs.pullRequestNumber) {
    throw new Error(
      `Fetched pull request number ${pullRequest.number} does not match requested ${subject}`,
    );
  }

  if (pullRequest.authorLogin !== inputs.expectedAuthor) {
    throw new Error(
      `Refusing to seal ${subject} because the PR author is ${pullRequest.authorLogin}, expected ${inputs.expectedAuthor}`,
    );
  }

  const allowedPathSet = new Set(inputs.allowedPaths);
  const disallowedPaths = changedFiles.filter((file) => !allowedPathSet.has(file));
  if (disallowedPaths.length > 0) {
    throw new Error(
      `Refusing to seal ${subject} because changed files include disallowed paths: ${disallowedPaths.join(
        ", ",
      )}. Allowed paths: ${inputs.allowedPaths.join(", ")}`,
    );
  }

  if (pullRequest.id.length === 0) {
    throw new Error(`Failed to resolve pull request node ID for ${subject}`);
  }

  if (pullRequest.headSha.length === 0) {
    throw new Error(`Failed to resolve pull request head SHA for ${subject}`);
  }

  return {
    pullRequestId: pullRequest.id,
    headSha: pullRequest.headSha,
    changedFiles,
  };
}
