# Release Please Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Release Please automation while keeping weekly merged PR changelog automation on a separate CalVer tag namespace.

**Architecture:** Add source-controlled Release Please manifest config and a dedicated Release Please workflow that uses the existing `PULL_REQUEST_CREATOR` GitHub App token. Update the weekly workflow to create `weekly-YYYY.MM.DD` tags through the new `calver-beacon-action` `tag_prefix` input. Add focused Vitest tests that inspect workflow/config text for the agreed safety properties.

**Tech Stack:** GitHub Actions, `googleapis/release-please-action` v4.4.1, `actions/create-github-app-token`, `actions/checkout`, Release Please manifest config, TypeScript/Vitest workflow tests, pnpm.

---

### Task 1: Add Release Please Manifest Configuration

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Test: `src/release-please-config.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `src/release-please-config.test.ts` with this content:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const releasePleaseConfig = JSON.parse(readFileSync("release-please-config.json", "utf8"));
const releasePleaseManifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"));

describe("release-please config", () => {
  it("uses node releases for the root package", () => {
    expect(releasePleaseConfig["release-type"]).toBe("node");
    expect(releasePleaseConfig.packages["."]["release-type"]).toBe("node");
  });

  it("keeps release tags in the vX.Y.Z namespace", () => {
    expect(releasePleaseConfig["include-component-in-tag"]).toBe(false);
    expect(releasePleaseConfig.packages["."]["include-component-in-tag"]).toBe(false);
  });

  it("does not require issue write permissions for labeling", () => {
    expect(releasePleaseConfig["skip-labeling"]).toBe(true);
  });

  it("bootstraps the root package so the first feat release stays in the 0.1.x series", () => {
    expect(releasePleaseManifest["."]).toBe("0.0.1");
  });
});
```

- [ ] **Step 2: Run the failing config tests**

Run: `pnpm vitest run src/release-please-config.test.ts`

Expected: FAIL because `release-please-config.json` and `.release-please-manifest.json` do not exist yet.

- [ ] **Step 3: Add Release Please config files**

Create `release-please-config.json`:

```json
{
  "release-type": "node",
  "include-component-in-tag": false,
  "skip-labeling": true,
  "packages": {
    ".": {
      "release-type": "node",
      "include-component-in-tag": false
    }
  }
}
```

Create `.release-please-manifest.json`:

```json
{
  ".": "0.0.1"
}
```

- [ ] **Step 4: Run the config tests again**

Run: `pnpm vitest run src/release-please-config.test.ts`

Expected: PASS.

### Task 2: Add Release Please Workflow

**Files:**
- Create: `.github/workflows/release-please.yml`
- Test: `src/release-please-workflow.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Create `src/release-please-workflow.test.ts` with this content:

```ts
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
```

- [ ] **Step 2: Run the failing workflow tests**

Run: `pnpm vitest run src/release-please-workflow.test.ts`

Expected: FAIL because `.github/workflows/release-please.yml` does not exist yet.

- [ ] **Step 3: Add the Release Please workflow**

Create `.github/workflows/release-please.yml`:

```yaml
name: release-please

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: release-please-main
  cancel-in-progress: false

jobs:
  release-please:
    name: Run Release Please
    runs-on: ubuntu-latest
    steps:
      - name: Create pull request creator GitHub App token
        id: pr-creator-token
        uses: actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349 # v2
        with:
          app-id: ${{ vars.PULL_REQUEST_CREATOR_APP_ID }}
          private-key: ${{ secrets.PULL_REQUEST_CREATOR_APP_PRIVATE_KEY }}

      - name: Run Release Please
        id: release
        uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071 # v4.4.1
        with:
          token: ${{ steps.pr-creator-token.outputs.token }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

      - name: Check out released commit
        if: ${{ steps.release.outputs.release_created == 'true' }}
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ steps.release.outputs.sha }}
          fetch-depth: 0
          token: ${{ steps.pr-creator-token.outputs.token }}

      - name: Update moving major tag
        if: ${{ steps.release.outputs.release_created == 'true' }}
        env:
          MAJOR_TAG: v${{ steps.release.outputs.major }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git tag -d "${MAJOR_TAG}" || true
          git push origin ":refs/tags/${MAJOR_TAG}" || true
          git tag -a "${MAJOR_TAG}" -m "Release ${MAJOR_TAG}"
          git push origin "refs/tags/${MAJOR_TAG}"
```

- [ ] **Step 4: Run the workflow tests again**

Run: `pnpm vitest run src/release-please-workflow.test.ts`

Expected: PASS.

### Task 3: Move Weekly CalVer Tags To weekly- Prefix

**Files:**
- Modify: `.github/workflows/weekly-changelog-update.yml`
- Modify: `src/weekly-changelog-workflow.test.ts`

- [ ] **Step 1: Add failing weekly workflow assertions**

Update `src/weekly-changelog-workflow.test.ts` so it contains these tests:

```ts
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

  it("uses the tag-prefix capable calver-beacon-action commit", () => {
    expect(workflow).toContain("y-writings/calver-beacon-action@0ba68eee60be71b3549212bf896fac07df928d4d");
    expect(workflow).not.toContain("y-writings/calver-beacon-action@87fc751559901b887938bc3dfcd8ca7126d72421");
  });

  it("creates weekly CalVer tags in a separate namespace", () => {
    expect(workflow).toContain("tag_prefix: weekly-");
  });
});
```

- [ ] **Step 2: Run the failing weekly workflow test**

Run: `pnpm vitest run src/weekly-changelog-workflow.test.ts`

Expected: FAIL because the workflow still uses the old `calver-beacon-action` SHA and does not pass `tag_prefix: weekly-`.

- [ ] **Step 3: Update the weekly workflow action reference and input**

In `.github/workflows/weekly-changelog-update.yml`, change the CalVer step to:

```yaml
      - name: Create weekly CalVer tag through GitHub API
        id: calver-tag
        uses: y-writings/calver-beacon-action@0ba68eee60be71b3549212bf896fac07df928d4d
        with:
          calver_date: ${{ inputs.calver_date }}
          tag_prefix: weekly-
          target_ref: main
          github_token: ${{ steps.pr-creator-token.outputs.token }}
```

- [ ] **Step 4: Run the weekly workflow test again**

Run: `pnpm vitest run src/weekly-changelog-workflow.test.ts`

Expected: PASS.

### Task 4: Run Full Verification

**Files:**
- Verify all implementation files and tests.

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: PASS with all Vitest test files passing.

- [ ] **Step 2: Run TypeScript build**

Run: `pnpm build`

Expected: PASS with `tsc --noEmit` exiting 0.

- [ ] **Step 3: Inspect final diff**

Run: `git diff -- .github/workflows/release-please.yml .github/workflows/weekly-changelog-update.yml release-please-config.json .release-please-manifest.json src/release-please-config.test.ts src/release-please-workflow.test.ts src/weekly-changelog-workflow.test.ts docs/superpowers/plans/2026-05-24-release-please-action.md docs/superpowers/specs/2026-05-24-release-please-action-design.md`

Expected: diff only includes Release Please config/workflow, weekly CalVer prefix update, tests, and the implementation plan. `session-ses_1a6a.md` remains unrelated and untracked.

## Self-Review

- Spec coverage: The plan covers the Release Please workflow, existing `PULL_REQUEST_CREATOR` token source, manifest bootstrap from `0.0.1`, manual Release PR merge behavior, GitHub Release creation, moving `v0` tag update, weekly `weekly-` CalVer tags, separated changelog files, minimal permissions, and workflow/config tests.
- Placeholder scan: No placeholders remain. Every code/config step includes exact file contents or exact replacement snippets.
- Type consistency: Test file names, workflow IDs, action SHAs, config keys, and output names are consistent across tasks.
