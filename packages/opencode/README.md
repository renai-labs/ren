# @renai-labs/opencode

An OpenCode plugin that makes the OpenCode TUI a Ren client. A user's local OpenCode sessions keep working beside their Ren sessions.

The three parts load. Signed in, the server part registers the provider `ren`, and a local session with a `ren/<model>` model runs its turns on a Ren brain. `/ren:space` selects the Ren space and `/ren:new` starts a Ren session in it. Built: `turn`, `auth`, `ren`, `link`, `binding`, `model`, `mirror`, `title`, `provider`, `rpc`, `handlers`, `commands` and the TUI part (see Modules). Messages that other people and clients write in a Ren session show in the local session (Multiplayer), and a rename on either side reaches the other (Rename). Everything marked _not built_ is the plan in [`specs/opencode-plugin.md`](../../specs/opencode-plugin.md).

## What belongs here

- The plugin's server, TUI and RPC parts.
- Translation between Ren's Chat API and OpenCode's sessions and models.
- Sign-in and the credentials the plugin keeps.

## What does not

- Ren's API and Chat API clients (`@ren/client`) or the chat connection (`@ren/chat`): use them.
- OpenCode internals: everything goes through `@opencode/plugin`.
- Imports from `core`, `db`, `server`, `host-api`, `hand-api` or `cell`. Only tests import `@ren/cell/testing`, to run a real brain.

## How it works

The server part registers a provider, `ren`. Its language model, an AI SDK `LanguageModelV3` like OpenCode's built-in `claude-agent` provider, sends the prompt to the Ren session's brain over the Chat API and streams the remote turn back into the local session: text, reasoning and the tool calls the brain ran.

A local session is a Ren session when its model is `ren/<model>` and its session metadata holds `ren: { spaceId, sessionId }`. A session from `/ren:new` starts with `ren: { spaceId }`: its first prompt creates the Ren session in that space and adds `sessionId`.

The plugin never picks a brain. For each Ren session it calls `chat.access(sessionId)` and gets a URL and a short-lived token, so every brain and hand layout works the same way.

## Parts

| Part   | Export  | File            | API                                                         |
| ------ | ------- | --------------- | ----------------------------------------------------------- |
| Server | `.`     | `src/server.ts` | `@opencode/plugin/effect`, in the OpenCode server           |
| TUI    | `./tui` | `src/tui.tsx`   | `@opencode/plugin/tui`, in the terminal UI                  |
| RPC    | `./rpc` | `src/rpc.ts`    | `@opencode/plugin/rpc`, the contract between server and TUI |

OpenCode loads each part's default export; the RPC part exports its contract by name (`RenRpc.Definition`).

## Modules

| Module     | Holds                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `turn`     | Pure conversion of Ren session events into `LanguageModelV3` stream parts.                      |
| `auth`     | `RenAuth`: the server URL and a currently valid token.                                          |
| `ren`      | `RenApi`: the Ren API client (`@ren/client/effect`) with the token of the moment.               |
| `link`     | `Link`: one Chat API client and event stream per Ren root session, with `chat.access` refresh.  |
| `binding`  | `Binding`: the `ren` session metadata, new local Ren sessions and the selected space.           |
| `model`    | `RenModel`: the `LanguageModelV3` that runs a local turn on the Ren session's brain.            |
| `provider` | `RenProvider`: the provider `ren`, its models, and the session hooks of a Ren session.          |
| `rpc`      | `RenRpc`: the contract between the server part and the TUI part.                                |
| `handlers` | `RenHandlers`: the server part's RPC handlers.                                                  |
| `commands` | `RenCommands`: what each `/ren:*` command does, over the part of the TUI context it uses.       |
| `tui`      | The TUI part: the commands, and the selected space in the footers.                              |
| `mirror`   | `Mirror`: messages from other clients of a Ren session into the local session, and their turns. |
| `title`    | `Title`: the title of a Ren session, kept the same locally and on Ren.                          |

## Connection

The server URL is the plugin option `url`, then `REN_URL`, then `https://api.useren.ai`. Only `http` and `https` URLs are accepted.

The token is `REN_TOKEN`, else the `ren` CLI's login in `${XDG_CONFIG_HOME:-~/.config}/ren/credentials.json` for the server's origin, so `ren login` signs in both. The plugin reads the file on each request for a token, so a later `ren login` or `ren logout` applies without a restart. Within 60 seconds of `expiresAt` it renews the login with the stored refresh token, as the CLI does (the same discovery, `client_id` and `resource`), and writes it back in the CLI's format, atomically, with mode `0600`. Concurrent requests share one renewal. When the server refuses the renewal because the CLI already rotated the login, the plugin uses the CLI's new login.

Without a token, or when the server refuses the renewal, `RenAuth.token` and `RenApi.client` fail with `RenAuth.SignedOut`. Other failures (an unreadable file, an unreachable server) are `RenAuth.AuthError`.

The file format, the discovery and the renewal are a port of `packages/cli/src/services/{credentials,oauth,connection}.ts`: the plugin cannot depend on the private CLI package. Change both together.

The plugin runs in OpenCode's process with only `Scope` in its context, so it provides its own platform services: `FetchHttpClient` from `effect/http` for HTTP, and Bun and `node:fs` for the credentials file, because `effect`'s `FileSystem` needs a platform package that OpenCode does not provide to plugins.

## Link

`Link.Service.open(sessionId)` gives the link of a Ren root session, in a `Scope`. While any scope holds it, every caller gets the same link; when the last one closes, its event stream stops.

A link is `ChatAccess` and `Connection` from `@ren/chat`, wired as `ChatSession` wires them for the web and mobile apps, so the rules are one copy:

- `client` is a Chat API client with a valid token. It calls `chat.access` through `RenApi`, polls every 2 seconds while the brain starts, and fails with `ChatAccess.AccessFailed` when the brain failed or its space stopped. It authenticates to the brain's URL with Basic `ren:<token>` and asks again within a minute of `expiresAt`. After a gateway 502 or 504, a transport error or two connect timeouts, the next `chat.access` says `unreachable`. The URL can change at each access.
- `frames` subscribes to the session's events from that moment. The stream reconnects with backoff and asks for access again after it drops or ends with `stream.ended`. Events are not replayed: each connect starts with `server.connected`, after which a consumer reads what it needs again. A consumer that subscribes while the stream is connected gets a `server.connected` first, so every consumer starts the same way.
- `boot` (checking, starting with its phase, ready, failed with its reason, stopped), `status` and `retryAt` are `SubscriptionRef`s.
- `wake` reconnects a parked stream. `lost` marks the brain unreachable after a request that it refused with 401.

## First turn

Signed in, the plugin lists the models of the selected space (`chat.models`) as `ren/<endpoint>/<model>`, with their variants. Their context limit is 0, so OpenCode never compacts a Ren session locally: the brain owns its context. Cost is zero, because Ren lists no prices. Signed out, or when Ren does not answer at load (it waits at most 5 seconds), it registers nothing, and it asks again every 5 minutes, so a later `ren login` adds the models without a restart.

The selected space is the one `/ren:space` stored, else the plugin option `space` (a space ID or slug), else the first space you joined. The models are the selected space's.

For a primary request `doStream`:

1. Reads the OpenCode session ID from `x-opencode-session-id` and the request kind from `x-ren-request-kind`, which the plugin's `model.request` hook sets.
2. Reads the binding. A session whose binding names another session is a copy (a fork) and is refused.
3. Reads the local messages (`session.context`). The candidates are the user messages after the last assistant message that completed without an error.
4. Without a Ren session in the binding, creates it with the local session's ID, the binding's space (else the selected space) and the model (`session.create`), then writes the binding.
5. Opens the link for this turn, subscribes, and waits until it is connected.
6. On the first `server.connected`, asks the brain which candidates it has (`session.message`) and sends the others with `session.prompt`, the local message ID as `id`, `delivery: "steer"`.
7. The turn starts at `session.inbox.delivered` of a sent message; earlier events are ignored. `turn` converts the events until the execution ends, or until the brain delivers a user message that is not one of the candidates (Multiplayer).
8. When nothing was sent (the brain has every candidate), and after every later `server.connected` (a reconnect, events may be lost), it reads the state again: once the brain has every candidate, a busy session means the turn runs (follow it), an idle one that it ended (finish).

Stopping the local turn cancels the stream, which calls `session.interrupt`. OpenCode does not retry a Ren turn (the `retry` hook): the brain retries model calls itself. The `title` hook answers with the Ren session's title, or none yet, so OpenCode never asks the model for a title. Compaction and one-off generations fail with a message and never reach the brain.

## Multiplayer

Other members, and the signed-in user's other clients (the web app, Slack, schedules, a teammate's OpenCode), write in the same Ren session. While a Ren session is in use here, a user message that the brain delivers and that the local session does not have becomes a local user message, and its turn streams into the local session like a local turn. Nothing is sent to the brain for it.

- **In use.** A Ren session is watched from its first local turn in this OpenCode process (`Mirror.Service.watch`, which `doStream` calls; a later feature that opens a Ren session calls it too). The mirror holds the session's link and reads its events until the brain ends the event stream as idle (`stream.ended` with `idle`: no execution and no events for the brain's `CHAT_IDLE_MS`, 2 minutes), then lets it go, so an idle OpenCode keeps no brain awake. An open Chat API event stream holds the brain's harness open. At most 4 sessions are watched; a fifth lets go of the one used longest ago. A message delivered while the session is not watched, or while the event stream reconnects, is not shown (catch-up is planned).
- **What appears.** At the brain's `session.inbox.delivered` of a message that the local session does not have, the mirror reads the message (`session.message`). A user message is admitted with `ctx.session.prompt`, with the Ren message ID as its `id`, `delivery: "steer"`, `resume: true` and the metadata `{ userID, userName, remote: true }`. Synthetic and compaction deliveries are not shown. The local session starts a step, and `doStream` streams the remote turn.
- **The name.** The stock TUI shows only a user message's text, so the text starts with `<name>: `. The name is the sender's in the space's member list (`space-member.list`, read once per space and again for an unknown member), else `Member`. A message from the signed-in user (`me.get`) has no prefix. A message from a channel, schedule, webhook or task shows `<sender> via Slack`, `Schedule <name>`, `Webhook <name>` or `Task <identifier>` instead. The brain never reads the local text: it has the original.
- **No echo.** A message this OpenCode sent is already in the local session, so it is not admitted again. A mirrored message is never sent: `doStream` reads `remote: true` from its metadata. Admitting an ID the local session has is a no-op, so a delivery seen twice adds nothing.
- **The turn of a mirrored message.** From the delivery the mirror records the session's events until that message's step claims them (`Mirror.Service.replay`), so the step streams the turn from its delivery even when it starts after the brain began, and no event goes to two steps. Without a record (a restart, a dropped record) the step uses the rule of a message the brain already has: follow a busy session, finish an idle one.
- **Two messages at once.** One remote execution can answer several messages: a steer is delivered after the running step and answered by the next step of the same execution. A local step ends at the delivery of a user message that is not one of its own, once its own were delivered; that message's own step streams the rest. So a teammate's steer during a local turn shows after the local answer, with its own answer. A local prompt during a mirrored turn waits until that step ends, as a steer during any Ren turn does, and is then sent.

Limits: a remote turn already running when the session is opened, and messages delivered while it was not watched, are not shown. Two messages delivered back to back can leave one local step empty. Synthetic continuations (a subagent's result, a scheduled wake) stream inside the step that is running, or not at all when no step runs.

## Rename

A Ren session has one title, locally and on Ren (`Title`).

- **Local to Ren.** The plugin reads the location's `session.renamed` events. A local rename of a Ren session (its binding has `sessionId`, and it is that session, not a copy) calls Chat API `session.rename` through the session's link. Both the built-in `/rename` and `session.update({ title })` cause one. The plugin reads `session.get` first and skips the call when the brain already has the title or the session's capability `rename` is false. It skips empty titles and sends renames one at a time, in order.
- **Ren to local.** While the session is watched (Multiplayer), the brain's `session.renamed` for the session itself (not a subagent's) sets the local title with `ctx.session.update`. At each connect of the watched link the plugin reads the brain's title (`session.get`), so a rename made while the session was not watched shows at its next turn.
- **No echo.** The plugin never sends back a title that it set locally, whether from a Ren rename or from the `title` hook (OpenCode shortens that one to 100 characters). It does not apply the brain's echo of a rename this OpenCode sent. It drops a Ren title that arrives while a local rename is on its way, because the local one lands after it.
- **Before the Ren session exists.** A session from `/ren:new` that is renamed before its first prompt has no Ren session yet. At the first connect, if the brain has no title and the local session has one, the plugin sends the local title, so the brain does not replace it with a generated one. A local session that is not a Ren session sends nothing.
- **Brain not reachable.** The rename stays local and the plugin logs a warning. It waits at most a minute (for a starting brain). The plugin sends the title at the session's next connect in this OpenCode process. A restart forgets the title, and the brain's title then wins.

## Commands

Every command the plugin adds is `/ren:<command>`, in the slash completion and in the command palette under Ren.

- `/ren:space` lists the spaces you joined, with the selected one marked, and searches them by name. Choosing one selects it.
- `/ren:new` creates a local session bound to the selected space, with the prompt's `ren/<model>` model when the space offers it, else the space's default, and opens it.

Signed out, both say to run `ren login`. The home and prompt footers show `ren · <space>`.

### Selecting a space

The server part keeps the selection in plugin storage, which is OpenCode's database: one selection for every directory and OpenCode process, kept across restarts. Selecting a space stores it, wakes its brain (`chat.prepare`, without waiting; a failure does not fail the selection), lists its models, and sends the RPC event `spaceSelected`, which updates the footers of every TUI. `/ren:new` also wakes the brain. A server part in another directory is expected to list the new space's models at its next refresh, within 5 minutes (not run).

`/ren:new` creates the Ren session at the first prompt, as the web app does, so a session nobody writes in never reaches Ren.

### RPC

`RenRpc.Definition` (id `ren`). Every method takes an object and can fail with `signed_out` (`data: { server }`, the message says to run `ren login`) or `unavailable` (`data: {}`, the message says what failed).

| Method          | Input                          | Output                              |
| --------------- | ------------------------------ | ----------------------------------- |
| `listSpaces`    | `{}`                           | `{ spaces: SpaceInfo[], selected }` |
| `getSpace`      | `{}`                           | `SpaceInfo`, the selected space     |
| `selectSpace`   | `{ spaceId }`                  | `SpaceInfo`                         |
| `createSession` | `{ model?: { id, variant? } }` | `{ sessionID, spaceId }`            |

`SpaceInfo` is `id`, `slug`, `name`, `kind` and `description` from Ren's `Space.Info`. The event `spaceSelected` carries the new `SpaceInfo`. The schemas are Effect schemas wrapped with `Schema.toStandardSchemaV1`, so the TUI's Promise client accepts them, and keep the same shape encoded and decoded, because the Promise client returns the server's JSON without decoding it.

To add a feature: add its methods and events to `rpc.ts`, its handlers to `handlers.ts` (map failures with `answer`), its command logic to `commands.ts` as plain functions over `Surface`, and its keymap entries or slots to `tui.tsx`. Test the handlers through a real OpenCode (`OpenCodeHost`, `host.client.rpc(RenRpc.Definition)`), and the commands with `host.promise`, the Promise client a TUI gets, and a recording stand-in for the dialogs, toasts and router. No test runs `tui.tsx`: OpenCode does not publish its TUI, so check the keymap entries and slots by hand in a stock OpenCode (Install).

Built-in commands keep their names and act on Ren sessions through hooks and events: `/rename` (Rename), `/compact`, stop and the model picker.

Planned commands: `/ren:sessions`, `/ren:move`, `/ren:retry`, `/ren:login`, `/ren:logout`. Planned features:

- Move a local session to a Ren space. This needs a new Ren import endpoint.
- The web app chat's features, where the stock TUI allows them.

## Install

Not published yet. Once it is:

```sh
opencode plugin add @renai-labs/opencode
```

During development, add this directory to `plugins` in `opencode.jsonc` (the project's or `~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/ren/packages/opencode"],
}
```

To try a Ren model against a local server, pass the plugin's options with an entry object, then pick a `ren/…` model:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/ren/packages/opencode",
      "options": { "url": "http://localhost:4000", "space": "my-space" },
    },
  ],
}
```

`url` is the Ren server (default `REN_URL`, then `https://api.useren.ai`); sign in to it with `ren login`, or set `REN_TOKEN`. `space` is a space ID or slug, used until `/ren:space` selects one (default: your first joined space).

OpenCode resolves a local directory through its `package.json` `exports`, as it does a published package, so all three parts load from `src`. The TUI loads the TUI part of each plugin its server loads. OpenCode provides `effect` and `@opencode/plugin` to the plugin at runtime.

## Dependencies

`@opencode/plugin` and `effect` are peer dependencies: OpenCode provides its own copies at runtime, to the server part and to the TUI part. `@opentui/core`, `@opentui/solid` and `solid-js` are peer dependencies of the TUI part: the TUI provides them and compiles `tui.tsx` with Solid. All are dev dependencies too, for typecheck and tests, with `@opencode/theme` for the theme's types; `tsconfig.src.json` adds the `DOM` lib because Solid's `JSX.Element` names DOM's `Node`.

`@ren/client`, `@ren/chat`, `@ren/schema` and `@ren/protocol` are private workspace packages. They become dependencies when code uses them, and the build bundles them.

## Build and release (not built)

A build script will bundle the Ren packages into `dist` and keep `effect` and `@opencode/plugin` external, then point `exports` at the bundle. Publish only the built package, and test the installed package in a stock OpenCode release, not only this directory.

## Commands

```sh
bun typecheck
bun run lint
bun run test
REN_SLOW=1 bun run test   # also the slow tests: a link to a real brain, a /ren:new session's turn on a real brain, teammates on a real brain, and renames on a real brain
bun script/whoami.ts   # the signed-in user, through the plugin's connection
```

The end-to-end test `packages/e2e/tests/opencode.spec.ts` signs in with the `ren` CLI against a real server and checks that the plugin uses and renews that login.
