import { getOctokit } from "@actions/github";

import type { MergeMethod } from "../action/inputs.js";
import type { PullRequestDetails } from "../pr-seal/verify.js";

type GraphqlClient = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

interface AddPullRequestReviewResponse {
  addPullRequestReview: {
    pullRequestReview: { id: string } | null;
  };
}

interface EnablePullRequestAutoMergeResponse {
  enablePullRequestAutoMerge: {
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

export interface PullRequestSnapshot {
  pullRequest: PullRequestDetails;
  changedFiles: string[];
}

export interface GitHubSealAdapter {
  fetchPullRequestSnapshot(owner: string, repo: string, pullNumber: number): Promise<PullRequestSnapshot>;
  approvePullRequest(pullRequestId: string, headSha: string, body: string): Promise<string>;
  enableAutoMerge(pullRequestId: string, headSha: string, mergeMethod: MergeMethod): Promise<void>;
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
    approvePullRequest: (pullRequestId, headSha, body) =>
      approvePullRequest(approveGraphql, pullRequestId, headSha, body),
    enableAutoMerge: (pullRequestId, headSha, mergeMethod) =>
      enableAutoMerge(mergeGraphql, pullRequestId, headSha, mergeMethod),
  };
}

async function fetchPullRequestSnapshot(
  graphql: GraphqlClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestSnapshot> {
  const changedFiles: string[] = [];
  let fileCursor: string | null = null;
  let firstHeadSha: string | undefined;
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

    if (firstHeadSha && data.headRefOid !== firstHeadSha) {
      throw new Error(
        `Refusing to seal ${owner}/${repo}#${pullNumber} because changed file pagination observed multiple head SHAs: ${firstHeadSha}, ${data.headRefOid}`,
      );
    }

    firstHeadSha = data.headRefOid;
    pullRequest = {
      id: data.id,
      number: data.number,
      state: data.state.toLowerCase(),
      authorLogin: data.author?.login ?? "",
      headSha: data.headRefOid,
    };

    if (!data.files.nodes) {
      throw new Error(`GitHub did not return changed-file nodes for ${owner}/${repo}#${pullNumber}`);
    }

    for (const file of data.files.nodes) {
      if (!file?.path || !file.changeType) {
        throw new Error(`GitHub returned an incomplete changed-file node for ${owner}/${repo}#${pullNumber}`);
      }
      if (file.changeType === "RENAMED") {
        throw new Error(
          `Refusing to seal ${owner}/${repo}#${pullNumber} because renamed files cannot be safely verified: ${file.path}`,
        );
      }
      changedFiles.push(file.path);
    }

    if (!data.files.pageInfo.hasNextPage) {
      break;
    }

    if (!data.files.pageInfo.endCursor) {
      throw new Error(`GitHub did not return a changed-file pagination cursor for ${owner}/${repo}#${pullNumber}`);
    }

    fileCursor = data.files.pageInfo.endCursor;
  }

  return { pullRequest: pullRequest!, changedFiles };
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

function toGraphqlMergeMethod(mergeMethod: MergeMethod): "SQUASH" | "MERGE" | "REBASE" {
  if (mergeMethod === "squash") {
    return "SQUASH";
  }
  if (mergeMethod === "merge") {
    return "MERGE";
  }
  return "REBASE";
}
