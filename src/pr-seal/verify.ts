import { evaluateDocsConfigPath } from "./docs-config-preset.js";
import { isSafeRelativePath, matchesAnyGlob } from "./paths.js";

export type PathPreset = "none" | "docs-and-config";

export interface PullRequestDetails {
  id: string;
  number: number;
  state: string;
  authorLogin: string;
  headSha: string;
  baseSha: string;
}

export interface PullRequestFile {
  path: string;
  changeType: string;
}

export interface SafetyInputs {
  repository: string;
  pullRequestNumber: number;
  expectedAuthors: string[];
  allowedPaths: string[];
  allowedPatterns: string[];
  deniedPatterns: string[];
  pathPreset: PathPreset;
}

export interface VerifiedPullRequest {
  pullRequestId: string;
  headSha: string;
  baseSha: string;
  changedFiles: string[];
}

export class IneligiblePullRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IneligiblePullRequestError";
  }
}

const RENAMED = "RENAMED";

export function verifyPullRequestSafety(
  pullRequest: PullRequestDetails,
  changedFiles: readonly PullRequestFile[],
  inputs: SafetyInputs,
): VerifiedPullRequest {
  const subject = `${inputs.repository}#${inputs.pullRequestNumber}`;

  if (pullRequest.state !== "open") {
    throw new Error(`Refusing to seal ${subject} because the pull request is ${pullRequest.state}`);
  }

  if (pullRequest.number !== inputs.pullRequestNumber) {
    throw new Error(`Fetched pull request number ${pullRequest.number} does not match requested ${subject}`);
  }

  if (inputs.expectedAuthors.length > 0 && !inputs.expectedAuthors.includes(pullRequest.authorLogin)) {
    const expected =
      inputs.expectedAuthors.length === 1
        ? inputs.expectedAuthors[0]
        : `one of: ${inputs.expectedAuthors.join(", ")}`;
    throw new IneligiblePullRequestError(
      `Refusing to seal ${subject} because the PR author is ${pullRequest.authorLogin}, expected ${expected}`,
    );
  }

  const extended =
    inputs.allowedPatterns.length > 0 || inputs.deniedPatterns.length > 0 || inputs.pathPreset !== "none";
  for (const file of changedFiles) {
    if (extended && !isSafeRelativePath(file.path)) {
      throw new IneligiblePullRequestError(`Refusing to seal ${subject} because a changed path is invalid`);
    }
  }

  const renamed = changedFiles.filter((file) => file.changeType.toUpperCase() === RENAMED).map((file) => file.path);
  if (renamed.length > 0) {
    throw new IneligiblePullRequestError(
      `Refusing to seal ${subject} because renamed files cannot be safely verified: ${renamed.join(", ")}`,
    );
  }

  if (inputs.pathPreset === "docs-and-config" && changedFiles.length === 0) {
    throw new IneligiblePullRequestError(`Refusing to seal ${subject} because the pull request does not change any file`);
  }

  if (!extended) {
    const allowedPathSet = new Set(inputs.allowedPaths);
    const disallowedPaths = changedFiles.filter((file) => !allowedPathSet.has(file.path)).map((file) => file.path);
    if (disallowedPaths.length > 0) {
      throw new IneligiblePullRequestError(
        `Refusing to seal ${subject} because changed files include disallowed paths: ${disallowedPaths.join(", ")}. Allowed paths: ${inputs.allowedPaths.join(", ")}`,
      );
    }
  } else {
    const reasons = changedFiles.flatMap((file) => {
      const reason = explainPathRejection(file.path, inputs);
      return reason ? [`${file.path} (${reason})`] : [];
    });
    if (reasons.length > 0) {
      throw new IneligiblePullRequestError(
        `Refusing to seal ${subject} because changed files include disallowed paths: ${reasons.join("; ")}`,
      );
    }
  }

  if (pullRequest.id.length === 0) {
    throw new Error(`Failed to resolve pull request node ID for ${subject}`);
  }

  if (pullRequest.headSha.length === 0) {
    throw new Error(`Failed to resolve pull request head SHA for ${subject}`);
  }

  if (pullRequest.baseSha.length === 0) {
    throw new Error(`Failed to resolve pull request base SHA for ${subject}`);
  }

  return {
    pullRequestId: pullRequest.id,
    headSha: pullRequest.headSha,
    baseSha: pullRequest.baseSha,
    changedFiles: changedFiles.map((file) => file.path),
  };
}

function explainPathRejection(path: string, inputs: SafetyInputs): string | null {
  if (matchesAnyGlob(inputs.deniedPatterns, path)) {
    return "matches a denied pattern";
  }

  const preset = inputs.pathPreset === "docs-and-config" ? evaluateDocsConfigPath(path) : null;
  if (preset?.denied) {
    return preset.reason;
  }
  if (inputs.allowedPaths.includes(path) || matchesAnyGlob(inputs.allowedPatterns, path)) {
    return null;
  }
  if (preset?.allowed) {
    return null;
  }
  if (preset) {
    return preset.reason;
  }
  return "is not an allowed path";
}
