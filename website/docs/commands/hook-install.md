---
id: hook-install
title: das hook install
---

# das hook install

```text
Usage: das hook install [options]

Install the das SessionStart hook

Options:
  --project   install into the project's committed .claude/settings.json instead
              of the personal one
  --yes       skip the collaborator-impact confirmation prompt for --project
  -h, --help  display help for command
```

Installs the `SessionStart` hook (`das refresh --hook`) into personal settings by default. See [The SessionStart hook](/docs/concepts/refresh-and-freshness#the-sessionstart-hook) for what it does each session.

| Flag        | Effect                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project` | Install into the project's committed `.claude/settings.json` instead, which runs the hook for every collaborator who checks out the project. |
| `--yes`     | Skip the collaborator-impact confirmation prompt that `--project` requires by default.                                                       |
