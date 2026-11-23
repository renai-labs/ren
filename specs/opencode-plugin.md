# OpenCode plugin (`@renai-labs/opencode`)

The plugin makes a user's own OpenCode a Ren client. Local OpenCode sessions keep working beside Ren sessions in the same TUI. The package is `packages/opencode`; its `README.md` and `AGENTS.md` hold what is built and the package rules. This spec holds the plan. Remove a part from here in the change that builds it.

## 1. Decisions

- D1. **Ren as a provider.** The server part registers a provider `ren`. Its language model is an AI SDK `LanguageModelV3` in plugin code, as OpenCode's `claude-agent` provider is. One `doStream` sends the prompt to the brain of the Ren session through the Chat API and streams the remote turn into the local session. The brain runs the tools; the stream reports them as executed by the provider.
- D2. **A Ren session is a local session with a `ren/<model>` model and the metadata `ren: { spaceId, sessionId }`.** The local session ID and the Ren session ID are the same ID.
- D3. **The plugin never selects a brain.** For each Ren root session it calls `chat.access(sessionId)` and gets a URL and a token. Every brain and hand layout works the same way. The plugin enables features from `Session.Capabilities`, not from the layout.
- D4. **Three parts:** the server part (`@opencode/plugin/effect`), the TUI part (`@opencode/plugin/tui`) and the RPC contract between them (`@opencode/plugin/rpc`).
- D5. **Stock OpenCode only.** No patched OpenCode. `effect` and `@opencode/plugin` come from the host.
- D6. **Commands are `/ren:<command>`.** Built-in commands keep their names and act on Ren sessions through hooks and events.
- D7. **Published alone.** The build bundles `@ren/client`, `@ren/chat`, `@ren/schema` and `@ren/protocol`.
- D8. **Each feature is one commit with its tests.** Write the test first. Add an end-to-end test where a real brain and a real OpenCode host can run.

## 2. Facts the design depends on

Verified by reading OpenCode 2.3.0 source (the dependency is 2.2.6) and Ren. Not yet run in a live TUI unless a feature below says so.

- F1. A plugin cannot write assistant messages or tool parts into a session. The model stream is the only path. `session.prompt` (with `id`, `metadata`, `resume`) admits a real user message.
- F2. The runner gives each model request the header `x-opencode-session-id`. The `model.request` hook gets `sessionID`, `kind` (`primary`, `compaction`, `title`, `generate`) and mutable `headers`.
- F3. `doStream` gets no `abortSignal`. A stop cancels the returned `ReadableStream`; its `cancel` is the stop signal.
- F4. A step whose tools are all provider-executed does not continue. One remote turn is one local step. A steer admitted during the step is delivered after it.
- F5. A provider-executed tool result keeps no `metadata`. The TUI's edit diff and subagent link read `metadata`, so those rows show as generic rows (limit L1).
- F6. A plain `Error` on the stream is retryable in OpenCode until the turn has produced output. A retry calls `doStream` again, so a send must be safe to repeat: use the local message ID as the Chat API prompt `id`.
- F7. The `title` and `compaction` hooks accept a `result` that skips the model call. `title`, `compaction` and `generate` requests reach the provider unless a hook supplies the result.
- F8. Cost comes only from catalog prices of the model. The stream cannot report a cost.
- F9. `experimental.session.import` creates a session with a chosen ID, metadata and model. It cannot append. `session.remove` then import with the same ID is expected to work (not run).
- F10. The TUI user message shows text, files and skills only. It reads no metadata and has no slot.
- F11. The TUI composer's `@` file search and `!` shell act on the local machine. A plugin cannot add autocomplete sources.
- F12. A slash command name is split on white space, so `ren:space` is a valid name.
- F13. Chat API events are not replayed on reconnect. After `server.connected` the client reads the resources again. A client token reaches only `/chat/*`, lasts 60 minutes, and carries the session ID; the brain sets the sender from the token.
- F14. Ren has no session import endpoint, no presence, no fork and no unarchive. `session.rename` is on the Chat API only.
- F15. An external plugin's `effect` runs with only `Scope` and the loggers in its context (`Plugin.load` in OpenCode's `packages/core/src/plugin.ts`). The plugin provides its own platform services: `FetchHttpClient` from `effect/http`, and Bun or `node:` APIs for files, because `effect`'s `FileSystem` needs a platform package that OpenCode does not provide to plugins.

## 3. Modules

| Module     | Holds                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `turn`     | Built. Pure conversion of Ren session events into stream parts.                                                          |
| `auth`     | Built. The server URL and a currently valid token (`RenAuth`).                                                           |
| `ren`      | Built. The Ren API client with the token of the moment (`RenApi`).                                                       |
| `link`     | One Chat API client (`@ren/client/chat/effect`) and one event stream for one Ren root session, with `chat.access` renew. |
| `binding`  | The `ren` session metadata and the selected space.                                                                       |
| `model`    | The `LanguageModelV3`.                                                                                                   |
| `provider` | The provider and its models.                                                                                             |
| `mirror`   | Remote activity into the local session.                                                                                  |
| `rpc`      | Methods and events between the server part and the TUI part.                                                             |
| TUI        | The `/ren:*` commands, dialogs and slots.                                                                                |

## 4. Features, in build order

Each is one commit. Built features leave the list; the others keep their numbers.

2. **Link.** `chat.access` with the `starting` poll (2 seconds), `failed` and `stopped` states; Basic auth `ren:<token>`; renew before `expiresAt`; a new `chat.access` after 401, 502, 504 or `stream.ended`; `unreachable` after two connect timeouts. Use `@ren/chat`'s connection code where it fits.
3. **First turn (`binding`, `model`, `provider`).** Without a token (`RenAuth.SignedOut`) the server part registers nothing and OpenCode works as before. Models from `chat.models` as `ren/<id>`. `doStream`: read the binding; create the Ren session if it does not exist (`session.create` with the same ID, the selected space and the first message); send each local user message that Ren does not have, with the local message ID; convert the events with `turn`; stop calls `session.interrupt`. The `title` hook returns the Ren title. `compaction` and `generate` requests do not reach the brain as prompts.
4. **Spaces and new sessions.** `/ren:space` selects a space (RPC `space.list`, `space.select`; the selection is in plugin storage; `chat.prepare` wakes the brain). `/ren:new` creates a session bound to the selected space. A status slot shows the space.
5. **Multiplayer (`mirror`).** A user message from another client becomes a local user message through `session.prompt` with the Ren message ID and metadata `{ userID, userName, remote: true }`, and the local turn streams the remote turn without sending. The local text has the sender's name as a prefix (F10). Names come from the organization member list.
6. **Rename.** Local `session.renamed` calls Chat API `session.rename`; a remote `session.renamed` calls local `session.update`. No loop.
7. **Session controls.** Model switch (`session.model.selected` to `session.model.switch`), compact (`compaction` hook to `session.compact`), archive (`session.archived` to `session.archive`), a blocked switch from a `ren` model to a local model, and a fork that is disconnected from Ren.
8. **Permissions and questions.** Remote `permission.asked` and `form.created` reach the user (the native prompt if a plugin can raise it, else a dialog through RPC), and the reply goes to `session.permission.reply`, `session.form.reply` or `session.form.cancel`.
9. **Open and catch up.** `/ren:sessions` lists Ren sessions with search and filters and opens one: import the Ren transcript into a local session with the same ID. On open, a local copy that is behind is removed and imported again.
10. **Sign-in.** `/ren:login` and `/ren:logout` with OAuth (authorization code with PKCE on a loopback redirect) and the plugin's own public client metadata document. The credentials file is shared with the `ren` CLI.
11. **Attachments.** Local files and pasted images upload with `drive.startUpload` and go in `files` (maximum 10).
12. **Status and retry.** Starting, failed and stopped states are visible; `/ren:retry` calls `chat.retry`; notifications through the TUI attention API.
13. **Move a local session to Ren.** A Ren endpoint that creates a session in a space from an OpenCode export (session row and message rows), a new `origin` literal, and the restore of those rows on the brain; then `/ren:move`, and a model change from a local model to `ren/<model>`.
14. **Build and release.** A build script that bundles the Ren packages, keeps `effect` and `@opencode/plugin` external, points `exports` at `dist`, widens the peer ranges, and a check of the OpenCode version at load.
15. **Panels.** Files, changes, terminal (`/ren:files`, `/ren:diff`, `/ren:shell`), `/ren:background`, links to tasks and pull requests, context usage.

## 5. Limits

- L1. Edit diffs and subagent links show as generic tool rows (F5). A fix needs proxy tools that wait for the remote result, limited to Ren sessions, or an OpenCode change.
- L2. Sender names are a text prefix (F10).
- L3. `@` file search and `!` shell are local (F11). The browser tab is not possible in a terminal.
- L4. Undo and redo: only user message IDs match between local and Ren.
- L5. A queue is local until sent. Other users do not see it.
- L6. Cost is the catalog price (F8).
- L7. Models and server commands are one list for all spaces; the plugin checks the selection at send time.
- L8. Presence and fork do not exist in Ren (F14).
