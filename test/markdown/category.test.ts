import { describe, expect, it } from "vitest";
import {
  isCategoryFileName,
  parseCategoryMeta,
} from "../../src/markdown/category.js";

describe("isCategoryFileName", () => {
  it("recognises the names Docusaurus uses, case-insensitively", () => {
    expect(isCategoryFileName("_category_.json")).toBe(true);
    expect(isCategoryFileName("_category_.yml")).toBe(true);
    expect(isCategoryFileName("_category_.yaml")).toBe(true);
    expect(isCategoryFileName("_CATEGORY_.JSON")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isCategoryFileName("category.json")).toBe(false);
    expect(isCategoryFileName("_category_.md")).toBe(false);
    expect(isCategoryFileName("_category_.json.bak")).toBe(false);
  });
});

describe("parseCategoryMeta", () => {
  it("reads label and position from JSON", () => {
    const meta = parseCategoryMeta(
      '{"label":"Tutorial","position":2.5}',
      "_category_.json",
    );

    expect(meta).toEqual({ label: "Tutorial", position: 2.5 });
  });

  it("reads a generated-index link's title, description and keywords", () => {
    const meta = parseCategoryMeta(
      JSON.stringify({
        link: {
          type: "generated-index",
          title: "Tutorial overview",
          description: "Everything needed to ship a first change.",
          keywords: ["onboarding", "setup"],
        },
      }),
      "_category_.json",
    );

    expect(meta).toEqual({
      label: "Tutorial overview",
      description: "Everything needed to ship a first change.",
      keywords: ["onboarding", "setup"],
    });
  });

  it("prefers label over link.title, and link.description over customProps", () => {
    const meta = parseCategoryMeta(
      JSON.stringify({
        label: "Tutorial",
        link: { title: "Ignored", description: "From link." },
        customProps: { description: "From customProps." },
      }),
      "_category_.json",
    );

    expect(meta.label).toBe("Tutorial");
    expect(meta.description).toBe("From link.");
  });

  it("falls back to customProps.description, Docusaurus's documented idiom", () => {
    const meta = parseCategoryMeta(
      JSON.stringify({
        label: "Tutorial",
        customProps: { description: "From customProps." },
      }),
      "_category_.json",
    );

    expect(meta.description).toBe("From customProps.");
  });

  it("reads YAML the same way", () => {
    const meta = parseCategoryMeta(
      ["label: Tutorial", "position: 3", "link:", "  description: Via YAML."].join(
        "\n",
      ),
      "_category_.yml",
    );

    expect(meta).toEqual({
      label: "Tutorial",
      position: 3,
      description: "Via YAML.",
    });
  });

  it("returns nothing for malformed input rather than throwing", () => {
    expect(parseCategoryMeta("{not json", "_category_.json")).toEqual({});
    expect(parseCategoryMeta("", "_category_.json")).toEqual({});
    expect(parseCategoryMeta("[1,2,3]", "_category_.json")).toEqual({});
  });

  it("drops fields of the wrong type instead of coercing them", () => {
    const meta = parseCategoryMeta(
      JSON.stringify({
        label: 42,
        position: "first",
        link: { description: ["a", "b"], keywords: "onboarding" },
      }),
      "_category_.json",
    );

    expect(meta).toEqual({});
  });
});
