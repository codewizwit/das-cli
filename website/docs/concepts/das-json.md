---
id: das-json
title: "das.json: the ownership record"
---

# das.json: the ownership record

Every generated skill carries a `das.json` alongside its `SKILL.md`, captured from a real `das add` run:

```json
{
  "dasVersion": "0.1.1",
  "slicerVersion": 1,
  "name": "widget-sdk",
  "source": {
    "type": "path",
    "path": "/path/to/project/docs",
    "kind": "folder"
  },
  "trackedRef": null,
  "pinnedSha": null,
  "sourceHash": "sha256:298ddd77770bc806b50abc7af340bffa2e3feadacda7cae3fe8a30834b6a095d",
  "tokenBudget": 4000,
  "includeLarge": false,
  "checkIntervalHours": 24,
  "lastRefresh": "2026-07-24T18:14:48.382Z",
  "generatedFiles": ["SKILL.md", "das.json"]
}
```

`generatedFiles` is the only thing `das remove` and a `das refresh` rewrite ever delete or replace. A foreign file present alongside the tracked ones refuses the whole `das remove` unless `--force` is passed, and even then only the tracked files go. `das doctor` rebuilds the manifest cache by scanning for these files on disk, in case the cache and disk ever drift apart.

The rest of the fields are what makes refresh possible without re-asking you anything: `source` and `sourceHash` (or `trackedRef`/`pinnedSha` for a remote) are what [pin-and-check refresh](/docs/concepts/refresh-and-freshness) compares against, and `tokenBudget`/`includeLarge` are replayed on every regeneration so a skill keeps the shape it was created with.

Commands that read or write `das.json`: [`das add`](/docs/commands/add), [`das refresh`](/docs/commands/refresh), [`das list`](/docs/commands/list), [`das remove`](/docs/commands/remove), [`das doctor`](/docs/commands/doctor).
