---
id: add-a-remote-library
title: Add a remote library's docs
---

# Add a remote library's docs

```bash
das add https://github.com/prisma/docs --yes
```

`das` accepts `https://github.com/<org>/<repo>` and its `/tree/<ref>/<subpath>` and `/blob/<ref>/<file>` forms; every other URL shape is rejected. The clone is shallow, blob-filtered, and pinned to the resolved commit sha, which becomes `das.json`'s `pinnedSha`.

Add just a subfolder instead of a whole repo:

```bash
das add https://github.com/codewizwit/das-cli/tree/main/website/docs --yes
```

Once added, the skill tracks that ref. Run `das list` to see whether the upstream ref has moved, and `das refresh <name> --update` to pull the change:

```bash
das refresh widget-sdk --update
```

This clones at the new sha, shows a changed-file summary, re-runs the [injection scan](/docs/security#injection-scan) on the diff, and only then regenerates and re-pins. See [Pin-and-check refresh](/docs/concepts/refresh-and-freshness) for why a hook-mode check never does this automatically.
