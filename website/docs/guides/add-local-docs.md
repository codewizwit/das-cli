---
id: add-local-docs
title: Add a local docs folder
---

# Add a local docs folder

```bash
das add ./docs --scope project --yes
```

`das add` accepts a Markdown file, a docs folder, or a project root, in addition to a GitHub URL. `--scope project` puts the skill in `<project>/.claude/skills` so it's committed alongside the code; `--scope personal` puts it in `~/.claude/skills` for skills you want available everywhere.

A local source is re-hashed on every `SessionStart`; a changed hash triggers an automatic re-slice with no confirmation needed, since nothing left your machine. See [Pin-and-check refresh](/docs/concepts/refresh-and-freshness) for the full flow, and [When das beats grep](/docs/concepts/remote-vs-local) for when a small `docs/` folder doesn't need this at all.
