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
        baseRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
      fetchPullRequestRefs: expect.any(Function),
      fetchFileModes: expect.any(Function),
      approvePullRequest: expect.any(Function),
      dismissPullRequestReview: expect.any(Function),
      dismissPreviousApprovals: expect.any(Function),
      enableAutoMerge: expect.any(Function),
      mergePullRequest: expect.any(Function),
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
        baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      changedFiles: ["CHANGELOG.md", "docs/releases.md"],
      files: [
        { path: "CHANGELOG.md", changeType: "MODIFIED" },
        { path: "docs/releases.md", changeType: "ADDED" },
      ],
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

  it("returns a renamed file so verification can refuse it without losing the path", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () =>
      snapshotResponse({ files: [{ path: "CHANGELOG.md", changeType: "RENAMED" }] }),
    );
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.fetchPullRequestSnapshot("octo-org", "demo-repo", 9)).resolves.toMatchObject({
      files: [{ path: "CHANGELOG.md", changeType: "RENAMED" }],
    });
  });

  it("rejects when pagination observes multiple base SHAs", async () => {
    const mergeGraphql = vi
      .fn<GraphqlClient>()
      .mockResolvedValueOnce(
        snapshotResponse({
          files: [{ path: "CHANGELOG.md", changeType: "MODIFIED" }],
          hasNextPage: true,
          endCursor: "cursor-1",
        }),
      )
      .mockResolvedValueOnce({
        repository: {
          pullRequest: {
            id: "PR_node_id",
            number: 9,
            state: "OPEN",
            author: { login: "app/changelog-bot" },
            headRefOid: "abc123",
            baseRefOid: "cccccccccccccccccccccccccccccccccccccccc",
            files: {
              nodes: [{ path: "docs/releases.md", changeType: "ADDED" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.fetchPullRequestSnapshot("octo-org", "demo-repo", 9)).rejects.toThrow(
      "Refusing to seal octo-org/demo-repo#9 because changed file pagination observed multiple base SHAs: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, cccccccccccccccccccccccccccccccccccccccc",
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

  it("reads pinned refs and tree modes, and dismisses a review with the approver token", async () => {
    const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const baseSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const approveGraphql = vi.fn<GraphqlClient>(async () => ({
      dismissPullRequestReview: { pullRequestReview: { id: "review_id" } },
    }));
    const mergeGraphql = vi.fn<GraphqlClient>(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes("headRefOid") && !query.includes("files(")) {
        return {
          repository: {
            pullRequest: { state: "OPEN", headRefOid: headSha, baseRefOid: baseSha },
          },
        };
      }
      const entries =
        variables.expression === `${headSha}:docs`
          ? [{ name: "guide.md", mode: 33188, type: "blob" }]
          : variables.expression === `${baseSha}:`
            ? [{ name: "README.md", mode: 33261, type: "blob" }]
            : [{ name: "README.md", mode: 33188, type: "blob" }];
      return { repository: { object: { __typename: "Tree", entries } } };
    });
    const { adapter } = await createAdapter({ approveGraphql, mergeGraphql });

    await expect(adapter.fetchPullRequestRefs("octo-org", "demo-repo", 9)).resolves.toEqual({
      state: "open",
      headSha,
      baseSha,
    });
    await expect(
      adapter.fetchFileModes("octo-org", "demo-repo", headSha, baseSha, [
        { path: "README.md", changeType: "MODIFIED" },
        { path: "docs/guide.md", changeType: "ADDED" },
      ]),
    ).resolves.toEqual([
      {
        path: "README.md",
        changeType: "MODIFIED",
        head: { mode: 33188, type: "blob" },
        base: { mode: 33261, type: "blob" },
      },
      {
        path: "docs/guide.md",
        changeType: "ADDED",
        head: { mode: 33188, type: "blob" },
        base: null,
      },
    ]);
    expect(mergeGraphql).toHaveBeenCalledWith(expect.stringContaining("object(expression: $expression)"), {
      owner: "octo-org",
      repo: "demo-repo",
      expression: `${headSha}:docs`,
    });

    await adapter.dismissPullRequestReview("review_id", "stale");
    expect(approveGraphql).toHaveBeenCalledWith(expect.stringContaining("dismissPullRequestReview"), {
      reviewId: "review_id",
      message: "stale",
    });
  });

  it("fails closed when a required git entry is missing or the commit SHA is not usable", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () => ({
      repository: { object: { __typename: "Tree", entries: [] } },
    }));
    const { adapter } = await createAdapter({ mergeGraphql });
    const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const baseSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    await expect(
      adapter.fetchFileModes("octo-org", "demo-repo", headSha, baseSha, [{ path: "README.md", changeType: "MODIFIED" }]),
    ).rejects.toThrow("Git entry README.md is missing");
    await expect(
      adapter.fetchFileModes("octo-org", "demo-repo", "abc123", baseSha, [{ path: "README.md", changeType: "MODIFIED" }]),
    ).rejects.toThrow("invalid head SHA");
    await expect(
      adapter.fetchFileModes("octo-org", "demo-repo", headSha, baseSha, [{ path: "../README.md", changeType: "ADDED" }]),
    ).rejects.toThrow("unsafe path");
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
      body: "Verified.\n\n<!-- pr-seal-action:automated-approval -->",
    });
    expect(approveGraphql.mock.calls[0]?.[0]).toContain("commitOID: $commitOID");
  });

  it("dismisses only this action's approvals by the approver actor across review pages", async () => {
    const approveGraphql = vi.fn<GraphqlClient>()
      .mockResolvedValueOnce({ node: { reviews: {
        nodes: [
          { id: "auto-1", state: "APPROVED", viewerDidAuthor: true, body: "Verified.\n\n<!-- pr-seal-action:automated-approval -->" },
          { id: "owner-comment", state: "APPROVED", viewerDidAuthor: true, body: "Owner approved" },
          { id: "other-actor", state: "APPROVED", viewerDidAuthor: false, body: "Verified.\n\n<!-- pr-seal-action:automated-approval -->" },
        ],
        pageInfo: { hasNextPage: true, endCursor: "next" },
      } } })
      .mockResolvedValueOnce({ node: { reviews: {
        nodes: [{ id: "auto-2", state: "APPROVED", viewerDidAuthor: true, body: "Approved\n\n<!-- pr-seal-action:automated-approval -->" }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } })
      .mockResolvedValue({ dismissPullRequestReview: { pullRequestReview: { id: "dismissed" } } });
    const { adapter } = await createAdapter({ approveGraphql });

    await adapter.dismissPreviousApprovals("PR_node_id");

    expect(approveGraphql.mock.calls[0]?.[1]).toEqual({ pullRequestId: "PR_node_id", cursor: null });
    expect(approveGraphql.mock.calls[1]?.[1]).toEqual({ pullRequestId: "PR_node_id", cursor: "next" });
    expect(approveGraphql.mock.calls.slice(2).map(([, variables]) => variables.reviewId)).toEqual(["auto-1", "auto-2"]);
  });

  it("does not partially dismiss approvals when review pagination is incomplete", async () => {
    const approveGraphql = vi.fn<GraphqlClient>()
      .mockResolvedValueOnce({ node: { reviews: {
        nodes: [{ id: "auto-1", state: "APPROVED", viewerDidAuthor: true, body: "Verified.\n\n<!-- pr-seal-action:automated-approval -->" }],
        pageInfo: { hasNextPage: true, endCursor: "next" },
      } } })
      .mockResolvedValueOnce({ node: { reviews: { nodes: null, pageInfo: { hasNextPage: false, endCursor: null } } } });
    const { adapter } = await createAdapter({ approveGraphql });

    await expect(adapter.dismissPreviousApprovals("PR_node_id")).rejects.toThrow("did not return approval reviews");
    expect(approveGraphql).toHaveBeenCalledTimes(2);
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

  it("merges a pull request with expectedHeadOid and an uppercase GraphQL merge method", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () => ({
      mergePullRequest: { pullRequest: { id: "PR_node_id" } },
    }));
    const { adapter } = await createAdapter({ mergeGraphql });

    await adapter.mergePullRequest("PR_node_id", "abc123", "squash");

    expect(mergeGraphql).toHaveBeenCalledWith(expect.stringContaining("mergePullRequest"), {
      pullRequestId: "PR_node_id",
      expectedHeadOid: "abc123",
      mergeMethod: "SQUASH",
    });
    expect(mergeGraphql.mock.calls[0]?.[0]).toContain("expectedHeadOid: $expectedHeadOid");
  });

  it("fails when GitHub does not return a merged pull request ID", async () => {
    const mergeGraphql = vi.fn<GraphqlClient>(async () => ({
      mergePullRequest: { pullRequest: null },
    }));
    const { adapter } = await createAdapter({ mergeGraphql });

    await expect(adapter.mergePullRequest("PR_node_id", "abc123", "squash")).rejects.toThrow(
      "GitHub did not return a merged pull request ID",
    );
  });
});
