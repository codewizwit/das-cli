import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidDasJsonError,
  SLICER_VERSION,
  readDasJson,
  writeDasJson,
  type DasJson,
} from "../../src/emitter/das-json.js";

function validDasJson(): DasJson {
  return {
    dasVersion: "1.0.0",
    slicerVersion: SLICER_VERSION,
    name: "widget-docs",
    source: {
      type: "github",
      url: "https://github.com/acme/widget-docs.git",
      subpath: null,
    },
    trackedRef: "main",
    pinnedSha: "a".repeat(40),
    sourceHash: `sha256:${"b".repeat(64)}`,
    tokenBudget: 4000,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-22T12:00:00Z",
    generatedFiles: ["SKILL.md", "reference/topic.md"],
  };
}

describe("das-json", () => {
  let skillDir: string;

  beforeEach(async () => {
    skillDir = await mkdtemp(join(tmpdir(), "das-json-test-"));
  });

  afterEach(async () => {
    await rm(skillDir, { recursive: true, force: true });
  });

  it("exports SLICER_VERSION as 1", () => {
    expect(SLICER_VERSION).toBe(1);
  });

  it("round-trips a valid das.json through write then read", async () => {
    const data = validDasJson();
    await writeDasJson(skillDir, data);
    const result = await readDasJson(skillDir);
    expect(result).toEqual(data);
  });

  it("round-trips a path source", async () => {
    const data: DasJson = {
      ...validDasJson(),
      source: { type: "path", path: "/Users/alex/docs", kind: "folder" },
    };
    await writeDasJson(skillDir, data);
    const result = await readDasJson(skillDir);
    expect(result).toEqual(data);
  });

  it("throws InvalidDasJsonError when das.json is missing", async () => {
    await expect(readDasJson(skillDir)).rejects.toThrow(InvalidDasJsonError);
  });

  it("throws InvalidDasJsonError when das.json is unparseable JSON", async () => {
    await writeFile(join(skillDir, "das.json"), "not json{", "utf-8");
    await expect(readDasJson(skillDir)).rejects.toThrow(InvalidDasJsonError);
  });

  it("throws InvalidDasJsonError when a required field is missing", async () => {
    const data = validDasJson();
    const { dasVersion: _dasVersion, ...withoutDasVersion } = data;
    await writeFile(
      join(skillDir, "das.json"),
      JSON.stringify(withoutDasVersion),
      "utf-8",
    );
    await expect(readDasJson(skillDir)).rejects.toThrow(InvalidDasJsonError);
  });

  it.each(["Widget-Docs", "widget_docs", "-widget-docs"])(
    "rejects an invalid skill name %s",
    async (name) => {
      const data: DasJson = { ...validDasJson(), name };
      await expect(writeDasJson(skillDir, data)).rejects.toThrow(
        InvalidDasJsonError,
      );
    },
  );

  it("rejects a github source url using http", async () => {
    const data: DasJson = {
      ...validDasJson(),
      source: {
        type: "github",
        url: "http://github.com/acme/widget-docs.git",
        subpath: null,
      },
    };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a github source url with a non-github host", async () => {
    const data: DasJson = {
      ...validDasJson(),
      source: {
        type: "github",
        url: "https://gitlab.com/acme/widget-docs.git",
        subpath: null,
      },
    };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a pinnedSha that is not 40-char lowercase hex", async () => {
    const data: DasJson = { ...validDasJson(), pinnedSha: "abc123" };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a sourceHash without the sha256: prefix", async () => {
    const data: DasJson = { ...validDasJson(), sourceHash: "b".repeat(64) };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a sourceHash with the wrong hex length", async () => {
    const data: DasJson = {
      ...validDasJson(),
      sourceHash: `sha256:${"b".repeat(63)}`,
    };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a tokenBudget below 500", async () => {
    const data: DasJson = { ...validDasJson(), tokenBudget: 499 };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a tokenBudget above 100000", async () => {
    const data: DasJson = { ...validDasJson(), tokenBudget: 100001 };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a negative checkIntervalHours", async () => {
    const data: DasJson = { ...validDasJson(), checkIntervalHours: -1 };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a lastRefresh that is not ISO 8601", async () => {
    const data: DasJson = { ...validDasJson(), lastRefresh: "not-a-date" };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a generatedFiles entry that is an absolute path", async () => {
    const data: DasJson = {
      ...validDasJson(),
      generatedFiles: ["SKILL.md", "/etc/x"],
    };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects a generatedFiles entry containing a .. segment", async () => {
    const data: DasJson = {
      ...validDasJson(),
      generatedFiles: ["SKILL.md", "../outside.md"],
    };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("rejects an empty generatedFiles array", async () => {
    const data: DasJson = { ...validDasJson(), generatedFiles: [] };
    await expect(writeDasJson(skillDir, data)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });

  it("refuses to write an invalid object", async () => {
    const invalid: DasJson = { ...validDasJson(), tokenBudget: 1 };
    await expect(writeDasJson(skillDir, invalid)).rejects.toThrow(
      InvalidDasJsonError,
    );
  });
});
