import { describe, expect, it } from "vitest";
import { DEFAULT_APPROVE_BODY, parseInputs } from "./inputs.js";

type InputValues = Record<string, string | undefined>;

function inputReader(values: InputValues) {
  return {
    getInput(name: string, options?: { required?: boolean }): string {
      const value = values[name] ?? "";
      if (options?.required === true && value.length === 0) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    },
  };
}

const context = { repo: { owner: "octo-org", repo: "demo-repo" } };

describe("parseInputs", () => {
  it("parses required inputs and defaults repository, merge method, and approval body", () => {
    const inputs = parseInputs(
      inputReader({
        "pull-request-number": "42",
        "expected-author": "app/changelog-bot",
        "allowed-paths": "CHANGELOG.md\n",
        "approve-token": "approve-token-value",
        "merge-token": "merge-token-value",
      }),
      context,
    );

    expect(inputs).toEqual({
      repository: { owner: "octo-org", repo: "demo-repo", value: "octo-org/demo-repo" },
      pullRequestNumber: 42,
      expectedAuthors: ["app/changelog-bot"],
      allowedPaths: ["CHANGELOG.md"],
      allowedPatterns: [],
      deniedPatterns: [],
      pathPreset: "none",
      requireRegularFiles: false,
      approveToken: "approve-token-value",
      mergeToken: "merge-token-value",
      mergeMethod: "squash",
      approveBody: DEFAULT_APPROVE_BODY,
      autoMerge: true,
      onIneligible: "fail",
    });
  });

  it("parses explicit repository, multiple allowed paths, merge method, and approval body", () => {
    const inputs = parseInputs(
      inputReader({
        repository: "y-writings/pr-seal-action",
        "pull-request-number": "7",
        "expected-author": "app/pr-creator",
        "allowed-paths": "CHANGELOG.md\ndocs/releases.md\n",
        "approve-token": "approve-token-value",
        "merge-token": "merge-token-value",
        "merge-method": "rebase",
        "approve-body": "Verified automated release PR.",
      }),
      context,
    );

    expect(inputs.repository).toEqual({
      owner: "y-writings",
      repo: "pr-seal-action",
      value: "y-writings/pr-seal-action",
    });
    expect(inputs.allowedPaths).toEqual(["CHANGELOG.md", "docs/releases.md"]);
    expect(inputs.mergeMethod).toBe("rebase");
    expect(inputs.approveBody).toBe("Verified automated release PR.");
    expect(inputs.autoMerge).toBe(true);
    expect(inputs.onIneligible).toBe("fail");
  });

  it("rejects repository values that are not owner/name", () => {
    expect(() =>
      parseInputs(
        inputReader({
          repository: "missing-repo-name",
          "pull-request-number": "1",
          "expected-author": "app/changelog-bot",
          "allowed-paths": "CHANGELOG.md",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
        }),
        context,
      ),
    ).toThrow("repository must be in owner/name format");
  });

  it("rejects non-positive pull request numbers", () => {
    expect(() =>
      parseInputs(
        inputReader({
          "pull-request-number": "0",
          "expected-author": "app/changelog-bot",
          "allowed-paths": "CHANGELOG.md",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
        }),
        context,
      ),
    ).toThrow("pull-request-number must be a positive integer");
  });

  it("rejects unsafe integer pull request numbers", () => {
    expect(() =>
      parseInputs(
        inputReader({
          "pull-request-number": "9007199254740992",
          "expected-author": "app/changelog-bot",
          "allowed-paths": "CHANGELOG.md",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
        }),
        context,
      ),
    ).toThrow("pull-request-number must be a positive safe integer");
  });

  it("rejects empty allowed paths", () => {
    expect(() =>
      parseInputs(
        inputReader({
          "pull-request-number": "1",
          "expected-author": "app/changelog-bot",
          "allowed-paths": "\n\n",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
        }),
        context,
      ),
    ).toThrow("allowed-paths must include at least one path");
  });

  it("parses docs and config approval without an author or auto-merge", () => {
    const inputs = parseInputs(
      inputReader({
        "pull-request-number": "9",
        "require-expected-author": "false",
        "allowed-patterns": "**/*.md\n",
        "denied-patterns": "docs/private/**",
        "path-preset": "docs-and-config",
        "require-regular-files": "false",
        "auto-merge": "false",
        "on-ineligible": "skip",
        "approve-token": "approve-token-value",
        "merge-token": "merge-token-value",
      }),
      context,
    );

    expect(inputs.expectedAuthors).toEqual([]);
    expect(inputs.allowedPaths).toEqual([]);
    expect(inputs.allowedPatterns).toEqual(["**/*.md"]);
    expect(inputs.deniedPatterns).toEqual(["docs/private/**"]);
    expect(inputs.pathPreset).toBe("docs-and-config");
    expect(inputs.requireRegularFiles).toBe(true);
    expect(inputs.autoMerge).toBe(false);
    expect(inputs.onIneligible).toBe("skip");
  });

  it("accepts several authors and still enforces an author that was provided", () => {
    const inputs = parseInputs(
      inputReader({
        "pull-request-number": "9",
        "require-expected-author": "false",
        "expected-author": "octocat",
        "expected-authors": "app/changelog-bot\n\noctocat\n",
        "allowed-paths": "CHANGELOG.md",
        "approve-token": "approve-token-value",
        "merge-token": "merge-token-value",
      }),
      context,
    );

    expect(inputs.expectedAuthors).toEqual(["octocat", "app/changelog-bot"]);
  });

  it("keeps expected-author required for the existing caller shape", () => {
    expect(() =>
      parseInputs(
        inputReader({
          "pull-request-number": "1",
          "allowed-paths": "CHANGELOG.md",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
        }),
        context,
      ),
    ).toThrow("Input required and not supplied: expected-author");
  });

  it("rejects invalid patterns, presets, and mode switches", () => {
    expect(() =>
      parseInputs(
        inputReader({
          "pull-request-number": "1",
          "expected-author": "app/changelog-bot",
          "allowed-patterns": "../secret.md",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
        }),
        context,
      ),
    ).toThrow("allowed-patterns contains an invalid pattern");

    expect(() =>
      parseInputs(
        inputReader({
          "pull-request-number": "1",
          "expected-author": "app/changelog-bot",
          "allowed-paths": "CHANGELOG.md",
          "path-preset": "everything",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
        }),
        context,
      ),
    ).toThrow("path-preset must be docs-and-config or none");

    expect(() =>
      parseInputs(
        inputReader({
          "pull-request-number": "1",
          "expected-author": "app/changelog-bot",
          "allowed-paths": "CHANGELOG.md",
          "on-ineligible": "warn",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
        }),
        context,
      ),
    ).toThrow("on-ineligible must be fail or skip");
  });

  it("rejects unsupported merge methods", () => {
    expect(() =>
      parseInputs(
        inputReader({
          "pull-request-number": "1",
          "expected-author": "app/changelog-bot",
          "allowed-paths": "CHANGELOG.md",
          "approve-token": "approve-token-value",
          "merge-token": "merge-token-value",
          "merge-method": "octopus",
        }),
        context,
      ),
    ).toThrow("merge-method must be one of squash, merge, or rebase");
  });
});
