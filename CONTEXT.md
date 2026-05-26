# pr-seal-action

This context describes the action that verifies a tightly scoped automation pull request, approves it, and enables auto-merge against the verified head SHA.

## Language

**PR seal**:
The guarded flow that verifies an automation pull request, creates an approval review, and enables auto-merge for the same verified head SHA.
_Avoid_: auto-approve flow, merge helper

**Verified pull request**:
A pull request whose open state, number, author, changed paths, node ID, and head SHA have passed the PR seal safety checks.
_Avoid_: safe PR, valid PR

**GitHub seal adapter**:
The GitHub-backed module that fetches pull request evidence, creates the approval review, and enables auto-merge.
_Avoid_: GitHub client bundle, raw GraphQL client

**Workflow check**:
A repository test that protects release and changelog workflow configuration from drifting away from the intended automation contract.
_Avoid_: string snapshot, config smoke test

## Example Dialogue

Developer: "Can the PR seal approve this weekly changelog pull request?"

Domain expert: "Only after the GitHub seal adapter returns the pull request evidence and the PR seal turns it into a verified pull request."

Developer: "Where should release-please workflow expectations live?"

Domain expert: "As workflow checks, separate from the PR seal modules, because they protect this repository's automation rather than the reusable action runtime."
