import { describe, expect, it } from "vitest";
import type { DocFile } from "../../src/types.js";
import { hashFileset } from "../../src/state/hash.js";

function docFile(relativePath: string, content: string): DocFile {
  return { relativePath, content, frontmatter: {} };
}

const defaultParams = {
  slicerVersion: 1,
  tokenBudget: 4000,
  includeLarge: false,
};

describe("hashFileset", () => {
  it("returns a sha256-prefixed 64-hex-character digest", () => {
    const digest = hashFileset([docFile("a.md", "hello")], defaultParams);

    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is order-independent over the fileset", () => {
    const forward = hashFileset(
      [docFile("a.md", "one"), docFile("b.md", "two")],
      defaultParams,
    );
    const reversed = hashFileset(
      [docFile("b.md", "two"), docFile("a.md", "one")],
      defaultParams,
    );

    expect(forward).toBe(reversed);
  });

  it("changes when a file's content changes", () => {
    const before = hashFileset([docFile("a.md", "one")], defaultParams);
    const after = hashFileset([docFile("a.md", "ONE")], defaultParams);

    expect(before).not.toBe(after);
  });

  it("changes when a file's relative path changes", () => {
    const before = hashFileset([docFile("a.md", "one")], defaultParams);
    const after = hashFileset([docFile("b.md", "one")], defaultParams);

    expect(before).not.toBe(after);
  });

  it("changes when tokenBudget changes", () => {
    const files = [docFile("a.md", "one")];
    const before = hashFileset(files, defaultParams);
    const after = hashFileset(files, { ...defaultParams, tokenBudget: 2000 });

    expect(before).not.toBe(after);
  });

  it("changes when slicerVersion changes", () => {
    const files = [docFile("a.md", "one")];
    const before = hashFileset(files, defaultParams);
    const after = hashFileset(files, { ...defaultParams, slicerVersion: 2 });

    expect(before).not.toBe(after);
  });

  it("changes when includeLarge changes", () => {
    const files = [docFile("a.md", "one")];
    const before = hashFileset(files, defaultParams);
    const after = hashFileset(files, { ...defaultParams, includeLarge: true });

    expect(before).not.toBe(after);
  });

  it("resists field-boundary collisions between path and content", () => {
    const first = hashFileset([docFile("a", "bc")], defaultParams);
    const second = hashFileset([docFile("ab", "c")], defaultParams);

    expect(first).not.toBe(second);
  });

  it("does not mutate the input array order", () => {
    const files = [docFile("b.md", "two"), docFile("a.md", "one")];

    hashFileset(files, defaultParams);

    expect(files.map((file) => file.relativePath)).toEqual(["b.md", "a.md"]);
  });

  it("is deterministic across repeated calls", () => {
    const files = [docFile("a.md", "one"), docFile("b.md", "two")];

    expect(hashFileset(files, defaultParams)).toBe(
      hashFileset(files, defaultParams),
    );
  });
});
