import { describe, expect, it } from "vitest";
import { firstSummary } from "../../src/markdown/summary.js";

describe("firstSummary", () => {
  it("cuts a long prose paragraph at 120 characters on a word boundary", () => {
    const body =
      "The quick brown fox jumps over the lazy dog while the sun slowly sets behind the distant mountains and the wind begins to howl softly through the trees at dusk.";

    expect(firstSummary(body)).toBe(
      "The quick brown fox jumps over the lazy dog while the sun slowly sets behind the distant mountains and the wind begins",
    );
  });

  it("returns an empty string when the body has no prose after a fenced code block", () => {
    const body = "```\nconst code = true;\n```";

    expect(firstSummary(body)).toBe("");
  });

  it("returns an empty string when the body has no prose after a list", () => {
    const body = "- first item\n- second item\n- third item";

    expect(firstSummary(body)).toBe("");
  });

  it("returns a short paragraph whole when it is 120 characters or fewer", () => {
    const body = "This is a short paragraph.";

    expect(firstSummary(body)).toBe("This is a short paragraph.");
  });

  it("skips heading lines to find the first prose paragraph", () => {
    const body =
      "# Title\n\nThis is the first paragraph after a heading, kept short and simple.";

    expect(firstSummary(body)).toBe(
      "This is the first paragraph after a heading, kept short and simple.",
    );
  });

  it("joins multi-line paragraph lines with a single space before measuring", () => {
    const body = "This paragraph continues\nonto a second line.";

    expect(firstSummary(body)).toBe(
      "This paragraph continues onto a second line.",
    );
  });
});
