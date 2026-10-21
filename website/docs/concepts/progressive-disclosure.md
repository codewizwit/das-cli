---
id: progressive-disclosure
title: Progressive disclosure and the token budget
---

# Progressive disclosure and the token budget

A skill `das add` generates from a multi-file docs source, captured from a real run against
this repository's `demo/sample-docs`:

```
sample-docs/
  SKILL.md                              (routing rule and root index, always loaded)
  das.json                              (ownership record)
  resources/
    README.md                           (the source's own landing page, byte for byte)
    architecture/
      _das-index.md                     (generated index for this folder)
      data-model.md                     (source bytes, at the source path)
      events.md
      multi-region.md
      overview.md
    engineering/
      _das-index.md
      code-review.md
      ...
```

**`resources/` mirrors the source tree and every file in it is a byte copy.** das owns the
indexes and nothing else, so the path an agent guesses is the path the documentation
actually has, and a grep over `resources/` is a grep over the original. The generated index
is named `_das-index.md` so a folder that already has its own `index.md` keeps it.

`SKILL.md`, from the same run:

```markdown
---
name: "sample-docs"
description: "Use for questions about architecture, engineering, onboarding, runbooks, security, services."
---

## Using this skill

`resources/` holds the unmodified source documentation at its original paths.

- If the answer contains a distinctive term you can name, grep `resources/` for it.
- If you know roughly where it lives, open that path directly. The tree mirrors the source.
- Otherwise descend the indexes. Each lists what is one level down, with a description of
  each entry; entries linking to `_das-index.md` are further indexes.

## Contents

- [Acme Engineering Handbook](resources/README.md) — The single source of truth for how Acme builds and runs software. Start with onboarding, then read the architecture
- [architecture](resources/architecture/_das-index.md) — Data Model; Event Bus; Multi-Region; Architecture Overview
- [engineering](resources/engineering/_das-index.md) — Code Review; Git Workflow; Style Guide; Testing Strategy
- [onboarding](resources/onboarding/_das-index.md) — Accounts and Access; Your First Week; Local Tooling; Welcome
```

Three things in that file do work.

**The routing rule.** `SKILL.md` says how to use the tree, including that grep is still
available. The index is additive, so an agent that ignores it falls back to the path that
already worked.

**Entry descriptions.** An entry's text comes from the target's authored `description`
frontmatter when it has one, and falls back to the subsection names otherwise. The folders
above fall back, because `demo/sample-docs` carries no frontmatter. On a corpus that does,
every entry reads as a sentence its author wrote. That difference is measurable: the same
corpus went from 8 of 98 authored descriptions reaching the index to 98 of 98, and
[the evaluation](/docs/evaluation) traces the retrieval-cost result to it.

**The untrusted-content frame** sits on sliced documentation, not on the generated index,
because the index is the one part of the output meant to be acted on. See
[Security](/docs/security).

Claude Code loads `SKILL.md` first, every session, and opens a resource only when the
question needs it.

## How a subtree becomes one file or an index

Every node in the parsed tree is decided the same way: does the whole subtree fit inside
the **token budget** (`--token-budget`, default 4000 tokens per file)?

- **Fits** → no index is needed for it.
- **Doesn't fit** → a `_das-index.md` is emitted with a linked table of contents, and each
  child gets the same decision recursively.

The budget is an estimate, not a tokenizer count: prose is counted at 4 characters per
token and fenced code at 3. An oversized table of contents is chunked into grouped index
files instead of silently truncated. The full decision tree, including that grouping
fallback, is diagrammed in [Skill-tree emission](/docs/architecture#skill-tree-emission).

## Why this beats loading the whole set

A docs source with a hundred pages does not fit in one context window, and loading all of
it spends budget on sections the current question never touches. Measured on a 98-file
corpus, descending the index answered a question with a median of 1,453 documentation
tokens, which is 1.4% of the corpus, against 2,610 for searching the raw files. Numbers,
method and limits are in [the evaluation](/docs/evaluation).

See [`das add`](/docs/commands/add) for the flags that control this (`--token-budget`,
`--include-large`).
