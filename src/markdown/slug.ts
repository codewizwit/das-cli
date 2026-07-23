/**
 * Sanitize heading text into a safe, URL-friendly slug.
 *
 * Applies NFKC normalization, lowercasing, character filtering, and reserved-name
 * checking to ensure safe heading-to-filename conversion from untrusted markdown.
 *
 * @param headingText - The raw heading text from a markdown document
 * @returns A sanitized slug (1-64 characters), or "section" as fallback
 *
 * @example
 * ```ts
 * sanitizeSlug("Getting Started") // "getting-started"
 * sanitizeSlug("a／b")             // "a-b" (fullwidth solidus normalizes to /)
 * sanitizeSlug("!!!") // "section" (empty result after filtering)
 * ```
 */
export function sanitizeSlug(headingText: string): string {
  const reservedNames = new Set([
    ".",
    "..",
    "con",
    "prn",
    "aux",
    "nul",
    "com1",
    "com2",
    "com3",
    "com4",
    "com5",
    "com6",
    "com7",
    "com8",
    "com9",
    "lpt1",
    "lpt2",
    "lpt3",
    "lpt4",
    "lpt5",
    "lpt6",
    "lpt7",
    "lpt8",
    "lpt9",
  ]);

  const normalized = headingText.normalize("NFKC");
  const lowercased = normalized.toLowerCase();
  const filtered = lowercased.replace(/[^a-z0-9]/g, "-");
  const collapsed = filtered.replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "");
  const capped = trimmed.slice(0, 64);

  if (capped.length === 0 || reservedNames.has(capped)) {
    return "section";
  }

  return capped;
}
