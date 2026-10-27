import { compileGlob } from "../pr-seal/paths.js";
import type { PathPreset } from "../pr-seal/verify.js";

export type MergeMethod = "squash" | "merge" | "rebase";
export type OnIneligible = "fail" | "skip";

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
  expectedAuthors: string[];
  allowedPaths: string[];
  allowedPatterns: string[];
  deniedPatterns: string[];
  pathPreset: PathPreset;
  requireRegularFiles: boolean;
  approveToken: string;
  mergeToken: string;
  mergeMethod: MergeMethod;
  approveBody: string;
  autoMerge: boolean;
  onIneligible: OnIneligible;
}

export function parseInputs(reader: InputReader, context: GitHubContextLike): ActionInputs {
  const repositoryValue = optionalInput(reader, "repository") || `${context.repo.owner}/${context.repo.repo}`;
  const pullRequestNumber = parsePositiveInteger(
    requiredInput(reader, "pull-request-number"),
    "pull-request-number",
  );
  const requireExpectedAuthor = parseBoolean(
    optionalInput(reader, "require-expected-author"),
    "require-expected-author",
    true,
  );
  const listedAuthors = parseLineList(optionalInput(reader, "expected-authors"));
  const expectedAuthor =
    requireExpectedAuthor && listedAuthors.length === 0
      ? requiredInput(reader, "expected-author")
      : optionalInput(reader, "expected-author");
  const expectedAuthors = unique([expectedAuthor, ...listedAuthors].filter((author) => author.length > 0));
  if (requireExpectedAuthor && expectedAuthors.length === 0) {
    throw new Error("expected-author is required");
  }

  const pathPreset = parsePathPreset(optionalInput(reader, "path-preset"));
  const allowedPatterns = parsePatterns(optionalInput(reader, "allowed-patterns"), "allowed-patterns");
  const deniedPatterns = parsePatterns(optionalInput(reader, "denied-patterns"), "denied-patterns");
  const allowedPaths =
    allowedPatterns.length === 0 && pathPreset === "none"
      ? parseAllowedPaths(reader.getInput("allowed-paths", { required: true }))
      : parseLineList(optionalInput(reader, "allowed-paths"));
  const requireRegularFiles =
    parseBoolean(optionalInput(reader, "require-regular-files"), "require-regular-files", false) ||
    pathPreset === "docs-and-config";

  return {
    repository: parseRepository(repositoryValue),
    pullRequestNumber,
    expectedAuthors,
    allowedPaths,
    allowedPatterns,
    deniedPatterns,
    pathPreset,
    requireRegularFiles,
    approveToken: requiredInput(reader, "approve-token"),
    mergeToken: requiredInput(reader, "merge-token"),
    mergeMethod: parseMergeMethod(optionalInput(reader, "merge-method") || "squash"),
    approveBody: optionalInput(reader, "approve-body") || DEFAULT_APPROVE_BODY,
    autoMerge: parseBoolean(optionalInput(reader, "auto-merge"), "auto-merge", true),
    onIneligible: parseOnIneligible(optionalInput(reader, "on-ineligible")),
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
  const paths = parseLineList(value);
  if (paths.length === 0) {
    throw new Error("allowed-paths must include at least one path");
  }
  return paths;
}

function parseLineList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parsePatterns(value: string, name: string): string[] {
  const patterns = parseLineList(value);
  for (const pattern of patterns) {
    try {
      compileGlob(pattern);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${name} contains an invalid pattern: ${detail}`);
    }
  }
  return patterns;
}

function parsePathPreset(value: string): PathPreset {
  const normalized = value.toLowerCase();
  if (normalized.length === 0 || normalized === "none") {
    return "none";
  }
  if (normalized === "docs-and-config") {
    return "docs-and-config";
  }
  throw new Error("path-preset must be docs-and-config or none");
}

function parseMergeMethod(value: string): MergeMethod {
  const normalized = value.toLowerCase();
  if (normalized === "squash" || normalized === "merge" || normalized === "rebase") {
    return normalized;
  }
  throw new Error("merge-method must be one of squash, merge, or rebase");
}

function parseBoolean(value: string, name: string, fallback: boolean): boolean {
  if (value.length === 0) {
    return fallback;
  }
  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

function parseOnIneligible(value: string): OnIneligible {
  const normalized = value.toLowerCase() || "fail";
  if (normalized === "fail" || normalized === "skip") {
    return normalized;
  }
  throw new Error("on-ineligible must be fail or skip");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
