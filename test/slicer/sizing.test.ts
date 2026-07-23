import { describe, expect, it } from "vitest";
import { sizeTree } from "../../src/slicer/sizing.js";
import { estimateTokens } from "../../src/markdown/tokens.js";
import type { DocNode } from "../../src/types.js";

describe("sizeTree", () => {
  it("leaf's subtreeTokens equals estimateTokens of its body", () => {
    const leaf: DocNode = {
      name: "leaf",
      body: "Hello world",
      children: [],
      subtreeTokens: 0,
    };

    const result = sizeTree(leaf);

    expect(result.subtreeTokens).toBe(estimateTokens("Hello world"));
  });

  it("parent's subtreeTokens equals estimateTokens of parent body plus sum of children subtreeTokens", () => {
    const child1: DocNode = {
      name: "child1",
      body: "Child one",
      children: [],
      subtreeTokens: 0,
    };
    const child2: DocNode = {
      name: "child2",
      body: "Child two",
      children: [],
      subtreeTokens: 0,
    };
    const parent: DocNode = {
      name: "parent",
      body: "Parent body",
      children: [child1, child2],
      subtreeTokens: 0,
    };

    const result = sizeTree(parent);

    const expectedSize =
      estimateTokens("Parent body") +
      estimateTokens("Child one") +
      estimateTokens("Child two");
    expect(result.subtreeTokens).toBe(expectedSize);
  });

  it("node with empty body and children has subtreeTokens equal to sum of children", () => {
    const child1: DocNode = {
      name: "child1",
      body: "Child one",
      children: [],
      subtreeTokens: 0,
    };
    const child2: DocNode = {
      name: "child2",
      body: "Child two",
      children: [],
      subtreeTokens: 0,
    };
    const parent: DocNode = {
      name: "parent",
      body: "",
      children: [child1, child2],
      subtreeTokens: 0,
    };

    const result = sizeTree(parent);

    const expectedSize =
      estimateTokens("Child one") + estimateTokens("Child two");
    expect(result.subtreeTokens).toBe(expectedSize);
  });

  it("three-level tree aggregates grandparent correctly", () => {
    const grandchild: DocNode = {
      name: "grandchild",
      body: "Grandchild body",
      children: [],
      subtreeTokens: 0,
    };
    const child: DocNode = {
      name: "child",
      body: "Child body",
      children: [grandchild],
      subtreeTokens: 0,
    };
    const grandparent: DocNode = {
      name: "grandparent",
      body: "Grandparent body",
      children: [child],
      subtreeTokens: 0,
    };

    const result = sizeTree(grandparent);

    const expectedSize =
      estimateTokens("Grandparent body") +
      estimateTokens("Child body") +
      estimateTokens("Grandchild body");
    expect(result.subtreeTokens).toBe(expectedSize);
  });

  it("returns a new tree, leaving input untouched", () => {
    const leaf: DocNode = {
      name: "leaf",
      body: "Leaf body",
      children: [],
      subtreeTokens: 0,
    };
    const parent: DocNode = {
      name: "parent",
      body: "Parent body",
      children: [leaf],
      subtreeTokens: 0,
    };

    const result = sizeTree(parent);

    expect(result).not.toBe(parent);
    expect(result.children[0]).not.toBe(leaf);
    expect(parent.subtreeTokens).toBe(0);
    expect(leaf.subtreeTokens).toBe(0);
  });
});
