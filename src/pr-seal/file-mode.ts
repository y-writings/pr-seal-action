export const GIT_MODE_REGULAR = 0o100644;
export const GIT_MODE_EXECUTABLE = 0o100755;
export const GIT_MODE_SYMLINK = 0o120000;
export const GIT_MODE_SUBMODULE = 0o160000;
export const GIT_MODE_TREE = 0o040000;

export interface GitTreeEntry {
  mode: number;
  type: string;
}

export interface FileModeSnapshot {
  path: string;
  changeType: string;
  head: GitTreeEntry | null;
  base: GitTreeEntry | null;
}

export type GitFileKind = "regular" | "executable" | "symlink" | "submodule" | "tree" | "unknown";

export type RegularFilesDecision =
  | { ok: true }
  | { ok: false; hard: false; reason: string }
  | { ok: false; hard: true; reason: string };

const KNOWN_CHANGE_TYPES = new Set(["ADDED", "DELETED", "MODIFIED", "CHANGED", "COPIED"]);

export function classifyGitMode(mode: number, type: string): GitFileKind {
  if (type === "commit" || mode === GIT_MODE_SUBMODULE) {
    return "submodule";
  }
  if (type === "tree" || mode === GIT_MODE_TREE) {
    return "tree";
  }
  if (mode === GIT_MODE_SYMLINK) {
    return "symlink";
  }
  if (mode === GIT_MODE_EXECUTABLE) {
    return "executable";
  }
  if (mode === GIT_MODE_REGULAR && type === "blob") {
    return "regular";
  }
  return "unknown";
}

export function evaluateRegularFiles(subject: string, files: readonly FileModeSnapshot[]): RegularFilesDecision {
  const problems: string[] = [];
  for (const file of files) {
    const decision = evaluateFile(file);
    if (decision.ok) {
      continue;
    }
    if (decision.hard) {
      return { ok: false, hard: true, reason: `Refusing to seal ${subject} because ${decision.reason}` };
    }
    problems.push(decision.reason);
  }
  if (problems.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    hard: false,
    reason: `Refusing to seal ${subject} because ${problems.join("; ")}`,
  };
}

function evaluateFile(file: FileModeSnapshot): { ok: true } | { ok: false; hard: boolean; reason: string } {
  const changeType = file.changeType.toUpperCase();
  if (!KNOWN_CHANGE_TYPES.has(changeType)) {
    return {
      ok: false,
      hard: true,
      reason: `${file.path} has an unrecognized change status ${file.changeType}`,
    };
  }

  if (changeType === "DELETED") {
    if (file.head) {
      return { ok: false, hard: true, reason: `${file.path} is marked deleted but still exists at head` };
    }
    if (!file.base) {
      return { ok: false, hard: true, reason: `${file.path} has no base git entry` };
    }
    return sideProblem(file.path, file.base, "base") ?? { ok: true };
  }

  if (!file.head) {
    return { ok: false, hard: true, reason: `${file.path} has no head git entry` };
  }
  const headProblem = sideProblem(file.path, file.head, "head");
  if (headProblem) {
    return headProblem;
  }

  if (changeType === "ADDED" || changeType === "COPIED") {
    if (!file.base) {
      return { ok: true };
    }
    const replaced = classifyGitMode(file.base.mode, file.base.type);
    if (replaced === "unknown") {
      return {
        ok: false,
        hard: true,
        reason: `${file.path} replaces an unrecognized git mode ${file.base.mode} (${file.base.type}) on the base`,
      };
    }
    if (replaced !== "regular") {
      return { ok: false, hard: false, reason: `${file.path} replaces a non-regular file on the base` };
    }
    return { ok: true };
  }

  if (!file.base) {
    return { ok: false, hard: true, reason: `${file.path} has no base git entry` };
  }
  return sideProblem(file.path, file.base, "base") ?? { ok: true };
}

function sideProblem(
  path: string,
  entry: GitTreeEntry,
  side: "head" | "base",
): { ok: false; hard: boolean; reason: string } | null {
  const kind = classifyGitMode(entry.mode, entry.type);
  if (kind === "regular") {
    return null;
  }
  if (kind === "unknown") {
    return {
      ok: false,
      hard: true,
      reason: `${path} has an unrecognized git mode ${entry.mode} (${entry.type}) at ${side}`,
    };
  }
  return { ok: false, hard: false, reason: `${path} is ${describeKind(kind)} at ${side}` };
}

function describeKind(kind: Exclude<GitFileKind, "regular" | "unknown">): string {
  if (kind === "executable") {
    return "executable";
  }
  if (kind === "symlink") {
    return "a symlink";
  }
  if (kind === "submodule") {
    return "a submodule";
  }
  return "a directory";
}
