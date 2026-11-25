# Providers: models, own keys and subscriptions from model providers

Status: designed, not built. 25 Nov 2026: model providers as plug-ins (P27, §6). Tasks: RENAI-235 (model catalog refresh), RENAI-244 (provider pattern for own keys).

This file is the core of the spec. The references hold the detail:

| Reference                                          | Contents                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| [`references/gates.md`](references/gates.md)       | The experiments on the brain side (G1, G4, G5, G6): setup, result, decision |
| [`references/console.md`](references/console.md)   | The OpenCode Console and what Ren takes from it                             |
| [`references/opencode.md`](references/opencode.md) | The OpenCode facts the design uses, with file and line                      |

Ren core knows no provider by name. It gets cards and models from **model providers**: Effect plug-ins that the deployment chooses (§6). Hosted Ren uses one, the model gateway: a separate, closed service. This spec states only what Ren needs from it (§10).

## 1. Goal

An organization uses models from three kinds of provider. Every model call goes through the model gateway. Ren knows which provider served each call and who pays.

| Kind         | Example                                       | Who pays                                                 |
| ------------ | --------------------------------------------- | -------------------------------------------------------- |
| Ren          | `ren/anthropic/claude-opus-5-5`, a free model | Ren, then the organization's credit. Free models: nobody |
| Own key      | the organization's OpenAI key                 | the organization, to the vendor                          |
| Subscription | a member's Claude Max or ChatGPT Plus account | the organization's plan                                  |

Done when:

1. The Providers page works like the OpenCode Console Providers page (§5), with subscriptions as a method of the Anthropic and OpenAI cards.
2. Each model provider supplies its own cards and models. Ren core reads no model source and has no provider names in its code. The gateway's source is models.dev; nobody edits a model list by hand. A change reaches running brains through the push (§8).
3. A self-hosted Ren plugs in its own model provider, such as its own LiteLLM, without a change to Ren core.
4. Every call goes brain → egress → gateway → vendor. The brain holds no secret, and Ren core stores no key or login.
5. Subscriptions run on official clients only: the real `claude` program and OpenAI token sharing.
6. A chat shows which provider runs its model, and warns at 75, 80, 85, 90, 95 and 100% of a limit.
7. Every gate in §13.1 passes.

## 2. Words

| Word           | Meaning                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model provider | An Effect plug-in in Ren core that supplies cards, their models, connections and meters (§6). The gateway is one; a self-hosted LiteLLM is another |
| Card           | One provider on the Providers page: Ren, Anthropic, OpenAI, Google, …. A model provider supplies it                                                |
| Method         | How a card connects: `key` or `subscription`. Only Anthropic and OpenAI have `subscription`                                                        |
| Seat           | One connected subscription account. An organization can have several per vendor                                                                    |
| Gateway        | The closed model gateway service. It holds keys and logins, reads models.dev, chooses seats, checks credit and the free cap, and calls vendors     |
| Free model     | A Ren model with price 0 on models.dev                                                                                                             |
| Free cap       | 100 free-model requests per organization per UTC day                                                                                               |
| Push / pull    | Push: Ren tells a brain to pull now. Pull: the brain fetches its full state (§8)                                                                   |

## 3. Decisions

| ID  | Decision                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | The Providers page has one card per provider. Ren is always the first card                                                                                                                                                                                                                                                                                                                                            |
| P2  | A subscription is a method inside the Anthropic or OpenAI card. One method is active per card                                                                                                                                                                                                                                                                                                                         |
| P3  | Each card has an on/off switch, Ren included. Ren off hides Ren's models, free models included                                                                                                                                                                                                                                                                                                                        |
| P4  | No automatic fallback and no fallback switch. After an error, the person picks another model and presses Continue                                                                                                                                                                                                                                                                                                     |
| P5  | The gateway's providers for own keys are the OpenCode Console's 37 providers ([`references/console.md`](references/console.md)). One key per provider per organization                                                                                                                                                                                                                                                |
| P6  | Ren's card has a models list: one on/off switch per model. A new model is always on. Not in v1: several keys per provider, "who can use this", custom providers, budgets and reservations                                                                                                                                                                                                                             |
| P7  | Admins and owners change cards, methods, keys and Ren's model switches. Any member connects their own seat. A member removes their own seats; admins remove any seat                                                                                                                                                                                                                                                  |
| P8  | Seats serve the whole organization. Several seats per vendor spread the load; a chat sticks to one seat. Keys: one per provider                                                                                                                                                                                                                                                                                       |
| P9  | The gateway reads models.dev every 5 min with an ETag and keeps the last good copy. Ren core and the brain do not read it                                                                                                                                                                                                                                                                                             |
| P10 | Ren's models come automatically from Ren's upstream provider on models.dev (a gateway setting): chat models with tools, not deprecated, minus a block list                                                                                                                                                                                                                                                            |
| P11 | A Ren model id is `ren/<canonical_id>` (`ren/anthropic/claude-opus-5-5`). A model without a `canonical_id` keeps its upstream id                                                                                                                                                                                                                                                                                      |
| P12 | A seat's models come from the vendor through the gateway. Names, limits and efforts come from models.dev                                                                                                                                                                                                                                                                                                              |
| P13 | Price = the models.dev API price. Billing applies the markup and holds the credit                                                                                                                                                                                                                                                                                                                                     |
| P14 | No starter credit. Free models are on for every organization, capped at 100 requests per organization per UTC day, reset at 00:00 UTC. They may run out; the app says so                                                                                                                                                                                                                                              |
| P15 | The default model of a new organization is a deployment setting, for experiments                                                                                                                                                                                                                                                                                                                                      |
| P16 | Every model call goes brain → egress → gateway → vendor, own keys included                                                                                                                                                                                                                                                                                                                                            |
| P17 | Keys and logins live only in the gateway. Ren core forwards a key once, to the gateway, and never stores or logs it                                                                                                                                                                                                                                                                                                   |
| P18 | A provider that an organization did not connect never runs on Ren's account                                                                                                                                                                                                                                                                                                                                           |
| P19 | Claude models that run on a subscription or on the Claude Code runtime run on the `claude` program, through a Ren-owned setup of OpenCode's Claude Agent parts. OpenCode is not changed or patched (G4)                                                                                                                                                                                                               |
| P20 | ChatGPT seats use OpenAI token sharing on `api.openai.com/v1`                                                                                                                                                                                                                                                                                                                                                         |
| P21 | Warnings: a banner above the composer, not saved. Steps 75, 80, 85, 90, 95, 100%. Each step shows once per chat, meter and reset period                                                                                                                                                                                                                                                                               |
| P22 | Warning sources: Claude seats, Ren credit, the free cap. ChatGPT seats have no warnings; only a refusal at the limit                                                                                                                                                                                                                                                                                                  |
| P23 | For a seat, the banner shows the seat that served this chat's last call                                                                                                                                                                                                                                                                                                                                               |
| P24 | The model chip shows `<model> · <card>`, with `(subscription)` or `(key)` on Anthropic and OpenAI                                                                                                                                                                                                                                                                                                                     |
| P25 | A session stores OpenCode's provider and model ids. A method change shows a "model switched" row at the next turn                                                                                                                                                                                                                                                                                                     |
| P26 | Model list changes reach brains through the push. A change in a provider's models notifies only organizations whose list changed. The 30 s pull stays as the backup                                                                                                                                                                                                                                                   |
| P27 | Ren core is provider-agnostic. It builds lists, pushes and renders. Everything about a provider comes from its model provider (§6.1), the organization's settings included. The deployment chooses the model providers                                                                                                                                                                                                |
| P29 | The model provider holds every organization's provider settings: card on/off, method, key status, models switched off. Ren core reads and writes them through the plug-in and keeps no settings table. In hosted Ren the gateway's LiteLLM is the source of truth: an organization is a LiteLLM team, and the Providers page is that team's part of LiteLLM's admin console. A self-hosted Ren brings its own LiteLLM |
| P28 | A self-hosted Ren can run without the gateway and without the egress: its model provider gives the brain a real address and key. Egress on or off for self-hosting is separate work                                                                                                                                                                                                                                   |

## 4. Parts and responsibilities

```
┌──────────────┐  settings, chat         ┌──────────────┐  pull: providers + models + placeholders   ┌──────────────────┐
│              │ <────────────────────── │              │ ─────────────────────────────────────────> │                  │
│  Ren app     │ ──────────────────────> │  Ren core    │                                            │  brain           │
│              │                         │              │  push: POST /ren/pull                      │  (OpenCode)      │
└──────────────┘                         │              │ ─────────────────────────────────────────> │                  │
                                         └──────────────┘                                            └──────────────────┘
                                                │  RenGateway plug-in (§6.2), §10 routes                       │ every call
                                                │  cards, models, configure, keys,                             │ Bearer ren:MODELS
                                                │  connections, meters, brain keys                             v
                                                v                                                     ┌──────────────────┐
                                       ┌──────────────────────────┐   brain key                       │  egress          │
                                       │  Model gateway (closed)  │ <──────────────────────────────── │  swaps ren:MODELS│
                                       │  reads models.dev        │                                   │                  │
                                       │                          │                                   └──────────────────┘
                                       │  keys and logins         │ ──────────> Anthropic, OpenAI, Google, … (vendors)
                                       │  seat choice             │
                                       │  credit and free cap     │
                                       └──────────────────────────┘
                                                    │ usage rows (payer, kind, seat, tokens, cost)
                                                    v
                                       Ren usage_event ──> billing (markup, credit)
```

| Part     | Responsible for                                                                                                                                                                                                          | Holds secrets     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Ren core | organization settings (cards, methods, model switches, default model); the registry of model providers; builds each organization's model list from them; push and pull; Providers page and chat UI; warnings; usage rows | no                |
| Brain    | runs chats on OpenCode; sends every call to the gateway; runs `claude` for Claude models on the Claude Code runtime                                                                                                      | no (placeholders) |
| Egress   | swaps `ren:MODELS` for the brain's gateway key; blocks `api.anthropic.com` from the brain                                                                                                                                | the brain key     |
| Gateway  | the gateway model provider's server side: its cards and their models (models.dev, Ren's list, seats); sign-in pages; keys and logins; seat choice; credit check and free cap; calls vendors; usage rows                  | yes               |
| Billing  | markup and credit                                                                                                                                                                                                        | —                 |

A self-hosted Ren chooses other model providers (§6.3), or none: then it has no models.

## 5. UX

### 5.1 Providers page

Settings → Providers. It replaces "Subscriptions your agents run on" (`app/src/features/providers/providers-page.tsx:130`). The OpenCode Console's Providers pages are the model ([`references/console.md`](references/console.md)).

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

| Element                     | Behaviour                                                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add provider                | A page, Settings → Providers → Connect provider, laid out as the Console's: search, 37 providers, a tile per provider with its mark, name, model count from models.dev (a link to models.dev) and Connect. A provider already on the page is marked                                            |
| Connect (own key)           | A dialog with the provider's fields (most: API key; Azure, AWS Bedrock, Google Vertex AI, Cloudflare AI Gateway, Cloudflare Workers AI and Databricks have more, §16), **Test connection**, Cancel, Save. Save runs the test first. A failed test shows the vendor's message and saves nothing |
| Card switch                 | On or off. Off removes the card's models from pickers at the next push                                                                                                                                                                                                                         |
| Method (Anthropic, OpenAI)  | `API key` or `Subscription`. A change applies at the next push                                                                                                                                                                                                                                 |
| Seats (subscription method) | One line per seat: who connected it, plan, meters (Claude only). "Connect your Claude" or "Sign in with ChatGPT" opens the gateway's sign-in page. A seat that needs a new sign-in shows "Sign in again"                                                                                       |
| Key line                    | The last 4 characters, who saved it, the test result. Replace, remove                                                                                                                                                                                                                          |
| Ren card                    | Credit and today's free count. **Models ›** opens §5.2                                                                                                                                                                                                                                         |
| Members                     | See the page. Only "Connect your …" and their own seats are active (P7)                                                                                                                                                                                                                        |

### 5.2 Ren models

A table like the Console's Models page: name, id, price per 1M tokens (input, output, cache read, cache write), a "Free" tag and an on/off switch per model. Filters: All, On, Free. A new model from models.dev is always on; an admin can switch it off after it arrives. Admins change the switches.

### 5.3 Picker

1. The picker lists exactly the models of the chat's brain (the same pull), grouped by card. The picker already reads the brain's list (`chat/src/react.ts:213`).
2. Each row shows the card and, for Anthropic and OpenAI, the method. Free models carry "Free". Ren models show the price.
3. Card names come from the pull data. The hand-written names go (`app/src/components/model-picker.tsx:65` `vendorNames`, `chat/src/turn-problems.ts:28` `providerLabels`).

### 5.4 Chat

| Element            | Behaviour                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model chip         | `Claude Opus 5.5 · Anthropic (subscription)`, `GPT-6.1 Sol · OpenAI (key)`, `Gemma 4 31B · Ren · Free`                                                                                                                      |
| Warning banner     | Above the composer, not saved (P21). Examples: "Claude seat (Asha's Max): 80% of 7-day limit used · resets Mon 14:00", "Ren credit: 90% used · $0.50 left [Add credits]", "Free models: 75 of 100 today · resets 00:00 UTC" |
| Error              | The turn-problem card (`chat/src/turn-problems.ts`) with the codes of §9.4. Action "Change model". The person can pick another model and press Continue; nothing switches by itself (P4)                                    |
| Model switched row | As today (`app/src/features/session/transcript.tsx:173`), and it names the card as well as the model                                                                                                                        |

### 5.5 A new organization

1. Ren core creates the organization. Ren is on. No credit (P14).
2. The gateway creates the organization's account on the first brain key, as today.
3. The picker shows Ren's free models (on) and Ren's credit models with prices. A credit model refuses with `insufficient_credits` while the organization has no credit.
4. The default model is the deployment setting `REN_DEFAULT_MODEL` (P15).
5. The free cap is 100 per day. Free models can also be unavailable for everyone for a while; the error says "Free models are limited and not guaranteed. Add credit or connect a provider."

## 6. Model providers and model lists

### 6.1 The contract

A model provider is an Effect plug-in in `core`. It is built like a machine provider (`core/src/machine-provider.ts`, `brain-provider.ts`): an `Effect` that gives a `ModelProvider.Provider`, and a registry layer that takes a list of them. The registry refuses two cards with the same id. Ren core uses only this interface:

| Member          | Gives                                                                                                                                                                           | Replaces in Ren core                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `id`            | the plug-in's id: `ren-gateway`, `litellm-gateway`                                                                                                                              | —                                                      |
| `baseUrl`       | where a brain calls the plug-in's models                                                                                                                                        | `Models.Gateway.baseUrl`                               |
| `headers`       | headers a brain sends with each call                                                                                                                                            | —                                                      |
| `cards`         | the cards it offers (below)                                                                                                                                                     | `ProviderCard.definitions`, the `ren` constant         |
| `models`        | a card's models for an organization: `{ revision, models: Models.Info[] }`                                                                                                      | `ModelCatalog`, the Ren list rules, the seat models    |
| `changed`       | a `Stream` of `Changed`, `{ card, organizationId? }`: a card's models changed for one organization, or for all. Named like `MachineProvider.lost`                               | the models.dev job, `POST /internal/inference/changed` |
| `grant`         | a brain's key, a `Grant` (below)                                                                                                                                                | `Models.Gateway.key`                                   |
| `settings`      | an organization's settings of every card: on/off, method, key status (last 4 characters, who saved it, test result), models switched off. The plug-in is their only store (P29) | Ren's settings tables                                  |
| `organizations` | the organizations that have a card on, for a push after a change for every organization                                                                                         | the hash table of Ren's lists                          |
| `configure`     | writes a card's settings for an organization: on/off, method, models switched off                                                                                               | `PUT /v1/ren-models` switches, `PUT /v1/providers/:id` |
| `connect`       | `key`: test, then save the fields. `subscription`: the sign-in address. Answers the vendor's message on a failed test                                                           | the `RenInference` key and connect routes              |
| `disconnect`    | removes a key or a seat                                                                                                                                                         | the same                                               |
| `connections`   | a card's key (last 4 characters, who saved it, test result) and seats (who, plan, models)                                                                                       | the same                                               |
| `meters`        | the meters of a chat's model: credit, free cap, seat limits                                                                                                                     | the gateway calls in `limits.ts`                       |

A `Grant`:

| Tag      | Fields             | Ren core caches it until                                              |
| -------- | ------------------ | --------------------------------------------------------------------- |
| `Minted` | `key`, `expiresAt` | `expiresAt` minus the renewal margin (`credential-source.ts:146-147`) |
| `Fixed`  | `key`              | a call answers 401 (`forget`, `credential-source.ts:498-511`)         |

Two rules for `grant`:

1. It is idempotent per brain. It gives the same valid key until the key is near its expiry, also after Ren core restarts. The gateway keeps each brain's key (`Litellm.ensureBrainKey`, ren-inference `litellm/index.ts:28-53`). A LiteLLM plug-in finds its key by alias (`brain-<id>`).
2. A minted key has an expiry. The type requires it: a `Minted` grant without `expiresAt` does not compile.

Each plug-in runs the contract suite `contract(name, options)` in `core/test/lib/model-provider.ts`, against the real service behind it (`RenGateway`: a running Ren Inference Service, `core/test/ren-inference-live.slow.test.ts`):

| Case                                                         | Shows                                 |
| ------------------------------------------------------------ | ------------------------------------- |
| `grant(A)` two times                                         | the same key                          |
| make the plug-in again over the same server, then `grant(A)` | the same key after a Ren core restart |
| `grant(A)` and `grant(B)`, both `Minted`                     | two keys, each expiring in the future |

Ren core renews a `Minted` key from its `expiresAt` (`core/test/models.test.ts`); when the plug-in mints a new key near expiry is the plug-in's own rule.

A card:

| Field      | Values                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | unique over all plug-ins: `ren`, `groq`, `anthropic`, …                                                                                                                               |
| `name`     | `Groq`                                                                                                                                                                                |
| `mark`     | the logo id                                                                                                                                                                           |
| `payer`    | `ren` or `customer`                                                                                                                                                                   |
| `protocol` | how a brain calls the card's models, unless a model says otherwise                                                                                                                    |
| `auth`     | one or more of: `key` with its fields (name, label, secret, multiline, placeholder); `subscription` with its sign-in label; `operator` (no form: the deployment holds the credential) |
| `models`   | `shared` (the same list for every organization) or `organization` (depends on the organization: seats)                                                                                |

The app renders a card's fields and meters as data. It knows no provider.

The deployment chooses the plug-ins in `server/src/main.ts`:

```ts
ModelProvider.layer([RenGateway.provider]) // hosted Ren
ModelProvider.layer([LiteLLMGateway.provider]) // later, self-hosted: the owner's LiteLLM
ModelProvider.layer([]) // no models
```

With the egress, a brain has one model key (`ren:MODELS`), so a deployment that uses the egress runs one plug-in that gives a key. Several at once is part of the self-hosting work (P28).

### 6.2 The `RenGateway` plug-in (hosted Ren)

`core/src/model-provider/ren-gateway.ts`, namespace `RenGateway`, export `provider`. A client of the gateway's provider routes (§10). The gateway does the work:

**LiteLLM is the source of truth** for what it can hold (P29). The gateway writes to it and answers Ren by reading it:

| Ren concept          | LiteLLM object                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A card               | an access group (`groq`, `ren`); its Connect form from LiteLLM's `/public/providers/fields`                                                                                                                                                                                                                                    |
| A card's model       | one database entry per model (`/model/new`), `model_name` `<card>/<model>` or `ren/<id>`, `model_info` with name, limits, efforts, input types, price, `access_groups: ["<card>"]`, and the payer and kind tags. No wildcards: LiteLLM lists only database entries, and access groups on wildcards need its Enterprise license |
| An organization      | a team (`team_id` = the organization)                                                                                                                                                                                                                                                                                          |
| A card on, connected | the access group in the team's `models`                                                                                                                                                                                                                                                                                        |
| Models switched off  | the team's `models` names the card's other models instead of its access group                                                                                                                                                                                                                                                  |
| An own key           | the credential `own-<organization>-<card>` and its `credential_info` (last 4 characters, who saved it, test result)                                                                                                                                                                                                            |
| A brain key          | a virtual key of the team (`/key/generate`)                                                                                                                                                                                                                                                                                    |

The gateway keeps outside LiteLLM only what LiteLLM has no object for: reading models.dev (the updater's input), the change signal to Ren, subscription seats, Ren credit (the billing hook) and the free cap.

1. **models.dev.** The gateway reads `https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image,video` every 5 min with `If-None-Match`, keeps only its cards' providers, and keeps the last good copy. Facts on 21 Nov 2026: 327 providers, 11.8 MB. `canonical_id` links one model across providers; 9 of 18 Anthropic models had none.
2. **Cards.** Ren, the 37 Console providers, and the subscription method on Anthropic and OpenAI. One list in the gateway holds each card's fields and how the gateway calls it.
3. **Ren's models.** Card `ren`, `shared`:

| Rule    | Value                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source  | Ren's upstream provider on models.dev (`REN_MODELS_UPSTREAM`, a gateway setting)                                                                                                              |
| Kept    | type chat, tool calling, not deprecated, not in the block list (`REN_MODELS_BLOCK`), not an alias (an upstream id that starts with `~`, such as OpenRouter's `~anthropic/claude-opus-latest`) |
| Id      | `ren/<canonical_id>`; without a `canonical_id`, `ren/<upstream id>`                                                                                                                           |
| Free    | price 0 on models.dev                                                                                                                                                                         |
| Price   | the models.dev price; billing applies the markup                                                                                                                                              |
| Runtime | Claude models (`ren/anthropic/…`): `claude`. Others: HTTP                                                                                                                                     |

4. **Own-key models.** A vendor card's models on models.dev: type chat, not deprecated. `shared`.
5. **Subscription models.** The union of the organization's seats' models, joined with models.dev for names, limits and efforts. A model that models.dev does not know keeps the vendor's id and default limits. `organization`.
6. **Changes.** When a card's models change, the gateway calls `POST /internal/inference/changed {card, organizationId?}` (§10). The plug-in gives it to `changed`.

Gateway names:

| Model        | Gateway name                                               |
| ------------ | ---------------------------------------------------------- |
| Ren          | `ren/<id>`                                                 |
| Own key      | `<provider>/<model>` (`openai/gpt-6.1-sol`)                |
| Subscription | `seat/<vendor>/<model>` (`seat/anthropic/claude-opus-5-5`) |

### 6.3 The `LiteLLMGateway` plug-in (self-hosted Ren, later)

Not built in this work. It shows that the contract fits a self-hosted Ren; build it with the self-hosting work. `core/src/model-provider/litellm-gateway.ts`, namespace `LiteLLMGateway`. Settings: `LITELLM_URL`, `LITELLM_MASTER_KEY` (stays in Ren core's environment).

| Member                                 | Value                                                                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cards`                                | one card, `litellm`, named by the setting `LITELLM_NAME` (default `LiteLLM`), auth `operator`, payer `customer`, `shared`                                                                           |
| `models`                               | `GET <LITELLM_URL>/model/info`: each model's name, context and output limits, input types, tool calling and price, where the LiteLLM owner set them. Absent values take default limits and no price |
| `changed`                              | the plug-in reads `/model/info` every 5 min and reports a change when the answer changes                                                                                                            |
| `baseUrl`                              | `LITELLM_URL`                                                                                                                                                                                       |
| `grant`                                | `Minted`: a LiteLLM virtual key per brain (`POST /key/generate`, 6 h, alias `brain-<id>`, metadata: organization, brain, space), found again by alias until it nears expiry                         |
| `connect`, `disconnect`, `connections` | none: the owner configures LiteLLM                                                                                                                                                                  |
| `meters`                               | none                                                                                                                                                                                                |

### 6.4 An organization's list

For each card that is on: the card's models minus the models switched off. Each model carries: gateway name, display name, card, method, runtime (`http` or `claude`), protocol, limits, efforts, input types, price, free.

Ren core stores no list. At each pull it asks the plug-in for the organization's `settings` and each card's `models`, and adds each plug-in's `baseUrl` and `headers`. The gateway answers from LiteLLM and keeps its own copy in memory of what it wrote there.

| Event                                        | Ren core does                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `changed` for one organization               | `pg_notify('ren_brains', 'org:<id>')`                                                             |
| `changed` for a card and every organization  | asks the plug-in which organizations have the card on (`organizations`), then `org:<id>` for each |
| a setting written through the Providers page | `org:<id>` for that organization                                                                  |
| the gateway is down at a pull                | the reply has no `providers`; the brain keeps its last list (`host-api/src/ren-host-api.ts:131`)  |

The 30 s pull stays as the backup. A push that changes nothing costs the brain one pull.

### 6.5 Other model types

A card's models can be of any type LiteLLM serves (`model_info.mode`). Built first: chat and image. Later: transcription, speech, video, decision and others. The contract does not change with a new type.

1. **A provider.** Any provider LiteLLM supports can be a card: one entry in the gateway's offered list, its Connect form from LiteLLM's `/public/providers/fields`, and its chat and image models written by the updater from models.dev. Ren core does not change. Examples: Google (Gemini image models), OpenAI (`gpt-image`), and later ElevenLabs for speech. The person brings the key; the card works as any own-key card.
2. **A card with no chat model** (an image-only provider) shows on the Providers page and in the image tool's choice of model, not in the chat picker.
3. **Ren's card.** Its models are LiteLLM's access group `ren`: chat models from the updater and the media models an operator keeps (`ren/gpt-image-2.5-sunburst`, …). The list never keeps chat models only.
4. **Price.** A list of rates, as models.dev and LiteLLM state them: `{ direction: input | output | cacheRead | cacheWrite, unit: token | image | megapixel | second | character, usd }`; `usd` is per 1M for `token`, per one for the others. Examples: `dall-e-3` output 0.052 per image; Cloudflare's `flux-2-klein-4b` output 0.001095 per megapixel; `gpt-image-1` per image token. Today's per-1M-token price is the `token` unit.
5. **The brain.** Each type has one use: chat → the harness's model and the picker; image → OpenCode's built-in image tool, shown when the list has an image model, with the agent's default `image_generation` model (`media-models.md` D3, D4). A new type adds its tool and its protocol (`cell/src/harness/opencode/model-providers.ts`).
6. **Subscriptions** serve chat only.

To add a type: its model type and protocol in `schema/src/models.ts`, a price unit if it has a new one, and its tool in the brain.

## 7. The brain

### 7.1 What the pull carries

Ren core keeps one thing in memory: a brain's key, the plug-in's `grant`, per workload and plug-in, until it expires (`Minted`) or a call answers 401. It keeps no list. A change in models changes lists and mints no key.

`RenHostApi` pull `providers` (`host-api/src/ren-host-api.ts:131`) becomes the organization's list (§6.4): per card the id, name, and its model provider's `baseUrl` and `headers`, and the models with their gateway names, runtime and metadata. With the egress the key is the placeholder `ren:MODELS`. The brain key comes from `models.refresh` as today (`cell/src/model-refresh.ts`).

### 7.2 HTTP runtime

`cell/src/harness/opencode/model-providers.ts` keeps mapping each card to an OpenCode provider with the card id and the protocol's package. Changes:

1. It does not remove `claude-agent` (`model-providers.ts:24`; tested in G4).
2. A model carries the client settings it needs as fields, and the adapter applies them without a vendor check: `effortUpdates: false`, `compaction: "summary"`, `cost: false`. The gateway sets them on ChatGPT seat models (§6.2), as OpenCode's ChatGPT plugin does (`chatgpt.ts:306-339`), which Ren does not activate. Models with `reasoning.mode: "pro"` are not listed. The Ren plugin's `retry` hook stops retries on the token-sharing refusal codes (`chatgpt.ts:58-67`).

### 7.3 Claude runtime

Claude models with runtime `claude` run on OpenCode's provider `claude-agent`, because its hooks and instructions are bound to that id ([`references/opencode.md`](references/opencode.md)).

1. **Ren-owned setup.** A new file `cell/src/harness/opencode/claude-agent.ts`: the 2.2.6 plugin body without the workspace check, built from `@opencode/core`'s exported parts. It registers the `claude-agent` provider and its models from the pull itself; it never calls `ClaudeProvider.register`, which replaces the list with Claude's short names (G4). It gives `ClaudeIntegration.register` the server's `Bus` service. It is registered next to `RenPlugin` (`server.ts:248`). The code that passed is in [`references/gates.md`](references/gates.md) G4. OpenCode's own copy stays loaded and stops at its workspace check.
2. **Dependency.** `@anthropic-ai/claude-agent-sdk` 0.3.301 in `cell`. It ships `claude` 2.1.301; the plugin needs 2.1.248 or later. `OPENCODE_CLAUDE_PATH` points at the SDK's binary in the brain image (`packages/cell/e2b/e2b.Dockerfile`). No separate `claude` install.
3. **Env and settings.**

| Name                                            | Value                                                                        | Why                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL` (provider `baseURL`)       | the gateway                                                                  | every call through the gateway                                                                                                |
| `ANTHROPIC_CUSTOM_HEADERS` (provider `headers`) | `x-litellm-api-key: Bearer ren:MODELS` and `ren-member: ren:PERSON.<member>` | the gateway key and the member, apart from `Authorization`                                                                    |
| `CLAUDE_CODE_OAUTH_TOKEN`                       | a placeholder that does not start with `sk-ant-oat` (for example `ren-seat`) | subscription mode in `claude`. The gateway puts the seat's login in; a client token that looks like a login would win over it |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`      | `1`                                                                          | no direct calls to `api.anthropic.com` (G1)                                                                                   |

4. **Egress.** Block `api.anthropic.com` from the brain sandbox.
5. **Folder.** `claude` starts in a folder on the brain's machine. Tools still run on the hand through MCP.

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

| Change                                                                            | Written to                                                | Notify                                            |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| Card on/off, method, key saved or removed, model switch                           | the model provider (`configure`, `connect`, `disconnect`) | `org:<id>`                                        |
| A provider's `changed`: one organization (a seat) or all (models.dev, Ren's list) | nothing in Ren                                            | `org:<id>` for the organizations with the card on |

A Ren-wide `'all'` notify wakes every running brain (`specs/runtime/hot-reload/README.md` §2.5), so a provider change never sends `'all'`. The 30 s pull stays as the backup. The core and brain polls go.

What a running chat sees:

| Change                                         | Effect                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Card off, model removed                        | The call in flight finishes. The model leaves the picker. The next turn uses the chat's settings model and shows why (hot-reload row 33) |
| Key replaced, login refreshed                  | Nothing. The next call uses the new credential                                                                                           |
| Method key ↔ subscription                      | The runtime changes (`anthropic` ↔ `claude-agent`): a "model switched" row at the next turn                                              |
| Claude runtime connection change during a turn | The turn finishes on the old settings; the next turn uses the new ones (G5)                                                              |
| New model                                      | In the picker after the push                                                                                                             |

## 9. Usage, limits and billing

### 9.1 Usage rows

The gateway sends one `usage_event` per call (`specs/usage.md`). New fields in `data`: `seat` (seat id, for seat calls) and `kind` (`ren`, `free`, `key`, `seat`). `payer` is `ren` for Ren calls and `customer` for own keys and seats (`schema/src/usage.ts:13`). Cost is the models.dev price; billing charges only rows with payer `ren`.

### 9.2 Credit

Billing holds the credit and the markup. The gateway checks credit before each Ren call.

### 9.3 Warnings

| Meter        | Source                                                              | Reset                  |
| ------------ | ------------------------------------------------------------------- | ---------------------- |
| Claude seat  | the gateway's per-seat meters (5h and 7d, from Anthropic's answers) | the meter's reset time |
| ChatGPT seat | none; only the refusal                                              | —                      |
| Ren credit   | `Billing.Summary` used ÷ granted (`schema/src/billing.ts:21-22`)    | the plan cycle         |
| Free cap     | `GET /v1/usage/free`                                                | 00:00 UTC              |

Delivery: a new endpoint `limits.get({ sessionId })` returns the meters for the chat's current model, from the `meters` of the card's model provider: the seat of the session's last `usage_event` with a `seat` (P23), or credit, or the free cap. The app reads it when a chat opens, after each turn and every 60 s while the chat is open. The `chat` package decides which step to show and remembers shown steps per chat, meter and reset time.

### 9.4 Errors

| Code                                       | When                                 | Text                                                                                       | Actions                            |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| `insufficient_credits`                     | Ren call, no credit                  | today's out-of-credits text (`chat/src/turn-problems.ts`)                                  | Add credits (admins), Change model |
| `free_limit_reached`                       | free cap reached                     | "Free models: today's 100 requests are used. They reset at 00:00 UTC."                     | Change model                       |
| `free_unavailable`                         | free models unavailable for everyone | "Free models are limited and not guaranteed. Try later, add credit or connect a provider." | Change model                       |
| `provider_not_connected`                   | own-key model without a key          | "<Card> is not connected."                                                                 | Providers (admins), Change model   |
| `subscription_limit_reached`               | every seat of the vendor is full     | "All <vendor> subscriptions are at their limit. The next resets at <time>."                | Change model                       |
| ChatGPT refusal codes (`chatgpt.ts:58-67`) | a ChatGPT seat refuses               | "ChatGPT usage limit reached."                                                             | Change model                       |
| `gateway_unavailable`                      | the gateway cannot decide            | "Model access is not available now. Try again."                                            | Try again                          |

## 10. Contract: Ren core → gateway

The `RenGateway` plug-in (§6.2) and `RenInference` call the gateway with today's signed token (`core/src/ren-inference.ts`). The organization is in the token.

| Route                                                                                | Status | Purpose                                                                                                        |
| ------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `GET /v1/providers`                                                                  | new    | `cards`: the gateway's cards (§6.1)                                                                            |
| `GET /v1/providers/:card/models`                                                     | new    | `models`: `{ revision, models }`. A `shared` card answers the same for every organization                      |
| `GET /v1/providers/:card/organizations`                                              | new    | `organizations`: the teams whose allowlist has the card's access group                                         |
| `GET /v1/providers/settings`                                                         | new    | `settings`: the organization's settings of every card, read from its LiteLLM team and credentials              |
| `PUT /v1/providers/:card {enabled, method, off}`                                     | new    | `configure`: on/off, method, and the models switched off. A switched-off model is refused with `403 model_off` |
| `POST /v1/providers/:card/test {fields}`                                             | new    | test a key without saving; ok or the vendor's message                                                          |
| `PUT /v1/providers/:card/key {fields}`                                               | new    | test, then store; returns `{ last4, testedAt }`. Ren core forwards the fields and never stores or logs them    |
| `DELETE /v1/providers/:card/key`                                                     | new    | remove the key                                                                                                 |
| `POST /v1/connect`, `GET /v1/connections`, `PATCH/DELETE /v1/connections/:id`        | change | seats. `GET` adds each seat's card, plan and models                                                            |
| `GET /v1/providers/:card/meters?sessionId=`                                          | new    | `meters`: credit, the free cap `{ used, limit, resetsAt }`, the seat meters                                    |
| `POST /v1/keys {brainId, spaceId}`                                                   | keep   | `grant`: the brain key, `Minted`                                                                               |
| inference keys, `POST /v1/harness-plans`, `DELETE /v1/members/:id`, `DELETE /v1/org` | keep   | not part of the model provider                                                                                 |
| `PUT /v1/ren-models`, `GET /v1/catalog`, `GET /v1/usage/free`                        | remove | the gateway builds Ren's list; the free cap is a meter                                                         |

Gateway → Ren core: `POST /internal/inference/changed {card, organizationId?}` when a card's models change: a seat (one organization) or models.dev and Ren's list (no organization). Only the usage ingest key may call it.

## 11. Lifecycle states

| State                    | What happens                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brain asleep             | Nothing. The pull at wake brings the newest list                                                                                                                                                     |
| Brain waking             | The start pull brings the newest list. The Claude runtime starts `claude` with the new env                                                                                                           |
| Mid-turn                 | §8 table. A seat that fills mid-turn: the gateway tries another seat                                                                                                                                 |
| Brain down or restarting | The boot pull applies the list. No secret is lost: the brain holds none                                                                                                                              |
| Gateway down             | Calls fail (`gateway_unavailable` or a transport error). The brain's same-model retry runs (about 84 s); then the turn shows the error. `models` fails: Ren core keeps each organization's last list |
| Ren core down            | Calls keep working. Settings and lists do not change until it is back                                                                                                                                |
| models.dev down          | The gateway keeps its last good copy                                                                                                                                                                 |
| A login's refresh fails  | The seat shows "Sign in again"                                                                                                                                                                       |

## 12. Work in Ren, by package

| Package              | Work                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`             | `ModelProvider.Card` and its fields; provider settings shapes (card, method, key status, model switch). Per model in `Models.Registration`: gateway name, runtime, card, method, price, free. Usage `kind` and `seat`                                                                                                                                                                                 |
| `db`                 | No tables for providers or lists. Ren core sends `pg_notify('ren_brains', 'org:<id>')` itself                                                                                                                                                                                                                                                                                                         |
| `core`               | `ModelProvider` (contract, registry, layer); the plug-in `model-provider/ren-gateway.ts`; the contract suite `test/lib/model-provider.ts`; the list job on `changed`; `Models.grant` and the pull from §6.4; remove the `/v1/catalog` poll (`core/src/ren-inference/provider.ts`); policy `provider.manage` (admins, owners) and `provider.view` (members); `limits.get`; setting `REN_DEFAULT_MODEL` |
| `protocol`, `server` | Providers endpoints (list, update, test, set key, remove key), Ren models endpoints, `limits.get`, `POST /internal/inference/changed`; `bun run generate`                                                                                                                                                                                                                                             |
| `cell`               | `model-providers.ts` (§7.2); `claude-agent.ts` (§7.3); remove `model-discovery.ts`; ChatGPT settings and retry codes                                                                                                                                                                                                                                                                                  |
| image, egress        | SDK binary path in `e2b.Dockerfile`; block `api.anthropic.com` from the brain                                                                                                                                                                                                                                                                                                                         |
| `chat`               | Error codes (§9.4); banner rules; card labels from data                                                                                                                                                                                                                                                                                                                                               |
| `app`                | Providers page, Add provider grid and dialog, Ren models page, picker rows, model chip, banner                                                                                                                                                                                                                                                                                                        |

## 13. Tests

### 13.1 Gates

Done ([`references/gates.md`](references/gates.md)): G1, G4, G5, G6.

Pending (Ren side):

| Gate | Question                                                                                               | When                    |
| ---- | ------------------------------------------------------------------------------------------------------ | ----------------------- |
| GR1  | The SDK's Linux `claude` binary runs in a real brain (own E2B template) and a turn reaches the gateway | with the Claude runtime |
| GR2  | The egress blocks `api.anthropic.com` from the brain, and a turn still works                           | with the Claude runtime |
| GR3  | A provider change for all organizations pushes only to the organizations with the card on, under load  | with the list job       |

### 13.2 Package tests

Only rules that the code does not show:

| Package | Test                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`  | the contract suite (§6.1) on `RenGateway`; a `Minted` grant is reused until its renewal time, a `Fixed` one until a 401; a `changed` event mints no key; the registry refuses a duplicate card; an organization's list from settings and two plug-ins (a test plug-in as the second); a `changed` for all organizations notifies only those whose list changed; the default model setting |
| `cell`  | `claude-agent` stays when Ren sends other providers; the Claude runtime env; ChatGPT refusal codes stop a retry                                                                                                                                                                                                                                                                           |
| `chat`  | each banner step shows once per chat, meter and reset period; each error code maps to its text and actions                                                                                                                                                                                                                                                                                |

### 13.3 End-to-end (`packages/e2e/chaos`)

| Case                          | Covers                                                                                                                     | States                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Catalog                       | a new model in the gateway's models.dev reaches the picker after one push; gateway down keeps the last list                | Ren core restart while the gateway is down |
| Own key                       | save with a failed and a passing test; a turn; payer `customer`; key removed mid-turn → next call `provider_not_connected` | mid-turn, asleep                           |
| Claude seat (live test seat)  | a turn on `claude`; usage row names the seat; banner at 75%                                                                | waking, `claude` idle 5 min                |
| Two Claude seats              | stickiness per chat; one seat full → the next try uses the other; no error shown                                           | mid-turn                                   |
| ChatGPT seat (live test seat) | a turn; refusal code text                                                                                                  | mid-turn                                   |
| Ren credit                    | cost at the models.dev price; banners; 0 credit → `insufficient_credits`                                                   | credit runs out mid-turn                   |
| Ren free                      | 100 requests, then `free_limit_reached`; reset at 00:00 UTC under `TestClock`                                              | —                                          |
| Hot reload                    | card off mid-turn; method change → switch row; Ren model switched off leaves the picker                                    | mid-turn, asleep, restart                  |

### 13.4 App (Playwright)

1. Providers: add a key (bad, then good), turn a card off and on, change the method, connect a seat (stubbed page), Ren model switches.
2. Chat: the chip for each kind; each banner step; the error card actions.

## 14. Removed and superseded

| Item                                                                                           | Fate                                          |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `specs/runtime/media-models.md` §8 items B0–B4 (own key through the egress)                    | replaced by this spec                         |
| `core/src/ren-inference/provider.ts` 30 s poll of `/v1/catalog`; `cell/src/model-discovery.ts` | removed                                       |
| `vendorNames`, `providerLabels`                                                                | removed; names from data                      |
| `Models.layerNone`; `ProviderCard.definitions` and the `ren` card constant in Ren core         | an empty registry; cards from model providers |

## 15. Build order (Ren side)

| Step | Work                                                                                                            | Done when                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | `ModelProvider` contract, registry and suite, the `RenGateway` plug-in, organization tables, the list job, push | a provider change reaches only affected organizations' pickers   |
| 2    | Providers API (schema, db, core, protocol, server)                                                              | cards, keys and switches round-trip; members cannot change cards |
| 3    | App: Providers page, Add provider, Ren models page, picker rows, model chip                                     | the Playwright journeys of §13.4 pass                            |
| 4    | Brain: pull shape, `model-providers.ts`, Claude runtime, ChatGPT settings, image and egress                     | a turn on a Claude seat and on a ChatGPT seat; GR1, GR2          |
| 5    | Warnings and errors: `limits.get`, usage fields, banner rules, error codes; end-to-end cases                    | §13.3 passes                                                     |

## 16. Settled details

| Item                                                                                                                                  | Decision                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A "Use this model on Ren" button on errors                                                                                            | No. The error card offers "Change model" only (P4)                                                         |
| The fields of Azure, AWS Bedrock, Google Vertex AI, Cloudflare AI Gateway, Cloudflare Workers AI and Databricks in the Connect dialog | The builder takes them from each provider's documentation and from the credential values the gateway needs |
| The values of `REN_DEFAULT_MODEL` (Ren), `REN_MODELS_UPSTREAM` and `REN_MODELS_BLOCK` (gateway)                                       | Deployment settings. The owner sets and changes them; no code change                                       |

## 17. Later: the self-hosting work

These items are not built in this work. The contract (§6.1) must keep room for each.

| Item                             | Problem                                                                                                                                      | Planned answer                                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LiteLLM plug-in                  | A self-hosted Ren brings its own LiteLLM                                                                                                     | §6.3                                                                                                                                                                                                                                                          |
| Brains without the egress        | A self-hosted Ren may run brains with no egress. The brain then holds the real key                                                           | The brain gets its key from `models.refresh` (`cell/src/model-refresh.ts`, the mode without the egress). The egress becomes a deployment switch                                                                                                               |
| A brain key after its brain      | Without the egress, the key is on the machine. When Ren destroys the brain, a minted key stays valid until it expires (6 h for LiteLLM keys) | An optional contract method, `revoke(brain)`, that ends a brain's key. Ren core calls it when it destroys a brain. The LiteLLM plug-in deletes the key (`POST /key/delete`). The gateway does not need it: with the egress, the key never reaches the machine |
| Several plug-ins with the egress | A brain has one model placeholder, `ren:MODELS`. Two plug-ins that each give a key need one placeholder each                                 | One egress label per plug-in that gives a key                                                                                                                                                                                                                 |
