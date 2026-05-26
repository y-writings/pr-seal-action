import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const releasePleaseConfig = JSON.parse(readFileSync("release-please-config.json", "utf8"));
const releasePleaseManifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

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

  it("tracks the released root package version", () => {
    expect(releasePleaseManifest["."]).toBe(packageJson.version);
  });
});
