import * as core from "@actions/core";
import { context as githubContext } from "@actions/github";
import {
  createGitHubSealAdapter,
  type GitHubSealAdapter,
} from "../github/seal-adapter.js";
import { sealPullRequest, type SealResult } from "../pr-seal/seal.js";
import {
  parseInputs,
  type GitHubContextLike,
  type InputReader,
} from "./inputs.js";

interface ActionsCore extends InputReader {
  setSecret(secret: string): void;
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
}

interface RunDependencies {
  core: ActionsCore;
  context: GitHubContextLike;
  createGitHubSealAdapter(tokens: {
    approveToken: string;
    mergeToken: string;
  }): GitHubSealAdapter;
  sealPullRequest(
    inputs: ReturnType<typeof parseInputs>,
    github: GitHubSealAdapter,
  ): Promise<SealResult>;
}

export async function run(dependencies: RunDependencies): Promise<void> {
  try {
    const inputs = parseInputs(
      dependencies.core,
      dependencies.context,
    );
    dependencies.core.setSecret(inputs.approveToken);
    dependencies.core.setSecret(inputs.mergeToken);

    const github = dependencies.createGitHubSealAdapter({
      approveToken: inputs.approveToken,
      mergeToken: inputs.mergeToken,
    });
    const result = await dependencies.sealPullRequest(inputs, github);

    dependencies.core.setOutput(
      "pull-request-id",
      result.pullRequestId,
    );
    dependencies.core.setOutput("head-sha", result.headSha);
    dependencies.core.setOutput(
      "changed-files",
      JSON.stringify(result.changedFiles),
    );
    dependencies.core.setOutput("approved", String(result.approved));
    dependencies.core.setOutput(
      "auto-merge-enabled",
      String(result.autoMergeEnabled),
    );
  } catch (error) {
    dependencies.core.setFailed(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runAction(): Promise<void> {
  await run(createDefaultDependencies());
}

function createDefaultDependencies(): RunDependencies {
  return {
    core,
    context: githubContext,
    createGitHubSealAdapter,
    sealPullRequest,
  };
}
