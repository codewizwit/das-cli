/**
 * Estimate token count for markdown content, accounting for prose and code blocks.
 *
 * Prose content is estimated at 4 characters per token. Code block interior is
 * estimated at 3 characters per token. Fence delimiters (including language tags)
 * count as prose and toggle the code block state.
 *
 * Accumulates consecutive lines of the same type (prose or code) into segments
 * and applies Math.ceil once per segment.
 *
 * @param markdown - The markdown content to estimate
 * @returns Estimated token count
 *
 * @remarks
 * Known limitations:
 * - Unclosed fence: remaining content is counted at the code rate (3 chars/token)
 * - Fence markers inside code: will incorrectly toggle fence state
 * - CRLF line endings: newline bytes are counted as part of segment length
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
  let segmentLines: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (segmentLines.length > 0) {
        const segmentString = segmentLines.join("\n");
        const tokenDivisor = insideFence ? 3 : 4;
        total += Math.ceil(segmentString.length / tokenDivisor);
        segmentLines = [];
      }

      total += Math.ceil(line.trim().length / 4);
      insideFence = !insideFence;
    } else {
      segmentLines.push(line);
    }
  }

  if (segmentLines.length > 0) {
    const segmentString = segmentLines.join("\n");
    const tokenDivisor = insideFence ? 3 : 4;
    total += Math.ceil(segmentString.length / tokenDivisor);
  }

  return total;
}
