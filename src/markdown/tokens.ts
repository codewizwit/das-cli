/**
 * Estimate token count for markdown content, accounting for prose and code blocks.
 *
 * Prose content is estimated at 4 characters per token. Code block interior is
 * estimated at 3 characters per token. Fence delimiters count as prose.
 *
 * @param markdown - The markdown content to estimate
 * @returns Estimated token count
 *
 * @example
 * ```ts
 * const tokens = estimateTokens("Hello world\n```\ncode\n```");
 * ```
 */
export function estimateTokens(markdown: string): number {
  if (markdown.length === 0) return 0;

  const lines = markdown.split("\n");
  let insideFence = false;
  let total = 0;

  for (const line of lines) {
    if (line.trim() === "```") {
      insideFence = !insideFence;
      total += Math.ceil(line.length / 4);
    } else if (insideFence) {
      total += Math.ceil(line.length / 3);
    } else {
      total += Math.ceil(line.length / 4);
    }
  }

  return total;
}
