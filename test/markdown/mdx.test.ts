import { describe, expect, it } from "vitest";
import { stripMdx } from "../../src/markdown/mdx.js";

describe("stripMdx", () => {
  it("removes import and export statements", () => {
    expect(stripMdx("import X from 'x';\n\nHello")).toBe("Hello");
  });

  it("removes export statements", () => {
    expect(stripMdx("export const x = 1;\n\nHello")).toBe("Hello");
  });

  it("keeps fenced code verbatim even when it contains JSX", () => {
    const fenced = "```jsx\n<Widget/>\n```";
    expect(stripMdx(fenced)).toBe(fenced);
  });

  it("flattens Tabs into labeled subsections", () => {
    const tabs =
      '<Tabs>\n<TabItem label="npm">npm i</TabItem>\n<TabItem label="pnpm">pnpm add</TabItem>\n</Tabs>';
    expect(stripMdx(tabs)).toBe("**npm:**\n\nnpm i\n\n**pnpm:**\n\npnpm add");
  });

  it("replaces self-closing components with a visible placeholder", () => {
    expect(stripMdx("<ApiTable data={x}/>")).toBe(
      "[unrendered component: ApiTable]",
    );
  });

  it("converts admonitions to bold labels", () => {
    expect(stripMdx(":::danger\nDeletes data\n:::")).toBe(
      "**Danger:**\nDeletes data",
    );
  });

  it("removes paired tags keeping children", () => {
    expect(stripMdx("<Card>\nInner\n</Card>")).toBe("Inner");
  });

  it("extracts the TabItem label regardless of attribute order", () => {
    const result = stripMdx('<TabItem value="npm" label="npm">npm i</TabItem>');
    expect(result).toBe("**npm:**\n\nnpm i");
    expect(result).not.toContain("<TabItem");
  });

  it("extracts the TabItem label with single quotes", () => {
    const result = stripMdx(
      "<TabItem value='pnpm' label='pnpm'>pnpm add</TabItem>",
    );
    expect(result).toBe("**pnpm:**\n\npnpm add");
  });

  it("flattens multi-line TabItem blocks with the same spacing as the inline form", () => {
    const tabs =
      '<Tabs>\n<TabItem value="npm" label="npm">\nnpm i\n</TabItem>\n<TabItem value="pnpm" label="pnpm">\npnpm add\n</TabItem>\n</Tabs>';
    expect(stripMdx(tabs)).toBe("**npm:**\n\nnpm i\n\n**pnpm:**\n\npnpm add");
  });

  it("strips same-line paired tags keeping inline children", () => {
    expect(stripMdx("<Card>Inner</Card>")).toBe("Inner");
  });

  it("does not treat prose beginning with import/export as a statement", () => {
    const prose = "You can\nimport this module for extra features.";
    expect(stripMdx(prose)).toBe(prose);
  });

  it("still drops a genuine import statement", () => {
    expect(stripMdx("import X from 'x';\n\nHello")).toBe("Hello");
  });

  it("still drops a genuine export statement", () => {
    expect(stripMdx("export default Foo\n\nHello")).toBe("Hello");
  });
});
