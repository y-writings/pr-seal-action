# CodeQL Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-appropriate CodeQL workflow for the TypeScript GitHub Action.

**Architecture:** Add one focused workflow under `.github/workflows/codeql.yaml`. It runs CodeQL's JavaScript/TypeScript analysis on PRs, pushes to `main`, and a weekly schedule with minimal permissions and no dependency install step. Actions are pinned by SHA to match existing workflows.

**Tech Stack:** GitHub Actions, CodeQL Action, TypeScript/JavaScript analysis.

---

### Task 1: Add CodeQL Workflow

**Files:**
- Create: `.github/workflows/codeql.yaml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: codeql

on:
  push:
    branches:
      - main
  pull_request:
  schedule:
    - cron: '34 1 * * 2'

permissions:
  contents: read
  security-events: write

jobs:
  analyze:
    name: Analyze javascript-typescript
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Initialize CodeQL
        uses: github/codeql-action/init@dc73d59c2d7bd4f8194098a91219eeee6d8a1719 # v4
        with:
          languages: javascript-typescript
          build-mode: none

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@dc73d59c2d7bd4f8194098a91219eeee6d8a1719 # v4
```

- [ ] **Step 2: Verify YAML syntax**

Run: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/codeql.yaml")'`

Expected: command exits with status 0.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- .github/workflows/codeql.yaml docs/superpowers/specs/2026-05-24-codeql-workflow-design.md docs/superpowers/plans/2026-05-24-codeql-workflow.md`

Expected: diff shows the CodeQL workflow and supporting design/plan docs only.

## Self-Review

- Spec coverage: The workflow covers TypeScript/JavaScript CodeQL analysis, PRs, pushes to `main`, weekly schedule, and minimal permissions.
- Placeholder scan: No placeholders remain.
- Type consistency: Not applicable; this change is workflow-only.
