# Chat inventory

Every edge case that OpenCode's client handles, and the Ren-specific cases from ren-v1, with the files that handle them. The [plan](../plan.md) ports them one at a time. When a row is ported, set its `Status` to `done` and add the Ren file.

| File                             | Area                                                                                                  | Rows | IDs                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- | ----------------------------------- |
| [01-sync.md](01-sync.md)         | Transport, connection, reads, reducer, outbox, inbox, permissions, forms, families                    | 214  | SYNC-01 to SYNC-214                 |
| [02-render.md](02-render.md)     | Timeline projection, rows, streaming markdown, highlighting, tools, diffs, notices                    | 164  | RND-01 to RND-164                   |
| [03-session.md](03-session.md)   | Scroll follow, virtualization, history, deep links, search, docks, revert, fork, subagents            | 155  | SES-01 to SES-155                   |
| [04-composer.md](04-composer.md) | Editor, paste, drop, attachments, mentions, commands, shell, history, drafts, submit, queue, platform | 185  | CMP-01 to CMP-140, PLT-01 to PLT-45 |
| [05-ren-v1.md](05-ren-v1.md)     | Ren-specific: attribution, readiness, edit message, channels, files, ren-v1 components                | 121  | V1-01 to V1-121                     |

OpenCode paths are relative to `../misc/opencode` (branch `v2`). ren-v1 paths start with `ren-v1/` or `ren-v1-oc-v2/`.

Status values: `todo` (port it), `done`, `n/a` (obsolete in the cell architecture), `rethink` (the need stays, the mechanism changes).
