import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/weekly-changelog-update.yml", "utf8");

describe("weekly changelog workflow", () => {
  it("does not pass a single tag as the initial git-cliff range", () => {
    expect(workflow).not.toContain('echo "range=${TAG}"');
    expect(workflow).toContain('echo "range="');
  });

  it("expects the GitHub App pull request author login returned by GitHub", () => {
    expect(workflow).toContain("expected-author: y-writings-pr-creator-bot");
    expect(workflow).not.toContain("expected-author: app/y-writings-pr-creator-bot");
  });

  it("writes weekly merged pull requests outside CHANGELOG.md", () => {
    expect(workflow).toContain("--output WEEKLY_MERGED_PULL_REQUESTS.md");
    expect(workflow).toContain("WEEKLY_MERGED_PULL_REQUESTS.md");
    expect(workflow).not.toContain("CHANGELOG.md");
  });
});
