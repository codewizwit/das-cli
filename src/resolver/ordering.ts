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

function compareCaseFolded(firstValue: string, secondValue: string): number {
  return firstValue
    .toLowerCase()
    .localeCompare(secondValue.toLowerCase(), "en", { numeric: false });
}

function asFiniteOrUndefined(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
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
  const aPosition = asFiniteOrUndefined(a.sidebarPosition);
  const bPosition = asFiniteOrUndefined(b.sidebarPosition);

  if (aPosition !== undefined && bPosition !== undefined) {
    if (aPosition !== bPosition) {
      return aPosition - bPosition;
    }
  } else if (aPosition !== undefined) {
    return -1;
  } else if (bPosition !== undefined) {
    return 1;
  }

  const aPrefix = asFiniteOrUndefined(numericPrefix(a.fileName));
  const bPrefix = asFiniteOrUndefined(numericPrefix(b.fileName));

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
