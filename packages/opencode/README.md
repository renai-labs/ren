# @renai-labs/opencode

An OpenCode plugin that makes the OpenCode TUI a Ren client. A user's local OpenCode sessions keep working beside their Ren sessions.

The three parts load. Signed in, the server part registers the provider `ren`, and a local session with a `ren/<model>` model runs its turns on a Ren brain. `/ren:login` and `/ren:logout` sign in and out, `/ren:space` selects the Ren space, `/ren:new` starts a Ren session in it, `/ren:move` moves a local session there with its history, and `/ren:sessions` opens one started anywhere (Open and catch up). Built: `turn`, `auth`, `ren`, `link`, `binding`, `model`, `mirror`, `title`, `requests`, `provider`, `controls`, `outgoing`, `history`, `sessions`, `rpc`, `handlers`, `commands`, `support` and the TUI part (see Modules), and the build of the publishable package (Build and release). Messages that other people and clients write in a Ren session show in the local session (Multiplayer), a rename on either side reaches the other (Rename), the built-in model picker, `/compact`, archive, delete and fork act on a Ren session (Session controls), and the brain's permission requests and questions show as OpenCode's own prompts (Permissions and questions). A prompt's files, agent mentions and skills reach the brain with it (Attachments). Everything marked _not built_ is the plan in [`specs/opencode-plugin.md`](../../specs/opencode-plugin.md).

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

| Module     | Holds                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `turn`     | Pure conversion of Ren session events into `LanguageModelV3` stream parts.                         |
| `auth`     | `RenAuth`: the server URL and a currently valid token; `RenAuth.Login`: sign-in and sign-out.      |
| `ren`      | `RenApi`: the Ren API client (`@ren/client/effect`) with the token of the moment.                  |
| `link`     | `Link`: one Chat API client and event stream per Ren root session, with `chat.access` refresh.     |
| `binding`  | `Binding`: the `ren` session metadata, new local Ren sessions and the selected space.              |
| `model`    | `RenModel`: the `LanguageModelV3` that runs a local turn on the Ren session's brain.               |
| `provider` | `RenProvider`: the provider `ren`, its models, and the session hooks of a Ren session.             |
| `rpc`      | `RenRpc`: the contract between the server part and the TUI part.                                   |
| `handlers` | `RenHandlers`: the server part's RPC handlers.                                                     |
| `commands` | `RenCommands`: what each `/ren:*` command does, over the part of the TUI context it uses.          |
| `tui`      | The TUI part: the commands, the space in the footers, and the local forms of Ren questions.        |
| `mirror`   | `Mirror`: messages from other clients of a Ren session into the local session, and their turns.    |
| `title`    | `Title`: the title of a Ren session, kept the same locally and on Ren.                             |
| `controls` | `Controls`: the built-in model picker, `/compact`, archive, delete and fork on a Ren session.      |
| `requests` | `Requests`: the brain's permission requests and questions as local ones, and the answers.          |
| `outgoing` | `Outgoing`: a local user message as a Chat API prompt; its files go to the space's drive.          |
| `support`  | `Support`: the OpenCode releases the plugin supports, checked at load and used for the peer range. |
| `history`  | `History`: Chat API messages as OpenCode export messages, and the catch-up rules.                  |
| `sessions` | `Sessions`: the session list, and the transcript to import on open and catch-up.                   |

## Connection

The server URL is the plugin option `url`, then `REN_URL`, then `https://api.useren.ai`. Only `http` and `https` URLs are accepted.

The token is `REN_TOKEN`, else the `ren` CLI's login in `${XDG_CONFIG_HOME:-~/.config}/ren/credentials.json` for the server's origin, so `/ren:login` and `ren login` sign in both. The plugin reads the file on each request for a token, so a later `ren login` or `ren logout` applies without a restart. Within 60 seconds of `expiresAt` it renews the login with the stored refresh token, as the CLI does (the same discovery, `client_id` and `resource`), and writes it back in the CLI's format, atomically, with mode `0600`. Concurrent requests share one renewal. When the server refuses the renewal because the CLI already rotated the login, the plugin uses the CLI's new login.

Without a token, or when the server refuses the renewal, `RenAuth.token` and `RenApi.client` fail with `RenAuth.SignedOut`, whose message says to run `/ren:login`. Other failures (an unreadable file, an unreachable server) are `RenAuth.AuthError`.

The file format, the discovery and the renewal are a port of `packages/cli/src/services/{credentials,oauth,connection}.ts`: the plugin cannot depend on the private CLI package. Change both together.

The plugin runs in OpenCode's process with only `Scope` in its context, so it provides its own platform services: `FetchHttpClient` from `effect/http` for HTTP, and Bun and `node:fs` for the credentials file, because `effect`'s `FileSystem` needs a platform package that OpenCode does not provide to plugins.

### Sign-in

`/ren:login` is the CLI's `ren login`, run by the server part, which owns the credentials file:

- `RenAuth.Login.authorize` discovers the endpoints, listens on `127.0.0.1` on a free port for `/callback`, and returns the authorization URL: authorization code with PKCE (S256), the CLI's `client_id`, scope `openid offline_access ren`, `resource` and a random `state`. A request to the listener with another `state` gets 400 and changes nothing. The first one with the right `state` ends the wait, and the listener closes.
- The TUI opens the URL in the browser (`open` on macOS, else `xdg-open` when it exists) and shows it in a dialog that closes once the sign-in ends. When the browser cannot reach the listener (the server part runs on another machine, see below), the user pastes the address the browser was sent to; `redirect` accepts it when its `state` matches. Closing the dialog cancels the sign-in and closes the listener.
- A denied consent or no answer within 5 minutes fails it (`RenAuth.SignInFailed`, with Ren's `error_description` when it sends one). Otherwise the code is exchanged with the verifier, the new token is checked with `me.get`, and the login is stored in the CLI's format for this server's origin, keeping every other server's.
- Then the plugin lists the selected space's models at once and sends the RPC event `signedIn`, so every TUI shows the space in its footers without a restart.
- `/ren:login` while signed in names the account and asks before it signs in again.

`/ren:logout` revokes the refresh token at the server's `revocation_endpoint` (errors are ignored, as in the CLI), removes this server's login only, lists the models again (none, so they disappear) and sends `signedOut`. With `REN_TOKEN` set both commands say that the token comes from the environment and do nothing.

The plugin signs in as the CLI's OAuth client (`Auth.cliClient`, named "Ren CLI" on the consent page). Ren binds a refresh token to the client that got it, and both tools renew the one login in the shared file, so they must be the same client. A client of its own would need its own hosted metadata document and the client recorded with each stored login, which changes the CLI's file format.

When the TUI runs on another machine than the server part, the browser opens on the TUI's machine and its redirect to `127.0.0.1` reaches nothing; the dialog's paste field finishes the sign-in. The server part's listener closes after 5 minutes.

Ren is not an integration in OpenCode's `/connect`: an integration's OAuth method stores the tokens in OpenCode's own credential store, a second copy of a refresh token that Ren rotates at each renewal (spec, L17s).

## Link

`Link.Service.open(sessionId)` gives the link of a Ren root session, in a `Scope`. While any scope holds it, every caller gets the same link; when the last one closes, its event stream stops.

A link is `ChatAccess` and `Connection` from `@ren/chat`, wired as `ChatSession` wires them for the web and mobile apps, so the rules are one copy:

- `client` is a Chat API client with a valid token. It calls `chat.access` through `RenApi`, polls every 2 seconds while the brain starts, and fails with `ChatAccess.AccessFailed` when the brain failed or its space stopped. It authenticates to the brain's URL with Basic `ren:<token>` and asks again within a minute of `expiresAt`. After a gateway 502 or 504, a transport error or two connect timeouts, the next `chat.access` says `unreachable`. The URL can change at each access.
- `frames` subscribes to the session's events from that moment. The stream reconnects with backoff and asks for access again after it drops or ends with `stream.ended`. Events are not replayed: each connect starts with `server.connected`, after which a consumer reads what it needs again. A consumer that subscribes while the stream is connected gets a `server.connected` first, so every consumer starts the same way.
- `boot` (checking, starting with its phase, ready, failed with its reason, stopped), `status` and `retryAt` are `SubscriptionRef`s.
- `wake` reconnects a parked stream. `lost` marks the brain unreachable after a request that it refused with 401.

## First turn

Signed in, the plugin lists the models of the selected space (`chat.models`) as `ren/<endpoint>/<model>`, with their variants. Their context limit is 0, so OpenCode never compacts a Ren session locally: the brain owns its context. Cost is zero, because Ren lists no prices. Signed out, or when Ren does not answer at load (it waits at most 5 seconds), it registers nothing, and it asks again every 5 minutes, so a later `ren login` adds the models without a restart. After `/ren:login` and `/ren:logout` it asks at once.

The selected space is the one `/ren:space` stored, else the plugin option `space` (a space ID or slug), else the first space you joined. The models are the selected space's.

For a primary request `doStream`:

1. Reads the OpenCode session ID from `x-opencode-session-id` and the request kind from `x-ren-request-kind`, which the plugin's `model.request` hook sets.
2. Reads the binding. A session whose binding names another session is a copy (a fork) and is refused, and so is a fork without a Ren session (Session controls).
3. Reads the local messages (`session.context`). The candidates are the user messages after the last assistant message that completed without an error.
4. Without a binding, a session with a finished local answer is refused with a message to run `/ren:move`, so its history is never left behind. Without a Ren session in the binding, creates it with the local session's ID, the binding's space (else the selected space) and the model (`session.create`), then writes the binding.
5. Opens the link for this turn, subscribes, and waits until it is connected.
6. On the first `server.connected`, asks the brain which candidates it has (`session.message`) and sends the others with `session.prompt`, the local message ID as `id`, `delivery: "steer"`, with their files, agents and skills (Attachments). Before it sends to an existing Ren session, it switches the brain to the local model (Session controls).
7. The turn starts at `session.inbox.delivered` of a sent message; earlier events are ignored. `turn` converts the events until the execution ends, or until the brain delivers a user message that is not one of the candidates (Multiplayer).
8. When nothing was sent (the brain has every candidate), and after every later `server.connected` (a reconnect, events may be lost), it reads the state again: once the brain has every candidate, a busy session means the turn runs (follow it), an idle one that it ended (finish).

Stopping the local turn cancels the stream, which calls `session.interrupt`. OpenCode does not retry a Ren turn (the `retry` hook): the brain retries model calls itself. The `title` hook answers with the Ren session's title, or none yet, so OpenCode never asks the model for a title. One-off generations fail with a message and never reach the brain; `/compact` compacts on the brain (Session controls).

## Attachments

A local prompt reaches the brain as the local model would have received it (`Outgoing`):

- **Text.** The stored user message's `text`, unchanged. OpenCode keeps no separate display form, so no `presentation` is sent.
- **Files.** OpenCode reads a prompt's files when it admits the message (`@` mentions the TUI turned into attachments, drag and drop, pasted images and PDFs) and stores their bytes with it: a line range (`?start=&end=`) as those lines, a folder as its listing. `doStream` reads them from `session.context`, uploads each to the space's drive at `chats/<sessionId>/uploads/<messageId>/<name>` (`drive.startUpload`, then the form POST), and sends `files: [{ path, name }]`, as the web app does. The brain types a drive file by its name, so a name gets the extension of its type when it lacks one (`Pasted image.png`), a text file without a text extension gets `.txt`, a folder becomes `<name>.listing.txt`, and a second file with the same name becomes `<name> (2).<ext>`.
- **Agents and skills.** Before it sends a message with agent or skill mentions, `doStream` reads the brain's `agent.list` and `skill.list`. A mention passes, with its position in the text, when the brain has that agent or skill (by ID, else by name). Another agent mention is left out; its `@name` stays in the text, which is all a local model gets of it. A local skill the brain lacks goes as a file, `<name>.skill.md`, with the skill's text, which the local model would have read.
- **Retries.** Only messages the brain does not have are uploaded and sent; a retried turn uploads a message's files again to the same paths, which replaces them.
- **Refusals.** More than 10 files in a message (skill files count) fail the turn before anything is uploaded or sent. A file Ren's drive does not take fails the turn with Ren's reason, and the message is not sent. A brain whose chat cannot read the space's drive refuses the message, and the turn fails with its reason.

A typed `@path` that the TUI did not turn into an attachment stays text: the brain reads it as a path on its hand. The agent picked in the TUI does not change the remote turn's agent: the Ren session keeps its own.

## Multiplayer

Other members, and the signed-in user's other clients (the web app, Slack, schedules, a teammate's OpenCode), write in the same Ren session. While a Ren session is in use here, a user message that the brain delivers and that the local session does not have becomes a local user message, and its turn streams into the local session like a local turn. Nothing is sent to the brain for it.

- **In use.** A Ren session is watched from its first local turn in this OpenCode process (`Mirror.Service.watch`, which `doStream` calls; a later feature that opens a Ren session calls it too). The mirror holds the session's link and reads its events until the brain ends the event stream as idle (`stream.ended` with `idle`: no execution and no events for the brain's `CHAT_IDLE_MS`, 2 minutes), then lets it go, so an idle OpenCode keeps no brain awake. An open Chat API event stream holds the brain's harness open. At most 4 sessions are watched; a fifth lets go of the one used longest ago. A message delivered while the session is not watched, or while the event stream reconnects, is not shown live; catch-up brings it in (Open and catch up).
- **What appears.** At the brain's `session.inbox.delivered` of a message that the local session does not have, the mirror reads the message (`session.message`). A user message is admitted with `ctx.session.prompt`, with the Ren message ID as its `id`, `delivery: "steer"`, `resume: true` and the metadata `{ userID, userName, remote: true }`. Synthetic and compaction deliveries are not shown. The local session starts a step, and `doStream` streams the remote turn.
- **The name.** The stock TUI shows only a user message's text, so the text starts with `<name>: `. The name is the sender's in the space's member list (`space-member.list`, read once per space and again for an unknown member), else `Member`. A message from the signed-in user (`me.get`) has no prefix. A message from a channel, schedule, webhook or task shows `<sender> via Slack`, `Schedule <name>`, `Webhook <name>` or `Task <identifier>` instead. The brain never reads the local text: it has the original.
- **No echo.** A message this OpenCode sent is already in the local session, so it is not admitted again. A mirrored message is never sent: `doStream` reads `remote: true` from its metadata. Admitting an ID the local session has is a no-op, so a delivery seen twice adds nothing.
- **The turn of a mirrored message.** From the delivery the mirror records the session's events until that message's step claims them (`Mirror.Service.replay`), so the step streams the turn from its delivery even when it starts after the brain began, and no event goes to two steps. Without a record (a restart, a dropped record) the step uses the rule of a message the brain already has: follow a busy session, finish an idle one.
- **Two messages at once.** One remote execution can answer several messages: a steer is delivered after the running step and answered by the next step of the same execution. A local step ends at the delivery of a user message that is not one of its own, once its own were delivered; that message's own step streams the rest. So a teammate's steer during a local turn shows after the local answer, with its own answer. A local prompt during a mirrored turn waits until that step ends, as a steer during any Ren turn does, and is then sent.

Limits: a remote turn already running when the session is opened, and messages delivered while it was not watched, are not shown live (catch-up brings them in later). Two messages delivered back to back can leave one local step empty. Synthetic continuations (a subagent's result, a scheduled wake) stream inside the step that is running, or not at all when no step runs.

## Rename

A Ren session has one title, locally and on Ren (`Title`).

- **Local to Ren.** The plugin reads the location's `session.renamed` events. A local rename of a Ren session (its binding has `sessionId`, and it is that session, not a copy) calls Chat API `session.rename` through the session's link. Both the built-in `/rename` and `session.update({ title })` cause one. The plugin reads `session.get` first and skips the call when the brain already has the title or the session's capability `rename` is false. It skips empty titles and sends renames one at a time, in order.
- **Ren to local.** While the session is watched (Multiplayer), the brain's `session.renamed` for the session itself (not a subagent's) sets the local title with `ctx.session.update`. At each connect of the watched link the plugin reads the brain's title (`session.get`), so a rename made while the session was not watched shows at its next turn.
- **No echo.** The plugin never sends back a title that it set locally, whether from a Ren rename or from the `title` hook (OpenCode shortens that one to 100 characters). It does not apply the brain's echo of a rename this OpenCode sent. It drops a Ren title that arrives while a local rename is on its way, because the local one lands after it.
- **Before the Ren session exists.** A session from `/ren:new` that is renamed before its first prompt has no Ren session yet. At the first connect, if the brain has no title and the local session has one, the plugin sends the local title, so the brain does not replace it with a generated one. A local session that is not a Ren session sends nothing.
- **Brain not reachable.** The rename stays local and the plugin logs a warning. It waits at most a minute (for a starting brain). The plugin sends the title at the session's next connect in this OpenCode process. A restart forgets the title, and the brain's title then wins.

## Session controls

The built-in controls act on a Ren session (`Controls`, registered from the server part):

- **Model picker.** Picking another `ren/<model>` or variant changes nothing on Ren until the next local prompt: before `doStream` sends a message to an existing Ren session, it reads the brain's model (`session.get`) and, when it differs from the local model and variant, calls `session.model.switch`. This is the web app's rule (the switch goes with the next sent message), it holds after a restart because it compares states instead of reacting to an event, and a mirrored turn, which sends nothing, never switches. A model the session's space does not offer fails the turn with Ren's reason and sends nothing; a session whose `model` capability is off fails it too.
- **A local model on a Ren session.** OpenCode has no veto, so the plugin switches back. Before each prompt is admitted (the `prompt` hook) and on `session.model.selected`, a session bound to its Ren session whose model is not a `ren` model gets its last `ren` model back, with a notice in the session. Because the hook runs before the prompt's step starts, a prompt never runs on the local model. To continue a Ren session on a local model, fork it.
- **`/compact`.** The `compaction` hook calls `session.compact` on the brain, waits for the brain's `session.compaction.ended` (or `failed`, or, after a reconnect, reads the compaction message), and returns the brain's summary, so OpenCode stores a local compaction with that summary and calls no model. The local history then starts at the compaction, and `doStream` sends only messages written after it. When Ren refuses (the `compact` capability is off, the brain fails or is unreachable), the local compaction fails with Ren's reason.
- **Archive.** Archiving a local Ren session archives the Ren session (`session.archive`). Ren has no unarchive: unarchiving the local session leaves the Ren session archived and says so in a notice.
- **Delete.** A local copy is a view: deleting it never archives or deletes the Ren session. It stops the mirror's watch and its link.
- **Fork.** Ren has no fork. A fork of a Ren session copies its metadata, so on `session.forked` the plugin removes the fork's `ren` binding and adds a notice. The fork keeps its `ren/*` model but no Ren session, and its prompts are refused with what to do, because a new Ren session would lose the history: pick a local model to continue it locally.

Notices are synthetic messages with a description (`resume: false`), which the TUI shows as a notice row; the brain never receives them. A compaction that someone else starts on Ren is not shown locally.

## Permissions and questions

When the brain stops a turn to ask (a permission request or a question), the local session shows OpenCode's own prompt, and the answer goes to the brain (`Requests`, fed by the mirror's frames). The local turn keeps streaming: the remote execution goes on after the answer.

- **Which requests.** Those the brain asks while the Ren session is watched (Multiplayer), on the session and on its subagents. At each connect of the watched link the plugin lists them again (`session.permission.list` and `session.form.list` for the session and its `session.children`, as far as the capabilities `permissions` and `forms` allow), so a request asked while the session was not watched shows when it is watched, and one answered meanwhile closes. All show on the local session itself, as the web app shows a subagent's request in the parent chat.
- **Permissions.** The server part asks OpenCode with `ctx.permission.assert` on the local session: the action, resources and metadata of the Ren request, with `metadata.ren` naming it. The stock TUI shows its own permission prompt. The plugin's `evaluate` hook makes such a request always ask, so no local allow rule answers it. Allow once, always (shown when the request has `save`) and reject go to `session.permission.reply` on the requesting session, with the rejection's message. The `save` patterns are shown with ` (on Ren)`, because OpenCode stores them as saved rules of the local project when the user picks always; that suffix keeps them from matching any local resource.
- **Questions.** A server plugin cannot create a form, so the server part sends the RPC event `formAsked` and each TUI creates the local form with `session.form.create`, with the Ren form's ID and fields (the first TUI wins; the others get a conflict). The stock TUI shows its own form, one tab per field. The local answer goes to `session.form.reply`, a dismissal to `session.form.cancel`. Web search consent (`websearch.provider`) is a form like any other.
- **Answered elsewhere.** When another member or client answers first, or the turn stops, the brain's `permission.replied`, `form.replied` or `form.cancelled` closes the local request (the plugin answers a local permission `once` itself and forwards nothing; a TUI cancels the local form), and the RPC event `requestClosed` makes each TUI show a toast that says so.
- **Expired questions.** As in the web app, a question (`kind: "question"`) that the brain cancels stays open locally. Its answer, or an answer that Ren refuses because the question is gone, goes to the session as a new local prompt that quotes each question, with the text of the web app's `ChatSession.quote` (a copy: importing `chat-session` would bundle the whole chat runtime).
- **Late TUIs.** A TUI that starts or reconnects calls the RPC method `requests`, creates the pending forms and cancels local forms that closed while no TUI listened.

Stopping the local turn while a request is pending interrupts the remote turn as before; the brain then closes the request. Limits: spec L20p to L22p.

## Open and catch up

A Ren session started elsewhere (the web app, a teammate, Slack, a schedule, another machine) opens as a local copy, and a local copy that fell behind Ren is brought up to date (`Sessions`, `History`, `RenCommands.sessions`, `open`, `catchUp`).

- **List.** `/ren:sessions` lists the selected space's sessions, newest activity first (Ren's `session.list`, 50 per page): your own, or with `ctrl+s` everyone's in the space. Each row shows the title, who started it ("You" or the member's name), when it was last active, working or idle, its origin unless it is a chat, and `local` when a local copy exists. Typing filters the listed rows; `ctrl+f` asks Ren to search titles and message text. The RPC `listSessions` also takes `status`, `origin`, `page` and `pageSize`.
- **Open.** Choosing a session calls `openSession`. Without a local copy the server part reads Ren's saved transcript (Ren API `chat.messages`, which works while the brain starts or is stopped), turns it into OpenCode's export shape and returns it; the TUI part imports it with OpenCode's `experimental.session.import` (a server plugin cannot import) under the Ren session's ID, then calls `openSession` again, which watches the session (`Mirror.Service.watch`), and opens it. The copy has the Ren title, the binding `ren: { spaceId, sessionId }`, the model `ren/<provider>/<model>` of the newest assistant or model switch (else the space's default), and every message under its Ren message ID.
- **What the copy holds.** Chat API messages are OpenCode's messages with Ren's fields lifted out of `metadata`, so the conversion puts them back: a user message from someone else gets the mirror's name prefix and origin label and `{ userID, userName, remote: true }`, the signed-in user's own messages have no prefix, model refs become `ren` models, and text parts lose `time`. Tool parts keep their `metadata`, so an imported tool row renders as the TUI's own row (a read shows "Explored: 1 read"), unlike a live-streamed one (L1). Running messages are left out, as OpenCode's import does.
- **Nothing reaches Ren.** Opening sends no prompt, rename, model switch or archive: the import publishes only `session.created`, which `Title` and `Controls` ignore.
- **Catch-up.** When the TUI shows a Ren session, and each time that session goes idle, and when `/ren:sessions` opens one that has a copy, the plugin compares the copy with Ren's newest 20 saved messages: it is behind when Ren has, after the newest message both have, a user, synthetic or compaction message the copy lacks, or an answer while the copy has none. A behind copy is removed and imported again under the same ID (the mirror stops watching it before the removal and watches it again after the import), and the TUI reloads its messages and shows it again. The comparison uses message IDs, so a copy that streamed its own turns (whose assistant messages have local IDs) is not behind.
- **Never lose local work.** The copy is not replaced while its local turn runs, while its inbox holds queued items, or while it has user messages after its last answer that Ren does not have (unsent because the brain was unreachable); a notice says why, and the next prompt sends the unsent ones. After a refresh, `doStream`'s candidates are the messages after the last imported answer, so the next prompt sends only itself.

Limits: subagent child sessions are not imported, so a subagent row's link leads nowhere. Catch-up runs from a TUI only, for the session it shows. A refresh of the shown session goes home with OpenCode's "The current session was deleted" toast for a moment. Local notices, failed local turns and local model switches are dropped by a refresh. A transcript larger than an RPC response (32 MiB) cannot be opened.

## Commands

Every command the plugin adds is `/ren:<command>`, in the slash completion and in the command palette under Ren.

- `/ren:space` lists the spaces you joined, with the selected one marked, and searches them by name. Choosing one selects it.
- `/ren:login` signs in through the browser and `/ren:logout` signs out (Sign-in).
- `/ren:new` creates a local session bound to the selected space, with the prompt's `ren/<model>` model when the space offers it, else the space's default, and opens it.
- `/ren:move` moves the open local session to the selected space (Moving a session).
- `/ren:sessions` lists the Ren sessions of the selected space and opens the chosen one (Open and catch up).

Signed out, they say to run `/ren:login`. The home and prompt footers show `ren · <space>`.

### Selecting a space

The server part keeps the selection in plugin storage, which is OpenCode's database: one selection for every directory and OpenCode process, kept across restarts. Selecting a space stores it, wakes its brain (`chat.prepare`, without waiting; a failure does not fail the selection), lists its models, and sends the RPC event `spaceSelected`, which updates the footers of every TUI. `/ren:new` also wakes the brain. A server part in another directory is expected to list the new space's models at its next refresh, within 5 minutes (not run).

`/ren:new` creates the Ren session at the first prompt, as the web app does, so a session nobody writes in never reaches Ren.

### RPC

`RenRpc.Definition` (id `ren`). Every method takes an object and can fail with `signed_out` (`data: { server }`, the message says to run `/ren:login`) or `unavailable` (`data: {}`, the message says what failed).

| Method          | Input                               | Output                              |
| --------------- | ----------------------------------- | ----------------------------------- |
| `listSpaces`    | `{}`                                | `{ spaces: SpaceInfo[], selected }` |
| `getSpace`      | `{}`                                | `SpaceInfo`, the selected space     |
| `selectSpace`   | `{ spaceId }`                       | `SpaceInfo`                         |
| `createSession` | `{ model?: { id, variant? } }`      | `{ sessionID, spaceId }`            |
| `account`       | `{}`                                | `{ server, environment, user }`     |
| `login`         | `{ attempt }`                       | `{ url }`                           |
| `completeLogin` | `{ attempt, url }`                  | `{}`                                |
| `cancelLogin`   | `{ attempt }`                       | `{}`                                |
| `logout`        | `{}`                                | `{ server, signedOut }`             |
| `moveSession`   | `{ sessionID, transcript, model? }` | `{ sessionID, spaceId }`            |
| `requests`      | `{}`                                | `{ forms: LocalForm[], closed }`    |
| `listSessions`  | `Filter`                            | `{ sessions, space, page, total }`  |
| `openSession`   | `{ sessionId, existing?, … }`       | `{ sessionID, outcome, import? }`   |

`SpaceInfo` is `id`, `slug`, `name`, `kind` and `description` from Ren's `Space.Info`. `Filter` is `scope` (`mine`, the default, or `space`), `status`, `origin`, `search`, `page` and `pageSize`; `listSessions` also returns `pageSize`, and each `SessionSummary` has `id`, `title`, `startedBy`, `mine`, `origin`, `status`, `updated` and `local`. `openSession` takes `existing` (only a session with a local copy), `imported` (just imported: only watch it) and `queued` (the local inbox holds items); its `outcome` is `current`, `import` (with the transcript to import), `busy`, `unsent` or `local` (not a Ren session). The event `spaceSelected` carries the new `SpaceInfo`. `user` is `{ name, email }` or `null`. `login` starts a sign-in under an `attempt` ID that the TUI chooses and returns once the listener is up; a new one cancels the one before. Its end comes as the event `signedIn` (`{ attempt, user }`) or `loginFailed` (`{ attempt, message }`), so a TUI subscribes before it calls `login` and keeps the events of its own attempt. `signedOut` carries the `server`. `formAsked` carries a `LocalForm` (`sessionID`, `id`, `title`, `metadata.ren`, `fields`: the input of `session.form.create`); `requestClosed` carries `{ sessionID, id, kind, message }`; `requests` returns the pending `LocalForm`s and the local forms to cancel (`closed`: `{ sessionID, formID }`). The schemas are Effect schemas wrapped with `Schema.toStandardSchemaV1`, so the TUI's Promise client accepts them, and keep the same shape encoded and decoded, because the Promise client returns the server's JSON without decoding it.

To add a feature: add its methods and events to `rpc.ts`, its handlers to `handlers.ts` (map failures with `answer`), its command logic to `commands.ts` as plain functions over `Surface`, and its keymap entries or slots to `tui.tsx`. Test the handlers through a real OpenCode (`OpenCodeHost`, `host.client.rpc(RenRpc.Definition)`), and the commands with `host.promise`, the Promise client a TUI gets, and a recording stand-in for the dialogs, toasts and router. No test runs `tui.tsx`: OpenCode does not publish its TUI, so check the keymap entries and slots by hand in a stock OpenCode (Install).

Built-in commands keep their names and act on Ren sessions through hooks and events: `/rename` (Rename), `/compact` and the model picker (Session controls), and stop.

Planned commands: `/ren:retry`. Planned features:

- The web app chat's features, where the stock TUI allows them.

## Moving a session

`/ren:move` asks to move the open session to the selected space, naming it. The TUI part exports the session (`experimental.session.export`, which only the TUI's client has; a server part cannot export) and sends the export to the server part (`moveSession`), which:

1. Refuses a session that is already a Ren session or a copy of one, and an export over 32 MiB (`Session.maxImportBytes`, Ren's limit for the request), before it reaches Ren.
2. Calls Ren's `session.import` with the local session's ID, the selected space, the prompt's `ren/<model>` (else the space's default) and the export as OpenCode sent it. Ren converts the export into OpenCode's own rows, stores them, and starts the brain, which restores them (`origin: "opencode"`, the local title).
3. Binds the local session to the Ren session, switches it to the `ren/<model>`, and watches it (Multiplayer).

The local transcript stays as it is. The next prompt sends only that message: the brain has every earlier one, with the same IDs. A last user message that no answer followed is on the brain too: the next prompt's execution answers it first, then the new message, and the local turn shows both answers.

Every step can run again: Ren's import of the same ID by the same person into the same space starts the brain again and changes nothing else, and a session already bound is only switched to the Ren model and watched. A failed move leaves the session local; the toast says why (signed out, not allowed in the space, too large).

Changing a session's model to `ren/<model>` is not a move: a session with a finished local answer is refused on its next prompt with a message to run `/ren:move`. A session with no answer yet is created in Ren at its first prompt, as from `/ren:new`.

Limits: Ren does not get the session's subagent sessions, its fork lineage or its staged revert, and OpenCode's export leaves out unfinished messages. The history's tool calls refer to files on this computer; the brain continues on its own hand, so the repository must be reachable in the space for the brain to go on with the work.

## Install

Not published yet (Build and release). Once it is:

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

`url` is the Ren server (default `REN_URL`, then `https://api.useren.ai`); sign in to it with `/ren:login` or `ren login`, or set `REN_TOKEN`. `space` is a space ID or slug, used until `/ren:space` selects one (default: your first joined space).

OpenCode resolves a local directory through its `package.json` `exports`, as it does a published package, so all three parts load from `src`; the built `dist` loads the same way. The TUI loads the TUI part of each plugin its server loads. OpenCode provides `effect` and `@opencode/plugin` to the plugin at runtime.

## Dependencies

`@opencode/plugin` and `effect` are peer dependencies: OpenCode provides its own copies at runtime, to the server part and to the TUI part. `@opentui/core`, `@opentui/solid` and `solid-js` are peer dependencies of the TUI part: the TUI provides them and compiles `tui.tsx` with Solid. All are dev dependencies too, for typecheck and tests, with `@opencode/theme` for the theme's types; `tsconfig.src.json` adds the `DOM` lib because Solid's `JSX.Element` names DOM's `Node`.

`@ren/client`, `@ren/chat`, `@ren/schema` and `@ren/protocol` are private workspace packages. They become dependencies when code uses them, and the build bundles them. The published manifest has no dependencies and widens the peers (Build and release).

## Supported OpenCode

`Support.opencode` (`src/support.ts`) is the range of OpenCode releases the plugin supports: `>=2.2.6 <2.4.0`. 2.2.6 is the first release whose `effect` is 4.1.0, the version the bundled Ren packages are built with, and the release every fact in the spec was run on; the source also typechecks against `@opencode/plugin` 2.3.2. At load, the server part and the TUI part read the host's version (`ctx.app.version`, `context.app.version`). Outside the range the server part logs one warning, the TUI part shows one toast, and neither registers anything. A version that is not a release `X.Y.Z` (a dev, beta or local build, or an embedded host's `unknown`) is not checked. Widen the range in that one place after you test a new OpenCode release; the build writes it as the `@opencode/plugin` peer range.

## Build and release

```sh
bun run build                     # dist/, version from package.json
bun run build --version 1.2.3     # the version to publish
```

`script/build.ts` bundles the three parts (`src/server.ts`, `src/tui.tsx`, `src/rpc.ts`) with `Bun.build` (target `bun`, ESM, code splitting) into `dist/server.js`, `dist/tui.js`, `dist/rpc.js` and shared chunks, and writes `dist/package.json`. `dist` is the whole package: publish that directory, never this one (this `package.json` is `private`).

- **Inlined:** `@ren/client`, `@ren/chat` (only `chat-access` and `connection`, so no React and no timeline), `@ren/schema`, `@ren/protocol` and `ulid`. About 440 KiB for the server part, 33 KiB for the chunk with the RPC contract, 8 KiB for the TUI part.
- **External, provided by OpenCode:** `effect` and `effect/*` and `@opencode/plugin/*` (OpenCode's plugin runtime resolves them to its own copies and refuses a plugin's own copy), and for the TUI part `solid-js`, `@opentui/core` and `@opentui/solid` (OpenTUI's runtime plugin support in the TUI). The build fails when a copy of one of them ends up in the bundle.
- **The TUI part is built JavaScript.** OpenCode's TUI compiles `.tsx` with the Solid transform only outside `node_modules` (`createSolidTransformPlugin` in `@opentui/solid`), so an installed plugin's `.tsx` would not get it. The build applies the same transform OpenCode's own build uses (`@opentui/solid/bun-plugin`, universal, `@opentui/solid`), and the TUI rewrites the resulting `@opentui/solid` and `solid-js` imports to its own instances.
- **The manifest** has `exports` for `.`, `./tui` and `./rpc`, `files`, the license, `publishConfig`, no dependencies, and peer dependencies on what the host provides: `@opencode/plugin` in `Support.opencode`, `effect` `^4.1.0`, `@opentui/*` `^0.8.1` and `solid-js` `^1.9.17`, the versions OpenCode 2.2.6 to 2.3.2 ship. All are optional, as `@opencode/plugin`'s own TUI peers are, so the install (npm Arborist, which installs required peers) never downloads them.
- **No types.** `./rpc` ships without declarations: they would name the private `@ren/schema` types. Only the TUI part imports the contract today.

`test/build.slow.test.ts` builds into a temporary `node_modules/@renai-labs/opencode` with nothing else around it, as an install leaves it, and checks what is inlined, resolves the parts with `Host.resolve`, runs a turn and an RPC call in a real OpenCode with OpenCode's plugin runtime (`ensurePluginRuntime`), and loads the TUI part with the modules the TUI provides.

To try the built package by hand in the stock `opencode`, pack it and unpack it into a `node_modules` folder, then point a plugin entry at it (an isolated `HOME` and `XDG_*` keep your own config out):

```sh
bun run build && (cd dist && npm pack --pack-destination /tmp/ren-oc)
mkdir -p /tmp/ren-oc/node_modules/@renai-labs && tar -xzf /tmp/ren-oc/renai-labs-opencode-0.0.0.tgz -C /tmp/ren-oc/node_modules/@renai-labs
mv /tmp/ren-oc/node_modules/@renai-labs/package /tmp/ren-oc/node_modules/@renai-labs/opencode
# plugins: [{ "package": "/tmp/ren-oc/node_modules/@renai-labs/opencode", "options": { "url": "…" } }]
```

Release (manual; no workflow publishes it yet): run the package checks and `REN_SLOW=1 bun run test`, check the newest OpenCode release by hand and widen `Support.opencode` if it works, then `bun run build --version X.Y.Z` and `npm publish dist` (or `bun publish --cwd dist`).

## Commands

```sh
bun typecheck
bun run lint
bun run test
REN_SLOW=1 bun run test   # also the slow tests: a link to a real brain, a /ren:new session's turn on a real brain, teammates, renames, a model switch and /compact on a real brain, a moved session on a real brain, opening and catching up a session a real brain answered, a permission request and a question on a real brain, agent mentions and a drive file sent to a real brain, and the built package
bun run build
bun script/whoami.ts   # the signed-in user, through the plugin's connection
```

The end-to-end test `packages/e2e/tests/opencode.spec.ts` signs in with the `ren` CLI against a real server and checks that the plugin uses and renews that login. It also signs in through the plugin's RPC `login` in an in-process OpenCode (`packages/e2e/script/opencode-account.ts`) with a real consent in the browser, checks that the plugin and `ren whoami` share the login and that the CLI renews it, then signs out with `logout` and checks that both are signed out.
