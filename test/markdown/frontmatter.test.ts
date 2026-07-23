import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../src/markdown/frontmatter.js";

describe("parseFrontmatter", () => {
  it("extracts title, sidebar_position, draft", () => {
    const raw =
      "---\ntitle: Intro\nsidebar_position: 2\ndraft: true\n---\nBody";
    const parsed = parseFrontmatter(raw);
    expect(parsed.frontmatter).toEqual({
      title: "Intro",
      sidebarPosition: 2,
      draft: true,
    });
    expect(parsed.body).toBe("Body");
  });

  it("accepts float and negative positions", () => {
    expect(
      parseFrontmatter("---\nsidebar_position: 1.5\n---\n").frontmatter
        .sidebarPosition,
    ).toBe(1.5);
    expect(
      parseFrontmatter("---\nsidebar_position: -3\n---\n").frontmatter
        .sidebarPosition,
    ).toBe(-3);
  });

  it("maps Starlight's nested sidebar.order to sidebarPosition", () => {
    const raw = "---\nsidebar:\n  order: 3\n---\nBody";
    expect(parseFrontmatter(raw).frontmatter.sidebarPosition).toBe(3);
  });

  it("returns an empty frontmatter object when none of the recognized fields are present", () => {
    expect(
      parseFrontmatter("---\nunrelated: yes\n---\nBody").frontmatter,
    ).toEqual({});
  });
});
