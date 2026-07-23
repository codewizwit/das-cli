/** Parsed YAML frontmatter fields recognized by DAS. */
export interface Frontmatter {
  /** Document title, if declared in frontmatter. */
  title?: string;
  /** Explicit ordering hint used by {@link https://docusaurus.io | Docusaurus}-style sidebars. */
  sidebarPosition?: number;
  /** When true, the document is excluded from the generated skill. */
  draft?: boolean;
}

/** A single Markdown source file with its frontmatter separated from its body. */
export interface DocFile {
  /** Path relative to the resolved source root, using forward slashes. */
  relativePath: string;
  /** Document body with frontmatter removed. */
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
