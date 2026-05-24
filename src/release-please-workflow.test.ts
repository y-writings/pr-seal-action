import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/release-please.yml", "utf8");

describe("release-please workflow", () => {
  it("runs on main pushes and manual dispatch", () => {
    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("uses minimal write permissions without issue writes", () => {
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).not.toContain("issues: write");
  });

  it("creates the pull request creator GitHub App token", () => {
    expect(workflow).toContain("id: pr-creator-token");
    expect(workflow).toContain("actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349 # v2");
    expect(workflow).toContain("app-id: ${{ vars.PULL_REQUEST_CREATOR_APP_ID }}");
    expect(workflow).toContain("private-key: ${{ secrets.PULL_REQUEST_CREATOR_APP_PRIVATE_KEY }}");
  });

  it("runs the pinned release-please action with manifest config", () => {
    expect(workflow).toContain("id: release");
    expect(workflow).toContain("googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071 # v4.4.1");
    expect(workflow).toContain("token: ${{ steps.pr-creator-token.outputs.token }}");
    expect(workflow).toContain("config-file: release-please-config.json");
    expect(workflow).toContain("manifest-file: .release-please-manifest.json");
  });

  it("checks out the released commit with the pull request creator token before moving tags", () => {
    expect(workflow).toContain("- name: Check out released commit");
    expect(workflow).toContain("ref: ${{ steps.release.outputs.sha }}");
    expect(workflow).toContain("token: ${{ steps.pr-creator-token.outputs.token }}");
  });

  it("updates only the moving major tag after a release is created", () => {
    expect(workflow).toContain("if: ${{ steps.release.outputs.release_created == 'true' }}");
    expect(workflow).toContain("MAJOR_TAG: v${{ steps.release.outputs.major }}");
    expect(workflow).toContain("git push origin \":refs/tags/${MAJOR_TAG}\" || true");
    expect(workflow).toContain("git tag -a \"${MAJOR_TAG}\" -m \"Release ${MAJOR_TAG}\"");
    expect(workflow).not.toContain("steps.release.outputs.minor");
  });
});
