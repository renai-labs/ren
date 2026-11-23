# @renai-labs/opencode

An OpenCode plugin that makes the OpenCode TUI a Ren client. A user's local OpenCode sessions keep working beside their Ren sessions.

The three parts load. The server part registers nothing yet. Built: `turn`, `auth`, `ren` and `link` (see Modules). Everything marked _not built_ is the plan in [`specs/opencode-plugin.md`](../../specs/opencode-plugin.md).

## What belongs here

- The plugin's server, TUI and RPC parts.
- Translation between Ren's Chat API and OpenCode's sessions and models.
- Sign-in and the credentials the plugin keeps.

## What does not

- Ren's API and Chat API clients (`@ren/client`) or the chat connection (`@ren/chat`): use them.
- OpenCode internals: everything goes through `@opencode/plugin`.
- Imports from `core`, `db`, `server`, `host-api`, `hand-api` or `cell`. Only tests import `@ren/cell/testing`, to run a real brain.

## How it works (not built)

The server part registers a provider, `ren`. Its language model, an AI SDK `LanguageModelV3` like OpenCode's built-in `claude-agent` provider, sends the prompt to the Ren session's brain over the Chat API and streams the remote turn back into the local session: text, reasoning and the tool calls the brain ran.

A local session is a Ren session when its model is `ren/<model>` and its session metadata holds `ren: { spaceId, sessionId }`.

The plugin never picks a brain. For each Ren session it calls `chat.access(sessionId)` and gets a URL and a short-lived token, so every brain and hand layout works the same way.

## Parts

| Part   | Export  | File            | API                                                         |
| ------ | ------- | --------------- | ----------------------------------------------------------- |
| Server | `.`     | `src/server.ts` | `@opencode/plugin/effect`, in the OpenCode server           |
| TUI    | `./tui` | `src/tui.ts`    | `@opencode/plugin/tui`, in the terminal UI                  |
| RPC    | `./rpc` | `src/rpc.ts`    | `@opencode/plugin/rpc`, the contract between server and TUI |

OpenCode loads each part's default export; the RPC part exports its contract by name. `src/tui.ts` becomes `src/tui.tsx`, with OpenTUI and Solid as peer dependencies, when the first slot or panel lands.

## Modules

| Module     | Holds                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `turn`     | Pure conversion of Ren session events into `LanguageModelV3` stream parts.                     |
| `auth`     | `RenAuth`: the server URL and a currently valid token.                                         |
| `ren`      | `RenApi`: the Ren API client (`@ren/client/effect`) with the token of the moment.              |
| `link`     | `Link`: one Chat API client and event stream per Ren root session, with `chat.access` refresh. |
| `model`    | _Not built._ The `LanguageModelV3`.                                                            |
| `provider` | _Not built._ Provider and model registration.                                                  |
| `binding`  | _Not built._ The `ren` session metadata.                                                       |
| `mirror`   | _Not built._ Remote activity into the local session.                                           |
| TUI        | _Not built._ The `/ren:*` commands.                                                            |

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
- `frames` subscribes to the session's events from that moment. The stream reconnects with backoff and asks for access again after it drops or ends with `stream.ended`. Events are not replayed: each connect starts with `server.connected`, after which a consumer reads what it needs again.
- `boot` (checking, starting with its phase, ready, failed with its reason, stopped), `status` and `retryAt` are `SubscriptionRef`s.
- `wake` reconnects a parked stream. `lost` marks the brain unreachable after a request that it refused with 401.

## Commands the plugin adds (not built)

Every command is `/ren:<command>`: `/ren:space`, `/ren:sessions`, `/ren:new`, `/ren:move`, `/ren:retry`, `/ren:login`, `/ren:logout`.

Built-in commands keep their names and act on Ren sessions through hooks: `/rename`, `/compact`, stop and the model picker.

Planned features:

- Select a space.
- Create sessions on Ren first.
- Move a local session to a Ren space. This needs a new Ren import endpoint.
- Multiplayer: messages from other users appear as user messages with the sender's name.
- Rename.
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

OpenCode resolves a local directory through its `package.json` `exports`, as it does a published package, so all three parts load from `src`. The TUI loads the TUI part of each plugin its server loads. OpenCode provides `effect` and `@opencode/plugin` to the plugin at runtime.

## Dependencies

`@opencode/plugin` and `effect` are peer dependencies: OpenCode provides its own copies at runtime. They are dev dependencies too, for typecheck and tests.

`@ren/client`, `@ren/chat`, `@ren/schema` and `@ren/protocol` are private workspace packages. They become dependencies when code uses them, and the build bundles them.

## Build and release (not built)

A build script will bundle the Ren packages into `dist` and keep `effect` and `@opencode/plugin` external, then point `exports` at the bundle. Publish only the built package, and test the installed package in a stock OpenCode release, not only this directory.

## Commands

```sh
bun typecheck
bun run lint
bun run test
REN_SLOW=1 bun run test   # also the slow tests, such as a link to a real brain
bun script/whoami.ts   # the signed-in user, through the plugin's connection
```

The end-to-end test `packages/e2e/tests/opencode.spec.ts` signs in with the `ren` CLI against a real server and checks that the plugin uses and renews that login.
