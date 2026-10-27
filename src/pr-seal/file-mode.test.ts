import { describe, expect, it } from "vitest";
import {
  GIT_MODE_EXECUTABLE,
  GIT_MODE_REGULAR,
  GIT_MODE_SUBMODULE,
  GIT_MODE_SYMLINK,
  GIT_MODE_TREE,
  classifyGitMode,
  evaluateRegularFiles,
  type FileModeSnapshot,
} from "./file-mode.js";

const regular = { mode: GIT_MODE_REGULAR, type: "blob" };
const executable = { mode: GIT_MODE_EXECUTABLE, type: "blob" };
const symlink = { mode: GIT_MODE_SYMLINK, type: "blob" };
const submodule = { mode: GIT_MODE_SUBMODULE, type: "commit" };

function file(overrides: Partial<FileModeSnapshot> & Pick<FileModeSnapshot, "path" | "changeType">): FileModeSnapshot {
  return { head: regular, base: regular, ...overrides };
}

describe("classifyGitMode", () => {
  it("recognizes regular blobs and unsafe git modes", () => {
    expect(classifyGitMode(GIT_MODE_REGULAR, "blob")).toBe("regular");
    expect(classifyGitMode(33188, "blob")).toBe("regular");
    expect(classifyGitMode(GIT_MODE_EXECUTABLE, "blob")).toBe("executable");
    expect(classifyGitMode(GIT_MODE_SYMLINK, "blob")).toBe("symlink");
    expect(classifyGitMode(GIT_MODE_SUBMODULE, "commit")).toBe("submodule");
    expect(classifyGitMode(GIT_MODE_TREE, "tree")).toBe("tree");
    expect(classifyGitMode(0o100666, "blob")).toBe("unknown");
  });
});

describe("evaluateRegularFiles", () => {
  it("accepts regular non-executable files on every side the diff touches", () => {
    expect(
      evaluateRegularFiles("octo/repo#1", [
        file({ path: "README.md", changeType: "ADDED", base: null }),
        file({ path: "CHANGELOG.md", changeType: "MODIFIED" }),
        file({ path: "OLD.md", changeType: "DELETED", head: null }),
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects executable bits, symlinks, submodules, and directories", () => {
    expect(evaluateRegularFiles("octo/repo#1", [file({ path: "README.md", changeType: "ADDED", head: executable, base: null })])).toMatchObject({
      ok: false,
      hard: false,
      reason: expect.stringContaining("README.md is executable at head"),
    });
    expect(evaluateRegularFiles("octo/repo#1", [file({ path: "README.md", changeType: "ADDED", head: symlink, base: null })])).toMatchObject({
      ok: false,
      hard: false,
      reason: expect.stringContaining("README.md is a symlink at head"),
    });
    expect(
      evaluateRegularFiles("octo/repo#1", [file({ path: "vendor/lib", changeType: "MODIFIED", head: submodule, base: submodule })]),
    ).toMatchObject({
      ok: false,
      hard: false,
      reason: expect.stringContaining("vendor/lib is a submodule at head"),
    });
    expect(
      evaluateRegularFiles("octo/repo#1", [
        file({ path: "docs", changeType: "MODIFIED", head: { mode: GIT_MODE_TREE, type: "tree" }, base: regular }),
      ]),
    ).toMatchObject({ ok: false, hard: false });
  });

  it("rejects a mode change or replacement that leaves a non-regular file on either side", () => {
    expect(evaluateRegularFiles("octo/repo#1", [file({ path: "README.md", changeType: "MODIFIED", base: executable })])).toMatchObject({
      ok: false,
      hard: false,
      reason: expect.stringContaining("README.md is executable at base"),
    });
    expect(evaluateRegularFiles("octo/repo#1", [file({ path: "README.md", changeType: "ADDED", base: symlink })])).toMatchObject({
      ok: false,
      hard: false,
      reason: expect.stringContaining("README.md replaces a non-regular file on the base"),
    });
    expect(evaluateRegularFiles("octo/repo#1", [file({ path: "script.sh", changeType: "DELETED", head: null, base: executable })])).toMatchObject({
      ok: false,
      hard: false,
      reason: expect.stringContaining("script.sh is executable at base"),
    });
  });

  it("fails closed when git metadata needed to prove a regular file is missing or unrecognized", () => {
    expect(evaluateRegularFiles("octo/repo#1", [file({ path: "README.md", changeType: "MODIFIED", head: null })])).toMatchObject({
      ok: false,
      hard: true,
      reason: expect.stringContaining("README.md has no head git entry"),
    });
    expect(evaluateRegularFiles("octo/repo#1", [file({ path: "README.md", changeType: "WEIRD" })])).toMatchObject({
      ok: false,
      hard: true,
      reason: expect.stringContaining("unrecognized change status"),
    });
    expect(
      evaluateRegularFiles("octo/repo#1", [file({ path: "README.md", changeType: "ADDED", head: { mode: 1, type: "blob" }, base: null })]),
    ).toMatchObject({ ok: false, hard: true });
  });
});
