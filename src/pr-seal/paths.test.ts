import { describe, expect, it } from "vitest";
import { compileGlob, isSafeRelativePath, matchesAnyGlob } from "./paths.js";

describe("isSafeRelativePath", () => {
  it("accepts repository-relative paths", () => {
    expect(isSafeRelativePath("README.md")).toBe(true);
    expect(isSafeRelativePath("docs/guide.md")).toBe(true);
  });

  it("rejects paths that can escape a glob or tree lookup", () => {
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("/README.md")).toBe(false);
    expect(isSafeRelativePath("docs/")).toBe(false);
    expect(isSafeRelativePath("../README.md")).toBe(false);
    expect(isSafeRelativePath("docs/../../.github/workflows/ci.yml")).toBe(false);
    expect(isSafeRelativePath("docs\\README.md")).toBe(false);
    expect(isSafeRelativePath("docs/\nREADME.md")).toBe(false);
  });
});

describe("compileGlob", () => {
  it("matches within the full relative path", () => {
    expect(compileGlob("*.md").test("README.md")).toBe(true);
    expect(compileGlob("*.md").test("docs/README.md")).toBe(false);
    expect(compileGlob("**/*.md").test("README.md")).toBe(true);
    expect(compileGlob("**/*.md").test("docs/guide.md")).toBe(true);
    expect(compileGlob("**/*.md").test("docs/guide.md.bak")).toBe(false);
    expect(compileGlob("docs/*").test("docs/guide.md")).toBe(true);
    expect(compileGlob("docs/*").test("docs/nested/guide.md")).toBe(false);
    expect(compileGlob("docs/**").test("docs/nested/guide.md")).toBe(true);
    expect(compileGlob("docs/**").test("docs")).toBe(false);
    expect(compileGlob("a/**/b").test("a/b")).toBe(true);
    expect(compileGlob("a/**/b").test("a/x/y/b")).toBe(true);
    expect(compileGlob("a/**/b").test("a/bb")).toBe(false);
    expect(compileGlob("?.md").test("a.md")).toBe(true);
    expect(compileGlob("?.md").test("ab.md")).toBe(false);
    expect(compileGlob("**").test("docs/guide.md")).toBe(true);
    expect(matchesAnyGlob([".github/workflows/**"], ".github/workflows/ci.yml")).toBe(true);
  });

  it("treats dots and other regex characters as literals", () => {
    expect(compileGlob(".github/*.yml").test(".github/ci.yml")).toBe(true);
    expect(compileGlob(".github/*.yml").test("Xgithub/ci.yml")).toBe(false);
  });

  it("rejects patterns that are not safe relative globs", () => {
    expect(() => compileGlob("")).toThrow("invalid glob pattern");
    expect(() => compileGlob("/README.md")).toThrow("invalid glob pattern");
    expect(() => compileGlob("docs/")).toThrow("invalid glob pattern");
    expect(() => compileGlob("../README.md")).toThrow("invalid glob pattern");
    expect(() => compileGlob("docs/**/../secret.md")).toThrow("invalid glob pattern");
  });
});
