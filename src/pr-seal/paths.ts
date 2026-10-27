const PATTERN_MAX_LENGTH = 512;

export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) {
    return false;
  }
  if (/[\0\r\n\\]/.test(path)) {
    return false;
  }
  if (path.startsWith("/") || path.endsWith("/")) {
    return false;
  }
  const parts = path.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function compileGlob(pattern: string): RegExp {
  if (pattern.length === 0 || pattern.length > PATTERN_MAX_LENGTH) {
    throw new Error(`invalid glob pattern: ${pattern}`);
  }
  if (/[\0\r\n\\]/.test(pattern) || pattern.startsWith("/") || pattern.endsWith("/")) {
    throw new Error(`invalid glob pattern: ${pattern}`);
  }

  const segments = pattern.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`invalid glob pattern: ${pattern}`);
  }

  let source = "";
  let needsSeparator = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const isLast = index === segments.length - 1;
    if (segment === "**") {
      if (segments.length === 1) {
        source += ".*";
      } else if (isLast) {
        if (needsSeparator) {
          source += "/";
        }
        source += ".*";
      } else if (needsSeparator) {
        source += "/(?:[^/]+/)*";
      } else {
        source += "(?:[^/]+/)*";
      }
      needsSeparator = false;
      continue;
    }

    if (needsSeparator) {
      source += "/";
    }
    source += compileSegment(segment);
    needsSeparator = true;
  }

  return new RegExp(`^${source}$`);
}

export function matchesAnyGlob(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => compileGlob(pattern).test(path));
}

function compileSegment(segment: string): string {
  let source = "";
  for (const character of segment) {
    if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(character);
    }
  }
  return source;
}

function escapeRegex(character: string): string {
  return character.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
}
