import { describe, expect, it } from "vitest";
import { evaluateDocsConfigPath } from "./docs-config-preset.js";

describe("evaluateDocsConfigPath", () => {
  it("allowlists documentation and non-executable configuration", () => {
    const paths = [
      "WEEKLY_MERGED_PULL_REQUESTS.md",
      "CHANGELOG.md",
      "docs/guide.markdown",
      "docs/guide.rst",
      "docs/guide.adoc",
      "docs/guide.asciidoc",
      "LICENSE",
      "LICENSE.txt",
      "NOTICE",
      ".github/pull_request_template.md",
      "docs/diagram.png",
      "docs/diagram.SVG",
      ".gitignore",
      ".editorconfig",
      "cliff.toml",
      "tombi.toml",
      ".pinact.yaml",
      ".prettierrc.json",
      "tsconfig.json",
      "tsconfig.app.json",
      "tsconfig.foo-bar.json",
      "biome.json",
      ".commitlintrc.yaml",
      ".github/pr-diff-groups.json",
      ".github/FUNDING.yml",
      ".github/ISSUE_TEMPLATE/config.yml",
      ".github/DISCUSSION_TEMPLATE/config.yml",
    ];

    for (const path of paths) {
      expect(evaluateDocsConfigPath(path), path).toEqual({ allowed: true, denied: false, reason: "" });
    }
  });

  it("denies workflows, scripts, lockfiles, CI config, and other unsafe paths", () => {
    const cases: Array<[string, string]> = [
      [".github/workflows/ci.yml", "is in a workflow or action directory"],
      [".github/workflows/README.md", "is in a workflow or action directory"],
      [".GitHub/Actions/guide.md", "is in a workflow or action directory"],
      ["nested/.github/workflows/ci.yml", "is in a workflow or action directory"],
      ["action.yml", "is a GitHub Action definition"],
      ["src/main.ts", "is executable source"],
      ["scripts/deploy.sh", "is executable source"],
      ["package.json", "is a build, lock, task, or CI file"],
      ["pnpm-lock.yaml", "is a build, lock, task, or CI file"],
      ["go.sum", "is a build, lock, task, or CI file"],
      ["flake.nix", "is a build, lock, task, or CI file"],
      ["Dockerfile", "is a build or CI file"],
      ["Dockerfile.ci", "is a build or CI file"],
      ["compose.yaml", "is a build, lock, task, or CI file"],
      ["lefthook.yaml", "is a build, lock, task, or CI file"],
      ["Makefile", "is a build, lock, task, or CI file"],
      ["requirements-dev.txt", "is a build or CI file"],
      ["CODEOWNERS", "is a build, lock, task, or CI file"],
      [".github/dependabot.yml", "is a build, lock, task, or CI file"],
      ["renovate.json", "is a build, lock, task, or CI file"],
      ["Cargo.lock", "is a build, lock, task, or CI file"],
      ["vendor/deps.lock", "is a build or lock file"],
    ];

    for (const [path, reason] of cases) {
      expect(evaluateDocsConfigPath(path), path).toMatchObject({ allowed: false, denied: true, reason });
    }
  });

  it("leaves unrecognized paths unallowlisted without a hard denial", () => {
    expect(evaluateDocsConfigPath(".mise/config.toml")).toEqual({
      allowed: false,
      denied: false,
      reason: "is not documentation or non-executable configuration",
    });
    expect(evaluateDocsConfigPath("notes.xyz").denied).toBe(false);
    expect(evaluateDocsConfigPath("tsconfig..json").allowed).toBe(false);
    expect(evaluateDocsConfigPath("not-tsconfig.json").allowed).toBe(false);
  });

  it("denies invalid paths", () => {
    expect(evaluateDocsConfigPath("../README.md").denied).toBe(true);
    expect(evaluateDocsConfigPath("docs/../../.github/workflows/ci.yml").reason).toBe("is an invalid path");
  });
});
