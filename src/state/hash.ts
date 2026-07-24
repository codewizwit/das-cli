import { createHash } from "node:crypto";
import type { DocFile } from "../types.js";

/** Generation parameters that participate in the fileset hash so a settings change forces regeneration. */
export interface HashParams {
  slicerVersion: number;
  tokenBudget: number;
  includeLarge: boolean;
}

function appendLengthPrefixedField(
  hash: ReturnType<typeof createHash>,
  field: string,
): void {
  const bytes = Buffer.from(field, "utf-8");
  const lengthHeader = Buffer.alloc(4);
  lengthHeader.writeUInt32BE(bytes.length, 0);
  hash.update(lengthHeader);
  hash.update(bytes);
}

/**
 * Compute a deterministic, order-independent digest of a documentation fileset and its
 * generation parameters.
 *
 * Files with distinct relative paths are sorted by relative path before hashing, so the same set
 * in any order yields the same digest; two entries sharing a relative path (a degenerate input the
 * upstream resolver does not produce) are left in their given order. Every field is length-prefixed
 * before being fed to the hash, using its UTF-8 byte length, so no combination of path and content
 * bytes can collide with a different combination across a field boundary.
 * The digest changes whenever any file's path or content changes, or when any generation
 * parameter changes, which is what lets refresh skip regeneration only when nothing that affects
 * the output has changed.
 *
 * @param files - The resolved documentation fileset
 * @param params - Generation parameters that must invalidate the hash when changed
 * @returns A digest of the form `sha256:` followed by 64 lowercase hex characters
 */
export function hashFileset(files: DocFile[], params: HashParams): string {
  const sortedFiles = [...files].sort((first, second) =>
    first.relativePath < second.relativePath
      ? -1
      : first.relativePath > second.relativePath
        ? 1
        : 0,
  );

  const hash = createHash("sha256");

  for (const file of sortedFiles) {
    appendLengthPrefixedField(hash, file.relativePath);
    appendLengthPrefixedField(hash, file.content);
  }

  appendLengthPrefixedField(hash, String(params.slicerVersion));
  appendLengthPrefixedField(hash, String(params.tokenBudget));
  appendLengthPrefixedField(hash, String(params.includeLarge));

  return `sha256:${hash.digest("hex")}`;
}
