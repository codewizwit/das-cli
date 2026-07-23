import { describe, expect, it } from "vitest";
import {
  compareDocOrder,
  numericPrefix,
  type OrderKey,
} from "../../src/resolver/ordering.js";

describe("numericPrefix", () => {
  it("reads a dash-separated leading number", () => {
    expect(numericPrefix("10-x.md")).toBe(10);
  });

  it("reads an underscore-separated leading number", () => {
    expect(numericPrefix("01_setup.md")).toBe(1);
  });

  it("reads a dot-separated leading number", () => {
    expect(numericPrefix("2.overview.md")).toBe(2);
  });

  it("reads a bare leading number with no trailing separator", () => {
    expect(numericPrefix("10.md")).toBe(10);
  });

  it("returns undefined when the filename has no leading number", () => {
    expect(numericPrefix("intro.md")).toBeUndefined();
  });

  it("reads a leading zero as 0, not as absent", () => {
    expect(numericPrefix("0-intro.md")).toBe(0);
  });
});

describe("compareDocOrder", () => {
  it("sorts an entry with a sidebarPosition before one without", () => {
    const positioned: OrderKey = {
      sidebarPosition: 5,
      fileName: "z.md",
      relativePath: "z.md",
    };
    const unpositioned: OrderKey = {
      fileName: "a.md",
      relativePath: "a.md",
    };

    expect(compareDocOrder(positioned, unpositioned)).toBeLessThan(0);
    expect(compareDocOrder(unpositioned, positioned)).toBeGreaterThan(0);
  });

  it("sorts a fractional sidebarPosition between its neighboring integers", () => {
    const one: OrderKey = {
      sidebarPosition: 1,
      fileName: "a.md",
      relativePath: "a.md",
    };
    const oneAndAHalf: OrderKey = {
      sidebarPosition: 1.5,
      fileName: "b.md",
      relativePath: "b.md",
    };
    const two: OrderKey = {
      sidebarPosition: 2,
      fileName: "c.md",
      relativePath: "c.md",
    };

    const sorted = [two, oneAndAHalf, one].sort(compareDocOrder);

    expect(sorted).toEqual([one, oneAndAHalf, two]);
  });

  it("sorts unpositioned entries by their numeric filename prefix", () => {
    const introFirst: OrderKey = {
      fileName: "01-intro.md",
      relativePath: "01-intro.md",
    };
    const setupSecond: OrderKey = {
      fileName: "02-setup.md",
      relativePath: "02-setup.md",
    };

    expect(compareDocOrder(setupSecond, introFirst)).toBeGreaterThan(0);
    expect(compareDocOrder(introFirst, setupSecond)).toBeLessThan(0);
  });

  it("breaks ties on case-folded filename using the en locale", () => {
    const upper: OrderKey = {
      fileName: "Banana.md",
      relativePath: "Banana.md",
    };
    const lower: OrderKey = {
      fileName: "apple.md",
      relativePath: "apple.md",
    };

    expect(compareDocOrder(lower, upper)).toBeLessThan(0);
    expect(compareDocOrder(upper, lower)).toBeGreaterThan(0);
  });

  it("falls back to relativePath when every other key is equal", () => {
    const nested: OrderKey = {
      fileName: "readme.md",
      relativePath: "b/readme.md",
    };
    const shallow: OrderKey = {
      fileName: "readme.md",
      relativePath: "a/readme.md",
    };

    expect(compareDocOrder(shallow, nested)).toBeLessThan(0);
    expect(compareDocOrder(nested, shallow)).toBeGreaterThan(0);
  });

  it("returns 0 when every key, including relativePath, is identical", () => {
    const first: OrderKey = {
      fileName: "readme.md",
      relativePath: "readme.md",
    };
    const second: OrderKey = {
      fileName: "readme.md",
      relativePath: "readme.md",
    };

    expect(compareDocOrder(first, second)).toBe(0);
  });

  it("treats a NaN sidebarPosition as absent, same as undefined", () => {
    const nanPositioned: OrderKey = {
      sidebarPosition: NaN,
      fileName: "z.md",
      relativePath: "z.md",
    };
    const positioned: OrderKey = {
      sidebarPosition: 1,
      fileName: "a.md",
      relativePath: "a.md",
    };

    expect(compareDocOrder(positioned, nanPositioned)).toBeLessThan(0);
    expect(compareDocOrder(nanPositioned, positioned)).toBeGreaterThan(0);
  });

  it("falls through to later keys when both sidebarPositions are NaN, returning a finite result", () => {
    const first: OrderKey = {
      sidebarPosition: NaN,
      fileName: "a.md",
      relativePath: "a.md",
    };
    const second: OrderKey = {
      sidebarPosition: NaN,
      fileName: "b.md",
      relativePath: "b.md",
    };

    expect(Number.isFinite(compareDocOrder(first, second))).toBe(true);
    expect(compareDocOrder(first, second)).toBeLessThan(0);
  });

  it("treats a zero sidebarPosition as present, sorting before an unpositioned entry", () => {
    const zeroPositioned: OrderKey = {
      sidebarPosition: 0,
      fileName: "z.md",
      relativePath: "z.md",
    };
    const unpositioned: OrderKey = {
      fileName: "a.md",
      relativePath: "a.md",
    };

    expect(compareDocOrder(zeroPositioned, unpositioned)).toBeLessThan(0);
  });

  it("orders numeric filename prefixes by value, not lexically", () => {
    const nine: OrderKey = { fileName: "9-x.md", relativePath: "9-x.md" };
    const ten: OrderKey = { fileName: "10-x.md", relativePath: "10-x.md" };

    expect(compareDocOrder(nine, ten)).toBeLessThan(0);
  });

  it("orders three entries with positioned, prefix-only, and neither keys transitively", () => {
    const positioned: OrderKey = {
      sidebarPosition: 1,
      fileName: "z.md",
      relativePath: "z.md",
    };
    const prefixOnly: OrderKey = {
      fileName: "01-intro.md",
      relativePath: "01-intro.md",
    };
    const neither: OrderKey = {
      fileName: "readme.md",
      relativePath: "readme.md",
    };

    const sorted = [neither, prefixOnly, positioned].sort(compareDocOrder);

    expect(sorted).toEqual([positioned, prefixOnly, neither]);
  });

  it("orders folders using the same keys with no special casing", () => {
    const guidesFolder: OrderKey = {
      sidebarPosition: 1,
      fileName: "guides",
      relativePath: "guides",
    };
    const referenceFolder: OrderKey = {
      fileName: "reference",
      relativePath: "reference",
    };
    const readmeFile: OrderKey = {
      fileName: "readme.md",
      relativePath: "readme.md",
    };

    const sorted = [readmeFile, referenceFolder, guidesFolder].sort(
      compareDocOrder,
    );

    expect(sorted).toEqual([guidesFolder, readmeFile, referenceFolder]);
  });
});
