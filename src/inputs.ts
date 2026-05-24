export type MergeMethod = "squash" | "merge" | "rebase";

export const DEFAULT_APPROVE_BODY =
  "Automated approval by pr-seal-action after author and changed-file verification.";

export interface InputReader {
  getInput(name: string, options?: { required?: boolean }): string;
}

export interface GitHubContextLike {
  repo: {
    owner: string;
    repo: string;
  };
}

export interface RepositoryInput {
  owner: string;
  repo: string;
  value: string;
}

export interface ActionInputs {
  repository: RepositoryInput;
  pullRequestNumber: number;
  expectedAuthor: string;
  allowedPaths: string[];
  approveToken: string;
  mergeToken: string;
  mergeMethod: MergeMethod;
  approveBody: string;
}

export function parseInputs(reader: InputReader, context: GitHubContextLike): ActionInputs {
  const repositoryValue = optionalInput(reader, "repository") || `${context.repo.owner}/${context.repo.repo}`;

  return {
    repository: parseRepository(repositoryValue),
    pullRequestNumber: parsePositiveInteger(requiredInput(reader, "pull-request-number"), "pull-request-number"),
    expectedAuthor: requiredInput(reader, "expected-author"),
    allowedPaths: parseAllowedPaths(reader.getInput("allowed-paths", { required: true })),
    approveToken: requiredInput(reader, "approve-token"),
    mergeToken: requiredInput(reader, "merge-token"),
    mergeMethod: parseMergeMethod(optionalInput(reader, "merge-method") || "squash"),
    approveBody: optionalInput(reader, "approve-body") || DEFAULT_APPROVE_BODY,
  };
}

function requiredInput(reader: InputReader, name: string): string {
  const value = reader.getInput(name, { required: true }).trim();
  if (value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalInput(reader: InputReader, name: string): string {
  return reader.getInput(name).trim();
}

function parseRepository(value: string): RepositoryInput {
  const parts = value.split("/");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new Error("repository must be in owner/name format");
  }

  return { owner: parts[0], repo: parts[1], value };
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return numberValue;
}

function parseAllowedPaths(value: string): string[] {
  const paths = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (paths.length === 0) {
    throw new Error("allowed-paths must include at least one path");
  }

  return paths;
}

function parseMergeMethod(value: string): MergeMethod {
  const normalized = value.toLowerCase();
  if (normalized === "squash" || normalized === "merge" || normalized === "rebase") {
    return normalized;
  }
  throw new Error("merge-method must be one of squash, merge, or rebase");
}
