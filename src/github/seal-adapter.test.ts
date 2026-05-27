import { describe, expect, it, vi } from "vitest";
import { createGitHubSealAdapter } from "./seal-adapter.js";

type GraphqlClient = (query: string, variables: Record<string, unknown>) => Promise<unknown>;
type GraphqlMock = ReturnType<typeof vi.fn<GraphqlClient>>;

const githubMock = vi.hoisted(() => ({
  getOctokit: vi.fn(),
}));

vi.mock("@actions/github", () => githubMock);

async function createAdapter(overrides?: { approveGraphql?: GraphqlMock; mergeGraphql?: GraphqlMock }) {
  const approveGraphql =
    overrides?.approveGraphql ??
    vi.fn<GraphqlClient>(async () => ({ addPullRequestReview: { pullRequestReview: { id: "review_id" } } }));
  const mergeGraphql =
    overrides?.mergeGraphql ??
    vi.fn<GraphqlClient>(async () => ({ enablePullRequestAutoMerge: { pullRequest: { id: "PR_node_id" } } }));

  githubMock.getOctokit.mockReset();
  githubMock.getOctokit
    .mockReturnValueOnce({ graphql: approveGraphql })
    .mockReturnValueOnce({ graphql: mergeGraphql });

  const adapter = await createGitHubSealAdapter({
    approveToken: "approve-token",
    mergeToken: "merge-token",
  });

  return { adapter, approveGraphql, mergeGraphql };
}

function snapshotResponse(overrides?: {
  headSha?: string;
  files?: Array<{ path?: string | null; changeType?: string | null } | null> | null;
  hasNextPage?: boolean;
  endCursor?: string | null;
}) {
  return {
    repository: {
      pullRequest: {
        id: "PR_node_id",
        number: 9,
        state: "OPEN",
        author: { login: "app/changelog-bot" },
        headRefOid: overrides?.headSha ?? "abc123",
        files: {
          nodes:
            overrides && "files" in overrides
              ? overrides.files
              : [
                  { path: "CHANGELOG.md", changeType: "MODIFIED" },
                  { path: "docs/releases.md", changeType: "ADDED" },
                ],
          pageInfo: {
            hasNextPage: overrides?.hasNextPage ?? false,
            endCursor: overrides?.endCursor ?? null,
          },
        },
      },
    },
  };
}

describe("createGitHubSealAdapter", () => {
  it("uses approve token for approval and merge token for snapshot and auto-merge", async () => {
    const { adapter } = await createAdapter();

    expect(githubMock.getOctokit).toHaveBeenNthCalledWith(1, "approve-token");
    expect(githubMock.getOctokit).toHaveBeenNthCalledWith(2, "merge-token");
    expect(adapter).toEqual({
      fetchPullRequestSnapshot: expect.any(Function),
      approvePullRequest: expect.any(Function),
      enableAutoMerge: expect.any(Function),
    });
  });

  it("maps a single GraphQL page into pull request details and changed files", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () => snapshotResponse());
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.fetchPullRequestSnapshot("octo-org", "demo-repo", 9)).resolves.toEqual({
      pullRequest: {
        id: "PR_node_id",
        number: 9,
        state: "open",
        authorLogin: "app/changelog-bot",
        headSha: "abc123",
      },
      changedFiles: ["CHANGELOG.md", "docs/releases.md"],
    });

    expect(mergeGraphql).toHaveBeenCalledWith(expect.stringContaining("pullRequest(number: $pullNumber)"), {
      owner: "octo-org",
      repo: "demo-repo",
      pullNumber: 9,
      fileCursor: null,
    });
  });

  it("paginates changed files with the returned cursor", async () => {
    const mergeGraphql = vi
      .fn<GraphqlClient>()
      .mockResolvedValueOnce(
        snapshotResponse({
          files: [{ path: "CHANGELOG.md", changeType: "MODIFIED" }],
          hasNextPage: true,
          endCursor: "cursor-1",
        }),
      )
      .mockResolvedValueOnce(
        snapshotResponse({
          files: [{ path: "docs/releases.md", changeType: "ADDED" }],
        }),
      );
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.fetchPullRequestSnapshot("octo-org", "demo-repo", 9)).resolves.toMatchObject({
      changedFiles: ["CHANGELOG.md", "docs/releases.md"],
    });

    expect(mergeGraphql).toHaveBeenNthCalledWith(1, expect.any(String), {
      owner: "octo-org",
      repo: "demo-repo",
      pullNumber: 9,
      fileCursor: null,
    });
    expect(mergeGraphql).toHaveBeenNthCalledWith(2, expect.any(String), {
      owner: "octo-org",
      repo: "demo-repo",
      pullNumber: 9,
      fileCursor: "cursor-1",
    });
  });

  it("rejects when pagination observes multiple head SHAs", async () => {
    const mergeGraphql = vi
      .fn<GraphqlClient>()
      .mockResolvedValueOnce(
        snapshotResponse({
          files: [{ path: "CHANGELOG.md", changeType: "MODIFIED" }],
          hasNextPage: true,
          endCursor: "cursor-1",
        }),
      )
      .mockResolvedValueOnce(
        snapshotResponse({
          headSha: "def456",
          files: [{ path: "docs/releases.md", changeType: "ADDED" }],
        }),
      );
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.fetchPullRequestSnapshot("octo-org", "demo-repo", 9)).rejects.toThrow(
      "Refusing to seal octo-org/demo-repo#9 because changed file pagination observed multiple head SHAs: abc123, def456",
    );
  });

  it("rejects a renamed changed file because the previous path cannot be safely verified", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () =>
      snapshotResponse({ files: [{ path: "CHANGELOG.md", changeType: "RENAMED" }] }),
    );
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.fetchPullRequestSnapshot("octo-org", "demo-repo", 9)).rejects.toThrow(
      "Refusing to seal octo-org/demo-repo#9 because renamed files cannot be safely verified: CHANGELOG.md",
    );
  });

  it("rejects when GitHub does not return changed-file nodes", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () => snapshotResponse({ files: null }));
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.fetchPullRequestSnapshot("octo-org", "demo-repo", 9)).rejects.toThrow(
      "GitHub did not return changed-file nodes for octo-org/demo-repo#9",
    );
  });

  it("rejects an incomplete changed-file node", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () => snapshotResponse({ files: [null] }));
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.fetchPullRequestSnapshot("octo-org", "demo-repo", 9)).rejects.toThrow(
      "GitHub returned an incomplete changed-file node for octo-org/demo-repo#9",
    );
  });

  it("creates an approval review against the verified commit OID", async () => {
    const approveGraphql = vi.fn<GraphqlClient>(async () => ({
      addPullRequestReview: { pullRequestReview: { id: "review_id" } },
    }));
    const { adapter } = await createAdapter({ approveGraphql });

    await expect(adapter.approvePullRequest("PR_node_id", "abc123", "Verified.")).resolves.toBe(
      "review_id",
    );

    expect(approveGraphql).toHaveBeenCalledWith(expect.stringContaining("addPullRequestReview"), {
      pullRequestId: "PR_node_id",
      commitOID: "abc123",
      body: "Verified.",
    });
    expect(approveGraphql.mock.calls[0]?.[0]).toContain("commitOID: $commitOID");
  });

  it("fails when GitHub does not return a review ID", async () => {
    const approveGraphql = vi.fn<GraphqlClient>(async () => ({
      addPullRequestReview: { pullRequestReview: null },
    }));
    const { adapter } = await createAdapter({ approveGraphql });

    await expect(adapter.approvePullRequest("PR_node_id", "abc123", "Verified.")).rejects.toThrow(
      "GitHub did not return an approval review ID",
    );
  });

  it("enables auto-merge with expectedHeadOid and an uppercase GraphQL merge method", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () => ({
      enablePullRequestAutoMerge: { pullRequest: { id: "PR_node_id" } },
    }));
    const { adapter } = await createAdapter({ mergeGraphql });

    await adapter.enableAutoMerge("PR_node_id", "abc123", "squash");

    expect(mergeGraphql).toHaveBeenCalledWith(expect.stringContaining("enablePullRequestAutoMerge"), {
      pullRequestId: "PR_node_id",
      expectedHeadOid: "abc123",
      mergeMethod: "SQUASH",
    });
    expect(mergeGraphql.mock.calls[0]?.[0]).toContain("expectedHeadOid: $expectedHeadOid");
  });

  it("fails when GitHub does not return an auto-merge pull request ID", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () => ({
      enablePullRequestAutoMerge: { pullRequest: null },
    }));
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.enableAutoMerge("PR_node_id", "abc123", "squash")).rejects.toThrow(
      "GitHub did not return an auto-merge pull request ID",
    );
  });
});
