const importOrExportPattern = /^(?:import|export)\b/;
const admonitionClosePattern = /^:::$/;
const admonitionOpenPattern = /^:::(\S.*)$/;
const tabItemInlinePattern =
  /^<TabItem\s+label="([^"]*)"[^>]*>(.*)<\/TabItem>$/;
const tabItemOpenPattern = /^<TabItem\s+label="([^"]*)"[^>]*>$/;
const selfClosingTagPattern = /^<([A-Za-z][\w.-]*)(?:\s[^>]*)?\/>$/;
const openingTagPattern = /^<[A-Za-z][\w.-]*(?:\s[^>]*)?(?<!\/)>$/;
const closingTagPattern = /^<\/[A-Za-z][\w.-]*>$/;

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * Strip MDX-specific syntax from a document body, leaving plain Markdown.
 *
 * Processes the body line by line, leaving fenced code regions untouched.
 * Outside fences: import/export statements are dropped, `:::type` admonitions
 * become `**Type:**` labels, `<Tabs>`/`<TabItem>` blocks are flattened into
 * `**label:**` subsections, self-closing components become a visible
 * placeholder, and other paired tags are removed while keeping their
 * children.
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

    if (importOrExportPattern.test(trimmedLine)) {
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
      const [, label = "", content = ""] = tabItemInlineMatch;
      pushContent(`**${label}:**`);
      output.push("");
      output.push(content);
      pendingBlank = true;
      continue;
    }

    const tabItemOpenMatch = tabItemOpenPattern.exec(trimmedLine);
    if (tabItemOpenMatch) {
      const [, label = ""] = tabItemOpenMatch;
      pushContent(`**${label}:**`);
      continue;
    }

    const selfClosingMatch = selfClosingTagPattern.exec(trimmedLine);
    if (selfClosingMatch) {
      const [, componentName = ""] = selfClosingMatch;
      pushContent(`[unrendered component: ${componentName}]`);
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
