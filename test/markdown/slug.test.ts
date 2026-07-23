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

  it("re-trims trailing dashes after truncation", () => {
    expect(sanitizeSlug("x".repeat(63) + " " + "y".repeat(5))).toBe(
      "x".repeat(63),
    );
  });

  it("rejects fullwidth confusables that normalize into reserved names", () => {
    expect(sanitizeSlug("ＣＯＮ")).toBe("section");
  });

  it("falls back to section for zero-width-only input", () => {
    expect(sanitizeSlug("​​")).toBe("section");
  });
});
