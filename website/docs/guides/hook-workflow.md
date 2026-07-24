---
id: hook-workflow
title: The hook workflow
---

# The hook workflow

```bash
das hook install
```

This installs the `SessionStart` hook (`das refresh --hook`) into your personal Claude Code settings. From then on, every new session runs a bounded check: local skills get re-hashed and re-sliced on a change, remote skills get a read-only `git ls-remote`, and anything with an available update prints one line telling you what to run.

Install it for the whole project instead, so every collaborator who checks the project out gets the same hook:

```bash
das hook install --project
```

This writes to the project's committed `.claude/settings.json`, so it requires confirmation (`--yes` to skip it) since it affects every collaborator, not just you. See [`das hook install`](/docs/commands/hook-install) for the flags and [The SessionStart hook](/docs/concepts/refresh-and-freshness#the-sessionstart-hook) for what runs each session.
