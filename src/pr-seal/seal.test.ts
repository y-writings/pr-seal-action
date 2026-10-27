import { describe, expect, it, vi } from "vitest";
import type { ActionInputs } from "../action/inputs.js";
import type { GitHubSealAdapter, PullRequestRefs, PullRequestSnapshot } from "../github/seal-adapter.js";
import { GIT_MODE_EXECUTABLE, GIT_MODE_REGULAR, GIT_MODE_SYMLINK } from "./file-mode.js";
import { sealPullRequest } from "./seal.js";

const inputs: ActionInputs = {
  repository: { owner: "octo-org", repo: "demo-repo", value: "octo-org/demo-repo" },
  pullRequestNumber: 9,
  expectedAuthors: ["app/changelog-bot"],
  allowedPaths: ["CHANGELOG.md"],
  allowedPatterns: [],
  deniedPatterns: [],
  pathPreset: "none",
  requireRegularFiles: false,
  approveToken: "approve-token-value",
  mergeToken: "merge-token-value",
  mergeMethod: "squash",
  approveBody: "Verified.",
  autoMerge: true,
  onIneligible: "fail",
};

const pinnedRefs: PullRequestRefs = { state: "open", headSha: "abc123", baseSha: "base123" };

function snapshot(overrides?: {
  authorLogin?: string;
  state?: string;
  files?: PullRequestSnapshot["files"];
  headSha?: string;
  baseSha?: string;
}): PullRequestSnapshot {
  const files = overrides?.files ?? [{ path: "CHANGELOG.md", changeType: "MODIFIED" }];
  return {
    pullRequest: {
      id: "PR_node_id",
      number: 9,
      state: overrides?.state ?? "open",
      authorLogin: overrides?.authorLogin ?? "app/changelog-bot",
      headSha: overrides?.headSha ?? "abc123",
      baseSha: overrides?.baseSha ?? "base123",
    },
    changedFiles: files.map((file) => file.path),
    files,
  };
}

function dependencies(overrides?: {
  snapshot?: PullRequestSnapshot;
  refs?: PullRequestRefs[];
  fetchPullRequestSnapshot?: ReturnType<typeof vi.fn<GitHubSealAdapter["fetchPullRequestSnapshot"]>>;
  fetchPullRequestRefs?: ReturnType<typeof vi.fn<GitHubSealAdapter["fetchPullRequestRefs"]>>;
  fetchFileModes?: ReturnType<typeof vi.fn<GitHubSealAdapter["fetchFileModes"]>>;
  approvePullRequest?: ReturnType<typeof vi.fn<GitHubSealAdapter["approvePullRequest"]>>;
  dismissPullRequestReview?: ReturnType<typeof vi.fn<GitHubSealAdapter["dismissPullRequestReview"]>>;
  dismissPreviousApprovals?: ReturnType<typeof vi.fn<GitHubSealAdapter["dismissPreviousApprovals"]>>;
  enableAutoMerge?: ReturnType<typeof vi.fn<GitHubSealAdapter["enableAutoMerge"]>>;
  mergePullRequest?: ReturnType<typeof vi.fn<GitHubSealAdapter["mergePullRequest"]>>;
}) {
  const refs = overrides?.refs ?? [pinnedRefs];
  let refIndex = 0;
  return {
    fetchPullRequestSnapshot:
      overrides?.fetchPullRequestSnapshot ??
      vi.fn<GitHubSealAdapter["fetchPullRequestSnapshot"]>(async () => overrides?.snapshot ?? snapshot()),
    fetchPullRequestRefs:
      overrides?.fetchPullRequestRefs ??
      vi.fn<GitHubSealAdapter["fetchPullRequestRefs"]>(async () => refs[Math.min(refIndex++, refs.length - 1)]!),
    fetchFileModes:
      overrides?.fetchFileModes ??
      vi.fn<GitHubSealAdapter["fetchFileModes"]>(async () => {
        throw new Error("file modes were not expected");
      }),
    approvePullRequest:
      overrides?.approvePullRequest ?? vi.fn<GitHubSealAdapter["approvePullRequest"]>(async () => "review_id"),
    dismissPullRequestReview:
      overrides?.dismissPullRequestReview ??
      vi.fn<GitHubSealAdapter["dismissPullRequestReview"]>(async () => undefined),
    dismissPreviousApprovals:
      overrides?.dismissPreviousApprovals ??
      vi.fn<GitHubSealAdapter["dismissPreviousApprovals"]>(async () => undefined),
    enableAutoMerge:
      overrides?.enableAutoMerge ?? vi.fn<GitHubSealAdapter["enableAutoMerge"]>(async () => undefined),
    mergePullRequest:
      overrides?.mergePullRequest ?? vi.fn<GitHubSealAdapter["mergePullRequest"]>(async () => undefined),
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
      eligible: true,
      reason: "",
    });

    expect(github.fetchPullRequestSnapshot).toHaveBeenCalledWith("octo-org", "demo-repo", 9);
    expect(github.fetchFileModes).not.toHaveBeenCalled();
    expect(github.approvePullRequest).toHaveBeenCalledWith("PR_node_id", "abc123", "Verified.");
    expect(github.enableAutoMerge).toHaveBeenCalledWith("PR_node_id", "abc123", "squash");
    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(github.dismissPullRequestReview).not.toHaveBeenCalled();
    expect(github.fetchPullRequestRefs).toHaveBeenCalledTimes(2);
    expect(github.approvePullRequest.mock.invocationCallOrder[0]).toBeLessThan(
      github.enableAutoMerge.mock.invocationCallOrder[0]!,
    );
    expect(github.fetchPullRequestRefs.mock.invocationCallOrder[0]).toBeLessThan(
      github.approvePullRequest.mock.invocationCallOrder[0]!,
    );
  });

  it("directly merges the verified head when GitHub reports the pull request is already clean", async () => {
    const enableAutoMerge = vi.fn<GitHubSealAdapter["enableAutoMerge"]>(async () => {
      throw new Error("Request failed due to following response errors:\n - Pull request Pull request is in clean status");
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
      eligible: true,
      reason: "",
    });

    expect(github.approvePullRequest).toHaveBeenCalledWith("PR_node_id", "abc123", "Verified.");
    expect(github.enableAutoMerge).toHaveBeenCalledWith("PR_node_id", "abc123", "squash");
    expect(github.mergePullRequest).toHaveBeenCalledWith("PR_node_id", "abc123", "squash");
    expect(github.enableAutoMerge.mock.invocationCallOrder[0]).toBeLessThan(
      github.mergePullRequest.mock.invocationCallOrder[0]!,
    );
  });

  it("approves the verified head and does not merge when auto-merge is disabled", async () => {
    const github = dependencies();

    await expect(sealPullRequest({ ...inputs, autoMerge: false }, github)).resolves.toMatchObject({
      approved: true,
      autoMergeEnabled: false,
      merged: false,
      eligible: true,
    });

    expect(github.approvePullRequest).toHaveBeenCalledOnce();
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
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
    const github = dependencies({ snapshot: snapshot({ authorLogin: "app/other-bot" }) });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow("PR author is app/other-bot");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(github.fetchFileModes).not.toHaveBeenCalled();
  });

  it("reports an out-of-scope pull request without failing when ineligible results are skipped", async () => {
    const github = dependencies({ snapshot: snapshot({ files: [{ path: "src/main.ts", changeType: "MODIFIED" }] }) });

    await expect(sealPullRequest({ ...inputs, onIneligible: "skip" }, github)).resolves.toEqual({
      pullRequestId: "PR_node_id",
      headSha: "abc123",
      changedFiles: ["src/main.ts"],
      approved: false,
      autoMergeEnabled: false,
      merged: false,
      eligible: false,
      reason:
        "Refusing to seal octo-org/demo-repo#9 because changed files include disallowed paths: src/main.ts. Allowed paths: CHANGELOG.md",
    });

    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
  });

  it("dismisses earlier automated approvals before reporting an ineligible path", async () => {
    const github = dependencies({ snapshot: snapshot({ files: [{ path: "src/main.ts", changeType: "MODIFIED" }] }) });

    await expect(sealPullRequest({ ...inputs, onIneligible: "skip" }, github)).resolves.toMatchObject({
      eligible: false,
    });
    expect(github.dismissPreviousApprovals).toHaveBeenCalledWith("PR_node_id");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("fails when an earlier automated approval cannot be dismissed", async () => {
    const github = dependencies({
      snapshot: snapshot({ files: [{ path: "src/main.ts", changeType: "MODIFIED" }] }),
      dismissPreviousApprovals: vi.fn<GitHubSealAdapter["dismissPreviousApprovals"]>(async () => {
        throw new Error("dismiss rejected");
      }),
    });

    await expect(sealPullRequest({ ...inputs, onIneligible: "skip" }, github)).rejects.toThrow("dismiss rejected");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("still fails closed on hard errors when ineligible results are skipped", async () => {
    const github = dependencies({
      fetchPullRequestSnapshot: failedSnapshot("GitHub did not return changed-file nodes for octo-org/demo-repo#9"),
    });

    await expect(sealPullRequest({ ...inputs, onIneligible: "skip" }, github)).rejects.toThrow(
      "GitHub did not return changed-file nodes",
    );
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("does not approve or enable auto-merge when changed files are unsafe", async () => {
    const github = dependencies({
      snapshot: snapshot({
        files: [
          { path: "CHANGELOG.md", changeType: "MODIFIED" },
          { path: "package.json", changeType: "MODIFIED" },
        ],
      }),
    });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow("disallowed paths: package.json");
    expect(github.dismissPreviousApprovals).toHaveBeenCalledWith("PR_node_id");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("approves a regular documentation file and does not merge in approve-only mode", async () => {
    const fetchFileModes = vi.fn<GitHubSealAdapter["fetchFileModes"]>(async () => [
      {
        path: "README.md",
        changeType: "MODIFIED",
        head: { mode: GIT_MODE_REGULAR, type: "blob" },
        base: { mode: GIT_MODE_REGULAR, type: "blob" },
      },
    ]);
    const github = dependencies({
      snapshot: snapshot({ files: [{ path: "README.md", changeType: "MODIFIED" }] }),
      fetchFileModes,
    });

    await expect(
      sealPullRequest(
        {
          ...inputs,
          expectedAuthors: [],
          allowedPaths: [],
          pathPreset: "docs-and-config",
          requireRegularFiles: true,
          autoMerge: false,
          onIneligible: "skip",
        },
        github,
      ),
    ).resolves.toMatchObject({
      approved: true,
      eligible: true,
      autoMergeEnabled: false,
      merged: false,
      changedFiles: ["README.md"],
    });

    expect(github.approvePullRequest).toHaveBeenCalledWith("PR_node_id", "abc123", "Verified.");
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("skips a symlink without approving when ineligible results are skipped", async () => {
    const github = dependencies({
      snapshot: snapshot({ files: [{ path: "README.md", changeType: "ADDED" }] }),
      fetchFileModes: vi.fn<GitHubSealAdapter["fetchFileModes"]>(async () => [
        {
          path: "README.md",
          changeType: "ADDED",
          head: { mode: GIT_MODE_SYMLINK, type: "blob" },
          base: null,
        },
      ]),
    });

    await expect(
      sealPullRequest(
        {
          ...inputs,
          expectedAuthors: [],
          allowedPaths: [],
          pathPreset: "docs-and-config",
          requireRegularFiles: true,
          autoMerge: false,
          onIneligible: "skip",
        },
        github,
      ),
    ).resolves.toMatchObject({
      eligible: false,
      approved: false,
      reason: expect.stringContaining("README.md is a symlink at head"),
    });
    expect(github.dismissPreviousApprovals).toHaveBeenCalledWith("PR_node_id");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("fails closed on an unrecognized git mode even when ineligible results are skipped", async () => {
    const github = dependencies({
      fetchFileModes: vi.fn<GitHubSealAdapter["fetchFileModes"]>(async () => [
        {
          path: "CHANGELOG.md",
          changeType: "MODIFIED",
          head: { mode: 1, type: "blob" },
          base: { mode: GIT_MODE_REGULAR, type: "blob" },
        },
      ]),
    });

    await expect(
      sealPullRequest({ ...inputs, requireRegularFiles: true, onIneligible: "skip" }, github),
    ).rejects.toThrow("unrecognized git mode");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("rejects executable files only after the path policy passes", async () => {
    const fetchFileModes = vi.fn<GitHubSealAdapter["fetchFileModes"]>(async () => [
      {
        path: "CHANGELOG.md",
        changeType: "MODIFIED",
        head: { mode: GIT_MODE_EXECUTABLE, type: "blob" },
        base: { mode: GIT_MODE_REGULAR, type: "blob" },
      },
    ]);
    const github = dependencies({ fetchFileModes });

    await expect(sealPullRequest({ ...inputs, requireRegularFiles: true }, github)).rejects.toThrow(
      "CHANGELOG.md is executable at head",
    );
    expect(github.fetchFileModes).toHaveBeenCalledWith(
      "octo-org",
      "demo-repo",
      "abc123",
      "base123",
      [{ path: "CHANGELOG.md", changeType: "MODIFIED" }],
    );
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("does not fetch file modes when the path policy already rejects the pull request", async () => {
    const github = dependencies({
      snapshot: snapshot({ files: [{ path: "src/main.ts", changeType: "ADDED" }] }),
    });

    await expect(
      sealPullRequest({ ...inputs, requireRegularFiles: true, pathPreset: "docs-and-config", onIneligible: "skip" }, github),
    ).resolves.toMatchObject({ eligible: false });
    expect(github.fetchFileModes).not.toHaveBeenCalled();
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it("does not approve when the head changes before approval", async () => {
    const github = dependencies({ refs: [{ state: "open", headSha: "def456", baseSha: "base123" }] });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow("head SHA changed from abc123 to def456");
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
  });

  it("dismisses the approval when the head changes after it is submitted", async () => {
    const github = dependencies({
      refs: [pinnedRefs, { state: "open", headSha: "def456", baseSha: "base123" }],
    });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow("head SHA changed from abc123 to def456");
    expect(github.approvePullRequest).toHaveBeenCalledOnce();
    expect(github.dismissPullRequestReview).toHaveBeenCalledWith(
      "review_id",
      "Dismissed because the pull request changed after the verified head was approved.",
    );
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
  });

  it("fails closed when a stale approval cannot be dismissed", async () => {
    const github = dependencies({
      refs: [pinnedRefs, { state: "open", headSha: "def456", baseSha: "base123" }],
      dismissPullRequestReview: vi.fn<GitHubSealAdapter["dismissPullRequestReview"]>(async () => {
        throw new Error("dismiss rejected");
      }),
    });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow(
      "head SHA changed from abc123 to def456 after verification. Also failed to dismiss the approval: dismiss rejected",
    );
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
  });

  it("does not enable auto-merge when approval fails", async () => {
    const approvePullRequest = vi.fn<GitHubSealAdapter["approvePullRequest"]>(async () => {
      throw new Error("approval rejected");
    });
    const github = dependencies({ approvePullRequest });

    await expect(sealPullRequest(inputs, github)).rejects.toThrow("approval rejected");
    expect(github.enableAutoMerge).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(github.dismissPullRequestReview).not.toHaveBeenCalled();
  });
});
