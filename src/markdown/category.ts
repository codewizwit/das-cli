import matter from "gray-matter";

/** File names Docusaurus recognises as a folder's category metadata. */
const categoryFileNamePattern = /^_category_\.(json|ya?ml)$/i;

/**
 * Authored metadata a folder declares about itself.
 *
 * Docusaurus reads these from `_category_.json` or `_category_.yml` beside a
 * folder's contents. They are the only authored description a folder has when
 * it carries no landing page, so das reads them rather than falling back to a
 * humanized directory name.
 */
export interface CategoryMeta {
  /** Display name for the folder. */
  label?: string;
  /** Authored sidebar position, which is also das's index ordering. */
  position?: number;
  /** Authored one-line summary of what the folder holds. */
  description?: string;
  /** Authored keywords, a synonym source for the folder's index entry. */
  keywords?: string[];
}

/** True when this file name is a folder's category metadata. */
export function isCategoryFileName(fileName: string): boolean {
  return categoryFileNamePattern.test(fileName);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return entries.length === 0 ? undefined : entries;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Parse a folder's category metadata, from JSON or YAML.
 *
 * Returns an empty object rather than throwing on malformed input: a folder
 * with a broken category file falls back to the tiers below it, which is the
 * same outcome as having no category file, and a documentation source should
 * never be able to fail a `das` run by being malformed.
 *
 * YAML is parsed by handing it to gray-matter as a frontmatter block, which
 * is the YAML parser already in this project's dependencies.
 *
 * @param raw - The file's contents
 * @param fileName - The file's name, which decides JSON or YAML
 * @returns The recognised fields, or an empty object
 *
 * @example
 * ```ts
 * parseCategoryMeta('{"label":"Tutorial","position":2}', "_category_.json")
 * // { label: "Tutorial", position: 2 }
 * ```
 */
export function parseCategoryMeta(
  raw: string,
  fileName: string,
): CategoryMeta {
  let data: Record<string, unknown>;

  try {
    data = fileName.toLowerCase().endsWith(".json")
      ? asRecord(JSON.parse(raw))
      : asRecord(matter(`---\n${raw}\n---\n`).data);
  } catch {
    return {};
  }

  const link = asRecord(data.link);
  const customProps = asRecord(data.customProps);

  const label = readString(data.label) ?? readString(link.title);
  const position = readNumber(data.position);
  const description =
    readString(link.description) ?? readString(customProps.description);
  const keywords =
    readStrings(link.keywords) ?? readStrings(data.keywords);

  return {
    ...(label !== undefined ? { label } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
  };
}
