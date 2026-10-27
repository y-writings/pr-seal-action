import { isSafeRelativePath } from "./paths.js";

const DOC_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".rst",
  ".adoc",
  ".asciidoc",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

const DOC_BASENAMES = new Set([
  "license",
  "license.md",
  "license.txt",
  "copying",
  "copying.md",
  "notice",
  "notice.md",
  "notice.txt",
  "authors",
  "authors.md",
  "changelog",
  "changelog.md",
  "contributors",
  "contributors.md",
]);

const CONFIG_BASENAMES = new Set([
  ".editorconfig",
  ".gitignore",
  ".prettierignore",
  "tombi.toml",
  ".pinact.yaml",
  ".yamllint",
  ".yamllint.yml",
  ".yamllint.yaml",
]);

const EXACT_CONFIG_PATHS = new Set([
  ".github/pr-diff-groups.json",
  ".github/FUNDING.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/DISCUSSION_TEMPLATE/config.yml",
]);

const SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".ksh",
  ".fish",
  ".ps1",
  ".psm1",
  ".bat",
  ".cmd",
  ".py",
  ".pyw",
  ".rb",
  ".pl",
  ".pm",
  ".php",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".cs",
  ".fs",
  ".vb",
  ".scala",
  ".groovy",
  ".lua",
  ".dart",
  ".ex",
  ".exs",
  ".clj",
  ".hs",
  ".ml",
  ".r",
  ".jl",
]);

const UNSAFE_BASENAMES = new Set([
  "action.yml",
  "action.yaml",
  "dockerfile",
  "containerfile",
  "makefile",
  "gnumakefile",
  "justfile",
  "jenkinsfile",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "go.mod",
  "go.sum",
  "cargo.toml",
  "cargo.lock",
  "pyproject.toml",
  "pipfile",
  "pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "gemfile",
  "gemfile.lock",
  "composer.json",
  "composer.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "flake.nix",
  "flake.lock",
  "default.nix",
  "shell.nix",
  "cmakelists.txt",
  "meson.build",
  "lefthook.yml",
  "lefthook.yaml",
  "procfile",
  "codeowners",
  "dependabot.yml",
  "dependabot.yaml",
  "renovate.json",
  "renovate.json5",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "taskfile.yml",
  "taskfile.yaml",
  "mix.exs",
  "pubspec.yaml",
  "pubspec.lock",
  "package.swift",
  "module.bazel",
  "workspace",
  "workspace.bazel",
  ".gitlab-ci.yml",
  ".travis.yml",
  "appveyor.yml",
  "azure-pipelines.yml",
  "netlify.toml",
  "vercel.json",
  "fly.toml",
  "render.yaml",
  "mise.toml",
  ".mise.toml",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".tool-versions",
  "release-please-config.json",
  ".release-please-manifest.json",
]);

const UNSAFE_EXTENSIONS = new Set([".lock", ".nix", ".gemspec", ".csproj", ".fsproj", ".sln"]);

export interface DocsConfigDecision {
  allowed: boolean;
  denied: boolean;
  reason: string;
}

export function evaluateDocsConfigPath(path: string): DocsConfigDecision {
  if (!isSafeRelativePath(path)) {
    return { allowed: false, denied: true, reason: "is an invalid path" };
  }
  if (isWorkflowOrActionPath(path)) {
    return { allowed: false, denied: true, reason: "is in a workflow or action directory" };
  }
  const unsafeReason = knownUnsafeReason(path);
  if (unsafeReason) {
    return { allowed: false, denied: true, reason: unsafeReason };
  }
  if (isAllowlisted(path)) {
    return { allowed: true, denied: false, reason: "" };
  }
  return {
    allowed: false,
    denied: false,
    reason: "is not documentation or non-executable configuration",
  };
}

function isAllowlisted(path: string): boolean {
  const base = basename(path);
  if (DOC_BASENAMES.has(base.toLowerCase())) {
    return true;
  }
  if (EXACT_CONFIG_PATHS.has(path)) {
    return true;
  }
  if (CONFIG_BASENAMES.has(base)) {
    return true;
  }
  return DOC_EXTENSIONS.has(extensionOf(base));
}

function knownUnsafeReason(path: string): string | null {
  const base = basename(path);
  const lower = base.toLowerCase();
  if (
    lower === "cliff.toml" ||
    lower === "biome.json" ||
    lower === "biome.jsonc" ||
    /^(?:tsconfig|jsconfig)(?:\.[a-z0-9_-]+)?\.json$/.test(lower) ||
    /^\.(?:prettierrc|markdownlint(?:-cli2)?|markdownlintrc|commitlintrc)(?:\..+)?$/.test(lower)
  ) {
    return "can run or load code";
  }
  if (lower === "action.yml" || lower === "action.yaml") {
    return "is a GitHub Action definition";
  }
  if (
    /^(?:dockerfile|containerfile|jenkinsfile)(?:\..+)?$/.test(lower) ||
    /^requirements(?:[-_][^/]+)?\.txt$/.test(lower)
  ) {
    return "is a build or CI file";
  }
  if (UNSAFE_BASENAMES.has(lower)) {
    return "is a build, lock, task, or CI file";
  }
  const extension = extensionOf(base);
  if (SCRIPT_EXTENSIONS.has(extension)) {
    return "is executable source";
  }
  if (UNSAFE_EXTENSIONS.has(extension)) {
    return "is a build or lock file";
  }
  return null;
}

function isWorkflowOrActionPath(path: string): boolean {
  const parts = path.split("/");
  for (let index = 0; index < parts.length - 1; index += 1) {
    const parent = parts[index]!.toLowerCase();
    const child = parts[index + 1]!.toLowerCase();
    if (parent === ".github" && (child === "workflows" || child === "actions")) {
      return true;
    }
  }
  return false;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return lower.slice(dot);
}
