import { describe, expect, it, vi } from "vitest";
import {
  approvePullRequest,
  createGitHubClients,
  enableAutoMerge,
  fetchChangedFiles,
  fetchPullRequest,
  fetchPullRequestSnapshot,
} from "./github";

const githubMock = vi.hoisted(() => ({
  getOctokit: vi.fn((token: string) => ({
    graphql: vi.fn(async () => ({ token })),
    rest: { token },
  })),
}));

vi.mock("@actions/github", () => githubMock);

describe("createGitHubClients", () => {
  it("uses merge token for read and merge clients and approve token for approval client", async () => {
    githubMock.getOctokit.mockClear();

    const clients = await createGitHubClients({
      approveToken: "approve-token",
      mergeToken: "merge-token",
    });

    const readOctokit = githubMock.getOctokit.mock.results[0]?.value;
    const approveOctokit = githubMock.getOctokit.mock.results[1]?.value;
    const mergeOctokit = githubMock.getOctokit.mock.results[2]?.value;

    expect(githubMock.getOctokit).toHaveBeenNthCalledWith(1, "merge-token");
    expect(githubMock.getOctokit).toHaveBeenNthCalledWith(2, "approve-token");
    expect(githubMock.getOctokit).toHaveBeenNthCalledWith(3, "merge-token");
    expect(clients.readClient).toBe(readOctokit);
    expect(clients.approveGraphql).toBe(approveOctokit.graphql);
    expect(clients.mergeGraphql).toBe(mergeOctokit.graphql);
  });
});

describe("fetchPullRequest", () => {
  it("maps REST pull request data into internal details", async () => {
    const client = {
      rest: {
        pulls: {
          get: vi.fn(async () => ({
            data: {
              node_id: "PR_node_id",
              number: 9,
              state: "open",
              user: { login: "app/changelog-bot" },
              head: { sha: "abc123" },
            },
          })),
          listFiles: vi.fn(),
        },
      },
      paginate: vi.fn(),
    };

    await expect(fetchPullRequest(client, "octo-org", "demo-repo", 9)).resolves.toEqual({
      id: "PR_node_id",
      number: 9,
      state: "open",
      authorLogin: "app/changelog-bot",
      headSha: "abc123",
    });

    expect(client.rest.pulls.get).toHaveBeenCalledWith({
      owner: "octo-org",
      repo: "demo-repo",
      pull_number: 9,
    });
  });
});

describe("fetchChangedFiles", () => {
  it("collects all filenames through octokit pagination", async () => {
    const listFiles = vi.fn();
    const client = {
      rest: { pulls: { get: vi.fn(), listFiles } },
      paginate: vi.fn(async (_endpoint, _params, mapFn: (response: { data: Array<{ filename: string }> }) => string[]) =>
        mapFn({ data: [{ filename: "CHANGELOG.md" }, { filename: "docs/releases.md" }] }),
      ),
    };

    await expect(fetchChangedFiles(client, "octo-org", "demo-repo", 9)).resolves.toEqual([
      "CHANGELOG.md",
      "docs/releases.md",
    ]);

    expect(client.paginate).toHaveBeenCalledWith(
      listFiles,
      { owner: "octo-org", repo: "demo-repo", pull_number: 9, per_page: 100 },
      expect.any(Function),
    );
  });
});

describe("fetchPullRequestSnapshot", () => {
  it("maps a single GraphQL page into pull request details and changed files", async () => {
    const graphql = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      repository: {
        pullRequest: {
          id: "PR_node_id",
          number: 9,
          state: "OPEN",
          author: { login: "app/changelog-bot" },
          headRefOid: "abc123",
          files: {
            nodes: [
              { path: "CHANGELOG.md", changeType: "MODIFIED" },
              { path: "docs/releases.md", changeType: "ADDED" },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }));

    await expect(fetchPullRequestSnapshot(graphql, "octo-org", "demo-repo", 9)).resolves.toEqual({
      pullRequest: {
        id: "PR_node_id",
        number: 9,
        state: "open",
        authorLogin: "app/changelog-bot",
        headSha: "abc123",
      },
      changedFiles: ["CHANGELOG.md", "docs/releases.md"],
    });

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("pullRequest(number: $pullNumber)"), {
      owner: "octo-org",
      repo: "demo-repo",
      pullNumber: 9,
      fileCursor: null,
    });
  });

  it("paginates changed files with the returned cursor", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({
        repository: {
          pullRequest: {
            id: "PR_node_id",
            number: 9,
            state: "OPEN",
            author: { login: "app/changelog-bot" },
            headRefOid: "abc123",
            files: {
              nodes: [{ path: "CHANGELOG.md", changeType: "MODIFIED" }],
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequest: {
            id: "PR_node_id",
            number: 9,
            state: "OPEN",
            author: { login: "app/changelog-bot" },
            headRefOid: "abc123",
            files: {
              nodes: [{ path: "docs/releases.md", changeType: "ADDED" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });

    await expect(fetchPullRequestSnapshot(graphql, "octo-org", "demo-repo", 9)).resolves.toMatchObject({
      changedFiles: ["CHANGELOG.md", "docs/releases.md"],
    });

    expect(graphql).toHaveBeenNthCalledWith(1, expect.any(String), {
      owner: "octo-org",
      repo: "demo-repo",
      pullNumber: 9,
      fileCursor: null,
    });
    expect(graphql).toHaveBeenNthCalledWith(2, expect.any(String), {
      owner: "octo-org",
      repo: "demo-repo",
      pullNumber: 9,
      fileCursor: "cursor-1",
    });
  });

  it("rejects when pagination observes multiple head SHAs", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({
        repository: {
          pullRequest: {
            id: "PR_node_id",
            number: 9,
            state: "OPEN",
            author: { login: "app/changelog-bot" },
            headRefOid: "abc123",
            files: {
              nodes: [{ path: "CHANGELOG.md", changeType: "MODIFIED" }],
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequest: {
            id: "PR_node_id",
            number: 9,
            state: "OPEN",
            author: { login: "app/changelog-bot" },
            headRefOid: "def456",
            files: {
              nodes: [{ path: "docs/releases.md", changeType: "ADDED" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });

    await expect(fetchPullRequestSnapshot(graphql, "octo-org", "demo-repo", 9)).rejects.toThrow(
      "Refusing to seal octo-org/demo-repo#9 because changed file pagination observed multiple head SHAs: abc123, def456",
    );
  });

  it("rejects a renamed changed file because the previous path cannot be safely verified", async () => {
    const graphql = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      repository: {
        pullRequest: {
          id: "PR_node_id",
          number: 9,
          state: "OPEN",
          author: { login: "app/changelog-bot" },
          headRefOid: "abc123",
          files: {
            nodes: [{ path: "CHANGELOG.md", changeType: "RENAMED" }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }));

    await expect(fetchPullRequestSnapshot(graphql, "octo-org", "demo-repo", 9)).rejects.toThrow(
      "Refusing to seal octo-org/demo-repo#9 because renamed files cannot be safely verified: CHANGELOG.md",
    );
  });

  it("rejects when GitHub does not return changed-file nodes", async () => {
    const graphql = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      repository: {
        pullRequest: {
          id: "PR_node_id",
          number: 9,
          state: "OPEN",
          author: { login: "app/changelog-bot" },
          headRefOid: "abc123",
          files: {
            nodes: null,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }));

    await expect(fetchPullRequestSnapshot(graphql, "octo-org", "demo-repo", 9)).rejects.toThrow(
      "GitHub did not return changed-file nodes for octo-org/demo-repo#9",
    );
  });

  it("rejects an incomplete changed-file node", async () => {
    const graphql = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      repository: {
        pullRequest: {
          id: "PR_node_id",
          number: 9,
          state: "OPEN",
          author: { login: "app/changelog-bot" },
          headRefOid: "abc123",
          files: {
            nodes: [null],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }));

    await expect(fetchPullRequestSnapshot(graphql, "octo-org", "demo-repo", 9)).rejects.toThrow(
      "GitHub returned an incomplete changed-file node for octo-org/demo-repo#9",
    );
  });
});

describe("approvePullRequest", () => {
  it("creates an approval review against the verified commit OID", async () => {
    const graphql = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      addPullRequestReview: { pullRequestReview: { id: "review_id" } },
    }));

    await expect(approvePullRequest(graphql, "PR_node_id", "abc123", "Verified.")).resolves.toBe(
      "review_id",
    );

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("addPullRequestReview"), {
      pullRequestId: "PR_node_id",
      commitOID: "abc123",
      body: "Verified.",
    });
    expect(graphql.mock.calls[0]?.[0]).toContain("commitOID: $commitOID");
  });

  it("fails when GitHub does not return a review ID", async () => {
    const graphql = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      addPullRequestReview: { pullRequestReview: null },
    }));

    await expect(approvePullRequest(graphql, "PR_node_id", "abc123", "Verified.")).rejects.toThrow(
      "GitHub did not return an approval review ID",
    );
  });
});

describe("enableAutoMerge", () => {
  it("enables auto-merge with expectedHeadOid and an uppercase GraphQL merge method", async () => {
    const graphql = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      enablePullRequestAutoMerge: { pullRequest: { id: "PR_node_id" } },
    }));

    await enableAutoMerge(graphql, "PR_node_id", "abc123", "squash");

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("enablePullRequestAutoMerge"), {
      pullRequestId: "PR_node_id",
      expectedHeadOid: "abc123",
      mergeMethod: "SQUASH",
    });
    expect(graphql.mock.calls[0]?.[0]).toContain("expectedHeadOid: $expectedHeadOid");
  });

  it("fails when GitHub does not return an auto-merge pull request ID", async () => {
    const graphql = vi.fn(async (_query: string, _variables: Record<string, unknown>) => ({
      enablePullRequestAutoMerge: { pullRequest: null },
    }));

    await expect(enableAutoMerge(graphql, "PR_node_id", "abc123", "squash")).rejects.toThrow(
      "GitHub did not return an auto-merge pull request ID",
    );
  });
});
