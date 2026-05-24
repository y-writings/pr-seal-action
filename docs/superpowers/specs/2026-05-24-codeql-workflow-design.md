CodeQL Workflow Design
======================

Goal
----

Add GitHub CodeQL analysis that fits this repository's TypeScript GitHub Action.

Context
-------

The repository is a Node 24 GitHub Action implemented in TypeScript under `src/`, with a bundled `dist/` artifact and `pnpm` package management. Existing workflows are split by concern, so CodeQL should be added as its own workflow rather than folded into the existing secret scan workflow.

Design
------

Create `.github/workflows/codeql.yaml` with a single CodeQL job. The job will analyze the `javascript-typescript` language using `github/codeql-action/init` and `github/codeql-action/analyze`, pinned to the CodeQL Action v4 tag SHA to match the repository's existing workflow style.

The workflow will run on pull requests, pushes to `main`, and a weekly scheduled scan. Permissions will be limited to `contents: read` and `security-events: write`.

CodeQL will use `build-mode: none`. For JavaScript and TypeScript, CodeQL can analyze source without installing dependencies or running `pnpm build`, which keeps the security scan small and avoids unrelated package-manager failures.

Verification
------------

Validate the workflow YAML shape locally and inspect the final diff. GitHub performs the actual CodeQL analysis when the workflow runs.
