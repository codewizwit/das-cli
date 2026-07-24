---
id: remote-vs-local
title: When das beats grep
---

# When das beats grep

```bash
das add https://github.com/prisma/docs
```

One command turns a library's documentation into a fresh, local skill Claude Code can navigate, without cloning it yourself or writing an adapter.

`das` earns its keep in three situations:

- **Remote sources.** Any GitHub repository's documentation becomes a local, versioned skill without a manual clone.
- **Oversized docs.** A `docs/` folder too large to load in one shot needs slicing into a navigable tree; see [Progressive disclosure](/docs/concepts/progressive-disclosure).
- **MDX-heavy sources.** Docusaurus, Starlight, and similar sites carry frontmatter, tabs, and admonitions that plain Markdown ingestion mangles; `das` parses them.

## When you don't need it

If your project already has a small `docs/` folder, a one-line pointer in your `CLAUDE.md` ("see `docs/` for API reference") is often enough for a docs set that already fits comfortably in context. `das` is for the case plain grep cannot reach: a normal docs search either dumps far more text than a session's budget can hold, or misses the section that answers the question because it never had a table of contents to search from.

Your documentation site (Docusaurus, MkDocs, Starlight, or plain Markdown) stays the human-facing source of truth. `das` makes the same source legible to Claude Code without duplicating it by hand. See [Add a remote library's docs](/docs/guides/add-a-remote-library) and [Add a local docs folder](/docs/guides/add-local-docs) for the two starting points.
