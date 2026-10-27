import { describe, expect, it } from "vitest";
import { IneligiblePullRequestError, verifyPullRequestSafety, type PullRequestFile, type SafetyInputs } from "./verify.js";

const basePullRequest = {
  id: "PR_node_id",
  number: 12,
  state: "open",
  authorLogin: "app/changelog-bot",
  headSha: "abc123",
  baseSha: "base123",
};

const safetyInputs: SafetyInputs = {
  repository: "octo-org/demo-repo",
  pullRequestNumber: 12,
  expectedAuthors: ["app/changelog-bot"],
  allowedPaths: ["CHANGELOG.md"],
  allowedPatterns: [],
  deniedPatterns: [],
  pathPreset: "none",
};

function files(...paths: string[]): PullRequestFile[] {
  return paths.map((path) => ({ path, changeType: "MODIFIED" }));
}

describe("verifyPullRequestSafety", () => {
  it("returns verified identity and changed files when the PR is safe", () => {
    const result = verifyPullRequestSafety(basePullRequest, files("CHANGELOG.md"), safetyInputs);

    expect(result).toEqual({
      pullRequestId: "PR_node_id",
      headSha: "abc123",
      baseSha: "base123",
      changedFiles: ["CHANGELOG.md"],
    });
  });

  it("allows a pull request with no changed files when only exact paths are configured", () => {
    expect(verifyPullRequestSafety(basePullRequest, [], safetyInputs).changedFiles).toEqual([]);
  });

  it("rejects pull requests that are not open", () => {
    expect(() => verifyPullRequestSafety({ ...basePullRequest, state: "closed" }, files("CHANGELOG.md"), safetyInputs)).toThrow(
      "Refusing to seal octo-org/demo-repo#12 because the pull request is closed",
    );
  });

  it("rejects fetched pull requests with a different number", () => {
    expect(() => verifyPullRequestSafety({ ...basePullRequest, number: 13 }, files("CHANGELOG.md"), safetyInputs)).toThrow(
      "Fetched pull request number 13 does not match requested octo-org/demo-repo#12",
    );
  });

  it("rejects author mismatches before path verification succeeds", () => {
    expect(() =>
      verifyPullRequestSafety({ ...basePullRequest, authorLogin: "app/other-bot" }, files("CHANGELOG.md"), safetyInputs),
    ).toThrow(
      "Refusing to seal octo-org/demo-repo#12 because the PR author is app/other-bot, expected app/changelog-bot",
    );
  });

  it("accepts any listed author and can skip the author check", () => {
    expect(
      verifyPullRequestSafety({ ...basePullRequest, authorLogin: "octocat" }, files("CHANGELOG.md"), {
        ...safetyInputs,
        expectedAuthors: ["app/changelog-bot", "octocat"],
      }).pullRequestId,
    ).toBe("PR_node_id");

    expect(
      verifyPullRequestSafety({ ...basePullRequest, authorLogin: "someone-else" }, files("CHANGELOG.md"), {
        ...safetyInputs,
        expectedAuthors: [],
      }).changedFiles,
    ).toEqual(["CHANGELOG.md"]);
  });

  it("rejects several author mismatches with every accepted login", () => {
    expect(() =>
      verifyPullRequestSafety({ ...basePullRequest, authorLogin: "intruder" }, files("CHANGELOG.md"), {
        ...safetyInputs,
        expectedAuthors: ["app/changelog-bot", "octocat"],
      }),
    ).toThrow("expected one of: app/changelog-bot, octocat");
  });

  it("rejects changed files outside the exact allowed path list", () => {
    expect(() => verifyPullRequestSafety(basePullRequest, files("CHANGELOG.md", "package.json"), safetyInputs)).toThrow(
      "Refusing to seal octo-org/demo-repo#12 because changed files include disallowed paths: package.json. Allowed paths: CHANGELOG.md",
    );
  });

  it("matches glob patterns and lets denied patterns win", () => {
    const policy: SafetyInputs = {
      ...safetyInputs,
      allowedPaths: ["KEEP.md"],
      allowedPatterns: ["**/*.md"],
      deniedPatterns: ["docs/private/**"],
    };

    expect(verifyPullRequestSafety(basePullRequest, files("docs/guide.md", "KEEP.md"), policy).changedFiles).toEqual([
      "docs/guide.md",
      "KEEP.md",
    ]);

    expect(() => verifyPullRequestSafety(basePullRequest, files("docs/private/secret.md"), policy)).toThrow(
      "docs/private/secret.md (matches a denied pattern)",
    );
    expect(() => verifyPullRequestSafety(basePullRequest, files("src/main.ts"), policy)).toThrow(
      "src/main.ts (is not an allowed path)",
    );
  });

  it("uses the docs-and-config preset and does not let an allowlist override a denial", () => {
    const policy: SafetyInputs = {
      ...safetyInputs,
      expectedAuthors: [],
      allowedPaths: ["src/main.ts", "notes.xyz"],
      pathPreset: "docs-and-config",
    };

    expect(
      verifyPullRequestSafety(basePullRequest, files("README.md", "notes.xyz"), policy).changedFiles,
    ).toEqual(["README.md", "notes.xyz"]);

    expect(() => verifyPullRequestSafety(basePullRequest, files("README.md", "src/main.ts"), policy)).toThrow(
      "src/main.ts (is executable source)",
    );
    expect(() =>
      verifyPullRequestSafety(basePullRequest, [{ path: ".github/workflows/README.md", changeType: "ADDED" }], policy),
    ).toThrow("is in a workflow or action directory");
    expect(() => verifyPullRequestSafety(basePullRequest, [], policy)).toThrow("does not change any file");
    expect(() => verifyPullRequestSafety(basePullRequest, [{ path: "../README.md", changeType: "ADDED" }], policy)).toThrow(
      "a changed path is invalid",
    );
  });

  it("rejects renamed files because the previous path cannot be safely verified", () => {
    expect(() =>
      verifyPullRequestSafety(
        basePullRequest,
        [{ path: "CHANGELOG.md", changeType: "RENAMED" }],
        safetyInputs,
      ),
    ).toThrow(IneligiblePullRequestError);
    expect(() =>
      verifyPullRequestSafety(basePullRequest, [{ path: "CHANGELOG.md", changeType: "RENAMED" }], safetyInputs),
    ).toThrow("Refusing to seal octo-org/demo-repo#12 because renamed files cannot be safely verified: CHANGELOG.md");
  });

  it("rejects missing pull request node IDs", () => {
    expect(() => verifyPullRequestSafety({ ...basePullRequest, id: "" }, files("CHANGELOG.md"), safetyInputs)).toThrow(
      "Failed to resolve pull request node ID for octo-org/demo-repo#12",
    );
  });

  it("rejects missing head SHAs", () => {
    expect(() => verifyPullRequestSafety({ ...basePullRequest, headSha: "" }, files("CHANGELOG.md"), safetyInputs)).toThrow(
      "Failed to resolve pull request head SHA for octo-org/demo-repo#12",
    );
  });

  it("rejects missing base SHAs", () => {
    expect(() => verifyPullRequestSafety({ ...basePullRequest, baseSha: "" }, files("CHANGELOG.md"), safetyInputs)).toThrow(
      "Failed to resolve pull request base SHA for octo-org/demo-repo#12",
    );
  });
});
