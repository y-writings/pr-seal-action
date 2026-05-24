import { describe, expect, it, vi } from "vitest";
import type { ActionInputs } from "./inputs";
import type { GraphqlClient } from "./github";
import { sealPullRequest } from "./seal";

const inputs: ActionInputs = {
  repository: { owner: "octo-org", repo: "demo-repo", value: "octo-org/demo-repo" },
  pullRequestNumber: 9,
  expectedAuthor: "app/changelog-bot",
  allowedPaths: ["CHANGELOG.md"],
  approveToken: "approve-token-value",
  mergeToken: "merge-token-value",
  mergeMethod: "squash",
  approveBody: "Verified.",
};

function dependencies(overrides?: {
  authorLogin?: string;
  state?: string;
  files?: string[];
  snapshotPages?: Array<{ headSha: string; files: string[]; hasNextPage: boolean; endCursor: string | null }>;
  approveGraphql?: ReturnType<typeof vi.fn<GraphqlClient>>;
  mergeGraphql?: ReturnType<typeof vi.fn<GraphqlClient>>;
}) {
  const snapshotPages = overrides?.snapshotPages ?? [snapshotPage({ files: overrides?.files ?? ["CHANGELOG.md"] })];
  let snapshotPageIndex = 0;
  const readClient = {
    rest: {
      pulls: {
        get: vi.fn(),
        listFiles: vi.fn(),
      },
    },
    paginate: vi.fn(),
  };
  const mergeGraphql =
    overrides?.mergeGraphql ??
    vi.fn<GraphqlClient>(async (query) => {
      if (query.includes("pullRequest(number: $pullNumber)")) {
        const page = snapshotPages[Math.min(snapshotPageIndex, snapshotPages.length - 1)];
        snapshotPageIndex += 1;

        return {
          repository: {
            pullRequest: {
              id: "PR_node_id",
              number: 9,
              state: overrides?.state?.toUpperCase() ?? "OPEN",
              author: { login: overrides?.authorLogin ?? "app/changelog-bot" },
              headRefOid: page.headSha,
              files: {
                nodes: page.files.map((path) => ({ path, changeType: "MODIFIED" })),
                pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
              },
            },
          },
        };
      }

      if (query.includes("enablePullRequestAutoMerge")) {
        return { enablePullRequestAutoMerge: { pullRequest: { id: "PR_node_id" } } };
      }

      throw new Error(`Unexpected GraphQL query: ${query}`);
    });

  return {
    readClient,
    approveGraphql:
      overrides?.approveGraphql ??
      vi.fn<GraphqlClient>(async () => ({ addPullRequestReview: { pullRequestReview: { id: "review_id" } } })),
    mergeGraphql,
  };
}

function snapshotPage(overrides?: { headSha?: string; files?: string[]; hasNextPage?: boolean; endCursor?: string | null }) {
  return {
    headSha: overrides?.headSha ?? "abc123",
    files: overrides?.files ?? ["CHANGELOG.md"],
    hasNextPage: overrides?.hasNextPage ?? false,
    endCursor: overrides?.endCursor ?? null,
  };
}

function autoMergeCalls(graphql: ReturnType<typeof vi.fn<GraphqlClient>>) {
  return graphql.mock.calls.filter(([query]) => query.includes("enablePullRequestAutoMerge"));
}

describe("sealPullRequest", () => {
  it("fetches, verifies, approves, and enables auto-merge with the verified head SHA", async () => {
    const deps = dependencies();

    await expect(sealPullRequest(inputs, deps)).resolves.toEqual({
      pullRequestId: "PR_node_id",
      headSha: "abc123",
      changedFiles: ["CHANGELOG.md"],
      approved: true,
      autoMergeEnabled: true,
    });

    expect(deps.approveGraphql).toHaveBeenCalledWith(expect.stringContaining("addPullRequestReview"), {
      pullRequestId: "PR_node_id",
      commitOID: "abc123",
      body: "Verified.",
    });
    expect(deps.mergeGraphql).toHaveBeenCalledWith(expect.stringContaining("enablePullRequestAutoMerge"), {
      pullRequestId: "PR_node_id",
      expectedHeadOid: "abc123",
      mergeMethod: "SQUASH",
    });
    const autoMergeCallOrder = deps.mergeGraphql.mock.invocationCallOrder.find((_, index) =>
      deps.mergeGraphql.mock.calls[index]?.[0].includes("enablePullRequestAutoMerge"),
    );
    expect(deps.approveGraphql.mock.invocationCallOrder[0]).toBeLessThan(
      autoMergeCallOrder!,
    );
  });

  it("does not approve or enable auto-merge when snapshot pagination observes multiple head SHAs", async () => {
    const deps = dependencies({
      snapshotPages: [
        snapshotPage({ headSha: "abc123", hasNextPage: true, endCursor: "cursor-1" }),
        snapshotPage({ headSha: "def456", files: ["docs/releases.md"] }),
      ],
    });

    await expect(sealPullRequest(inputs, deps)).rejects.toThrow(
      "Refusing to seal octo-org/demo-repo#9 because changed file pagination observed multiple head SHAs: abc123, def456",
    );
    expect(deps.approveGraphql).not.toHaveBeenCalled();
    expect(autoMergeCalls(deps.mergeGraphql)).toHaveLength(0);
  });

  it("does not approve or enable auto-merge when author verification fails", async () => {
    const deps = dependencies({ authorLogin: "app/other-bot" });

    await expect(sealPullRequest(inputs, deps)).rejects.toThrow("PR author is app/other-bot");
    expect(deps.approveGraphql).not.toHaveBeenCalled();
    expect(autoMergeCalls(deps.mergeGraphql)).toHaveLength(0);
  });

  it("does not approve or enable auto-merge when changed files are unsafe", async () => {
    const deps = dependencies({ files: ["CHANGELOG.md", "package.json"] });

    await expect(sealPullRequest(inputs, deps)).rejects.toThrow("disallowed paths: package.json");
    expect(deps.approveGraphql).not.toHaveBeenCalled();
    expect(autoMergeCalls(deps.mergeGraphql)).toHaveLength(0);
  });

  it("does not enable auto-merge when approval fails", async () => {
    const approveGraphql = vi.fn<GraphqlClient>(async () => {
      throw new Error("approval rejected");
    });
    const deps = dependencies({ approveGraphql });

    await expect(sealPullRequest(inputs, deps)).rejects.toThrow("approval rejected");
    expect(autoMergeCalls(deps.mergeGraphql)).toHaveLength(0);
  });
});
