import { describe, expect, it } from "vitest";
import { sanitizeSlug } from "../../src/markdown/slug.js";

describe("sanitizeSlug", () => {
  it("lowercases and dashes ordinary headings", () => {
    expect(sanitizeSlug("Getting Started")).toBe("getting-started");
  });

  it("NFKC-normalizes before filtering so fullwidth solidus cannot survive", () => {
    expect(sanitizeSlug("a／b")).toBe("a-b");
  });

  it("strips traversal sequences entirely", () => {
    expect(sanitizeSlug("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeSlug("..")).toBe("section");
  });

  it("rejects reserved names", () => {
    expect(sanitizeSlug("CON")).toBe("section");
    expect(sanitizeSlug(".")).toBe("section");
  });

  it("collapses repeats, trims dashes, caps at 64 chars", () => {
    expect(sanitizeSlug("--a---b--")).toBe("a-b");
    expect(sanitizeSlug("x".repeat(100))).toHaveLength(64);
  });

  it("falls back to section for empty results", () => {
    expect(sanitizeSlug("!!!")).toBe("section");
  });
});
