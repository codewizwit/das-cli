---
id: list
title: das list
---

# das list

```text
Usage: das list [options]

List every registered skill

Options:
  -h, --help  display help for command
```

Lists every registered skill: name, source, scope, pinned ref/sha, last refresh, staleness, and whether an update is available, plus the aggregate token cost of loading every registered skill's description each session.

No flags beyond `--help`. See [`das.json`](/docs/concepts/das-json) for the record this reads.
