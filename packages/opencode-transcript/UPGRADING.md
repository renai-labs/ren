# Upgrading OpenCode

1. Run `bun run opencode:bump <version>` on a branch. It updates the catalog, installs, runs `check`, and runs `test:opencode` against the existing recordings.
2. Review the release's patches and persisted schema changes. Review any new dependency that needs a release-age exception in `bunfig.toml`. The bump command does not make these decisions.
3. Fix compatibility in the OpenCode boundary. Keep old recordings unchanged. A successful transcript decode is not enough: native model context, queued messages, settings and reverts must survive restore and sync back.
4. Run `bun run opencode:record` explicitly to add the new release's transcript recording and database snapshot. The recorder refuses to overwrite either. Review them and rerun `bun run test:opencode`.
5. Deploy the server before brains. Do not roll brains back after the newer version has synced chats.

## What the gate checks

- `opencode-transcript`: each historical message decodes without losing stored fields, and saved history remains readable.
- `cell`: the harness contracts, checkpoint behavior, imports, and storage. The storage subset also runs under Wrangler, even when the first cell test run fails.
- `chat`: live client behavior, including rereading persisted state after an unreadable event.
- `core`: stored JSON reads and the full restore suite, including queued messages and staged reverts.
- `server`: sync races and failures, historical restore/resume/sync-back, and the cell-sync lifecycle suite.

The storage audit compares the real SQLite columns with the synced columns and explicitly documented omissions. The populated-table audit is a tripwire for the exercised workload, not a complete inventory of every feature OpenCode can persist.

`cell/test/fixtures/databases` contains full SQLite schema, migration records and rows from a quiescent scripted chat. The Durable Object test loads each snapshot before opening the installed OpenCode, then checks that messages remain readable and unchanged through a write. At a version bump this exercises in-place migrations; the transcript fixtures separately exercise importing into a fresh database.

`bun run check` and `check:all` reject duplicate versions of shared Effect and OpenCode packages. There is one exact legacy exception: OpenCode 2.0.27 brings `@effect/platform-node-shared@4.0.1` alongside Ren's 4.1.0. It is disabled automatically for other OpenCode versions and should be removed at the bump.

A failing critical-path test is a failed gate. Diagnose or track the individual failure; do not exclude its entire suite to make an upgrade pass.
