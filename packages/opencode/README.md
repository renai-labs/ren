# @renai-labs/opencode

An OpenCode plugin that makes the OpenCode TUI a Ren client. A user's local OpenCode sessions keep working beside their Ren sessions.

Only the scaffold exists: the three parts load and do nothing. Everything below marked _not built_ is the plan.

## What belongs here

- The plugin's server, TUI and RPC parts.
- Translation between Ren's Chat API and OpenCode's sessions and models.
- Sign-in and the credentials the plugin keeps.

## What does not

- Ren's API and Chat API clients (`@ren/client`) or the chat connection (`@ren/chat`): use them.
- OpenCode internals: everything goes through `@opencode/plugin`.
- Imports from `core`, `db`, `server`, `host-api`, `hand-api` or `cell`.

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

## Planned layout (not built)

| Module     | Holds                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| `auth`     | Sign-in and credentials.                                                               |
| `ren`      | The Ren API and Chat API clients.                                                      |
| `link`     | One Chat API client and event stream per Ren root session, with `chat.access` refresh. |
| `turn`     | Pure conversion of Ren session events into `LanguageModelV3` stream parts.             |
| `model`    | The `LanguageModelV3`.                                                                 |
| `provider` | Provider and model registration.                                                       |
| `binding`  | The `ren` session metadata.                                                            |
| `mirror`   | Remote activity into the local session.                                                |
| TUI        | The `/ren:*` commands.                                                                 |

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
```
