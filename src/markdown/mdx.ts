const importStatementPattern = /^import\s.*['"]/;
const exportStatementPattern =
  /^export\s+(?:default|const|let|var|function|async|class|\{)/;
const admonitionClosePattern = /^:::$/;
const admonitionOpenPattern = /^:::(\S.*)$/;
const tabItemInlinePattern = /^<TabItem\b([^>]*)>(.*)<\/TabItem>$/;
const tabItemOpenPattern = /^<TabItem\b([^>]*)>$/;
const tabItemClosePattern = /^<\/TabItem>$/;
const labelAttributePattern = /label=["']([^"']*)["']/;
const selfClosingTagPattern = /^<([A-Za-z][\w.-]*)(?:\s[^>]*)?\/>$/;
const inlinePairedTagPattern = /^<([A-Za-z][\w.-]*)(?:\s[^>]*)?>(.*)<\/\1>$/;
const openingTagPattern = /^<[A-Za-z][\w.-]*(?:\s[^>]*)?(?<!\/)>$/;
const closingTagPattern = /^<\/[A-Za-z][\w.-]*>$/;

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function extractLabel(attributes: string): string | undefined {
  const match = labelAttributePattern.exec(attributes);
  return match?.[1];
}

/**
 * Strip MDX-specific syntax from a document body, leaving plain Markdown.
 *
 * Processes the body line by line, leaving fenced code regions untouched.
 * Outside fences: lines that look like import/export statements (not prose
 * that merely starts with those words) are dropped; `:::type` admonitions
 * become `**Type:**` labels; `<Tabs>`/`<TabItem>` blocks are flattened into
 * `**label:**` subsections, with the label read from a `label` attribute in
 * any position or quote style and no heading emitted when it's absent;
 * self-closing components become a visible placeholder; and other paired
 * tags, whether split across lines or written inline on one line, are
 * removed while keeping their children.
 *
 * @param body - The document body, with frontmatter already removed
 * @returns The body with MDX syntax stripped
 *
 * @example
 * ```ts
 * stripMdx("import X from 'x';\n\nHello") // "Hello"
 * ```
 */
export function stripMdx(body: string): string {
  const lines = body.split("\n");
  const output: string[] = [];
  let insideFence = false;
  let hasContent = false;
  let pendingBlank = false;

  const pushContent = (text: string): void => {
    if (hasContent && pendingBlank) {
      output.push("");
    }
    output.push(text);
    hasContent = true;
    pendingBlank = false;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (insideFence) {
      output.push(line);
      if (trimmedLine.startsWith("```")) {
        insideFence = false;
      }
      continue;
    }

    if (trimmedLine.startsWith("```")) {
      pushContent(line);
      insideFence = true;
      continue;
    }

    if (trimmedLine === "") {
      pendingBlank = true;
      continue;
    }

    if (
      importStatementPattern.test(trimmedLine) ||
      exportStatementPattern.test(trimmedLine)
    ) {
      continue;
    }

    if (admonitionClosePattern.test(trimmedLine)) {
      continue;
    }

    const admonitionMatch = admonitionOpenPattern.exec(trimmedLine);
    if (admonitionMatch) {
      const [, rawType = ""] = admonitionMatch;
      pushContent(`**${capitalize(rawType.trim())}:**`);
      continue;
    }

    const tabItemInlineMatch = tabItemInlinePattern.exec(trimmedLine);
    if (tabItemInlineMatch) {
      const [, attributes = "", content = ""] = tabItemInlineMatch;
      const label = extractLabel(attributes);
      if (label !== undefined) {
        pushContent(`**${label}:**`);
        pendingBlank = true;
      }
      pushContent(content);
      pendingBlank = true;
      continue;
    }

    const tabItemOpenMatch = tabItemOpenPattern.exec(trimmedLine);
    if (tabItemOpenMatch) {
      const [, attributes = ""] = tabItemOpenMatch;
      const label = extractLabel(attributes);
      if (label !== undefined) {
        pushContent(`**${label}:**`);
        pendingBlank = true;
      }
      continue;
    }

    if (tabItemClosePattern.test(trimmedLine)) {
      pendingBlank = true;
      continue;
    }

    const selfClosingMatch = selfClosingTagPattern.exec(trimmedLine);
    if (selfClosingMatch) {
      const [, componentName = ""] = selfClosingMatch;
      pushContent(`[unrendered component: ${componentName}]`);
      continue;
    }

    const inlinePairedTagMatch = inlinePairedTagPattern.exec(trimmedLine);
    if (inlinePairedTagMatch) {
      const [, , innerContent = ""] = inlinePairedTagMatch;
      pushContent(innerContent);
      continue;
    }

    if (openingTagPattern.test(trimmedLine)) {
      continue;
    }

    if (closingTagPattern.test(trimmedLine)) {
      continue;
    }

    pushContent(line);
  }

  return output.join("\n");
}
