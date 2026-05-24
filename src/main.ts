import { createGitHubClients, type GitHubClients } from "./github";
import { parseInputs, type GitHubContextLike, type InputReader } from "./inputs";
import { sealPullRequest, type SealResult } from "./seal";

interface CoreLike extends InputReader {
  setSecret(secret: string): void;
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
}

interface RunDependencies {
  core: CoreLike;
  context: GitHubContextLike;
  createGitHubClients(tokens: { approveToken: string; mergeToken: string }): Promise<GitHubClients>;
  sealPullRequest(inputs: ReturnType<typeof parseInputs>, clients: GitHubClients): Promise<SealResult>;
}

export async function run(dependencies?: RunDependencies): Promise<void> {
  const resolvedDependencies = dependencies ?? (await createDefaultDependencies());

  try {
    const inputs = parseInputs(resolvedDependencies.core, resolvedDependencies.context);
    resolvedDependencies.core.setSecret(inputs.approveToken);
    resolvedDependencies.core.setSecret(inputs.mergeToken);

    const clients = await resolvedDependencies.createGitHubClients({
      approveToken: inputs.approveToken,
      mergeToken: inputs.mergeToken,
    });
    const result = await resolvedDependencies.sealPullRequest(inputs, clients);

    resolvedDependencies.core.setOutput("pull-request-id", result.pullRequestId);
    resolvedDependencies.core.setOutput("head-sha", result.headSha);
    resolvedDependencies.core.setOutput("changed-files", JSON.stringify(result.changedFiles));
    resolvedDependencies.core.setOutput("approved", String(result.approved));
    resolvedDependencies.core.setOutput("auto-merge-enabled", String(result.autoMergeEnabled));
  } catch (error) {
    resolvedDependencies.core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

async function createDefaultDependencies(): Promise<RunDependencies> {
  const core = await import("@actions/core");
  const github = await import("@actions/github");

  return {
    core,
    context: github.context,
    createGitHubClients,
    sealPullRequest,
  };
}

if (require.main === module) {
  void run();
}
