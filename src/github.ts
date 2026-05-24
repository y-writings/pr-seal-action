import type { MergeMethod } from "./inputs";
import type { PullRequestDetails } from "./verify";

export type GraphqlClient = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

export interface RestClient {
  rest: {
    pulls: {
      get(params: { owner: string; repo: string; pull_number: number }): Promise<{ data: PullRequestRestData }>;
      listFiles(params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
      }): Promise<unknown>;
    };
  };
  paginate(
    endpoint: unknown,
    params: Record<string, unknown>,
    mapFn: (response: { data: Array<{ filename: string }> }) => string[],
  ): Promise<string[]>;
}

interface PullRequestRestData {
  node_id?: string | null;
  number: number;
  state: string;
  user?: { login?: string | null } | null;
  head?: { sha?: string | null } | null;
}

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

export interface GitHubClients {
  readClient: RestClient;
  approveGraphql: GraphqlClient;
  mergeGraphql: GraphqlClient;
}

export async function createGitHubClients(tokens: { approveToken: string; mergeToken: string }): Promise<GitHubClients> {
  const github = await import("@actions/github");
  const readClient = github.getOctokit(tokens.mergeToken) as unknown as RestClient;
  const approveClient = github.getOctokit(tokens.approveToken);
  const mergeClient = github.getOctokit(tokens.mergeToken);

  return {
    readClient,
    approveGraphql: approveClient.graphql as GraphqlClient,
    mergeGraphql: mergeClient.graphql as GraphqlClient,
  };
}

export async function fetchPullRequest(
  client: RestClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestDetails> {
  const response = await client.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  const data = response.data;

  return {
    id: data.node_id ?? "",
    number: data.number,
    state: data.state,
    authorLogin: data.user?.login ?? "",
    headSha: data.head?.sha ?? "",
  };
}

export async function fetchChangedFiles(
  client: RestClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<string[]> {
  return client.paginate(
    client.rest.pulls.listFiles,
    { owner, repo, pull_number: pullNumber, per_page: 100 },
    (response) => response.data.map((file) => file.filename),
  );
}

export async function fetchPullRequestSnapshot(
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

export async function approvePullRequest(
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

export async function enableAutoMerge(
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
