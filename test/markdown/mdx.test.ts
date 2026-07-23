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
});
