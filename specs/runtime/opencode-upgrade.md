# OpenCode upgrades: boundary, then 2.0.27 → 2.2.6

Status: in progress on branch `opencode-upgrade`. Two pull requests. PR 1 makes an OpenCode upgrade a routine bump, on 2.0.27, and deploys first. PR 2 bumps to 2.2.6 with the command that PR 1 adds and fixes what its tests find. Tick an item in the change that does it; remove this file in the change that finishes PR 2, after moving the procedure (§0.4) to its owner.

| Word          | Meaning                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Old, new      | OpenCode 2.0.27 and 2.2.6.                                                                            |
| DO cell       | A brain hosted in a Cloudflare Durable Object (`cell/src/worker.ts`). OpenCode migrates its database. |
| Process brain | A brain run by Bun in a sandbox (`cell/src/bun.ts`, E2B). It deletes its database and restores chats. |
| Boundary      | `cell/src/harness/opencode/**`, `opencode-transcript`, and the OpenCode tests of `cell`.              |

## 0. PR 1: the boundary (on 2.0.27)

The goal: a bump changes the catalog, runs one command, and any break shows as a failing test or a type error inside the boundary. Code outside the boundary does not change.

### 0.1 Rules

- Only the boundary imports `@opencode/*` or names an OpenCode table. `e2e` may use `@opencode/client` to drive a cell from outside.
- Ren stores OpenCode rows as OpenCode wrote them and never rewrites them. Every read goes through one reader in `opencode-transcript`: raw row, then `SessionLegacy` (by shape, so a row with no version works), then the current OpenCode type, then the Ren type.
- Ren reads the rows of every OpenCode version it shipped, for ever: Postgres keeps them. The recorded fixtures (A7) of each version stay in the repo.
- The Chat API only grows. A new field is optional; a field is never removed or narrowed while a shipped client reads it.
- Never roll the OpenCode version back once chats have synced on the new one. The server deploys before brains.
- One copy of `effect`, `@effect/*` and `@opencode/*` in `bun.lock`. No hand edits, no `--minimum-release-age=0`.
- `core` keeps its SQL on `opencode_message` and `opencode_inbox` JSON (search, files reset, channel turns); its tests run that SQL on recorded rows (A7), so a shape change fails a test.

### 0.2 Steps

- [x] A1. Lint: `ren/opencode-boundary` reports `@opencode/*` and `node_modules/@opencode` outside the boundary. The `packages/cell/src/*.ts` ban does not fire today (`cell/src/bun.ts:2` imports `@opencode/util/global`). Move `bun.ts`'s OpenCode paths into the harness; give `@ren/cell/testing` Ren-typed helpers for the chat and server tests; drop `@opencode/*` from `chat` and `server`.
- [x] A2. Storage: move OpenCode's table and column names and their SQL (`brain/src/opencode-sync.ts`) into `opencode-transcript`; `brain` keeps the harness-neutral pass. Clear the harness database child-first (U4).
- [x] A3. Version: write `agent_session.harness_version` on upload (nothing wrote it). No restore guard: OpenCode reads older rows, and a newer row only reaches an older brain on a rollback, which the procedure rules out.
- [x] A4. Chat API: `translate.ts` holds one table of the OpenCode events Ren shows and one of its messages; each is `"translated"` or `{ reshaped: reason }`. Typecheck fails when one of them no longer fits Ren's shape or is gone from OpenCode (unknown and JSON, brands and `| undefined` count as equal). Other OpenCode events are dropped, as before. Exceptions on 2.0.27: the `move` inbox item and `shell.created` (session from metadata). The brain leaves out and logs an event or list item it cannot read. Commands are not changed here (U8 in PR 2).
- [x] A5. Contract suite: `bun run test:opencode` runs, whatever changed: all of `cell` (slow tests, then the Wrangler subset) and `opencode-transcript`, all of `chat`, and `test/opencode-*` in `core` and `server`. A test there checks that each OpenCode table with rows after a chat is synced or kept out on purpose. Sync's turn-end events are covered by `cell/test/chat-contract.test.ts` (every translated event shows up on a real OpenCode) and the A4 table. On 2.0.27 the suite fails only where `main` fails (§8).
- [x] A6. Fixtures: `bun run opencode:record` writes the rows of scripted chats to `opencode-transcript/test/fixtures/<version>.json` (loader: `@ren/opencode-transcript/testing`). 2.0.27 is recorded: reasoning with native data, a completed and a failed tool, a subagent, a channel message, a shell command, a files-reset message and queued item, an error turn, a summary compaction, a busy chat with queued items. Tests on every recording: each row decodes and encodes back with no field lost (`OpenCodeRows.stored`), the saved history has every message, `core`'s JSON reads (`OpenCodeStore.message`, files reset) agree with OpenCode's decoded messages, and each root chat round-trips through sync, restore, a turn with its compaction context and sync back with no row changed. The saved history leaves out and logs a row it cannot show. Not recorded: a provider compaction (`providerContext`); the stub model has no native compaction.
- [x] A7. `bun run opencode:bump <version>` (`script/opencode-bump.ts`): reads the release's `@opencode/*` packages from npm; stops, changing nothing, when one pins an `effect` or `@effect/*` other than Ren's `effect`; adds missing `@opencode/*` names to `minimumReleaseAgeExcludes`; sets the catalog; runs a plain `bun install`; fails when `bun.lock` holds two copies of `effect`, an `@effect/*` or an `@opencode/*`; names OpenCode's `patchedDependencies` that Ren installs unpatched; then records fixtures, typechecks and runs `test:opencode`. On 2.0.27 it stops at the effect check (4.0.1). In PR 2, add the `bun.lock` check to `bun run check`; on `main` it would fail (2.0.27 brings `@effect/platform-node-shared@4.0.1`).

### 0.3 Not in PR 1

- CI deploy order (wait for the server before the new template). Later.
- A catch-all event and message type for clients, needed before Ren adds an event type.
- E30, harness-neutral storage.

### 0.4 Procedure (moves to `AGENTS.md` and the bump script at the end)

1. `bun run opencode:bump <version>` on a branch.
2. Fix what fails inside the boundary. Add a fixture scenario for any new stored shape.
3. Deploy the server, then the template; dev for a day, then production.

## 1. PR 2: from the reverted 2.2.5 attempt

Redo these in PR 2 (patch: `~/.ren-backups/backup-2.2.5/`).

- [x] `opencode-transcript/src/opencode-rows.ts`: decode `agent` as `Agent.ID`; pass `time_busy: null` (new column, d500927b9d).
- [x] `cell/src/harness/opencode/plugin.ts`: import `Message` from `@opencode/ai/effect`; new has no `@opencode/ai/schema/messages`. Done: model messages no longer carry `metadata` (e5c9b0151b); the context hooks read it from `session.context` by message id.
- [x] Test stubs (`cell/test/lib/stub-model.ts`, `e2e/chaos/lib/provider/model.ts`): find a title request by "You name conversations"; new rewrote the title prompt (d2812d147e).
- [x] 2.2.6 is on effect 4.1.0: no nested `bun.lock` entry. Add the 7 missing `@opencode/*` names to `minimumReleaseAgeExcludes`. Done: all 11 names are excluded; the 2.0.27 exception in `script/opencode-lock.ts` is gone.
- [x] Apply OpenCode's patch for `@modelcontextprotocol/client@2.3.1` (one malformed MCP tool otherwise drops the server's whole list). Done: in `patchedDependencies`; `cell/test/mcp.test.ts` "a server that lists one malformed tool…" fails without it.

## 2. PR 2: must fix

### U1. Compaction no longer has `recent`

- [x] Fix Done: `Translate` fills `recent` from `metadata.recent` or `""`; the A4 table caught it.
- Evidence: acdcdb8dd9 and fd6589239e removed `recent` from `session.compaction.started` and `.ended` and from the `compaction` message (running and completed). New reads an old compaction through `SessionLegacy.message`, which moves `recent` to `metadata.recent`. `delta`, `failed` and the inbox item did not change.
- Ren: `schema/src/session/event.ts:171,181` and `schema/src/session/message.ts:294,305` require `recent`; `opencode-transcript/src/translate.ts`; `cell/src/harness/opencode/chat.ts` (fails with "The brain cannot read an OpenCode event Ren supports"); `opencode-transcript/src/transcript.ts:15`; `core/src/session.ts:267`.
- Impact: any compaction ends the event stream for every client of the brain. Any chat that has a compaction, from old or new, fails to load in the cell and on the server.
- Fix: keep `recent` in Ren's schema. In `Translate`, fill it from `metadata.recent` when it is a string, else `""`. Old already sent `""` for a manual compaction. This does not change the Chat API: no `bun run generate`, and old web and mobile clients keep decoding. Remove `recent` later, in two steps (optional, then gone), if at all.
- Tests that fail now: `cell/test/chat-contract.test.ts` ("every allowlisted event…"), `cell/test/chat.test.ts` ("a client compacts the session through the Chat API…"), `chat/test/chat-session.test.ts` ("coalesces duplicate gestures…").
- Add: `OpenCodeTranscript.messages` with a compaction row of each version (server path; no test covers it).

### U2. Restored chats lose model context

- [x] Fix Done: `OpenCodeRows.message` runs `SessionLegacy.message`; the "no field lost" test on the 2.0.27 recordings fails without it.
- Evidence: acdcdb8dd9 renamed `providerState`, `state` and `resultState` to `native`, moved `recent` to `metadata.recent` and `providerContext` to `native.messages`. New upgrades an old row with `SessionLegacy.message` in its own reads (`core/src/session/history.ts`) and in its HTTP import route. The in-process `SessionTransfer.import` does not.
- Ren: `opencode-transcript/src/opencode-rows.ts` `message` decodes the row with the new `SessionMessage.Info` and no upgrade; `cell/src/harness/opencode/harness.ts:668` passes it to `transfer.import`.
- Impact: a restored chat keeps its transcript but loses reasoning signatures (Anthropic, OpenAI, Gemini), cache continuity, and for a compaction the recent text and the native window: the model sees only the summary. Every process brain restores all its chats on its first boot after the deploy.
- The loss is permanent. Confirmed with the 2.2.6 schema on 2.0.27-shaped rows: the decode drops `recent`, `providerContext` and every `state`/`providerState` without an error. A sync pass uploads every message row of a chat and `OpenCodeStore.writeMessages` overwrites each column, so the first sync after a restore writes the stripped rows over Ren's copy in Postgres. Release blocker: the fix and a round-trip test (restore 2.0.27 fixtures, run a turn, sync, check Postgres) land before the bump deploys.
- Fix: decode `{ ...SessionLegacy.message(row.type, data), id, type }`; `SessionLegacy` is `@opencode/schema/session-legacy`. Not an API change. This also fixes the old-row half of U1.
- Add: an import test with an old-shaped row (`recent`, `providerContext`, `providerState`) in `cell/test/opencode-import.test.ts`.

### U3. Restore tests in core

- [x] Fix Done: on 2.2.6 only "a chat whose root never committed…" fails, as on `main`.
- `cell/test/hand-lifecycle-cell.test.ts` under Wrangler (`bun run test:cloudflare`): 18 tests fail on `main` at 1a6a06fc2 too (2026-11-07). "a command that prints 64 MiB keeps workerd's memory bounded" fails only under load. Not in `test:opencode`.
- `cell/test/tool-parity.slow.test.ts`: "J30 a command with no timeout and no output for 35 seconds…" (`Shell.NotFoundError` after about 5 seconds). Fails on `main` at 1a6a06fc2 too (2026-11-07). It is the only failure in `bun run test:opencode` for `cell`.
- `core/test/restore.slow.test.ts`: "a chat whose root never committed in Ren but whose subagent chat did…" (the subagent's message is missing) and "on a new sandbox the first request is a prompt to a chat that needs a restore…" (a tool reads `workspace/ses_other/f.txt`, not the chat's own folder). Both pass on `main`.
- Re-run after U2 and U4. If they still fail, find the cause; the second may be a `transfer.import` or location change (`harness.ts:663` assumes the import route drops the workspace link; not verified on new).

### U4. Clearing the harness database fails on new's schema

- [x] Fix Done: in PR 1 (c0db85ace).
- Evidence: `cell/src/harness-storage.ts:19-27` drops every table in `rowid desc` order. On a database created by new, `blob_ref` (parents `session_v2` and `blob`, both `on delete cascade`) comes before `blob`, which comes before `session_v2` (`core/src/database/schema.gen.ts`). The clear drops `session_v2`, then `blob`; SQLite then builds the cascade into `blob_ref` and fails with `no such table: main.session_v2`. Each retry fails the same way, and `prepare` throws before it writes the version key: the brain cannot open OpenCode again.
- Scope: not every DO cell at the deploy. Only `cell/src/bun.ts:268` calls `HarnessStorage.flushed`, so a DO cell never clears; it migrates in place. A process brain deletes its file. It fails in the test, and in any DO cell once DO cells write the flushed marker.
- Fix: in `storage.transactionSync`, drop in rounds: list the tables left (not `_*`, not `sqlite_*`), read each one's parents with `PRAGMA foreign_key_list`, drop the tables that no table left references. Confirm that celld and Wrangler allow `PRAGMA foreign_key_list`.
- Test that fails now: `cell/test/sync-storage.test.ts` "E100: a cell that opens OpenCode after another harness version clears its tables only when that version flushed sync". Run it with `CELL_RUNTIME=wrangler` too.

### U5. Rollout order and mixed versions

- [ ] Release note
- Evidence: old requires `recent` on a compaction. Old fails to decode a compaction row that new wrote (`Missing key at ["recent"]`). Other new fields (`native`, `retryAfterMs`, `FileDiff.more`) are ignored by old.
- Impact: a server on old code fails the saved history of a chat that a new cell compacted. A cell on old (a DO version skew, or an old E2B template) fails to restore a chat that a new cell synced.
- Fix: deploy the server before any cell or E2B template, and never roll the OpenCode version back after chats synced on the new one. No restore guard (dropped in A3).

### U13. A test pins old's 500 for a large text file

- [x] Fix Done: the 2.0.27 case is dropped.
- Evidence: `cell/test/brain-api.test.ts` "send rejects a message with a text file of more than 5,345,276 bytes, which OpenCode 2.0.27 answers with 500…" (81f726be9). New accepts that file: `send` returns the message ID, so the test fails.
- Ren: the behaviour that 81f726be9 adds (`answered` in `cell/src/harness/opencode/harness.ts`: OpenCode's answer becomes `BrainRejectedError`, a request with no answer stays a defect) does not change. The case "a file OpenCode cannot read" still proves it on new.
- Fix: drop the 2.0.27 case, or replace it with an input that new answers with a 5xx, so an answered 5xx stays covered. Confirm that the large file then runs a turn, and check whether sending large documents by path (`brain/src/reference/drive-files.ts`, same commit) is still needed.

## 3. Should fix

### U6. Start does not boot the chat's location

- [x] Fix Done: not changed. Booting at start made `chat` tests race; a production brain already boots at start through `remember`. Two MCP tests now prompt first.
- Evidence: 450e7b9241 removed `sessionLocationMiddleware` from the global session routes (`instructions.entry.*`, `session.update`, agent and model switches). Old booted the location, and so the plugins and MCP, when the chat started.
- Ren: `cell/src/harness/opencode/harness.ts` `start` calls `server.activate` only inside `remember`, when ChatSettings exist.
- Impact: the first prompt waits for plugins and MCP to start. Prompt-started turns still see every tool (`Plugin.awaitActivation` in `SessionPrompt.prepare`; confirmed by `cell/test/ren-mcp.test.ts` "each chat calls Ren MCP…" and "a space with Slack…").
- Fix: call `server.activate(sessionId)` in `start` every time. Then `cell/test/mcp.test.ts` needs no reordering (the 2.2.5 attempt sent the prompt before waiting for MCP in two tests).

### U7. A wake that is not a prompt can run without MCP tools

- [x] Fix Done: not reproduced: `cell/test/mcp.test.ts` "the first step of a message from Ren…" passes on 2.2.6 with no change; kept as a guard.
- Old had the same gap; it is not a regression.
- Evidence: `Session.synthetic`, `resumeSuspendedSessions` and background-job notices wake the drain without `SessionPrompt.prepare`. On a cold location, `boundary.run` in Ren's runner wrapper copies its holds before Ren's plugin registers the MCP hold (`cell/src/harness/opencode/execution.ts:20`).
- Impact: after a restart or a location eviction, a synthetic message (for example the channel reminder in `core/src/channel-turns.ts:123-130`) can run its first step without app, Ren or channel tools.
- Fix: in `execution.ts`, `drain: (input) => Plugin.Service.awaitActivation.pipe(Effect.andThen(boundary.run(...)))`; read `holds` lazily in `run` (`Effect.suspend`); add `Plugin.node` to the deps.
- Add: a test that sends a synthetic message to a chat on a cold location and sees a channel reply tool in the first request.

### U8. The `/goal` command

- [x] Decide: hide it or support it Done: hidden: left out of `commands()` and not found in the command route.
- [x] Map `CommandExecutionError` to `Harness.Rejected` (`session.command` declares `InvalidRequestError`).
- Evidence: 8de0323975 added `GoalPlugin` to the built-in plugins with no config gate (`core/src/plugin/goal.ts`, `plugin/internal.ts`). It continues a session for up to 50 rounds through `experimental.idle` and synthetic messages, and pauses goals when the server restarts.
- Ren: `cell/src/harness/opencode/chat.ts:259` lists every command to clients; `chat.ts:244-256` catches only `CommandNotFoundError`.
- Impact: `/goal` shows in Ren's command picker. It can run many billed rounds, and the continuations are hidden. `/goal` with no text, or `/goal pause` with no goal, fails with `CommandExecutionError`, which becomes a 500.
- Fix to hide it: drop `goal` (and `schedule`) from `commands()` and refuse them in the command route; the plugin's command editor can only add. In any case, map `CommandExecutionError` to `Harness.Rejected`.

### U9. Cold start of a DO cell

- [ ] Measure
- [ ] Decide
- Evidence: `core/src/models-dev/snapshot.txt` grew from 5.4 MB to 8.2 MB; it is decoded on first use even with `fetch: false`. About 910 ms and 11 MB of heap on an M-series Mac. The worker bundle grew from 3,990 to 4,441 KiB gzipped.
- Ren: `cell/src/harness/opencode/server.ts:80,114` (`models: { fetch: false }`).
- Fix: measure a DO cold boot on old and new (`bun run test:cloudflare` in `packages/cell`). If Ren needs no catalog data (it sets limits and efforts itself), pass `snapshot: false`, after checking what reads the catalog through `canonical`.

### U10. Interrupt of a session that OpenCode does not hold

- [x] Fix Done: no change: 2.2.6 answers 404 only for a session missing from the database, which Ren already treats as not found.
- Evidence: 450e7b9241: `session.interrupt` answers 404 for an unknown session.
- Ren: `cell/src/harness/opencode/harness.ts:545,834` call it with `Effect.orDie`.
- Fix: treat `NotFound` as done.

### U11. Ren's copy of the shell service

- [x] Fix Done: ported; `cell/test/tool-parity.test.ts` "a shell removed on the sandbox…" fails without it.
- Evidence: new `core/src/shell.ts:178` publishes `shell.exited` with `killed` when a running command is removed, and `:366-436` races the exit against the timeout so that the timeout kill always runs.
- Ren: `cell/src/harness/opencode/shell.ts:101-112,243-307` keeps old's logic.
- Fix: port both changes. Add a case to `cell/test/tool-parity.test.ts`.

### U12. `fetch` in Code Mode asks for the `webfetch` permission

- [x] Decide Done: no change. Ren allows `webfetch` unless a space rule asks or denies, and "ask" is "deny" when no one can answer; `fetch` now follows the same rules as the tool.
- Evidence: new `codemode/fetch.ts` calls `permission.assert({ action: "webfetch" })`; old's `codemode/web.ts` did not.
- Impact: with `webfetch: ask`, a `fetch` in `execute` asks the person; a chat that is not interactive can be refused.
- Fix: none if this is wanted. Otherwise allow it in Ren's `permission.hook("evaluate")` (`plugin.ts:492`).

## 4. Hygiene

- [x] Move `client.session.wait` and `client.session.instructions.entry.*` to `client.experimental.session.*` (9a9386edbc deprecates the old names; removed in 2.3). Ren: `cell/src/harness/opencode/chat.ts:214`, `harness.ts:328-336,833`, `cell/src/cell.ts:180`, tests.
- [ ] Remove `experimental_image_generate` in Ren's tool transform; Ren has its own `image_generation` (`model-tools.ts`). New registers it when the catalog has an image model.
- [ ] Add `browser` to the reserved skill ids (`plugin.ts:55-60`).
- [ ] Ren's `title` hook (`plugin.ts:318-334`) frames the conversation, and new now frames it too. Remove the hook and its assertion (`cell/test/settings.test.ts:1137-1138`) if the title still comes out right with Claude.
- [ ] Update the comments that name 2.0.27 and are still true on 2.2.6: `cell/src/harness/opencode/mcp.ts:28,281`, `plugin.ts:52`. Fix the stale line reference in `model-providers.ts:32` (`model.ts:210`).
- [ ] Re-check the 2.0.27 notes in `specs/runtime/e2b-brain/README.md:95-96` and `specs/integrations/README.md:100` on 2.2.6.
- [ ] Show `FileDiff.more` (a folder row in a revert) and `SessionError.retryAfterMs`, or filter the folder rows. Cosmetic.
- [ ] Count a subagent once when a follow-up goes to a running subagent (`chat/src/family.ts` `background()`). Not verified.

## 5. Watch at the next upgrade

- `session_part` (c1b5f1b416): new reads a message's parts from it and updates existing part rows, but creates none. Ren syncs only `session_message.data`. When a release writes parts, assistant messages would sync as `content: []`. Until then, make sync fail as "incompatible" when `session_part` has rows for a session (the A5 table test).
- `experimental.media_blob`: moves file bytes to `blob` and `blob_ref`, which Ren does not sync. Keep it off in the cell's config. Add a restore test with an image attachment.
- `@opencode/server/process` and the `@effect/platform-node` barrel do not load on effect 4.1.0 (`effect/Crypto` is gone). Ren imports neither; do not start.
- Saved "always allow" shell rules may no longer match on process brains: new removed the tree-sitter parser, and the portable scanner writes other patterns. Nothing to do unless people report it.

## 6. Release

- [ ] R1. PR 1 deploys before PR 2, so chats synced before the bump carry their OpenCode version.
- [ ] R2. Deploy the server before any cell or E2B template (U5).
- [ ] R3. Rebuild the E2B template (`bun run template:e2b` in `packages/cell`) and pass its smoke check; the version bump changes its hash.
- [ ] R4. Ship to the dev environment first and watch PostHog errors for a day before production.

## 7. Verify

- [ ] `bun run check` from the repo root.
- [ ] `REN_SLOW=1 bun turbo test --continue`, compared with `main` (see §8).
- [ ] `bun run test:cloudflare` in `packages/cell` (Wrangler, not celld).
- [x] A DO test that opens a database that old created and migrates it to new (m50 to m58, including `DROP COLUMN allowance` and the copy from `kv` to `job`). Every DO test starts empty today. Done: `cell/test/fixtures/databases/<version>.json` and `sync-storage.test.ts`.
- [ ] Mixed versions: the server decodes rows from old and new cells; a new cell restores a chat that old synced.
- [ ] By hand with `bun run dev` and `bun run dev:app`: a new chat; a message from Slack; an app MCP tool; a manual and an automatic compaction; a restore after the brain loses its database; subagents; a schedule.

## 8. Failures that are not from this upgrade

On a Mac without a container memory limit, the executor reads used memory as `totalmem() - freemem()`, which counts cache (98% here). The watchdog then kills any shell after one 5-second sample above 92%, so J30, J24 and J52 fail with `Shell.NotFoundError`. They pass with the critical line raised. Fix the reading in `executor/src/sandbox/memory.ts`, outside this upgrade.

A command with no description is dropped from `command.list`: OpenCode sends `description: undefined`, which `SessionCatalog.Command` does not accept.

These fail on `main` too (run on a `main` worktree, 2026-10-31). Fix them elsewhere; do not count them here.

- `server/test/cell-sync.slow.test.ts`: all 6 `cell sync` tests (`SessionNotFoundError` after the turn).
- `cell/test/tool-parity.slow.test.ts`: "J30 a command with no timeout and no output for 35 seconds…" (`Shell.NotFoundError` after about 5 seconds). Fails on `main` at 1a6a06fc2 too (2026-11-07). It is the only failure in `bun run test:opencode` for `cell`.
- `core/test/restore.slow.test.ts`: "a chat whose root never committed in Ren but whose subagent chat did…" (the root's first message is missing). Fails on `main` at 1a6a06fc2 too (2026-11-07).
- `core/test/session-runner.slow.test.ts`: "send to a session that the host lost…": the GitHub channel header now has the line "Text in this chat is not posted on GitHub…".
- `core/test/hand-lifecycle.slow.test.ts` and `core/test/environments.test.ts`: three tests of environments on a local sandbox brain ("an environment that is gone is replaced…", "Ren down during a turn…", "an archived environment template gives no access…").

Two tests that failed in a full `cell` run pass alone in under a second; they were slow because of the load of the run: `cell/test/models.test.ts` "each step names the sender…" and "a subagent request names its root chat…".
