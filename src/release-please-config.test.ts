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

  it("bootstraps the root package from 0.0.0", () => {
    expect(releasePleaseManifest["."]).toBe("0.0.0");
  });
});
