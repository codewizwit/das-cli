/** Parsed YAML frontmatter fields recognized by DAS. */
export interface Frontmatter {
  /** Document title, if declared in frontmatter. */
  title?: string;
  /** Explicit ordering hint used by {@link https://docusaurus.io | Docusaurus}-style sidebars. */
  sidebarPosition?: number;
  /** When true, the document is excluded from the generated skill. */
  draft?: boolean;
  /**
   * Authored one-line summary, used verbatim as this document's index entry.
   *
   * Preferred over anything das derives. Docusaurus defines the default for
   * this field as the first line of Markdown content, which is the fallback
   * das applies when it is absent.
   */
  description?: string;
  /** Authored search keywords, a synonym source for an index entry. */
  keywords?: string[];
  /** Authored tags, a synonym source for an index entry. */
  tags?: string[];
}

/**
 * File name das gives every generated index.
 *
 * Deliberately a name no documentation corpus uses, so a generated index can
 * never collide with a source file and every emitted resource stays byte
 * identical to its source. The leading underscore also keeps Docusaurus from
 * routing it if a generated skill ever lives inside a docs site.
 */
export const GENERATED_INDEX_FILE_NAME = "_das-index.md";

/** A single Markdown source file with its frontmatter separated from its body. */
export interface DocFile {
  /** Path relative to the resolved source root, using forward slashes. */
  relativePath: string;
  /**
   * The entire source file exactly as read, frontmatter included.
   *
   * This is what gets emitted as a resource and what the source hash covers,
   * so it must never be rewritten. MDX syntax is left intact.
   */
  raw: string;
  /**
   * Document body with frontmatter removed and MDX syntax stripped.
   *
   * This is what the slicer reads to build the tree. It is a derivative, so
   * nothing that must match the source byte for byte may be built from it.
   */
  content: string;
  /** Frontmatter parsed from the file, or an empty object when absent. */
  frontmatter: Frontmatter;
}

/** Where documentation was resolved from: a GitHub repository or a local path. */
export type SourceRef =
  | { type: "github"; url: string; subpath: string | null }
  | { type: "path"; path: string; kind: "file" | "folder" | "project" };

/** A node in the normalized documentation tree, sized for emission planning. */
export interface DocNode {
  /** Node name, used as the file or folder name when emitted. */
  name: string;
  /** Markdown body belonging directly to this node. */
  body: string;
  /** Child nodes, in document order. */
  children: DocNode[];
  /** Estimated token count of this node's body plus all descendants. */
  subtreeTokens: number;
  /**
   * The source file this node was built from, set only on file nodes.
   *
   * Its presence marks a node as a resource: the emitter writes
   * {@link DocFile.raw} verbatim instead of rendering the node.
   */
  source?: DocFile;
  /**
   * A folder's own landing page, its `index.md` or `README.md`, when it has
   * one. Set only on folder nodes.
   *
   * Read for the folder's display name and description. The page itself is
   * still emitted as an ordinary resource at its own path and still appears
   * as an entry in the folder's listing, so nothing here affects what is
   * written where.
   */
  landing?: DocFile;
  /**
   * Final path segment of the source folder, set only on folder nodes.
   *
   * Emitted paths mirror the source tree, so the segment is the path and
   * never a slug derived from a display name.
   */
  segment?: string;
}

/** A single file to be written by the emitter. */
export interface EmitFile {
  /** Path relative to the skill directory, using forward slashes. */
  relativePath: string;
  /** Full file contents. */
  content: string;
}

/** The complete set of files to emit for a skill, plus any sizing warnings. */
export interface SkillPlan {
  /** All files to write for this skill. */
  files: EmitFile[];
  /** Relative paths of leaves that exceed the token budget and were emitted whole. */
  oversized: string[];
}
