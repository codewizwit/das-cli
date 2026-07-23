const headingPattern = /^#{1,6}(\s|$)/;
const orderedListPattern = /^\d+\.\s/;
const unorderedListPattern = /^[-*+]\s/;

function isNonProseLine(trimmedLine: string): boolean {
  return (
    headingPattern.test(trimmedLine) ||
    trimmedLine.startsWith("```") ||
    trimmedLine.startsWith("|") ||
    trimmedLine.startsWith(">") ||
    unorderedListPattern.test(trimmedLine) ||
    orderedListPattern.test(trimmedLine)
  );
}

function findFirstProseParagraph(body: string): string | undefined {
  const lines = body.split("\n");
  let paragraphLines: string[] = [];
  let paragraphIsProse = true;

  const flushParagraph = (): string | undefined => {
    if (paragraphLines.length > 0 && paragraphIsProse) {
      return paragraphLines.join(" ");
    }
    return undefined;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === "") {
      const paragraph = flushParagraph();
      if (paragraph !== undefined) {
        return paragraph;
      }
      paragraphLines = [];
      paragraphIsProse = true;
      continue;
    }

    if (paragraphLines.length === 0) {
      paragraphIsProse = !isNonProseLine(trimmedLine);
    }

    paragraphLines.push(trimmedLine);
  }

  return flushParagraph();
}

function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const cutIndex = text.lastIndexOf(" ", maxLength);
  return text.slice(0, cutIndex);
}

/**
 * Produce a deterministic one-line summary of a markdown body.
 *
 * Finds the first prose paragraph, skipping heading lines, fenced code
 * blocks, tables, list items, and blockquotes, then returns its first
 * 120 characters, cut at a word boundary. Multi-line paragraphs are
 * joined with single spaces before measuring.
 *
 * @param body - The markdown document body
 * @returns The summary text, or an empty string when no prose paragraph exists
 *
 * @remarks
 * Known limitations:
 * - If the first 120 characters contain no space, the cut falls back to
 *   the character before index 120 rather than the whole first word
 *
 * @example
 * ```ts
 * firstSummary("# Title\n\nHello world.") // "Hello world."
 * ```
 */
export function firstSummary(body: string): string {
  const paragraph = findFirstProseParagraph(body);
  if (paragraph === undefined) {
    return "";
  }

  return truncateAtWordBoundary(paragraph, 120);
}
