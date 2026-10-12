import { firstSummary } from "./summary.js";
import type { DocNode } from "../types.js";

/** Longest description das will put on a single index entry. */
const maxDescriptionChars = 120;

/**
 * The authored description for a node, if its source declares one.
 *
 * This is the only tier das uses verbatim. Everything below it is derived.
 */
function authoredDescription(node: DocNode): string | undefined {
  const declared = node.source?.frontmatter.description?.trim();
  return declared === undefined || declared === "" ? undefined : declared;
}

/**
 * The node's first prose paragraph, which is what Docusaurus uses as a page's
 * default description when the page declares none.
 */
function firstParagraph(node: DocNode): string {
  return firstSummary(node.source?.content ?? node.body);
}

/**
 * The children worth naming for this node.
 *
 * A document whose only top-level heading repeats its own title describes
 * nothing by listing it, so descend through that wrapper to the sections
 * underneath. This is the frontmatter-title-equals-H1 case, which is the
 * common one.
 */
function listableChildren(node: DocNode): DocNode[] {
  const ownName = node.name.trim();
  let children = node.children;

  while (children.length === 1 && children[0]?.name.trim() === ownName) {
    children = children[0].children;
  }

  return children.filter((child) => child.name.trim() !== ownName);
}

/**
 * What this node contains, named in authored order.
 *
 * For a folder these are its subsections, so an agent reading the parent
 * index can tell which sub-index to open without opening any of them. For a
 * document these are its headings, which an agent cannot see any other way,
 * because a document is emitted whole and never split.
 *
 * Entries are taken in authored order until the budget is spent, never
 * selected by relevance: das orders nothing and ranks nothing. A truncated
 * list says so, so a reader can tell the remainder exists.
 */
function contentsListing(node: DocNode): string {
  const names = listableChildren(node)
    .map((child) => child.name.trim())
    .filter((name) => name !== "");

  if (names.length === 0) {
    return "";
  }

  const included: string[] = [];
  for (const name of names) {
    if ([...included, name].join(", ").length > maxDescriptionChars) {
      break;
    }
    included.push(name);
  }

  if (included.length === 0) {
    return "";
  }

  return included.length === names.length
    ? included.join(", ")
    : `${included.join(", ")}, and ${String(names.length - included.length)} more`;
}

function countOccurrences(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== "") {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Resolve one description per index entry, for a single index's entries.
 *
 * Tiers, each used only when the one above it is absent:
 *
 * 1. The authored `description` in the source's frontmatter.
 * 2. The first prose paragraph, **when it is unique among these siblings**. A
 *    paragraph two siblings share cannot help an agent choose between them,
 *    which is what a corpus whose pages open with the same boilerplate
 *    produces.
 * 3. What the node contains, from {@link contentsListing}, again only when
 *    it is unique among these siblings. Four documents with the same section
 *    structure produce one identical listing, which routes no better than the
 *    boilerplate paragraph above it.
 * 4. Nothing, which means the corpus holds nothing distinguishing this entry
 *    beyond its title. That is a gap for an author to fill, not a slot for
 *    das to pad.
 *
 * Uniqueness is scoped to one index because that is where the routing
 * decision happens: two entries an agent is choosing between need to differ
 * from each other, not from every entry in the skill. The comparison is exact,
 * so the result never depends on a similarity threshold.
 *
 * @param nodes - The entries of a single index, in the order they are listed
 * @returns One description per entry, positionally matching `nodes`
 */
export function resolveEntryDescriptions(nodes: DocNode[]): string[] {
  const paragraphs = nodes.map(firstParagraph);
  const listings = nodes.map(contentsListing);
  const paragraphCounts = countOccurrences(paragraphs);
  const listingCounts = countOccurrences(listings);

  return nodes.map((node, index) => {
    const authored = authoredDescription(node);
    if (authored !== undefined) {
      return authored;
    }

    const paragraph = paragraphs[index] ?? "";
    if (paragraph !== "" && paragraphCounts.get(paragraph) === 1) {
      return paragraph;
    }

    const listing = listings[index] ?? "";
    if (listing !== "" && listingCounts.get(listing) === 1) {
      return listing;
    }

    // Nothing in the corpus distinguishes this entry from its siblings
    // beyond its title, which the link text already carries. Saying nothing
    // is honest; the coverage gate reports the gap.
    return "";
  });
}
