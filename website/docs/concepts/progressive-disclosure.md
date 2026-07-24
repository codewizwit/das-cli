---
id: progressive-disclosure
title: Progressive disclosure and the token budget
---

# Progressive disclosure and the token budget

A skill `das add` generates from a multi-file docs source:

```
widget-sdk/
  SKILL.md                    (table of contents, always loaded)
  das.json                    (ownership record)
  resources/
    api-reference.md
    getting-started.md
    guide-1.md
    guide-2.md
    guide-3.md
```

`SKILL.md`'s table of contents, captured from a real `das add` run:

```markdown
- [API Reference](resources/api-reference.md)
- [Getting Started](resources/getting-started.md) — Install the widget SDK and run your first request.
- [Guide 1](resources/guide-1.md) — This is a longer walkthrough covering setup, configuration...
- [Guide 2](resources/guide-2.md) — This is a longer walkthrough covering authentication, deployment...
- [Guide 3](resources/guide-3.md) — This is a longer walkthrough covering monitoring, alerting...
```

Claude Code loads `SKILL.md` first, every session. It only opens a `resources/*.md` file when the question actually needs that section. This is the difference from grepping a docs repo directly: a search either dumps far more text than a session's budget can hold, or misses the section that answers the question because it never had a table of contents to search from.

## How a subtree becomes one file or an index

Every node in the parsed heading tree is decided the same way: does the whole subtree fit inside the **token budget** (`--token-budget`, default 4000 tokens per file)?

- **Fits** → inlined as one file. A leaf becomes one resource file; the whole doc set can become a single `SKILL.md` if it's small enough.
- **Doesn't fit** → emitted as an index: a short intro plus a linked table of contents, and each child gets the same decision recursively.

An oversized table of contents (too many entries to list within budget) is chunked into grouped index files instead of silently truncated. The full decision tree, including that grouping fallback, is diagrammed in [Skill-tree emission](/docs/architecture#skill-tree-emission).

## Why this beats a single flat file

A docs source with a hundred pages does not fit in one context window, and pasting all of it wastes budget on sections the current question never touches. Slicing bottom-up keeps every emitted file inside budget except a genuinely irreducible leaf or table of contents, which is emitted whole and flagged as a warning rather than truncated. See [`das add`](/docs/commands/add) for the flags that control this (`--token-budget`, `--include-large`).
