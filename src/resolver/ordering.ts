/**
 * The sortable identity of a documentation file or folder.
 */
export interface OrderKey {
  /** Explicit sidebar position; entries with one sort before those without */
  sidebarPosition?: number;
  /** The file or folder's own name, used for prefix and tie-break comparisons */
  fileName: string;
  /** Full path relative to the docs root, used as the final tie-break */
  relativePath: string;
}

const numericPrefixPattern = /^(\d+)(?:[-_.]|$)/;

/**
 * Extract a leading numeric prefix from a file or folder name.
 *
 * @param fileName - The file or folder name to inspect
 * @returns The leading number, or undefined if the name has no numeric prefix
 *
 * @example
 * ```ts
 * numericPrefix("01-intro.md") // 1
 * numericPrefix("intro.md") // undefined
 * ```
 */
export function numericPrefix(fileName: string): number | undefined {
  const match = numericPrefixPattern.exec(fileName);

  if (match === null) {
    return undefined;
  }

  return Number(match[1]);
}

function compareCaseFolded(a: string, b: string): number {
  return a
    .toLowerCase()
    .localeCompare(b.toLowerCase(), "en", { numeric: false });
}

/**
 * Compare two documentation entries to produce a deterministic total order.
 *
 * Orders by explicit `sidebarPosition` first, then by numeric filename prefix,
 * then by case-folded `fileName`, and finally by case-folded `relativePath`.
 *
 * @param a - The first entry
 * @param b - The second entry
 * @returns A negative number if `a` sorts before `b`, positive if after, zero if equal
 */
export function compareDocOrder(a: OrderKey, b: OrderKey): number {
  if (a.sidebarPosition !== undefined && b.sidebarPosition !== undefined) {
    if (a.sidebarPosition !== b.sidebarPosition) {
      return a.sidebarPosition - b.sidebarPosition;
    }
  } else if (a.sidebarPosition !== undefined) {
    return -1;
  } else if (b.sidebarPosition !== undefined) {
    return 1;
  }

  const aPrefix = numericPrefix(a.fileName);
  const bPrefix = numericPrefix(b.fileName);

  if (aPrefix !== undefined && bPrefix !== undefined) {
    if (aPrefix !== bPrefix) {
      return aPrefix - bPrefix;
    }
  } else if (aPrefix !== undefined) {
    return -1;
  } else if (bPrefix !== undefined) {
    return 1;
  }

  const fileNameComparison = compareCaseFolded(a.fileName, b.fileName);

  if (fileNameComparison !== 0) {
    return fileNameComparison;
  }

  return compareCaseFolded(a.relativePath, b.relativePath);
}
