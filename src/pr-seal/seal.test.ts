import { describe, expect, it, vi } from "vitest";
import type { ActionInputs } from "../action/inputs.js";
import type { GitHubSealAdapter } from "../github/seal-adapter.js";
import { sealPullRequest } from "./seal.js";

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
  fetchPullRequestSnapshot?: ReturnType<typeof vi.fn<GitHubSealAdapter["fetchPullRequestSnapshot"]>>;
  approvePullRequest?: ReturnType<typeof vi.fn<GitHubSealAdapter["approvePullRequest"]>>;
  enableAutoMerge?: ReturnType<typeof vi.fn<GitHubSealAdapter["enableAutoMerge"]>>;
  mergePullRequest?: ReturnType<typeof vi.fn<GitHubSealAdapter["mergePullRequest"]>>;
}) {
  return {
    fetchPullRequestSnapshot:
      overrides?.fetchPullRequestSnapshot ??
      vi.fn<GitHubSealAdapter["fetchPullRequestSnapshot"]>(async () => ({
        pullRequest: {
          id: "PR_node_id",
          number: 9,
          state: overrides?.state ?? "open",
          authorLogin: overrides?.authorLogin ?? "app/changelog-bot",
          headSha: "abc123",
        },
        changedFiles: overrides?.files ?? ["CHANGELOG.md"],
      })),
    approvePullRequest:
      overrides?.approvePullRequest ??
      vi.fn<GitHubSealAdapter["approvePullRequest"]>(async () => "review_id"),
    enableAutoMerge:
      overrides?.enableAutoMerge ??
      vi.fn<GitHubSealAdapter["enableAutoMerge"]>(async () => undefined),
    mergePullRequest:
      overrides?.mergePullRequest ??
      vi.fn<GitHubSealAdapter["mergePullRequest"]>(async () => undefined),
  };
}

function failedSnapshot(message: string): ReturnType<typeof vi.fn<GitHubSealAdapter["fetchPullRequestSnapshot"]>> {
  return vi.fn<GitHubSealAdapter["fetchPullRequestSnapshot"]>(async () => {
    throw new Error(message);
  });
}

describe("sealPullRequest", () => {
  it("fetches, verifies, approves, and enables auto-merge with the verified head SHA", async () => {
    const github = dependencies();

    await expect(sealPullRequest(inputs, github)).resolves.toEqual({
      pullRequestId: "PR_node_id",
      headSha: "abc123",
      changedFiles: ["CHANGELOG.md"],
      approved: true,
      autoMergeEnabled: true,
      merged: false,
    });

    expect(github.fetchPullRequestSnapshot).toHaveBeenCalledWith("octo-org", "demo-repo", 9);
    expect(github.approvePullRequest).toHaveBeenCalledWith("PR_node_id", "abc123", "Verified.");
    expect(github.enableAutoMerge).toHaveBeenCalledWith("PR_node_id", "abc123", "squash");
    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(github.approvePullRequest.mock.invocationCallOrder[0]).toBeLessThan(
      github.enableAutoMerge.mock.invocationCallOrder[0]!,
    );
  });

  it("directly merges the verified head when GitHub reports the pull request is already clean", async () => {
    const enableAutoMerge = vi.fn<GitHubSealAdapter["enableAutoMerge"]>(async () => {
      throw new Error(
        "Request failed due to following response errors:\n - Pull request Pull request is in clean status",
      );
    });
    const mergePullRequest = vi.fn<GitHubSealAdapter["mergePullRequest"]>(async () => undefined);
    const github = dependencies({ enableAutoMerge, mergePullRequest });

    await expect(sealPullRequest(inputs, github)).resolves.toEqual({
      pullRequestId: "PR_node_id",
      headSha: "abc123",
      changedFiles: ["CHANGELOG.md"],
      approved: true,
      autoMergeEnabled: false,
      merged: true,
    });

    expect(github.approvePullRequest).toHaveBeenCalledWith("PR_node_id", "abc123", "Verified.");
    expect(github.enableAutoMerge).toHaveBeenCalledWith("PR_node_id", "abc123", "squash");
    expect(github.mergePullRequest).toHaveBeenCalledWith("PR_node_id", "abc123", "squash");
    expect(github.enableAutoMerge.mock.invocationCallOrder[0]).toBeLessThan(
      github.mergePullRequest.mock.invocationCallOrder[0]!,
    );
  });

  it("does not approve or enable auto-merge when snapshot fetching fails closed", async () => {
    const github = dependencies({
      fetchPullRequestSnapshot: failedSnapshot(
        "Refusing to seal octo-org/demo-repo#9 because changed file pagination observed multiple head SHAs: abc123, def456",
      ),
    });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow(
      "Refusing to seal octo-org/demo-repo#9 because changed file pagination observed multiple head SHAs: abc123, def456",
    );
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("does not approve or enable auto-merge when author verification fails", async () => {
    const github = dependencies({ authorLogin: "app/other-bot" });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow("PR author is app/other-bot");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("does not approve or enable auto-merge when changed files are unsafe", async () => {
    const github = dependencies({ files: ["CHANGELOG.md", "package.json"] });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow("disallowed paths: package.json");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("does not enable auto-merge when approval fails", async () => {
    const approvePullRequest = vi.fn<GitHubSealAdapter["approvePullRequest"]>(async () => {
      throw new Error("approval rejected");
    });
    const github = dependencies({ approvePullRequest });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow("approval rejected");
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });
});
