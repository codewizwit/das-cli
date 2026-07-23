import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../src/markdown/tokens.js";

describe("estimateTokens", () => {
  it("estimates prose at chars/4", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("estimates fenced code content at chars/3", () => {
    const code = "```\n" + "x".repeat(300) + "\n```";
    expect(estimateTokens(code)).toBeGreaterThanOrEqual(100);
  });

  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("mixes prose and code segments", () => {
    const mixed = "a".repeat(400) + "\n```\n" + "x".repeat(300) + "\n```";
    expect(estimateTokens(mixed)).toBe(
      100 + 100 + estimateTokens("```\n\n```"),
    );
  });

  it("multi-line prose gets one ceil", () => {
    expect(estimateTokens("a\n".repeat(8))).toBe(Math.ceil(16 / 4));
  });

  it("tagged fence counts as code", () => {
    const tagged = "```typescript\n" + "x".repeat(300) + "\n```";
    expect(estimateTokens(tagged)).toBe(
      Math.ceil("```typescript".length / 4) + 100 + 1,
    );
  });

  it("unclosed fence counts remaining as code", () => {
    expect(estimateTokens("a\n```\nx")).toBe(1 + 1 + 1);
  });
});
