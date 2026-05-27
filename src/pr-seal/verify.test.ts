import { describe, expect, it } from "vitest";
import { verifyPullRequestSafety } from "./verify.js";

const basePullRequest = {
  id: "PR_node_id",
  number: 12,
  state: "open",
  authorLogin: "app/changelog-bot",
  headSha: "abc123",
};

const safetyInputs = {
  repository: "octo-org/demo-repo",
  pullRequestNumber: 12,
  expectedAuthor: "app/changelog-bot",
  allowedPaths: ["CHANGELOG.md"],
};

describe("verifyPullRequestSafety", () => {
  it("returns verified identity and changed files when the PR is safe", () => {
    const result = verifyPullRequestSafety(basePullRequest, ["CHANGELOG.md"], safetyInputs);

    expect(result).toEqual({
      pullRequestId: "PR_node_id",
      headSha: "abc123",
      changedFiles: ["CHANGELOG.md"],
    });
  });

  it("rejects pull requests that are not open", () => {
    expect(() =>
      verifyPullRequestSafety({ ...basePullRequest, state: "closed" }, ["CHANGELOG.md"], safetyInputs),
    ).toThrow("Refusing to seal octo-org/demo-repo#12 because the pull request is closed");
  });

  it("rejects fetched pull requests with a different number", () => {
    expect(() =>
      verifyPullRequestSafety({ ...basePullRequest, number: 13 }, ["CHANGELOG.md"], safetyInputs),
    ).toThrow("Fetched pull request number 13 does not match requested octo-org/demo-repo#12");
  });

  it("rejects author mismatches before path verification succeeds", () => {
    expect(() =>
      verifyPullRequestSafety(
        { ...basePullRequest, authorLogin: "app/other-bot" },
        ["CHANGELOG.md"],
        safetyInputs,
      ),
    ).toThrow(
      "Refusing to seal octo-org/demo-repo#12 because the PR author is app/other-bot, expected app/changelog-bot",
    );
  });

  it("rejects changed files outside the exact allowed path list", () => {
    expect(() =>
      verifyPullRequestSafety(basePullRequest, ["CHANGELOG.md", "package.json"], safetyInputs),
    ).toThrow(
      "Refusing to seal octo-org/demo-repo#12 because changed files include disallowed paths: package.json. Allowed paths: CHANGELOG.md",
    );
  });

  it("rejects missing pull request node IDs", () => {
    expect(() =>
      verifyPullRequestSafety({ ...basePullRequest, id: "" }, ["CHANGELOG.md"], safetyInputs),
    ).toThrow("Failed to resolve pull request node ID for octo-org/demo-repo#12");
  });

  it("rejects missing head SHAs", () => {
    expect(() =>
      verifyPullRequestSafety({ ...basePullRequest, headSha: "" }, ["CHANGELOG.md"], safetyInputs),
    ).toThrow("Failed to resolve pull request head SHA for octo-org/demo-repo#12");
  });
});
