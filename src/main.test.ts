import { describe, expect, it, vi } from "vitest";
import { run } from "./main";

function inputReader(values: Record<string, string | undefined>) {
  return vi.fn((name: string, options?: { required?: boolean }) => {
    const value = values[name] ?? "";
    if (options?.required === true && value.length === 0) {
      throw new Error(`Input required and not supplied: ${name}`);
    }
    return value;
  });
}

describe("run", () => {
  it("masks tokens, seals the PR, and sets outputs", async () => {
    const getInput = inputReader({
      "pull-request-number": "9",
      "expected-author": "app/changelog-bot",
      "allowed-paths": "CHANGELOG.md",
      "approve-token": "approve-token-value",
      "merge-token": "merge-token-value",
      "merge-method": "squash",
    });
    const core = {
      getInput,
      setSecret: vi.fn(),
      setOutput: vi.fn(),
      setFailed: vi.fn(),
    };
    const clients = {
      readClient: { rest: { pulls: { get: vi.fn(), listFiles: vi.fn() } }, paginate: vi.fn() },
      approveGraphql: vi.fn(),
      mergeGraphql: vi.fn(),
    };
    const createGitHubClients = vi.fn(async () => clients);
    const sealPullRequest = vi.fn(async () => ({
      pullRequestId: "PR_node_id",
      headSha: "abc123",
      changedFiles: ["CHANGELOG.md"],
      approved: true,
      autoMergeEnabled: true,
    }));

    await run({
      core,
      context: { repo: { owner: "octo-org", repo: "demo-repo" } },
      createGitHubClients,
      sealPullRequest,
    });

    expect(core.setSecret).toHaveBeenCalledWith("approve-token-value");
    expect(core.setSecret).toHaveBeenCalledWith("merge-token-value");
    expect(createGitHubClients).toHaveBeenCalledWith({
      approveToken: "approve-token-value",
      mergeToken: "merge-token-value",
    });
    expect(sealPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestNumber: 9, expectedAuthor: "app/changelog-bot" }),
      clients,
    );
    expect(core.setOutput).toHaveBeenCalledWith("pull-request-id", "PR_node_id");
    expect(core.setOutput).toHaveBeenCalledWith("head-sha", "abc123");
    expect(core.setOutput).toHaveBeenCalledWith("changed-files", "[\"CHANGELOG.md\"]");
    expect(core.setOutput).toHaveBeenCalledWith("approved", "true");
    expect(core.setOutput).toHaveBeenCalledWith("auto-merge-enabled", "true");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("marks the action failed when parsing or sealing throws", async () => {
    const core = {
      getInput: inputReader({}),
      setSecret: vi.fn(),
      setOutput: vi.fn(),
      setFailed: vi.fn(),
    };

    await run({
      core,
      context: { repo: { owner: "octo-org", repo: "demo-repo" } },
      createGitHubClients: vi.fn(),
      sealPullRequest: vi.fn(),
    });

    expect(core.setFailed).toHaveBeenCalledWith("Input required and not supplied: pull-request-number");
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it("marks the action failed when sealing throws", async () => {
    const core = {
      getInput: inputReader({
        "pull-request-number": "9",
        "expected-author": "app/changelog-bot",
        "allowed-paths": "CHANGELOG.md",
        "approve-token": "approve-token-value",
        "merge-token": "merge-token-value",
      }),
      setSecret: vi.fn(),
      setOutput: vi.fn(),
      setFailed: vi.fn(),
    };
    const clients = {
      readClient: { rest: { pulls: { get: vi.fn(), listFiles: vi.fn() } }, paginate: vi.fn() },
      approveGraphql: vi.fn(),
      mergeGraphql: vi.fn(),
    };

    await run({
      core,
      context: { repo: { owner: "octo-org", repo: "demo-repo" } },
      createGitHubClients: vi.fn(async () => clients),
      sealPullRequest: vi.fn(async () => {
        throw new Error("sealing failed");
      }),
    });

    expect(core.setFailed).toHaveBeenCalledWith("sealing failed");
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
