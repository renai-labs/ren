# Providers: models, own keys and subscriptions through one gateway

Status: in build. Built: the model catalog, Ren's models, each organization's list and its push (§6.1, §6.2, §7.1); the Providers API, its tables and policy (§6.3–§6.5, §10 client routes); the Providers and Ren models pages, picker rows and the model chip (§5.1–§5.3); the brain's HTTP and Claude runtimes (§7.2, §7.3); usage fields, `limits.get`, the warning banner and the error cards (§5.4, §9.1–§9.4). Tasks: RENAI-235 (model catalog refresh), RENAI-244 (provider pattern for own keys).

This file is the core of the spec. The references hold the detail:

| Reference                                          | Contents                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| [`references/gates.md`](references/gates.md)       | The experiments on the brain side (G1, G4, G5, G6): setup, result, decision |
| [`references/console.md`](references/console.md)   | The OpenCode Console and what Ren takes from it                             |
| [`references/opencode.md`](references/opencode.md) | The OpenCode facts the design uses, with file and line                      |

The model gateway is a separate, closed service. This spec states only what Ren needs from it (§10).

## 1. Goal

An organization uses models from three kinds of provider. Every model call goes through the model gateway. Ren knows which provider served each call and who pays.

| Kind         | Example                                       | Who pays                                                 |
| ------------ | --------------------------------------------- | -------------------------------------------------------- |
| Ren          | `ren/anthropic/claude-opus-5-5`, a free model | Ren, then the organization's credit. Free models: nobody |
| Own key      | the organization's OpenAI key                 | the organization, to the vendor                          |
| Subscription | a member's Claude Max or ChatGPT Plus account | the organization's plan                                  |

Done when:

1. The Providers page works like the OpenCode Console Providers page (§5), with subscriptions as a method of the Anthropic and OpenAI cards.
2. models.dev is the only source of models and providers. Nobody edits a model list by hand. A change reaches running brains through the push (§8).
3. Every call goes brain → egress → gateway → vendor. The brain holds no secret, and Ren core stores no key or login.
4. Subscriptions run on official clients only: the real `claude` program and OpenAI token sharing.
5. A chat shows which provider runs its model, and warns at 75, 80, 85, 90, 95 and 100% of a limit.
6. Every gate in §13.1 passes.

## 2. Words

| Word        | Meaning                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Card        | One provider on the Providers page: Ren, Anthropic, OpenAI, Google, …                                                        |
| Method      | How a card connects: `key` or `subscription`. Only Anthropic and OpenAI have `subscription`                                  |
| Seat        | One connected subscription account. An organization can have several per vendor                                              |
| Gateway     | The closed model gateway service. It holds keys and logins, chooses seats, checks credit and the free cap, and calls vendors |
| Free model  | A Ren model with price 0 on models.dev                                                                                       |
| Free cap    | 100 free-model requests per organization per UTC day                                                                         |
| Push / pull | Push: Ren tells a brain to pull now. Pull: the brain fetches its full state (§8)                                             |

## 3. Decisions

| ID  | Decision                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | The Providers page has one card per provider. Ren is always the first card                                                                                                                              |
| P2  | A subscription is a method inside the Anthropic or OpenAI card. One method is active per card                                                                                                           |
| P3  | Each card has an on/off switch, Ren included. Ren off hides Ren's models, free models included                                                                                                          |
| P4  | No automatic fallback and no fallback switch. After an error, the person picks another model and presses Continue                                                                                       |
| P5  | The providers for own keys are the OpenCode Console's 35 providers ([`references/console.md`](references/console.md)). One key per provider per organization                                            |
| P6  | Ren's card has a models list: one on/off switch per model, and a "New models on" switch. Not in v1: several keys per provider, "who can use this", custom providers, budgets and reservations           |
| P7  | Admins and owners change cards, methods, keys and Ren's model switches. Any member connects their own seat. A member removes their own seats; admins remove any seat                                    |
| P8  | Seats serve the whole organization. Several seats per vendor spread the load; a chat sticks to one seat. Keys: one per provider                                                                         |
| P9  | models.dev is the source. Ren core is the only reader for pickers and brains. Every 5 min with an ETag; the last good copy is kept                                                                      |
| P10 | Ren's models come automatically from Ren's upstream provider on models.dev (a deployment setting): chat models with tools, not deprecated, minus a block list                                           |
| P11 | A Ren model id is `ren/<canonical_id>` (`ren/anthropic/claude-opus-5-5`). A model without a `canonical_id` keeps its upstream id                                                                        |
| P12 | A seat's models come from the vendor through the gateway. Names, limits and efforts come from models.dev                                                                                                |
| P13 | Price = the models.dev API price. Billing applies the markup and holds the credit                                                                                                                       |
| P14 | No starter credit. Free models are on for every organization, capped at 100 requests per organization per UTC day, reset at 00:00 UTC. They may run out; the app says so                                |
| P15 | The default model of a new organization is a deployment setting, for experiments                                                                                                                        |
| P16 | Every model call goes brain → egress → gateway → vendor, own keys included                                                                                                                              |
| P17 | Keys and logins live only in the gateway. Ren core forwards a key once, to the gateway, and never stores or logs it                                                                                     |
| P18 | A provider that an organization did not connect never runs on Ren's account                                                                                                                             |
| P19 | Claude models that run on a subscription or on the Claude Code runtime run on the `claude` program, through a Ren-owned setup of OpenCode's Claude Agent parts. OpenCode is not changed or patched (G4) |
| P20 | ChatGPT seats use OpenAI token sharing on `api.openai.com/v1`                                                                                                                                           |
| P21 | Warnings: a banner above the composer, not saved. Steps 75, 80, 85, 90, 95, 100%. Each step shows once per chat, meter and reset period                                                                 |
| P22 | Warning sources: Claude seats, Ren credit, the free cap. ChatGPT seats have no warnings; only a refusal at the limit                                                                                    |
| P23 | For a seat, the banner shows the seat that served this chat's last call                                                                                                                                 |
| P24 | The model chip shows `<model> · <card>`, with `(subscription)` or `(key)` on Anthropic and OpenAI                                                                                                       |
| P25 | A session stores OpenCode's provider and model ids. A method change shows a "model switched" row at the next turn                                                                                       |
| P26 | Model list changes reach brains through the push. A models.dev change notifies only organizations whose list changed. The 30 s pull stays as the backup                                                 |

## 4. Parts and responsibilities

```
┌──────────────┐  settings, chat         ┌──────────────┐  pull: providers + models + placeholders   ┌──────────────────┐
│              │ <────────────────────── │              │ ─────────────────────────────────────────> │                  │
│  Ren app     │ ──────────────────────> │  Ren core    │                                            │  brain           │
│              │                         │              │  push: POST /ren/pull                      │  (OpenCode)      │
└──────────────┘                         │              │ ─────────────────────────────────────────> │                  │
                                         └──────────────┘                                            └──────────────────┘
       models.dev ──── read every 5 min ────>   │  §10 routes (signed token)                                   │ every call
                                                │  card state, keys, connections,                              │ Bearer ren:MODELS
                                                │  Ren models, brain keys                                      v
                                                v                                                     ┌──────────────────┐
                                       ┌──────────────────────────┐   brain key                       │  egress          │
                                       │  Model gateway (closed)  │ <──────────────────────────────── │  swaps ren:MODELS│
                                       │                          │                                   └──────────────────┘
                                       │  keys and logins         │ ──────────> Anthropic, OpenAI, Google, … (vendors)
                                       │  seat choice             │
                                       │  credit and free cap     │
                                       └──────────────────────────┘
                                                    │ usage rows (payer, access, seat, tokens, cost)
                                                    v
                                       Ren usage_event ──> billing (markup, credit)
```

| Part     | Responsible for                                                                                                                                                                                     | Holds secrets     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Ren core | organization settings (cards, methods, Ren model switches, default model); reads models.dev; builds each organization's model list; push and pull; Providers page and chat UI; warnings; usage rows | no                |
| Brain    | runs chats on OpenCode; sends every call to the gateway; runs `claude` for Claude models on the Claude Code runtime                                                                                 | no (placeholders) |
| Egress   | swaps `ren:MODELS` for the brain's gateway key; blocks `api.anthropic.com` from the brain                                                                                                           | the brain key     |
| Gateway  | sign-in pages for subscriptions; keys and logins; seat choice; credit check and free cap; calls vendors; usage rows                                                                                 | yes               |
| Billing  | markup and credit                                                                                                                                                                                   | —                 |

For a self-hosted Ren without the gateway, `Models.layerNone` stays: no models.

## 5. UX

### 5.1 Providers page

Built: `app/src/features/providers/` (`providers-page.tsx`, `add-provider-dialog.tsx`, `connect-dialog.tsx`, `ren-models-page.tsx`). Settings → Providers. It replaces "Subscriptions your agents run on" (`app/src/features/providers/providers-page.tsx:130`). The OpenCode Console's Providers pages are the model ([`references/console.md`](references/console.md)).

```
Providers                                                                        [ Add provider ]

┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                            │
│  Ren                          On ●      Credit $3.20 left · Free today 41 / 100            │
│  Claude, GPT and more on Ren credit; free models every day             [ Models › ]        │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                            │
│  Anthropic                    On ●      Method [ Subscription ▾ ]                          │
│  Asha (Max)  5h 42% · 7d 81%        Ben (Pro)  5h 12% · 7d 30%      [ Connect your Claude ]│
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                            │
│  OpenAI                       On ●      Method [ API key ▾ ]        sk-…9f2c · Test ✓      │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                            │
│  Google                       Off ○     Method [ API key ▾ ]        No key                 │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Element                     | Behaviour                                                                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add provider                | The Console grid: search, 35 providers, model count from models.dev, Connect. A provider already on the page is marked                                                                                                                                                  |
| Connect (own key)           | A dialog with the provider's fields (most: API key; Azure, AWS Bedrock, Google Vertex AI, Cloudflare AI Gateway and Databricks have more, §16), **Test connection**, Cancel, Save. Save runs the test first. A failed test shows the vendor's message and saves nothing |
| Card switch                 | On or off. Off removes the card's models from pickers at the next push                                                                                                                                                                                                  |
| Method (Anthropic, OpenAI)  | `API key` or `Subscription`. A change applies at the next push                                                                                                                                                                                                          |
| Seats (subscription method) | One line per seat: who connected it, plan, meters (Claude only). "Connect your Claude" or "Sign in with ChatGPT" opens the gateway's sign-in page. A seat that needs a new sign-in shows "Sign in again"                                                                |
| Key line                    | The last 4 characters, who saved it, the test result. Replace, remove                                                                                                                                                                                                   |
| Ren card                    | Credit and today's free count. **Models ›** opens §5.2                                                                                                                                                                                                                  |
| Members                     | See the page. Only "Connect your …" and their own seats are active (P7)                                                                                                                                                                                                 |

### 5.2 Ren models

A table like the Console's Models page: name, id, price per 1M tokens (input, output, cache read, cache write), a "Free" tag and an on/off switch per model. Filters: All, On, Free. A side switch: **New models on** (default on). A new model from models.dev takes that state. Admins change it.

### 5.3 Picker

1. The picker lists exactly the models of the chat's brain (the same pull), grouped by card. The picker already reads the brain's list (`chat/src/react.ts:213`).
2. Each row shows the card and, for Anthropic and OpenAI, the method. Free models carry "Free". Ren models show the price.
3. Card names come from the pull data. The hand-written names go (`app/src/components/model-picker.tsx:65` `vendorNames`, `providerLabels` in `chat/src/turn-problems.ts`). Built for the picker: each row (`SessionModel.Choice`) carries `providerName`, `method`, `price` and `free`, from Ren's list on the start page and from the list the brain applied in a chat. Built for the error cards: `providerLabels` is gone; a card's name comes from the chat's model list (`providerNames`), and an id the list does not name is shown capitalized. The mobile picker keeps its names until the mobile app takes the same fields.

### 5.4 Chat

| Element            | Behaviour                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model chip         | `Claude Opus 5.5 · Anthropic (subscription)`, `GPT-6.1 Sol · OpenAI (key)`, `Gemma 4 31B · Ren · Free`                                                                                                                         |
| Warning banner     | Above the composer, not saved (P21). Examples: "Anthropic seat (Asha’s Max): 80% of 7-day limit used · resets Mon 14:00", "Ren credit: 90% used · $0.50 left [Add credits]", "Free models: 75 of 100 today · resets 00:00 UTC" |
| Error              | The turn-problem card (`chat/src/turn-problems.ts`) with the codes of §9.4. Action "Change model". The person can pick another model and press Continue; nothing switches by itself (P4)                                       |
| Model switched row | As today (`app/src/features/session/transcript.tsx:173`), and it names the card as well as the model                                                                                                                           |

### 5.5 A new organization

1. Ren core creates the organization. Ren is on. No credit (P14).
2. The gateway creates the organization's account on the first brain key, as today.
3. The picker shows Ren's free models (on) and Ren's credit models with prices. A credit model refuses with `insufficient_credits` while the organization has no credit.
4. The default model is the deployment setting `REN_DEFAULT_MODEL` (P15).
5. The free cap is 100 per day. Free models can also be unavailable for everyone for a while; the error says "Free models are limited and not guaranteed. Add credit or connect a provider."

## 6. Models and provider lists

### 6.1 Reading models.dev

Built: `core/src/model-catalog.ts` (`ModelCatalog`, layers `layerModelsDev` and `layerFixture`), the list job in `core/src/model-lists.ts`, the bundled copy `core/src/model-catalog/snapshot.json` (`core/script/model-catalog-snapshot.ts` writes it), and tables `model_catalog` and `organization_model_list`. The brain reads no catalog: `cell/src/model-discovery.ts` and core's poll of the gateway's catalog are gone.

What the build found:

1. Ren stores only what it uses of each model: id, name, canonical id, type, tool calling, deprecated, input types, limits, efforts and the text price. The kept copy of the 35 providers is 0.6 MB (2,421 models on 22 Nov 2026); the full answer is 11.8 MB.
2. models.dev gives input types as MIME types (`image/png`, `application/pdf`). Ren maps them to `text`, `image`, `pdf`, `audio`, `video`.
3. A price has more parts than Ren keeps: a price above a context size (`overrides`) and two cache write prices (5 minutes, 1 hour). Ren keeps the base price and the 5-minute cache write.
4. Each server instance reads models.dev on its own with the shared ETag; the first that stores a copy notifies, and the others then find no change. A pull on any instance reads the shared copy's revision at most every 5 s.
5. The job stores a new copy only after the gateway answered `PUT /v1/ren-models`. While the gateway refuses, pickers keep the last list.

### 6.2 Ren's models

| Rule     | Value                                                                               |
| -------- | ----------------------------------------------------------------------------------- |
| Source   | Ren's upstream provider on models.dev (`REN_MODELS_UPSTREAM`)                       |
| Kept     | type chat, tool calling, not deprecated, not in the block list (`REN_MODELS_BLOCK`) |
| Id       | `ren/<canonical_id>`; without a `canonical_id`, `ren/<upstream id>`                 |
| Free     | price 0 on models.dev                                                               |
| Price    | the models.dev price; billing applies the markup                                    |
| Switches | per model; a new model takes "New models on"                                        |
| Runtime  | Claude models (`ren/anthropic/…`): `claude`. Others: HTTP                           |

Ren core sends this list to the gateway (§10) before it notifies brains, so the gateway knows a model before a picker shows it.

What the build found (models.dev, 22 Nov 2026):

1. A free model has the same `canonical_id` as the paid model it is a copy of (`google/gemma-4-31b-it:free` and `google/gemma-4-31b-it`). A free model keeps its upstream id, so the two never share an id.
2. Two paid models can share a `canonical_id` (`openai/gpt-5.6-terra` and `openai/gpt-5.6-terra-pro`). The one whose own id matches it, with `.` read as `-`, takes it; the others keep their upstream id.
3. A model without a price on models.dev is not kept: Ren could not charge for it.
4. `REN_MODELS_UPSTREAM` has no default. Without it the Ren card has no models.
5. Claude models (`ren/anthropic/…`) use the `anthropic-messages` protocol; the others `openai-chat`.

### 6.3 Own-key models

The provider's models on models.dev: type chat, not deprecated. No per-model switch in v1. Built: an own-key card is listed once its row has a key and is on.

### 6.4 Subscription models

The gateway reports each seat's models in `GET /v1/connections` (§10). Ren core keeps them in `organization_seat_models`. A card's list is the union over the organization's seats, joined with models.dev for names, limits and efforts. A model that models.dev does not know keeps the vendor's id and default limits.

Built: a card without a row is on with the subscription method once a member connected a seat of its vendor. A seat model that models.dev does not know has no name and no limits.

### 6.5 An organization's list

Built (`core/src/model-lists.ts`, `core/src/provider-settings.ts`, `GET/PATCH /providers`, `/providers/:id/test`, `/providers/:id/key`, `/providers/ren/models`, `POST /internal/inference/changed`). For each card that is on: the card's models (§6.2–6.4) minus switched-off Ren models. Each model carries: gateway name, display name, card, method, runtime (`http` or `claude`), protocol, limits, efforts, input types, price, free. Ren core stores a hash per organization in `organization_model_list` and compares it to decide on a push.

Gateway names:

| Model        | Gateway name                                               |
| ------------ | ---------------------------------------------------------- |
| Ren          | `ren/<id>`                                                 |
| Own key      | `<provider>/<model>` (`openai/gpt-6.1-sol`)                |
| Subscription | `seat/<vendor>/<model>` (`seat/anthropic/claude-opus-5-5`) |

## 7. The brain

### 7.1 What the pull carries

Built. `RenHostApi` pull `providers` (`host-api/src/ren-host-api.ts:131`) is the organization's list (§6.5): per card the id, name, gateway base URL and headers, and the models with their gateway names, runtime and metadata. The key is always the placeholder `ren:MODELS`. The brain key comes from `models.refresh` as today (`cell/src/model-refresh.ts`). Each model carries `gateway` (the name the brain sends, `ren/<id>`), `runtime`, `price` and `free`; the card carries `method`. OpenCode keeps Ren's id in the picker and sends the gateway name (`modelID`).

### 7.2 HTTP runtime

Built. `cell/src/harness/opencode/model-providers.ts` keeps mapping each card to an OpenCode provider with the card id and the protocol's package. Changes:

1. A model with runtime `claude` gets the Claude Agent package (§7.3); the others keep their protocol's package.
2. The models of OpenAI's card on the subscription method get the settings of OpenCode's ChatGPT plugin, which Ren does not activate: summary compaction, `supportsEffortUpdates: false`, cost `[]` (`chatgpt.ts:306-339`). The card already has `transport: "http"`. Ren's list has no model with `reasoning.mode: "pro"`, so none is switched off. The Ren plugin's `retry` hook stops retries on the token-sharing refusal codes (`Models.chatGptRefusals` in `schema/src/models.ts`, from `chatgpt.ts:58-67`; the error cards use the same list). The ChatGPT plugin's `session-id` headers are not sent: the gateway drops them (gate H1) and reads `prompt_cache_key`.

### 7.3 Claude runtime

Built: `cell/src/harness/opencode/claude-agent.ts`, registered before `RenPlugin` (`server.ts`). Claude models with runtime `claude` run on the `claude` program through OpenCode's Claude Agent parts.

1. **Provider id.** A Claude model stays under its card's provider (`ren`, `anthropic`); only its package is `@opencode/claude-agent`, and its canonical provider is `claude-agent`, which keys the options the Claude Agent model reads. The first design moved these models to provider `claude-agent`. That breaks every place Ren and its clients name a model by card id (picker, chip, transcripts, the chat's settings model, `session.model.switch`), so the setup changes the hooks instead: OpenCode's `ClaudeSessionHooks` and `ClaudeInstructions` run unchanged, with each hook bound to `claude-agent` run for the models whose package is the Claude Agent package in that location. A change of method (key ↔ subscription) keeps the model id; the next turn runs on the other runtime.
2. **Ren-owned setup.** The plugin body of 2.2.6 without the workspace check, from `@opencode/core`'s exported parts: the session registry, the AI SDK hook and the two hook sets. It never calls `ClaudeProvider.register`, which replaces the list with Claude's short names (G4), nor `ClaudeIntegration.register`, which is OpenCode's sign-in for a person's own `claude` and needs `Bus`. OpenCode's own copy stays loaded and stops at its workspace check; its hooks are bound to provider `claude-agent`, which Ren never lists.
3. **Dependency.** `@anthropic-ai/claude-agent-sdk` 0.3.301 in `cell`. It ships `claude` 2.1.301 in `@anthropic-ai/claude-agent-sdk-<platform>`; the plugin needs 2.1.248 or later. The setup finds that binary next to the SDK (glibc first on Linux), so the image needs no `OPENCODE_CLAUDE_PATH` and a `claude` on `PATH` is never used. `OPENCODE_CLAUDE_PATH` still wins when set. The brain's dependency bundle carries the Linux binary.
4. **Env and settings.** One `claude` process per chat. `claude` reads headers only at start, so the setup builds the env per call from the chat's usage headers and leaves out `ren-turn`, which changes each turn and would restart `claude`: usage rows of the Claude runtime have no turn.

| Name                                            | Value                                                                                                  | Why                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL` (provider `baseURL`)       | the gateway, without its `/v1`                                                                         | every call through the gateway; `claude` adds `/v1/messages`                                                                            |
| `ANTHROPIC_CUSTOM_HEADERS` (provider `headers`) | `x-litellm-api-key: Bearer ren:MODELS`, the chat's usage headers and `ren-member: ren:PERSON.<member>` | the gateway key, the usage claims and the member                                                                                        |
| `CLAUDE_CODE_OAUTH_TOKEN`                       | Ren's key: `ren:MODELS` behind the egress                                                              | subscription mode in `claude`; the gateway puts the seat's login in. It does not start with `sk-ant-oat`, so it never passes as a login |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`      | `1`                                                                                                    | no direct calls to `api.anthropic.com` (G1)                                                                                             |

5. **Egress.** Every call of `claude` carries `ren:MODELS` in `Authorization`. The egress fills in `MODELS` only for the gateway host (`core/src/credential-source.ts`), so a call of `claude` to `api.anthropic.com` or any other host is refused with `403` and `X-Ren-Egress`, and the egress log names it. Other programs in the sandbox are not affected: a hand may still call `api.anthropic.com` with a customer's own key. No egress change was needed.
6. **Folder.** `claude` starts in `.ren-claude` in the home folder of the brain's machine. Tools still run on the hand through MCP.

### 7.4 Session id

The gateway keeps a chat on one seat. It reads the session from the request body: `metadata.user_id` → `session_id` for Claude Code (G1), `prompt_cache_key` for OpenAI (OpenCode sets one per session, `opencode/packages/ai/src/protocols/open-responses.ts:840`). Ren sends no extra header for it.

## 8. Hot reload

Today's mechanism (`specs/runtime/hot-reload/README.md`):

```
PUSH  write → trigger pg_notify('ren_brains', 'org:<id>' | 'space:<id>' | 'all')   (db/migration/20261025101446_brain_push)
      → every server instance LISTENs (core/src/brain-push.ts), 16 brains at a time
      → POST /ren/pull to each brain → the brain POSTs /host/pull and applies the full state
PULL  each open brain pulls every 30 s (PULL_INTERVAL_MS, cell/src/env.ts:26; cell/src/hot-reload.ts:198-205), at wake and at start
```

Model lists rode only the 30 s pull until now: the brain fetched each provider's `/catalog` at each pull (`cell/src/hot-reload.ts:135` → `model-discovery.ts`), and core polled the gateway every 30 s (`core/src/ren-inference/provider.ts:22`).

New rules (P26):

| Change                                                                           | Written to                                                                  | Notify                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Card on/off, method, key saved or removed                                        | `organization_provider`                                                     | `org:<id>` when the list changed        |
| Ren model switch, "New models on"                                                | `organization_ren_model`, `organization_provider.new_models` (row `ren`)    | `org:<id>` when the list changed        |
| Seat connected, removed, or its models changed (the gateway tells Ren core, §10) | `organization_seat_models`                                                  | `org:<id>` when the list changed        |
| models.dev changed                                                               | `model_catalog`, then `organization_model_list` only where the hash changed | `org:<id>` for those organizations only |

Built differently from the first design: the settings tables have no trigger. Each write recomputes the organization's list hash, and only `organization_model_list` notifies, so a change that leaves the list as it was (a key replaced) wakes no brain. "New models on" is a column of Ren's row in `organization_provider`, not a separate settings table. Turning it off gives each of today's Ren models its own switch, so only models that arrive later start off.

A Ren-wide `'all'` notify wakes every running brain (`specs/runtime/hot-reload/README.md` §2.5), so a models.dev change never sends `'all'`. The 30 s pull stays as the backup. The core and brain polls go.

What a running chat sees:

| Change                                         | Effect                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Card off, model removed                        | The call in flight finishes. The model leaves the picker. The next turn uses the chat's settings model and shows why (hot-reload row 33) |
| Key replaced, login refreshed                  | Nothing. The next call uses the new credential                                                                                           |
| Method key ↔ subscription                      | The model id stays; the next turn runs on the other runtime (HTTP ↔ `claude`)                                                            |
| Claude runtime connection change during a turn | The turn finishes on the old settings; the next turn uses the new ones (G5)                                                              |
| New model                                      | In the picker after the push                                                                                                             |

## 9. Usage, limits and billing

### 9.1 Usage rows

The gateway sends one `usage_event` per call (`specs/usage.md`). New fields in `data`: `seat` (seat id, for seat calls) and `access` (`ren`, `free`, `key`, `seat`). The field is `access` because `data.kind` is already the request kind (primary, compaction, title). `payer` is `ren` for Ren calls and `customer` for own keys and seats (`schema/src/usage.ts:13`). Cost is the models.dev price; billing charges only rows with payer `ren`.

Built: `Usage.Access` and the two fields in `schema/src/usage.ts` (`Usage.ModelCall`), both optional for an older gateway; the ingest contract `protocol/usage-ingest.openapi.json`. Rows keep them in `usage_event.data`; the partial index `usage_event_root_session_seat_idx` (`root_session`, `time`, where `data ->> 'seat'` is set) finds a chat's last seat call.

### 9.2 Credit

Billing holds the credit and the markup. The gateway checks credit before each Ren call.

### 9.3 Warnings

| Meter        | Source                                                              | Reset                  |
| ------------ | ------------------------------------------------------------------- | ---------------------- |
| Claude seat  | the gateway's per-seat meters (5h and 7d, from Anthropic's answers) | the meter's reset time |
| ChatGPT seat | none; only the refusal                                              | —                      |
| Ren credit   | `Billing.Summary` used ÷ granted (`schema/src/billing.ts:21-22`)    | the plan cycle         |
| Free cap     | `GET /v1/usage/free`                                                | 00:00 UTC              |

Delivery: a new endpoint `limits.get({ sessionId })` returns the meters for the chat's current model: the seat of the session's last `usage_event` with a `seat` (P23), or credit, or the free cap. The app reads it when a chat opens, after each turn and every 60 s while the chat is open. The `chat` package decides which step to show and remembers shown steps per chat, meter and reset time.

Built: `core/src/limits.ts` (`Limits.get`), `GET /sessions/:id/limits` (`limits.get`, group `limits`, internal), `Limits.Info` in `schema/src/limits.ts`, `chat/src/limit-banners.ts` and `app/src/features/session/limit-banner.tsx`. What the build decided:

1. The chat's current model is the root session's model as OpenCode stored it (`opencode_session.model`, synced). Its card in the organization's list decides the meters: `ren` with a free model → free cap; `ren` → credit; a card on the subscription method → seat; anything else → none.
2. The seat is the seat of the card's vendor that served the chat's last seat call. A ChatGPT seat has no meters, so it shows none.
3. A source that does not answer (gateway, billing) gives no meter; `limits.get` still answers. With no credit granted (`grantedMicroUsd` 0, as with `Billing.layerNone`) there is no credit meter.
4. A step shows until the person dismisses it. A dismissed step does not come back in the same chat, meter and reset period while the app runs; the next step shows. A step passed before it showed is skipped. When several meters reach a step, the fullest shows.
5. Seat banners name the card from data: "Anthropic seat (Asha’s Max)", not "Claude seat". "Asha’s Max" is the connector's name and the plan; without them, the seat's label.
6. The app refetches when a turn ends by keying the banner on the chat's last finished turn.

### 9.4 Errors

| Code                                       | When                                 | Text                                                                                       | Actions                                       |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `insufficient_credits` (402)               | Ren call, no credit                  | today's out-of-credits text (`chat/src/turn-problems.ts`)                                  | Add credits (admins), Change model, Providers |
| `free_limit_reached` (429)                 | free cap reached                     | "Free models: today's 100 requests are used. They reset at 00:00 UTC."                     | Change model                                  |
| `free_unavailable`                         | free models unavailable for everyone | "Free models are limited and not guaranteed. Try later, add credit or connect a provider." | Change model                                  |
| `provider_not_connected`                   | own-key model without a key          | "<Card> is not connected."                                                                 | Providers (admins), Change model              |
| `model_off` (403)                          | a Ren model the organization is off  | "<model> is switched off for this organization."                                           | Providers (admins), Change model              |
| `subscription_limit_reached` (429)         | every seat of the vendor is full     | "All <vendor> subscriptions are at their limit. The next resets at <time>."                | Change model                                  |
| ChatGPT refusal codes (`chatgpt.ts:58-67`) | a ChatGPT seat refuses               | "ChatGPT usage limit reached."                                                             | Change model                                  |
| `inference_unavailable` (503)              | the gateway cannot decide            | "Model access is not available now. Try again."                                            | Try again                                     |

Built: `TurnProblems.of` in `chat/src/turn-problems.ts`, shown by the app's turn-problem card. What the build found and decided:

1. The gateway sends `inference_unavailable`, not `gateway_unavailable`, and also `model_off` (403). It does not send `free_unavailable` yet; the card maps it already.
2. A final refusal carries `x-should-retry: false`, which OpenCode honors, so the card shows at once. `inference_unavailable` is not final: the brain's same-model retry runs first.
3. The code is read from the error's response body (`SessionError.response.body`, carried on `TimelineRow.Error.body`), then from its text; a code wins over the older text and kind rules.
4. Only the two usage-limit codes of ChatGPT say "ChatGPT usage limit reached." The other refusal codes say "ChatGPT refused this request." with OpenCode's message for the code.
5. `subscription_limit_reached` takes the reset time from the first ISO time in the gateway's answer; without one it says "The next resets soon."
6. Out of credits keeps today's text; a member's text asks an admin or offers another model.
7. Open: a model on the Claude runtime loses the code. `claude` reports only the gateway's message (`API Error: 402 <message>`, type `provider.unknown`), without the response body, so the card falls back to "Ren couldn’t finish that reply." The fix belongs in the gateway's message (name the code in it) or in the Claude runtime (keep the body); the e2e journeys use an HTTP-runtime model.

## 10. Contract: Ren core → gateway

Ren core calls the gateway with today's signed token (`core/src/ren-inference.ts`).

| Route                                                                                | Status | Purpose                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/connect`, `GET /v1/connections`, `PATCH/DELETE /v1/connections/:id`        | change | `GET` adds each seat's models and plan                                                                                                                                       |
| `POST /v1/keys {brainId, spaceId}`                                                   | keep   | brain key                                                                                                                                                                    |
| inference keys, `POST /v1/harness-plans`, `DELETE /v1/members/:id`, `DELETE /v1/org` | keep   | —                                                                                                                                                                            |
| `PUT /v1/providers/:providerId {enabled, method}`                                    | new    | card state                                                                                                                                                                   |
| `POST /v1/providers/:providerId/test {fields}`                                       | new    | test a key without saving; ok or the vendor's message                                                                                                                        |
| `PUT /v1/providers/:providerId/key {fields, model}`                                  | new    | test, then store; returns `{ last4, testedAt }`, or 400 with the vendor's message. Ren core forwards the fields and never stores or logs them                                |
| `DELETE /v1/providers/:providerId/key`                                               | new    | remove the key                                                                                                                                                               |
| `PUT /v1/ren-models {revision, models, switches}`                                    | new    | Ren's model list (id, upstream id, prices, free) and the organizations' switches. Ren core notifies brains after a 200. A switched-off model is refused with `403 model_off` |
| `GET /v1/usage/free`                                                                 | new    | `{ used, limit, resetsAt }`                                                                                                                                                  |
| `GET /v1/catalog`                                                                    | remove | —                                                                                                                                                                            |

Gateway → Ren core: `POST /internal/inference/changed {organizationId}` when a seat or its models change, authenticated like usage ingest. Ren core reads `GET /v1/connections`, writes `organization_seat_models` and notifies. Built: only the usage ingest key may call it; `GET /v1/connections` adds `providerId`, `plan` and `models` to each seat.

Built in Ren core: every route above except `GET /v1/catalog`, which Ren no longer calls. The model gateway's side comes in its own changes.

## 11. Lifecycle states

| State                    | What happens                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Brain asleep             | Nothing. The pull at wake brings the newest list                                                                                         |
| Brain waking             | The start pull brings the newest list. The Claude runtime starts `claude` with the new env                                               |
| Mid-turn                 | §8 table. A seat that fills mid-turn: the gateway tries another seat                                                                     |
| Brain down or restarting | The boot pull applies the list. No secret is lost: the brain holds none                                                                  |
| Gateway down             | Calls fail (`inference_unavailable` or a transport error). The brain's same-model retry runs (about 84 s); then the turn shows the error |
| Ren core down            | Calls keep working. Settings and lists do not change until it is back                                                                    |
| models.dev down          | The last good copy stays                                                                                                                 |
| A login's refresh fails  | The seat shows "Sign in again"                                                                                                           |

## 12. Work in Ren, by package

| Package              | Work                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`             | Provider settings shapes (card, method, key status, Ren model switch). Per model in `Models.Registration`: gateway name, runtime, card, method, price, free. Usage `kind` and `seat`                                                                                                                                                              |
| `db`                 | Tables `organization_provider`, `organization_ren_model`, `organization_seat_models`, `model_catalog`, `organization_model_list`; `organization_settings.ren_new_models`. Triggers `pg_notify('ren_brains', 'org:<id>')` on the organization tables                                                                                               |
| `core`               | `ModelCatalog` and the list job; `Models.grant` and the pull from §6.5; `RenInference` client routes of §10; remove the `/v1/catalog` poll (`core/src/ren-inference/provider.ts`); policy `provider.manage` (admins, owners) and `provider.view` (members); `limits.get`; settings `REN_DEFAULT_MODEL`, `REN_MODELS_UPSTREAM`, `REN_MODELS_BLOCK` |
| `protocol`, `server` | Providers endpoints (list, update, test, set key, remove key), Ren models endpoints, `limits.get`, `POST /internal/inference/changed`; `bun run generate`                                                                                                                                                                                         |
| `chat`               | Error codes (§9.4); banner rules; card labels from data                                                                                                                                                                                                                                                                                           |
| `app`                | Providers page, Add provider grid and dialog, Ren models page, picker rows, model chip, banner                                                                                                                                                                                                                                                    |

## 13. Tests

### 13.1 Gates

Done ([`references/gates.md`](references/gates.md)): G1, G4, G5, G6, GR1, GR2.

Pending (Ren side):

| Gate | Question                                                                                                | When              |
| ---- | ------------------------------------------------------------------------------------------------------- | ----------------- |
| GR3  | A models.dev change notifies only the organizations whose list changed, under load (many organizations) | with the list job |

### 13.2 Package tests

Only rules that the code does not show:

| Package | Test                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`  | the Ren model filter (§6.2); an organization's list from settings, seats and the catalog; only organizations whose list changed are notified; the default model setting |
| `chat`  | each banner step shows once per chat, meter and reset period; each error code maps to its text and actions                                                              |

### 13.3 End-to-end (`packages/e2e/chaos`)

| Case                          | Covers                                                                                                                                   | States                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Catalog                       | a local models.dev with an ETag; a new model reaches the picker after one push; 304 changes nothing; models.dev down keeps the last copy | Ren core restart while models.dev is down |
| Own key                       | save with a failed and a passing test; a turn; payer `customer`; key removed mid-turn → next call `provider_not_connected`               | mid-turn, asleep                          |
| Claude seat (live test seat)  | a turn on `claude`; usage row names the seat; banner at 75%                                                                              | waking, `claude` idle 5 min               |
| Two Claude seats              | stickiness per chat; one seat full → the next try uses the other; no error shown                                                         | mid-turn                                  |
| ChatGPT seat (live test seat) | a turn; refusal code text                                                                                                                | mid-turn                                  |
| Ren credit                    | cost at the models.dev price; banners; 0 credit → `insufficient_credits`                                                                 | credit runs out mid-turn                  |
| Ren free                      | 100 requests, then `free_limit_reached`; reset at 00:00 UTC under `TestClock`                                                            | —                                         |
| Hot reload                    | card off mid-turn; method change → switch row; Ren model switched off leaves the picker                                                  | mid-turn, asleep, restart                 |

Built in the Playwright stack, where the stand-in gateway (`e2e/script/inference.ts`) and the scripted stub model play the gateway's answers (`e2e/tests/app/chat-limits.spec.ts`): Ren credit at 0 → `insufficient_credits`; Ren free at the cap → `free_limit_reached`; a Ren model switched off → `model_off`; each with `x-should-retry: false`, so the card shows without the retry wait. The free cap's banner steps run on the stand-in's per-organization free count (`POST /free` on the mailbox). Pending: the cases that need the real gateway or live seats (own key with payer `customer`, Claude and ChatGPT seats, two seats, cost at the models.dev price, the 00:00 UTC reset).

### 13.4 App (Playwright)

1. Providers: add a key (bad, then good), turn a card off and on, change the method, connect a seat (stubbed page), Ren model switches and "New models on".
2. Chat: the chip for each kind; each banner step; the error card actions. Built: `e2e/tests/app/chat-limits.spec.ts` (chip for a subscription, a Ren and a free Ren model; the free banner's steps; the error cards and Change model).

## 14. Removed and superseded

| Item                                                                        | Fate                     |
| --------------------------------------------------------------------------- | ------------------------ |
| `specs/runtime/media-models.md` §8 items B0–B4 (own key through the egress) | replaced by this spec    |
| `vendorNames`, `providerLabels`                                             | removed; names from data |

## 15. Build order (Ren side)

| Step | Work                                                                                         | Done when                                                        |
| ---- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | `ModelCatalog`, organization tables, the list job, push; send Ren's models to the gateway    | a models.dev change reaches only affected organizations' pickers |
| 2    | Providers API (schema, db, core, protocol, server)                                           | cards, keys and switches round-trip; members cannot change cards |
| 3    | App: Providers page, Add provider, Ren models page, picker rows, model chip                  | the Playwright journeys of §13.4 pass                            |
| 4    | Brain: pull shape, `model-providers.ts`, Claude runtime, ChatGPT settings, image and egress  | a turn on a Claude seat and on a ChatGPT seat; GR1, GR2          |
| 5    | Warnings and errors: `limits.get`, usage fields, banner rules, error codes; end-to-end cases | §13.3 passes. Built except the §13.3 cases that need the gateway |

## 16. Settled details

| Item                                                                                                           | Decision                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A "Use this model on Ren" button on errors                                                                     | No. The error card offers "Change model" only (P4)                                                                                                                                                                                                                                    |
| The fields of Azure, AWS Bedrock, Google Vertex AI, Cloudflare AI Gateway and Databricks in the Connect dialog | Built (`schema/src/provider-card.ts`): Azure key, endpoint, API version; Bedrock access key ID, secret, region; Vertex project, location, service account JSON; Cloudflare account ID and API token (models.dev's address names the account only); Databricks workspace URL and token |
| The values of `REN_DEFAULT_MODEL`, `REN_MODELS_UPSTREAM` and `REN_MODELS_BLOCK`                                | Deployment settings. The owner sets and changes them; no code change                                                                                                                                                                                                                  |
