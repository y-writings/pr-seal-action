import { getOctokit } from "@actions/github";

import type { MergeMethod } from "../action/inputs.js";
import type { FileModeSnapshot, GitTreeEntry } from "../pr-seal/file-mode.js";
import { isSafeRelativePath } from "../pr-seal/paths.js";
import type { PullRequestDetails, PullRequestFile } from "../pr-seal/verify.js";

type GraphqlClient = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

interface AddPullRequestReviewResponse {
  addPullRequestReview: {
    pullRequestReview: { id: string } | null;
  };
}

interface DismissPullRequestReviewResponse {
  dismissPullRequestReview: {
    pullRequestReview: { id: string } | null;
  };
}

interface EnablePullRequestAutoMergeResponse {
  enablePullRequestAutoMerge: {
    pullRequest: { id: string } | null;
  };
}

interface MergePullRequestResponse {
  mergePullRequest: {
    pullRequest: { id: string } | null;
  };
}

interface PullRequestSnapshotResponse {
  repository: {
    pullRequest: {
      id: string;
      number: number;
      state: string;
      author?: { login?: string | null } | null;
      headRefOid: string;
      baseRefOid: string;
      files: {
        nodes?: Array<{ path?: string | null; changeType?: string | null } | null> | null;
        pageInfo: {
          hasNextPage: boolean;
          endCursor?: string | null;
        };
      };
    } | null;
  } | null;
}

interface PullRequestRefsResponse {
  repository: {
    pullRequest: {
      state: string;
      headRefOid: string;
      baseRefOid: string;
    } | null;
  } | null;
}

interface TreeResponse {
  repository: {
    object: {
      __typename?: string;
      entries?: Array<{ name?: string | null; mode?: number | null; type?: string | null } | null> | null;
    } | null;
  } | null;
}

export interface PullRequestRefs {
  state: string;
  headSha: string;
  baseSha: string;
}

export interface PullRequestSnapshot {
  pullRequest: PullRequestDetails;
  changedFiles: string[];
  files: PullRequestFile[];
}

export interface GitHubSealAdapter {
  fetchPullRequestSnapshot(owner: string, repo: string, pullNumber: number): Promise<PullRequestSnapshot>;
  fetchPullRequestRefs(owner: string, repo: string, pullNumber: number): Promise<PullRequestRefs>;
  fetchFileModes(
    owner: string,
    repo: string,
    headSha: string,
    baseSha: string,
    files: readonly PullRequestFile[],
  ): Promise<FileModeSnapshot[]>;
  approvePullRequest(pullRequestId: string, headSha: string, body: string): Promise<string>;
  dismissPullRequestReview(reviewId: string, message: string): Promise<void>;
  enableAutoMerge(pullRequestId: string, headSha: string, mergeMethod: MergeMethod): Promise<void>;
  mergePullRequest(pullRequestId: string, headSha: string, mergeMethod: MergeMethod): Promise<void>;
}

export function createGitHubSealAdapter(tokens: {
  approveToken: string;
  mergeToken: string;
}): GitHubSealAdapter {
  const approveClient = getOctokit(tokens.approveToken);
  const mergeClient = getOctokit(tokens.mergeToken);
  const approveGraphql = approveClient.graphql as GraphqlClient;
  const mergeGraphql = mergeClient.graphql as GraphqlClient;

  return {
    fetchPullRequestSnapshot: (owner, repo, pullNumber) =>
      fetchPullRequestSnapshot(mergeGraphql, owner, repo, pullNumber),
    fetchPullRequestRefs: (owner, repo, pullNumber) => fetchPullRequestRefs(mergeGraphql, owner, repo, pullNumber),
    fetchFileModes: (owner, repo, headSha, baseSha, files) =>
      fetchFileModes(mergeGraphql, owner, repo, headSha, baseSha, files),
    approvePullRequest: (pullRequestId, headSha, body) =>
      approvePullRequest(approveGraphql, pullRequestId, headSha, body),
    dismissPullRequestReview: (reviewId, message) => dismissPullRequestReview(approveGraphql, reviewId, message),
    enableAutoMerge: (pullRequestId, headSha, mergeMethod) =>
      enableAutoMerge(mergeGraphql, pullRequestId, headSha, mergeMethod),
    mergePullRequest: (pullRequestId, headSha, mergeMethod) =>
      mergePullRequest(mergeGraphql, pullRequestId, headSha, mergeMethod),
  };
}

async function fetchPullRequestSnapshot(
  graphql: GraphqlClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestSnapshot> {
  const files: PullRequestFile[] = [];
  let fileCursor: string | null = null;
  let firstHeadSha: string | undefined;
  let firstBaseSha: string | undefined;
  let pullRequest: PullRequestDetails | undefined;

  for (;;) {
    const response = (await graphql(
      `query($owner: String!, $repo: String!, $pullNumber: Int!, $fileCursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullNumber) {
            id
            number
            state
            author { login }
            headRefOid
            baseRefOid
            files(first: 100, after: $fileCursor) {
              nodes { path changeType }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { owner, repo, pullNumber, fileCursor },
    )) as PullRequestSnapshotResponse;

    const data = response.repository?.pullRequest;
    if (!data) {
      throw new Error(`Failed to resolve pull request ${owner}/${repo}#${pullNumber}`);
    }
    if (!data.headRefOid || !data.baseRefOid) {
      throw new Error(`Failed to resolve pull request refs for ${owner}/${repo}#${pullNumber}`);
    }

    if (firstHeadSha && data.headRefOid !== firstHeadSha) {
      throw new Error(
        `Refusing to seal ${owner}/${repo}#${pullNumber} because changed file pagination observed multiple head SHAs: ${firstHeadSha}, ${data.headRefOid}`,
      );
    }
    if (firstBaseSha && data.baseRefOid !== firstBaseSha) {
      throw new Error(
        `Refusing to seal ${owner}/${repo}#${pullNumber} because changed file pagination observed multiple base SHAs: ${firstBaseSha}, ${data.baseRefOid}`,
      );
    }

    firstHeadSha = data.headRefOid;
    firstBaseSha = data.baseRefOid;
    pullRequest = {
      id: data.id,
      number: data.number,
      state: data.state.toLowerCase(),
      authorLogin: data.author?.login ?? "",
      headSha: data.headRefOid,
      baseSha: data.baseRefOid,
    };

    if (!data.files.nodes) {
      throw new Error(`GitHub did not return changed-file nodes for ${owner}/${repo}#${pullNumber}`);
    }

    for (const file of data.files.nodes) {
      if (!file?.path || !file.changeType) {
        throw new Error(`GitHub returned an incomplete changed-file node for ${owner}/${repo}#${pullNumber}`);
      }
      files.push({ path: file.path, changeType: file.changeType });
    }

    if (!data.files.pageInfo.hasNextPage) {
      break;
    }

    if (!data.files.pageInfo.endCursor) {
      throw new Error(`GitHub did not return a changed-file pagination cursor for ${owner}/${repo}#${pullNumber}`);
    }

    fileCursor = data.files.pageInfo.endCursor;
  }

  return {
    pullRequest: pullRequest!,
    changedFiles: files.map((file) => file.path),
    files,
  };
}

async function fetchPullRequestRefs(
  graphql: GraphqlClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestRefs> {
  const response = (await graphql(
    `query($owner: String!, $repo: String!, $pullNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pullNumber) {
          state
          headRefOid
          baseRefOid
        }
      }
    }`,
    { owner, repo, pullNumber },
  )) as PullRequestRefsResponse;

  const pullRequest = response.repository?.pullRequest;
  if (!pullRequest?.headRefOid || !pullRequest.baseRefOid) {
    throw new Error(`Failed to resolve pull request refs for ${owner}/${repo}#${pullNumber}`);
  }

  return {
    state: pullRequest.state.toLowerCase(),
    headSha: pullRequest.headRefOid,
    baseSha: pullRequest.baseRefOid,
  };
}

async function fetchFileModes(
  graphql: GraphqlClient,
  owner: string,
  repo: string,
  headSha: string,
  baseSha: string,
  files: readonly PullRequestFile[],
): Promise<FileModeSnapshot[]> {
  assertCommitSha(headSha, "head SHA");
  assertCommitSha(baseSha, "base SHA");
  const cache = new Map<string, Map<string, GitTreeEntry> | null>();
  const snapshots: FileModeSnapshot[] = [];

  for (const file of files) {
    if (!isSafeRelativePath(file.path)) {
      throw new Error(`Refusing to read git metadata for unsafe path ${file.path}`);
    }
    const changeType = file.changeType.toUpperCase();
    const headRequired = changeType !== "DELETED";
    const baseRequired = changeType === "DELETED" || changeType === "MODIFIED" || changeType === "CHANGED";
    snapshots.push({
      path: file.path,
      changeType: file.changeType,
      head: await lookupTreeEntry(graphql, owner, repo, headSha, file.path, headRequired, cache),
      base: await lookupTreeEntry(graphql, owner, repo, baseSha, file.path, baseRequired, cache),
    });
  }

  return snapshots;
}

async function lookupTreeEntry(
  graphql: GraphqlClient,
  owner: string,
  repo: string,
  sha: string,
  filePath: string,
  required: boolean,
  cache: Map<string, Map<string, GitTreeEntry> | null>,
): Promise<GitTreeEntry | null> {
  const slash = filePath.lastIndexOf("/");
  const directory = slash === -1 ? "" : filePath.slice(0, slash);
  const name = slash === -1 ? filePath : filePath.slice(slash + 1);
  const listing = await loadDirectory(graphql, owner, repo, sha, directory, cache);
  if (!listing) {
    if (required) {
      throw new Error(`Git tree for ${directory || "."} at ${sha} is unavailable`);
    }
    return null;
  }
  const entry = listing.get(name) ?? null;
  if (!entry && required) {
    throw new Error(`Git entry ${filePath} is missing at ${sha}`);
  }
  return entry;
}

async function loadDirectory(
  graphql: GraphqlClient,
  owner: string,
  repo: string,
  sha: string,
  directory: string,
  cache: Map<string, Map<string, GitTreeEntry> | null>,
): Promise<Map<string, GitTreeEntry> | null> {
  const cacheKey = `${sha}:${directory}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const expression = directory.length === 0 ? `${sha}:` : `${sha}:${directory}`;
  const response = (await graphql(
    `query($owner: String!, $repo: String!, $expression: String!) {
      repository(owner: $owner, name: $repo) {
        object(expression: $expression) {
          __typename
          ... on Tree {
            entries { name mode type }
          }
        }
      }
    }`,
    { owner, repo, expression },
  )) as TreeResponse;

  const object = response.repository?.object;
  if (!object) {
    cache.set(cacheKey, null);
    return null;
  }
  if (object.__typename !== "Tree" || !object.entries) {
    throw new Error(`Git object ${expression} is not a tree`);
  }

  const listing = new Map<string, GitTreeEntry>();
  for (const entry of object.entries) {
    if (!entry?.name || typeof entry.mode !== "number" || !entry.type) {
      throw new Error(`GitHub returned an incomplete tree entry for ${expression}`);
    }
    listing.set(entry.name, { mode: entry.mode, type: entry.type });
  }
  cache.set(cacheKey, listing);
  return listing;
}

function assertCommitSha(sha: string, label: string): void {
  if (!/^[0-9a-f]{40}$/i.test(sha) && !/^[0-9a-f]{64}$/i.test(sha)) {
    throw new Error(`Refusing to read git metadata for an invalid ${label}`);
  }
}

async function approvePullRequest(
  graphql: GraphqlClient,
  pullRequestId: string,
  headSha: string,
  body: string,
): Promise<string> {
  const response = (await graphql(
    `mutation($pullRequestId: ID!, $commitOID: GitObjectID!, $body: String!) {
      addPullRequestReview(input: {
        pullRequestId: $pullRequestId,
        commitOID: $commitOID,
        event: APPROVE,
        body: $body
      }) {
        pullRequestReview { id }
      }
    }`,
    { pullRequestId, commitOID: headSha, body },
  )) as AddPullRequestReviewResponse;

  const reviewId = response.addPullRequestReview.pullRequestReview?.id;
  if (!reviewId) {
    throw new Error("GitHub did not return an approval review ID");
  }

  return reviewId;
}

async function dismissPullRequestReview(graphql: GraphqlClient, reviewId: string, message: string): Promise<void> {
  const response = (await graphql(
    `mutation($reviewId: ID!, $message: String!) {
      dismissPullRequestReview(input: {
        pullRequestReviewId: $reviewId,
        message: $message
      }) {
        pullRequestReview { id }
      }
    }`,
    { reviewId, message },
  )) as DismissPullRequestReviewResponse;

  if (!response.dismissPullRequestReview.pullRequestReview?.id) {
    throw new Error("GitHub did not return a dismissed review ID");
  }
}

async function enableAutoMerge(
  graphql: GraphqlClient,
  pullRequestId: string,
  headSha: string,
  mergeMethod: MergeMethod,
): Promise<void> {
  const response = (await graphql(
    `mutation($pullRequestId: ID!, $expectedHeadOid: GitObjectID!, $mergeMethod: PullRequestMergeMethod!) {
      enablePullRequestAutoMerge(input: {
        pullRequestId: $pullRequestId,
        expectedHeadOid: $expectedHeadOid,
        mergeMethod: $mergeMethod
      }) {
        pullRequest { id }
      }
    }`,
    { pullRequestId, expectedHeadOid: headSha, mergeMethod: toGraphqlMergeMethod(mergeMethod) },
  )) as EnablePullRequestAutoMergeResponse;

  if (!response.enablePullRequestAutoMerge.pullRequest?.id) {
    throw new Error("GitHub did not return an auto-merge pull request ID");
  }
}

async function mergePullRequest(
  graphql: GraphqlClient,
  pullRequestId: string,
  headSha: string,
  mergeMethod: MergeMethod,
): Promise<void> {
  const response = (await graphql(
    `mutation($pullRequestId: ID!, $expectedHeadOid: GitObjectID!, $mergeMethod: PullRequestMergeMethod!) {
      mergePullRequest(input: {
        pullRequestId: $pullRequestId,
        expectedHeadOid: $expectedHeadOid,
        mergeMethod: $mergeMethod
      }) {
        pullRequest { id }
      }
    }`,
    { pullRequestId, expectedHeadOid: headSha, mergeMethod: toGraphqlMergeMethod(mergeMethod) },
  )) as MergePullRequestResponse;

  if (!response.mergePullRequest.pullRequest?.id) {
    throw new Error("GitHub did not return a merged pull request ID");
  }
}

function toGraphqlMergeMethod(mergeMethod: MergeMethod): "SQUASH" | "MERGE" | "REBASE" {
  if (mergeMethod === "squash") {
    return "SQUASH";
  }
  if (mergeMethod === "merge") {
    return "MERGE";
  }
  return "REBASE";
}
