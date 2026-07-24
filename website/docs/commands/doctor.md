---
id: doctor
title: das doctor
---

# das doctor

```text
Usage: das doctor [options]

Rebuild the manifest from what is actually on disk

Options:
  -h, --help  display help for command
```

Rebuilds the manifest cache from what is actually on disk, scanning `.claude/skills` directories for a valid `das.json`, and reports what was added, removed, or had its path updated.

No flags beyond `--help`. Run this if `das list` looks out of sync with what's actually on disk.
