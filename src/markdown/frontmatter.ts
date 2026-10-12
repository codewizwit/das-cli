import matter from "gray-matter";
import type { Frontmatter } from "../types.js";

/** The result of separating YAML frontmatter from a Markdown document's body. */
export interface ParsedFrontmatter {
  /** Recognized frontmatter fields, or an empty object when none are present. */
  frontmatter: Frontmatter;
  /** Document content with the frontmatter block removed. */
  body: string;
}

function readStringField(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

function readBooleanField(
  data: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = data[key];
  return typeof value === "boolean" ? value : undefined;
}

function readNumberField(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = data[key];
  return typeof value === "number" ? value : undefined;
}

function readSidebarPosition(
  data: Record<string, unknown>,
): number | undefined {
  const direct = readNumberField(data, "sidebar_position");
  if (direct !== undefined) {
    return direct;
  }

  const sidebar = data.sidebar;
  if (typeof sidebar === "object" && sidebar !== null) {
    return readNumberField(sidebar as Record<string, unknown>, "order");
  }

  return undefined;
}

/**
 * Parse YAML frontmatter from a Markdown or MDX document.
 *
 * Recognizes `title` and `draft`, and maps `sidebar_position` (Docusaurus)
 * or the nested `sidebar.order` (Starlight) to `sidebarPosition`. When both
 * are present, `sidebar_position` takes precedence.
 *
 * @param raw - The full document source, including any frontmatter block
 * @returns The recognized frontmatter fields and the body with frontmatter removed
 *
 * @example
 * ```ts
 * const { frontmatter, body } = parseFrontmatter("---\ntitle: Intro\n---\nBody");
 * ```
 */
/**
 * Read a field that is authored either as a YAML list or a single string.
 *
 * Docusaurus accepts both for `keywords` and `tags`, so both are kept.
 * Entries that are not strings are dropped rather than coerced.
 */
function readStringArrayField(
  data: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = data[key];

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : [trimmed];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  return entries.length === 0 ? undefined : entries;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;

  const title = readStringField(data, "title");
  const draft = readBooleanField(data, "draft");
  const sidebarPosition = readSidebarPosition(data);
  const description = readStringField(data, "description");
  const keywords = readStringArrayField(data, "keywords");
  const tags = readStringArrayField(data, "tags");

  const frontmatter: Frontmatter = {
    ...(title !== undefined ? { title } : {}),
    ...(sidebarPosition !== undefined ? { sidebarPosition } : {}),
    ...(draft !== undefined ? { draft } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
    ...(tags !== undefined ? { tags } : {}),
  };

  return { frontmatter, body: parsed.content };
}
