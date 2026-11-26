# Providers: models, own keys and subscriptions from inference plugins

Status: designed, not built. 25 Nov 2026: inference plugins as plug-ins (P27, §6). Tasks: RENAI-235 (model catalog refresh), RENAI-244 (provider pattern for own keys).

This file is the core of the spec. The references hold the detail:

| Reference                                          | Contents                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| [`references/gates.md`](references/gates.md)       | The experiments on the brain side (G1, G4, G5, G6): setup, result, decision |
| [`references/console.md`](references/console.md)   | The OpenCode Console and what Ren takes from it                             |
| [`references/opencode.md`](references/opencode.md) | The OpenCode facts the design uses, with file and line                      |

Ren core knows no provider by name. It gets providers and models from **inference plugins**: Effect plug-ins that the deployment chooses (§6). Hosted Ren uses one, Ren's inference plugin: a separate, closed service. This spec states only what Ren needs from it (§10).

## 1. Goal

An organization uses models from three kinds of provider. Every model call goes through the inference service. Ren knows which provider served each call and who pays.

| Kind         | Example                                       | Who pays                                                 |
| ------------ | --------------------------------------------- | -------------------------------------------------------- |
| Ren          | `ren/anthropic/claude-opus-5-5`, a free model | Ren, then the organization's credit. Free models: nobody |
| Own key      | the organization's OpenAI key                 | the organization, to the vendor                          |
| Subscription | a member's Claude Max or ChatGPT Plus account | the organization's plan                                  |

Done when:

1. The Providers page works like the OpenCode Console Providers page (§5), with subscriptions as a method of the Anthropic and OpenAI providers.
2. Each inference plugin supplies its own providers and models. Ren core reads no model source and has no provider names in its code. The inference service's source is models.dev; nobody edits a model list by hand. A change reaches running brains through the push (§8).
3. A self-hosted Ren plugs in its own inference plugin, such as its own LiteLLM, without a change to Ren core.
4. Every call goes brain → egress → inference service → vendor. The brain holds no secret, and Ren core stores no key or login.
5. Subscriptions run on official clients only: the real `claude` program and OpenAI token sharing.
6. A chat shows which provider runs its model, and warns at 75, 80, 85, 90, 95 and 100% of a limit.
7. Every gate in §13.1 passes.

## 2. Words

| Word              | Meaning                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inference plugin  | An Effect plug-in in Ren core that supplies providers, their models, connections and limits (§6). Ren's inference service is one; a self-hosted LiteLLM is another             |
| Provider          | A source of models that an organization turns on and connects: Ren, Anthropic, OpenAI, Google, …. An inference plugin offers it; the Providers page shows one row per provider |
| Method            | How a provider connects: `key` or `subscription`. Only Anthropic and OpenAI have `subscription`                                                                                |
| Seat              | One connected subscription account. An organization can have several per vendor                                                                                                |
| Inference service | The closed inference service (renai-labs/inference). It holds keys and logins, reads models.dev, chooses seats, checks credit and the free cap, and calls vendors              |
| Free model        | A Ren model with price 0 on models.dev                                                                                                                                         |
| Free cap          | 100 free-model requests per organization per UTC day                                                                                                                           |
| Push / pull       | Push: Ren tells a brain to pull now. Pull: the brain fetches its full state (§8)                                                                                               |

## 3. Decisions

| ID  | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | The Providers page shows one row per provider. Ren is always first                                                                                                                                                                                                                                                                                                                                                                               |
| P2  | A subscription is a method inside the Anthropic or OpenAI provider. One method is active per provider                                                                                                                                                                                                                                                                                                                                            |
| P3  | Each provider has an on/off switch, Ren included. Ren off hides Ren's models, free models included                                                                                                                                                                                                                                                                                                                                               |
| P4  | No automatic fallback and no fallback switch. After an error, the person picks another model and presses Continue                                                                                                                                                                                                                                                                                                                                |
| P5  | The inference service's providers for own keys are the OpenCode Console's 37 providers ([`references/console.md`](references/console.md)). One key per provider per organization                                                                                                                                                                                                                                                                 |
| P6  | Each provider has a models list: one on/off switch per model. A new model is always on. Not in v1: several keys per provider, "who can use this", custom providers, budgets and reservations                                                                                                                                                                                                                                                     |
| P7  | Admins and owners change providers, methods, keys and Ren's model switches. Any member connects their own seat. A member removes their own seats; admins remove any seat                                                                                                                                                                                                                                                                         |
| P8  | Seats serve the whole organization. Several seats per vendor spread the load; a chat sticks to one seat. Keys: one per provider                                                                                                                                                                                                                                                                                                                  |
| P9  | The inference service reads models.dev every 5 min with an ETag and keeps the last good copy. Ren core and the brain do not read it                                                                                                                                                                                                                                                                                                              |
| P10 | Ren's models come automatically from Ren's upstream provider on models.dev (an inference service setting): chat models with tools, not deprecated, minus a block list                                                                                                                                                                                                                                                                            |
| P11 | A Ren model id is `ren/<canonical_id>` (`ren/anthropic/claude-opus-5-5`). A model without a `canonical_id` keeps its upstream id                                                                                                                                                                                                                                                                                                                 |
| P12 | A seat's models come from the vendor through the inference service. Names, limits and efforts come from models.dev                                                                                                                                                                                                                                                                                                                               |
| P13 | Price = the models.dev API price. Billing applies the markup and holds the credit                                                                                                                                                                                                                                                                                                                                                                |
| P14 | No starter credit. Free models are on for every organization, capped at 100 requests per organization per UTC day, reset at 00:00 UTC. They may run out; the app says so                                                                                                                                                                                                                                                                         |
| P15 | The default model of a new organization is a deployment setting, for experiments                                                                                                                                                                                                                                                                                                                                                                 |
| P16 | Every model call goes brain → egress → inference service → vendor, own keys included                                                                                                                                                                                                                                                                                                                                                             |
| P17 | Keys and logins live only in the inference service. Ren core forwards a key once, to the inference service, and never stores or logs it                                                                                                                                                                                                                                                                                                          |
| P18 | A provider that an organization did not connect never runs on Ren's account                                                                                                                                                                                                                                                                                                                                                                      |
| P19 | Claude models that run on a subscription or on the Claude Code runtime run on the `claude` program, through a Ren-owned setup of OpenCode's Claude Agent parts. OpenCode is not changed or patched (G4)                                                                                                                                                                                                                                          |
| P20 | ChatGPT seats use OpenAI token sharing on `api.openai.com/v1`                                                                                                                                                                                                                                                                                                                                                                                    |
| P21 | Warnings: a banner above the composer, not saved. Steps 75, 80, 85, 90, 95, 100%. Each step shows once per chat, limit and reset period                                                                                                                                                                                                                                                                                                          |
| P22 | Warning sources: Claude seats, Ren credit, the free cap. ChatGPT seats have no warnings; only a refusal at the limit                                                                                                                                                                                                                                                                                                                             |
| P23 | For a seat, the banner shows the seat that served this chat's last call                                                                                                                                                                                                                                                                                                                                                                          |
| P24 | The model chip shows `<model> · <provider>`, with `(subscription)` or `(key)` on Anthropic and OpenAI                                                                                                                                                                                                                                                                                                                                            |
| P25 | A session stores OpenCode's provider and model ids. A method change shows a "model switched" row at the next turn                                                                                                                                                                                                                                                                                                                                |
| P26 | A change of one organization's settings or seats reaches its brains through the push. A change for every organization (models.dev, Ren's list) reaches brains at their next 30 s pull: a push to every organization with the provider on is a storm for a change no one waits for                                                                                                                                                                |
| P27 | Ren core is provider-agnostic. It builds lists, pushes and renders. Everything about a provider comes from its inference plugin (§6.1), the organization's settings included. The deployment chooses the inference plugins                                                                                                                                                                                                                       |
| P28 | A self-hosted Ren can run without the inference service and without the egress: its inference plugin gives the brain a real address and key. Egress on or off for self-hosting is separate work                                                                                                                                                                                                                                                  |
| P29 | The inference service holds every organization's provider settings: provider on/off, method, key status, models switched off. Ren core reads and writes them through the inference service and keeps no settings table. In hosted Ren the inference service's LiteLLM is the source of truth: an organization is a LiteLLM team, and the Providers page is that team's part of LiteLLM's admin console. A self-hosted Ren brings its own LiteLLM |

## 4. Parts and responsibilities

```
┌──────────────┐  settings, chat         ┌──────────────┐  pull: providers + models + placeholders   ┌──────────────────┐
│              │ <────────────────────── │              │ ─────────────────────────────────────────> │                  │
│  Ren app     │ ──────────────────────> │  Ren core    │                                            │  brain           │
│              │                         │              │  push: POST /ren/pull                      │  (OpenCode)      │
└──────────────┘                         │              │ ─────────────────────────────────────────> │                  │
                                         └──────────────┘                                            └──────────────────┘
                                                │  RenInferencePlugin (§6.2), §10 routes                       │ every call
                                                │  providers, models, configure, keys,                             │ Bearer ren:MODELS
                                                │  connections, limits, brain keys                             v
                                                v                                                     ┌──────────────────┐
                                       ┌──────────────────────────┐   brain key                       │  egress          │
                                       │  Inference plugin (closed)  │ <──────────────────────────────── │  swaps ren:MODELS│
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

| Part              | Responsible for                                                                                                                                                                              | Holds secrets     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Ren core          | the default model of a new organization; the registry of inference plugins; builds each organization's model list from them; push and pull; Providers page and chat UI; warnings; usage rows | no                |
| Brain             | runs chats on OpenCode; sends every call to the inference service; runs `claude` for Claude models on the Claude Code runtime                                                                | no (placeholders) |
| Egress            | swaps `ren:MODELS` for the brain's inference key, only for the inference service's host                                                                                                      | the brain key     |
| Inference service | the inference service: its providers and their models (models.dev, Ren's list, seats); sign-in pages; keys and logins; seat choice; credit check and free cap; calls vendors; usage rows     | yes               |
| Billing           | markup and credit                                                                                                                                                                            | —                 |

A self-hosted Ren chooses other inference plugins (§6.3), or none: then it has no models.

## 5. UX

### 5.1 Providers page

Settings → Providers: one grid of every provider the inference plugins offer, 3 per row, as the Console's Connect provider page ([`references/console.md`](references/console.md)). The built-in providers come first, then those the organization added, then the others.

```
 Providers                                                        [ Search ]   [ Inference keys ]

 ┌───────────────────────────────┐  ┌───────────────────────────────┐  ┌───────────────────────────────┐
 │                               │  │                               │  │                               │
 │  [logo]  Ren            On    │  │  [logo]  Anthropic     On     │  │  [logo]  Groq      [Connect]  │
 │                               │  │                               │  │                               │
 │  292 models · Built in        │  │  12 models · 2 subscriptions  │  │  7 models                     │
 │  Chat 287 · Image 2 · …       │  │  Chat 12                      │  │  Chat 7                       │
 │                               │  │                               │  │                               │
 └───────────────────────────────┘  └───────────────────────────────┘  └───────────────────────────────┘
```

| Element | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logo    | The address the inference service gives (`InferencePlugin.Provider.logo`): models.dev's for a vendor, the inference service's own for Ren. The app shows it on a white tile; a provider without one shows its first letter                                                                                                                                                                                                                                   |
| Card    | Model count and the count of each type (chat, image, voice, transcription, decisions). A connected provider shows On or Off and its key's last 4 characters or its subscriptions. Clicking it opens its page                                                                                                                                                                                                                                                 |
| Connect | On a provider that is not connected. For Anthropic and OpenAI, two tabs: **Subscription** (open the vendor's sign-in in a new tab, then paste what it shows; the inference service says what, `RenInference.SignIn.paste`) and **API key** (admins only). Other providers: the key's fields. **Save key** tests the key first; a failed test shows the vendor's message and saves nothing. An admin's first connection from here also becomes what chats use |
| Members | See every page. They connect their own subscription; adding a key and every switch are for admins (P7)                                                                                                                                                                                                                                                                                                                                                       |

A provider's page (Settings → Providers → <provider>):

| Element                           | Behaviour                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header                            | Logo and the provider switch (Off removes its models from pickers at the next push)                                                                                                                                                                                                                                                |
| Chats use (Anthropic, OpenAI)     | Two cards, Subscriptions and API key, each with what is connected; the one in use says so. An admin switches to the other once it is connected. When the one in use has nothing connected, the page says chats can't use the provider yet                                                                                          |
| API key                           | The last 4 characters, who saved it, when it was tested. Add, replace, remove                                                                                                                                                                                                                                                      |
| Subscriptions (Anthropic, OpenAI) | One card per seat: who connected it, plan, status, limits (Claude only). "Connect your Claude" and "Sign in again" open the Connect dialog on its Subscription tab; signing in again with the same account updates the seat in place                                                                                               |
| Models                            | Filters All, On, Free; one tab per model type the provider has. Columns: model, features (reasoning, reads images, reads PDFs, each with a tooltip), context, prices per 1M tokens, the switch. A new model is on. With subscriptions in use: "Models your subscriptions serve", the plans that serve each model instead of prices |

### 5.2 Ren models

Ren's page is the provider page of §5.1: its models by type (chat, image, transcription, decisions), with price, a "Free" tag and a switch per model. A new model from models.dev is always on; an admin can switch it off after it arrives.

### 5.3 Picker

1. The picker lists exactly the models of the chat's brain (the same pull), grouped by provider. The picker already reads the brain's list (`chat/src/react.ts:213`).
2. Each row shows the provider and, for Anthropic and OpenAI, the method. Free models carry "Free". Ren models show the price.
3. Provider names come from the pull data. The hand-written names go (`app/src/components/model-picker.tsx:65` `vendorNames`, `chat/src/turn-problems.ts:28` `providerLabels`).

### 5.4 Chat

| Element            | Behaviour                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model chip         | `Claude Opus 5.5 · Anthropic (subscription)`, `GPT-6.1 Sol · OpenAI (key)`, `Gemma 4 31B · Ren · Free`                                                                                                                      |
| Warning banner     | Above the composer, not saved (P21). Examples: "Claude seat (Asha's Max): 80% of 7-day limit used · resets Mon 14:00", "Ren credit: 90% used · $0.50 left [Add credits]", "Free models: 75 of 100 today · resets 00:00 UTC" |
| Error              | The turn-problem provider (`chat/src/turn-problems.ts`) with the codes of §9.4. Action "Change model". The person can pick another model and press Continue; nothing switches by itself (P4)                                |
| Model switched row | As today (`app/src/features/session/transcript.tsx:173`), and it names the provider as well as the model                                                                                                                    |

### 5.5 A new organization

1. Ren core creates the organization. Ren is on. No credit (P14).
2. The inference service creates the organization's account on the first brain key, as today.
3. The picker shows Ren's free models (on) and Ren's credit models with prices. A credit model refuses with `insufficient_credits` while the organization has no credit.
4. The default model is the deployment setting `REN_DEFAULT_MODEL` (P15).
5. The free cap is 100 per day. When the upstream of a free model fails, the call fails as any upstream failure does; no separate code says so.

## 6. Inference plugins and model lists

### 6.1 The contract

An inference plugin is an Effect plug-in in `core`. It is built like a machine provider (`core/src/machine-provider.ts`, `brain-provider.ts`): an `Effect` that gives a `InferencePlugin.Plugin`, and a registry layer that takes a list of them. The registry refuses two providers with the same id. Ren core uses only this interface:

| Member        | Gives                                                                                                                                                                                         | Replaces in Ren core                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `id`          | the inference plugin's id: `ren-inference`, `litellm`                                                                                                                                         | —                                                      |
| `baseUrl`     | where a brain calls the inference service's models                                                                                                                                            | `Models.Gateway.baseUrl`                               |
| `headers`     | headers a brain sends with each call                                                                                                                                                          | —                                                      |
| `providers`   | the providers it offers (below)                                                                                                                                                               | `ProviderCard.definitions`, the `ren` constant         |
| `models`      | a provider's models for an organization: `{ revision, models: Models.Info[] }`                                                                                                                | `ModelCatalog`, the Ren list rules, the seat models    |
| `grant`       | a brain's key, a `Grant` (below)                                                                                                                                                              | `Models.Gateway.key`                                   |
| `settings`    | an organization's settings of every provider: on/off, method, key status (last 4 characters, who saved it, test result), models switched off. The inference service is their only store (P29) | Ren's settings tables                                  |
| `configure`   | writes a provider's settings for an organization: on/off, method, models switched off                                                                                                         | `PUT /v1/ren-models` switches, `PUT /v1/providers/:id` |
| `saveKey`     | test, then save a key's fields. Answers the vendor's message on a failed test. A seat signs in on the inference service's page, not through the plugin                                        | the `RenInference` key and connect routes              |
| `removeKey`   | removes a key                                                                                                                                                                                 | the same                                               |
| `connections` | a provider's key (last 4 characters, who saved it, test result) and seats (who, plan, models)                                                                                                 | the same                                               |
| `limits`      | the limits of a chat's model: the free cap, the limits of the seat that served it. Not the credit, which is billing's (§9.2)                                                                  | the inference service calls in `limits.ts`             |

A `Grant`:

| Tag      | Fields             | Ren core caches it until                                              |
| -------- | ------------------ | --------------------------------------------------------------------- |
| `Minted` | `key`, `expiresAt` | `expiresAt` minus the renewal margin (`credential-source.ts:146-147`) |
| `Fixed`  | `key`              | a call answers 401 (`forget`, `credential-source.ts:498-511`)         |

Two rules for `grant`:

1. It is idempotent per brain. It gives the same valid key until the key is near its expiry, also after Ren core restarts. The inference service keeps each brain's key (`Litellm.ensureBrainKey`, ren-inference `litellm/index.ts:28-53`). A LiteLLM inference plugin finds its key by alias (`brain-<id>`).
2. A minted key has an expiry. The type requires it: a `Minted` grant without `expiresAt` does not compile.

Each inference plugin runs the contract suite `contract(name, options)` in `core/test/lib/inference-plugin.ts`, against the real service behind it (`RenInferencePlugin`: a running Ren Inference Service, `core/test/ren-inference-live.slow.test.ts`):

| Case                                                                   | Shows                                 |
| ---------------------------------------------------------------------- | ------------------------------------- |
| `grant(A)` two times                                                   | the same key                          |
| make the inference service again over the same server, then `grant(A)` | the same key after a Ren core restart |
| `grant(A)` and `grant(B)`, both `Minted`                               | two keys, each expiring in the future |

Ren core renews a `Minted` key from its `expiresAt` (`core/test/models.test.ts`); when the inference service mints a new key near expiry is the inference service's own rule.

A provider:

| Field      | Values                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | unique over all inference plugins: `ren`, `groq`, `anthropic`, …                                                                                                                      |
| `name`     | `Groq`                                                                                                                                                                                |
| `mark`     | the logo id                                                                                                                                                                           |
| `payer`    | `ren` or `customer`                                                                                                                                                                   |
| `protocol` | how a brain calls the provider's models, unless a model says otherwise                                                                                                                |
| `auth`     | one or more of: `key` with its fields (name, label, secret, multiline, placeholder); `subscription` with its sign-in label; `operator` (no form: the deployment holds the credential) |
| `models`   | `shared` (the same list for every organization) or `organization` (depends on the organization: seats)                                                                                |

The app renders a provider's fields and limits as data. It knows no provider.

The deployment chooses the inference plugins in `server/src/main.ts`:

```ts
InferencePlugin.layer([RenInferencePlugin.plugin]) // hosted Ren
InferencePlugin.layer([LiteLLMInferencePlugin.plugin]) // later, self-hosted: the owner's LiteLLM
InferencePlugin.layer([]) // no models
```

With the egress, a brain has one model key (`ren:MODELS`), so a deployment that uses the egress runs one inference plugin that gives a key. Several at once is part of the self-hosting work (P28).

### 6.2 The `RenInferencePlugin` plugin (hosted Ren)

`core/src/inference-plugin/ren.ts`, namespace `RenInferencePlugin`, export `provider`. A client of the inference service's provider routes (§10). The inference service does the work:

**models.dev is the source of truth for models; LiteLLM is the source of truth for each organization's settings** (P29). The inference service answers Ren's model lists from its models.dev copy, and writes to LiteLLM only what calls need:

| Ren concept              | LiteLLM object                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A provider               | an access group (`groq`, `ren`); its Connect form from LiteLLM's `/public/providers/fields`                                                                                                                                                                                                                                                                                                                                                                |
| A provider's model       | while some organization can call it (always for Ren; for an own-key provider, while some organization has its key): one database entry per model (`/model/new`), `model_name` `<provider>/<model>` or `ren/<id>`, `model_info` with name, limits, efforts, input types, price, `access_groups: ["<provider>"]`, and the payer and kind tags. No wildcards: LiteLLM lists only database entries, and access groups on wildcards need its Enterprise license |
| An organization          | a team (`team_id` = the organization)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A provider on, connected | the access group in the team's `models`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Models switched off      | the team's `models` names the provider's other models instead of its access group                                                                                                                                                                                                                                                                                                                                                                          |
| An own key               | the credential `own-<organization>-<provider>` and its `credential_info` (last 4 characters, who saved it, test result)                                                                                                                                                                                                                                                                                                                                    |
| A brain key              | a virtual key of the team (`/key/generate`)                                                                                                                                                                                                                                                                                                                                                                                                                |

LiteLLM reloads every entry every 30 s and each request waits while it does: with 2,213 entries (every provider's models) a reload took about 35 s and a chat call waited up to 36 s. So LiteLLM holds only what an organization can call, and the inference service never reads `/model/info` to answer Ren.

The inference service keeps outside LiteLLM what LiteLLM has no object for: the models.dev copy (the model lists' source), the change signal to Ren, subscription seats, Ren credit (the billing hook) and the free cap.

1. **models.dev.** The inference service reads `https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image,video` every 5 min with `If-None-Match`, keeps only its providers' providers, and keeps the last good copy. Facts on 21 Nov 2026: 327 providers, 11.8 MB. `canonical_id` links one model across providers; 9 of 18 Anthropic models had none.
2. **Providers.** Ren, the 37 Console providers, and the subscription method on Anthropic and OpenAI. One list in the inference service holds each provider's fields and how the inference service calls it.
3. **Ren's models.** Provider `ren`, `shared`:

| Rule    | Value                                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source  | Ren's upstream provider on models.dev (`REN_MODELS_UPSTREAM`, an inference service setting)                                                                                                   |
| Kept    | type chat, tool calling, not deprecated, not in the block list (`REN_MODELS_BLOCK`), not an alias (an upstream id that starts with `~`, such as OpenRouter's `~anthropic/claude-opus-latest`) |
| Id      | `ren/<canonical_id>`; without a `canonical_id`, `ren/<upstream id>`                                                                                                                           |
| Free    | price 0 on models.dev                                                                                                                                                                         |
| Price   | the models.dev price; billing applies the markup                                                                                                                                              |
| Runtime | Claude models (`ren/anthropic/…`): `claude`. Others: HTTP                                                                                                                                     |

4. **Own-key models.** A vendor provider's models on models.dev: type chat, not deprecated. `shared`.
5. **Subscription models.** The union of the organization's seats' models, joined with models.dev for names, limits and efforts. A model that models.dev does not know keeps the vendor's id and default limits. `organization`.
6. **Changes.** When one organization's models change (a seat signed in or removed), the inference service calls `POST /internal/inference/changed {provider, organizationId}` (§10). A change for every organization is not sent: brains read it at their next pull.

Gateway names:

| Model        | Gateway name                                               |
| ------------ | ---------------------------------------------------------- |
| Ren          | `ren/<id>`                                                 |
| Own key      | `<provider>/<model>` (`openai/gpt-6.1-sol`)                |
| Subscription | `seat/<vendor>/<model>` (`seat/anthropic/claude-opus-5-5`) |

### 6.3 The `LiteLLMInferencePlugin` plugin (self-hosted Ren, later)

Not built in this work. It shows that the contract fits a self-hosted Ren; build it with the self-hosting work. `core/src/inference-plugin/litellm.ts`, namespace `LiteLLMInferencePlugin`. Settings: `LITELLM_URL`, `LITELLM_MASTER_KEY` (stays in Ren core's environment).

| Member                                | Value                                                                                                                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers`                           | one provider, `litellm`, named by the setting `LITELLM_NAME` (default `LiteLLM`), auth `operator`, payer `customer`, `shared`                                                                       |
| `models`                              | `GET <LITELLM_URL>/model/info`: each model's name, context and output limits, input types, tool calling and price, where the LiteLLM owner set them. Absent values take default limits and no price |
| `baseUrl`                             | `LITELLM_URL`                                                                                                                                                                                       |
| `grant`                               | `Minted`: a LiteLLM virtual key per brain (`POST /key/generate`, 6 h, alias `brain-<id>`, metadata: organization, brain, space), found again by alias until it nears expiry                         |
| `saveKey`, `removeKey`, `connections` | none: the owner configures LiteLLM                                                                                                                                                                  |
| `limits`                              | none                                                                                                                                                                                                |

### 6.4 An organization's list

For each provider that is on: the provider's models minus the models switched off. Each model carries: gateway name, display name, provider, method, runtime (`http` or `claude`), protocol, limits, efforts, input types, price, free.

Ren core stores no list. At each pull it asks the inference service for the organization's `settings` and each provider's `models`, and adds each inference plugin's `baseUrl` and `headers`. The inference service answers from its models.dev copy and LiteLLM's teams and credentials; it keeps a new models.dev copy only after it has written its entries to LiteLLM, so Ren never lists a model LiteLLM cannot route.

| Event                                                   | Ren core does                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /internal/inference/changed` for one organization | `pg_notify('ren_brains', 'org:<id>')`, which every Ren process hears                             |
| a setting written through the Providers page            | `org:<id>` for that organization                                                                 |
| the inference service is down at a pull                 | the reply has no `providers`; the brain keeps its last list (`host-api/src/ren-host-api.ts:131`) |

The 30 s pull stays as the backup. A push that changes nothing costs the brain one pull.

### 6.4.1 Which providers reach the brain

A provider's access group enters the organization's team allowlist only while the provider is on and connected: a saved key for a key provider, a signed-in seat for the subscription method. Ren's provider needs no connection, so its group is in while the provider is on. A provider that is on without a key never reaches the brain or the harness. Only the inference service writes allowlists; LiteLLM refuses every call outside them.

### 6.5 Other model types

A provider's models can be of any type LiteLLM serves (`model_info.mode`). Built first: chat and image. Later: transcription, speech, video, decision and others. The contract does not change with a new type.

1. **A provider.** Any provider LiteLLM supports can be a provider: one entry in the inference service's offered list, its Connect form from LiteLLM's `/public/providers/fields`, and its chat and image models written by the updater from models.dev. Ren core does not change. Examples: Google (Gemini image models), OpenAI (`gpt-image`), and later ElevenLabs for speech. The person brings the key; the provider works as any own-key provider.
2. **A provider with no chat model** (an image-only provider) shows on the Providers page and in the image tool's choice of model, not in the chat picker.
3. **Ren's provider.** Its models are LiteLLM's access group `ren`: chat models from the updater and the media models an operator keeps (`ren/gpt-image-2.5-sunburst`, …). The list never keeps chat models only.
4. **Price.** A list of rates, as models.dev and LiteLLM state them: `{ direction: input | output | cacheRead | cacheWrite, unit: token | image | megapixel | second | character, usd }`; `usd` is per 1M for `token`, per one for the others. Examples: `dall-e-3` output 0.052 per image; Cloudflare's `flux-2-klein-4b` output 0.001095 per megapixel; `gpt-image-1` per image token. Today's per-1M-token price is the `token` unit.
5. **The brain.** Each type has one use: chat → the harness's model and the picker; image → OpenCode's built-in image tool, shown when the list has an image model, with the agent's default `image_generation` model (`media-models.md` D3, D4). A new type adds its tool and its protocol (`cell/src/harness/opencode/model-providers.ts`).
6. **Subscriptions** serve chat only.

To add a type: its model type and protocol in `schema/src/models.ts`, a price unit if it has a new one, and its tool in the brain.

## 7. The brain

### 7.1 What the pull carries

Ren core keeps one thing in memory: a brain's key, the inference plugin's `grant`, per workload and inference plugin, until it expires (`Minted`) or a call answers 401. It keeps no list. A change in models changes lists and mints no key.

`RenHostApi` pull `providers` (`host-api/src/ren-host-api.ts:131`) becomes the organization's list (§6.4): per provider the id, name, and its inference plugin's `baseUrl` and `headers`, and the models with their gateway names, runtime and metadata. With the egress the key is the placeholder `ren:MODELS`. The brain key comes from `models.refresh` as today (`cell/src/model-refresh.ts`).

### 7.2 HTTP runtime

Built. `cell/src/harness/opencode/model-providers.ts` keeps mapping each provider to an OpenCode provider with the provider id and the protocol's package. Changes:

1. A model with runtime `claude` gets the Claude Agent package (§7.3); the others keep their protocol's package.
2. A model carries the client settings it needs as fields (`client` in `Models.Info`), and the adapter applies them without a vendor check: `effortUpdates: false` (`supportsEffortUpdates: false`), `compaction: "summary"`, `cost: false` (cost `[]`). The inference service sets them on ChatGPT seat models (§6.2), as OpenCode's ChatGPT plugin does (`chatgpt.ts:306-339`), which Ren does not activate. Models with `reasoning.mode: "pro"` are not listed. The Ren plugin's `retry` hook stops retries on the token-sharing refusal codes (`Models.chatGptRefusals` in `schema/src/models.ts`, from `chatgpt.ts:58-67`; the error cards use the same list). The ChatGPT plugin's `session-id` headers are not sent: the inference service drops them (gate H1) and reads `prompt_cache_key`.

### 7.3 Claude runtime

Built: `cell/src/harness/opencode/claude-agent.ts`, registered before `RenPlugin` (`server.ts`). Claude models with runtime `claude` run on the `claude` program through OpenCode's Claude Agent parts.

1. **Provider id.** A Claude model stays under its provider (`ren`, `anthropic`); only its package is `@opencode/claude-agent`, and its canonical provider is `claude-agent`, which keys the options the Claude Agent model reads. The first design moved these models to provider `claude-agent`. That breaks every place Ren and its clients name a model by provider id (picker, chip, transcripts, the chat's settings model, `session.model.switch`), so the setup changes the hooks instead: OpenCode's `ClaudeSessionHooks` and `ClaudeInstructions` run unchanged, with each hook bound to `claude-agent` run for the models whose package is the Claude Agent package in that location. A change of method (key ↔ subscription) keeps the model id; the next turn runs on the other runtime.
2. **Ren-owned setup.** The plugin body of 2.2.6 without the workspace check, from `@opencode/core`'s exported parts: the session registry, the AI SDK hook and the two hook sets. It never calls `ClaudeProvider.register`, which replaces the list with Claude's short names (G4), nor `ClaudeIntegration.register`, which is OpenCode's sign-in for a person's own `claude` and needs `Bus`. OpenCode's own copy stays loaded and stops at its workspace check; its hooks are bound to provider `claude-agent`, which Ren never lists.
3. **Dependency.** `@anthropic-ai/claude-agent-sdk` 0.3.301 in `cell`. It ships `claude` 2.1.301 in `@anthropic-ai/claude-agent-sdk-<platform>`; the plugin needs 2.1.248 or later. The setup finds that binary next to the SDK (glibc first on Linux), so the image needs no `OPENCODE_CLAUDE_PATH` and a `claude` on `PATH` is never used. `OPENCODE_CLAUDE_PATH` still wins when set. The brain's dependency bundle carries the Linux binary.
4. **Env and settings.** One `claude` process per chat. `claude` reads headers only at start, so the setup builds the env per call from the chat's usage headers and leaves out the headers that change within a chat, because a changed header restarts `claude`: `ren-turn` (each turn), `ren-request-kind` (a compaction) and `ren-model-variant` (an effort change). Usage rows of the Claude runtime have no turn, kind or variant.

| Name                                            | Value                                                                                                  | Why                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL` (provider `baseURL`)       | the inference service, without its `/v1`                                                               | every call through the inference service; `claude` adds `/v1/messages`                                                                            |
| `ANTHROPIC_CUSTOM_HEADERS` (provider `headers`) | `x-litellm-api-key: Bearer ren:MODELS`, the chat's usage headers and `ren-member: ren:PERSON.<member>` | the inference key, the usage claims and the member                                                                                                |
| `CLAUDE_CODE_OAUTH_TOKEN`                       | Ren's key: `ren:MODELS` behind the egress                                                              | subscription mode in `claude`; the inference service puts the seat's login in. It does not start with `sk-ant-oat`, so it never passes as a login |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`      | `1`                                                                                                    | no direct calls to `api.anthropic.com` (G1)                                                                                                       |

5. **Egress.** Every call of `claude` carries `ren:MODELS` in `Authorization`. The egress fills in `MODELS` only for the inference service host (`core/src/credential-source.ts`), so a call of `claude` to `api.anthropic.com` or any other host is refused with `403` and `X-Ren-Egress`, and the egress log names it. Other programs in the sandbox are not affected: a hand may still call `api.anthropic.com` with a customer's own key. No egress change was needed.
6. **Folder.** `claude` starts in `.ren-claude` in the home folder of the brain's machine. Tools still run on the hand through MCP.

### 7.4 Session id

The inference service keeps a chat on one seat. It reads the session from the request body: `metadata.user_id` → `session_id` for Claude Code (G1), `prompt_cache_key` for OpenAI (OpenCode sets one per session, `opencode/packages/ai/src/protocols/open-responses.ts:840`). Ren sends no extra header for it.

## 8. Hot reload

Today's mechanism (`specs/runtime/hot-reload/README.md`):

```
PUSH  write → trigger pg_notify('ren_brains', 'org:<id>' | 'space:<id>' | 'all')   (db/migration/20261025101446_brain_push)
      → every server instance LISTENs (core/src/brain-push.ts), 16 brains at a time
      → POST /ren/pull to each brain → the brain POSTs /host/pull and applies the full state
PULL  each open brain pulls every 30 s (PULL_INTERVAL_MS, cell/src/env.ts:26; cell/src/hot-reload.ts:198-205), at wake and at start
```

Model lists rode only the 30 s pull until now: the brain fetched each provider's `/catalog` at each pull (`cell/src/hot-reload.ts:135` → `model-discovery.ts`), and core polled the inference service every 30 s (`core/src/ren-inference/provider.ts:22`).

New rules (P26):

| Change                                                      | Written to                                                                                             | Notify                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------ |
| Provider on/off, method, key saved or removed, model switch | the inference service (`update`, `switchModels`, `saveKey`, `removeKey`); each sends only what changed | `org:<id>`               |
| A seat signed in or removed (one organization)              | nothing in Ren                                                                                         | `org:<id>`               |
| models.dev or Ren's list changed (every organization)       | nothing in Ren                                                                                         | none: the next 30 s pull |

A Ren-wide `'all'` notify wakes every running brain (`specs/runtime/hot-reload/README.md` §2.5), so a provider change never sends `'all'`. The 30 s pull stays as the backup. The core and brain polls go.

What a running chat sees:

| Change                                         | Effect                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Provider off, model removed                    | The call in flight finishes. The model leaves the picker. The next turn uses the chat's settings model and shows why (hot-reload row 33) |
| Key replaced, login refreshed                  | Nothing. The next call uses the new credential                                                                                           |
| Method key ↔ subscription                      | The model id stays; the next turn runs on the other runtime (HTTP ↔ `claude`)                                                            |
| Claude runtime connection change during a turn | The turn finishes on the old settings; the next turn uses the new ones (G5)                                                              |
| New model                                      | In the picker after the push                                                                                                             |

## 9. Usage, limits and billing

### 9.1 Usage rows

The inference service sends one `usage_event` per call (`specs/usage.md`). New fields in `data`: `seat` (seat id, for seat calls) and `access` (`ren`, `free`, `key`, `seat`; `kind` is already the request kind). `payer` is `ren` for Ren calls and `customer` for own keys and seats (`schema/src/usage.ts:13`). Cost is the models.dev price; billing charges only rows with payer `ren`.

### 9.2 Credit

Billing holds the credit and the markup. The inference service checks credit before each Ren call.

### 9.3 Warnings

A warning shows how much of a limit or of the credit is used. A limit is a cap that the inference service or a vendor enforces, with a reset time: the free cap and a seat's windows. The credit is the organization's balance in billing (Dodo). Neither is a billing meter.

| Warning      | Source                                                                                                                                 | Reset                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Claude seat  | the inference plugin's `limits`: the seat's windows (5h and 7d, from Anthropic's answers)                                              | the window's reset time |
| ChatGPT seat | none; only the refusal                                                                                                                 | —                       |
| Free cap     | the inference plugin's `limits`, for a free model                                                                                      | 00:00 UTC               |
| Ren credit   | billing: `Billing.Summary` used ÷ granted (`schema/src/billing.ts:21-22`), for a model whose provider has `payer: ren` and is not free | the plan cycle          |

Delivery: an endpoint `limits.get({ sessionId })` returns the warnings for the chat's current model: the `limits` of its provider's inference plugin, for the model and the seat of the session's last `usage_event` with a `seat` (P23), and the credit from billing. The app reads it when a chat opens, after each turn and every 60 s while the chat is open. The `chat` package decides which step to show and remembers shown steps per chat, limit and reset time.

Built: `core/src/limits.ts` (`Limits.get`), `GET /sessions/:id/limits` (`limits.get`, internal), `Limits.Info` in `schema/src/limits.ts` (`limits`: `Limits.Limit`, tag `free` or `seat`; `credit`: `Limits.Credit` or null), `chat/src/limit-banners.ts` and `app/src/features/session/limit-banner.tsx`. Rules the code follows:

1. The chat's current model is the root session's model as OpenCode stored it (`opencode_session.model`). Ren core finds its provider and model through the inference plugins, and asks that provider's gateway for `limits` with the model's gateway name and the seat of the chat's last usage row with a seat. The inference service answers a seat's windows only when the seat is the provider's and the organization's.
2. Ren core adds the credit only for a model whose provider has `payer: ren` and that is not free. Ren core names no provider.
3. A source that does not answer (inference service, billing) gives nothing; `limits.get` still answers. With no credit granted there is no credit.
4. Seat banners name the provider and the seat: "Anthropic seat (Asha’s Max)". "Asha’s Max" is the name of the Ren user who connected the seat and its plan; without them, the seat's label.
5. A step shows until the person dismisses it, and does not come back in the same chat, limit and reset period while the app runs. A step passed before it showed is skipped. When several reach a step, the fullest shows.

### 9.4 Errors

The inference service sends each final refusal with `x-should-retry: false`, so the brain shows it at once; `inference_unavailable` and `seat_unavailable` may be retried. The chat finds the code in the error's body or text (`chat/src/turn-problems.ts`).

| Code                                     | When                                     | Text                                                                                 | Actions                                       |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| `insufficient_credits` (402)             | Ren call, no credit                      | today's out-of-credits text                                                          | Add credits (admins), Change model, Providers |
| `free_limit_reached` (429)               | free cap reached                         | "Free models: today's 100 requests are used. They reset at 00:00 UTC."               | Change model                                  |
| `provider_not_connected`                 | own-key model without a key              | "<Provider> is not connected."                                                       | Providers (admins), Change model              |
| `model_off` (403)                        | a model the organization switched off    | "<model> is switched off for this organization."                                     | Providers (admins), Change model              |
| `subscription_limit_reached` (429)       | every seat of the vendor is full         | "All <vendor> subscriptions are at their limit. The next resets at <time>."          | Change model                                  |
| `seat_unavailable` (429)                 | a seat refused; another may serve        | "No <vendor> subscription can serve this now. Try again, or pick another model."     | Try again, Change model                       |
| `subscription_request_unsupported` (400) | no seat of the vendor serves the request | "<vendor> subscriptions can't serve this request. Pick another model to keep going." | Change model                                  |
| `inference_unavailable` (503)            | the inference service cannot decide      | "Model access is not available now. Try again."                                      | Try again                                     |

## 10. Contract: Ren core → inference service

The `RenInferencePlugin` plugin (§6.2) and `RenInference` call the inference service with today's signed token (`core/src/ren-inference.ts`). The organization is in the token.

| Route                                                                                | Status | Purpose                                                                                                     |
| ------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| `GET /v1/providers`                                                                  | new    | `providers`: the inference service's providers (§6.1)                                                       |
| `GET /v1/providers/:provider/models`                                                 | new    | `models`: `{ revision, models }`. A `shared` provider answers the same for every organization               |
| `GET /v1/providers/settings`                                                         | new    | `settings`: the organization's settings of every provider, read from its LiteLLM team and credentials       |
| `PUT /v1/providers/:provider {enabled?, method?}`                                    | new    | `update`: on/off and method; only the fields sent change, under the organization's lock                     |
| `PATCH /v1/providers/:provider/models {models: [{id, enabled}]}`                     | new    | `switchModels`: only the models sent change. A switched-off model is refused with `403 model_off`           |
| `POST /v1/providers/:provider/test {fields}`                                         | new    | test a key without saving; ok or the vendor's message                                                       |
| `PUT /v1/providers/:provider/key {fields}`                                           | new    | test, then store; returns `{ last4, testedAt }`. Ren core forwards the fields and never stores or logs them |
| `DELETE /v1/providers/:provider/key`                                                 | new    | remove the key                                                                                              |
| `POST /v1/connect`, `GET /v1/connections`, `PATCH/DELETE /v1/connections/:id`        | change | seats. `GET` adds each seat's provider, plan and models                                                     |
| `GET /v1/providers/:provider/limits?model=&seat=`                                    | new    | `limits`: the free cap `{ used, limit, resetsAt }` for a free model, the seat's windows                     |
| `POST /v1/keys {brainId, spaceId}`                                                   | keep   | `grant`: the brain key, `Minted`                                                                            |
| inference keys, `POST /v1/harness-plans`, `DELETE /v1/members/:id`, `DELETE /v1/org` | keep   | not part of the inference service                                                                           |
| `PUT /v1/ren-models`, `GET /v1/catalog`, `GET /v1/usage/free`                        | remove | the inference service builds Ren's list; the free cap is a limit                                            |

Inference service → Ren core: `POST /internal/inference/changed {provider, organizationId}` when one organization's models change (a seat). Only the usage ingest key may call it.

## 11. Lifecycle states

| State                    | What happens                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brain asleep             | Nothing. The pull at wake brings the newest list                                                                                                                                                     |
| Brain waking             | The start pull brings the newest list. The Claude runtime starts `claude` with the new env                                                                                                           |
| Mid-turn                 | §8 table. A seat that fills mid-turn: the inference service tries another seat                                                                                                                       |
| Brain down or restarting | The boot pull applies the list. No secret is lost: the brain holds none                                                                                                                              |
| Inference service down   | Calls fail (`inference_unavailable` or a transport error). The brain's same-model retry runs (about 84 s); then the turn shows the error. A pull gets no `providers`: each brain keeps its last list |
| Ren core down            | Calls keep working. Settings and lists do not change until it is back                                                                                                                                |
| models.dev down          | The inference service keeps its last good copy                                                                                                                                                       |
| A login's refresh fails  | The seat shows "Sign in again"                                                                                                                                                                       |

## 12. Work in Ren, by package

| Package              | Work                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`             | `InferencePlugin.Provider` and its fields; provider settings shapes (provider, method, key status, model switch). Per model in `Models.Registration`: gateway name, runtime, provider, method, price, free. Usage `access` and `seat`                                                                                                                                    |
| `db`                 | No tables for providers or lists. Ren core sends `pg_notify('ren_brains', 'org:<id>')` itself                                                                                                                                                                                                                                                                            |
| `core`               | `InferencePlugin` (contract, registry, layer); the plug-in `inference-plugin/ren.ts`; the contract suite `test/lib/inference-plugin.ts`; `Models.grant` and the pull from §6.4; remove the `/v1/catalog` poll (`core/src/ren-inference/provider.ts`); policy `provider.manage` (admins, owners) and `provider.view` (members); `limits.get`; setting `REN_DEFAULT_MODEL` |
| `protocol`, `server` | Providers endpoints (list, update, test, set key, remove key), Ren models endpoints, `limits.get`, `POST /internal/inference/changed`; `bun run generate`                                                                                                                                                                                                                |
| `cell`               | `model-providers.ts` (§7.2); `claude-agent.ts` (§7.3); remove `model-discovery.ts`; ChatGPT settings and retry codes                                                                                                                                                                                                                                                     |
| image, egress        | SDK binary path in `e2b.Dockerfile`; no egress change (§7.3.5)                                                                                                                                                                                                                                                                                                           |
| `chat`               | Error codes (§9.4); banner rules; provider labels from data                                                                                                                                                                                                                                                                                                              |
| `app`                | Providers page, Add provider grid and dialog, Ren models page, picker rows, model chip, banner                                                                                                                                                                                                                                                                           |

## 13. Tests

### 13.1 Gates

Done ([`references/gates.md`](references/gates.md)): G1, G4, G5, G6, GR1, GR2. GR3 is withdrawn: Ren no longer pushes a change for every organization.

### 13.2 Package tests

Only rules that the code does not show:

| Package | Test                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`  | the contract suite (§6.1) on `RenInferencePlugin`; a `Minted` grant is reused until its renewal time, a `Fixed` one until a 401; a brain's keys answer while the inference service's lists fail; the registry refuses a duplicate provider; an organization's list from settings and two inference plugins (a test inference plugin as the second); a model the provider does not list is refused; a bad default model setting stops Ren at start |
| `cell`  | `claude-agent` stays when Ren sends other providers; the Claude runtime env; ChatGPT refusal codes stop a retry                                                                                                                                                                                                                                                                                                                                   |
| `chat`  | each banner step shows once per chat, limit and reset period; each error code maps to its text and actions                                                                                                                                                                                                                                                                                                                                        |

### 13.3 End-to-end (`packages/e2e/chaos`)

| Case                          | Covers                                                                                                                          | States                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Catalog                       | a new model in the inference service's models.dev reaches the picker after one push; inference service down keeps the last list | Ren core restart while the inference service is down |
| Own key                       | save with a failed and a passing test; a turn; payer `customer`; key removed mid-turn → next call `provider_not_connected`      | mid-turn, asleep                                     |
| Claude seat (live test seat)  | a turn on `claude`; usage row names the seat; banner at 75%                                                                     | waking, `claude` idle 5 min                          |
| Two Claude seats              | stickiness per chat; one seat full → the next try uses the other; no error shown                                                | mid-turn                                             |
| ChatGPT seat (live test seat) | a turn; refusal code text                                                                                                       | mid-turn                                             |
| Ren credit                    | cost at the models.dev price; banners; 0 credit → `insufficient_credits`                                                        | credit runs out mid-turn                             |
| Ren free                      | 100 requests, then `free_limit_reached`; reset at 00:00 UTC under `TestClock`                                                   | —                                                    |
| Hot reload                    | provider off mid-turn; method change → switch row; Ren model switched off leaves the picker                                     | mid-turn, asleep, restart                            |

### 13.4 App (Playwright)

1. Providers: add a key (bad, then good), turn a provider off and on, change the method, connect a seat (stubbed page), Ren model switches.
2. Chat: the chip for each kind; each banner step; the error provider actions.

## 14. Removed and superseded

| Item                                                                                           | Fate                                                |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `specs/runtime/media-models.md` §8 items B0–B4 (own key through the egress)                    | replaced by this spec                               |
| `core/src/ren-inference/provider.ts` 30 s poll of `/v1/catalog`; `cell/src/model-discovery.ts` | removed                                             |
| `vendorNames`, `providerLabels`                                                                | removed; names from data                            |
| `Models.layerNone`; `ProviderCard.definitions` and the `ren` provider constant in Ren core     | an empty registry; providers from inference plugins |

## 15. Build order (Ren side)

| Step | Work                                                                                                                      | Done when                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1    | `InferencePlugin` contract, registry and suite, the `RenInferencePlugin` plug-in, organization tables, the list job, push | a provider change reaches only affected organizations' pickers           |
| 2    | Providers API (schema, db, core, protocol, server)                                                                        | providers, keys and switches round-trip; members cannot change providers |
| 3    | App: Providers page, Add provider, Ren models page, picker rows, model chip                                               | the Playwright journeys of §13.4 pass                                    |
| 4    | Brain: pull shape, `model-providers.ts`, Claude runtime, ChatGPT settings, image and egress                               | a turn on a Claude seat and on a ChatGPT seat; GR1, GR2                  |
| 5    | Warnings and errors: `limits.get`, usage fields, banner rules, error codes; end-to-end cases                              | §13.3 passes                                                             |

## 16. Settled details

| Item                                                                                                                                  | Decision                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A "Use this model on Ren" button on errors                                                                                            | No. The error provider offers "Change model" only (P4)                                                               |
| The fields of Azure, AWS Bedrock, Google Vertex AI, Cloudflare AI Gateway, Cloudflare Workers AI and Databricks in the Connect dialog | The builder takes them from each provider's documentation and from the credential values the inference service needs |
| The values of `REN_DEFAULT_MODEL` (Ren), `REN_MODELS_UPSTREAM` and `REN_MODELS_BLOCK` (inference service)                             | Deployment settings. The owner sets and changes them; no code change                                                 |

## 17. Later: the self-hosting work

These items are not built in this work. The contract (§6.1) must keep room for each.

| Item                                      | Problem                                                                                                                                      | Planned answer                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LiteLLM inference plugin                  | A self-hosted Ren brings its own LiteLLM                                                                                                     | §6.3                                                                                                                                                                                                                                                                                                           |
| Brains without the egress                 | A self-hosted Ren may run brains with no egress. The brain then holds the real key                                                           | The brain gets its key from `models.refresh` (`cell/src/model-refresh.ts`, the mode without the egress). The egress becomes a deployment switch                                                                                                                                                                |
| A brain key after its brain               | Without the egress, the key is on the machine. When Ren destroys the brain, a minted key stays valid until it expires (6 h for LiteLLM keys) | An optional contract method, `revoke(brain)`, that ends a brain's key. Ren core calls it when it destroys a brain. The LiteLLM inference service deletes the key (`POST /key/delete`). The inference service does not need it: with the egress, the key never reaches the machine                              |
| Several inference plugins with the egress | A brain has one model placeholder, `ren:MODELS`. Two inference plugins that each give a key need one placeholder each                        | One egress label per inference plugin that gives a key                                                                                                                                                                                                                                                         |
| Plans                                     | A plan limits which providers and which of Ren's models an organization may use                                                              | A plan is a set of allowed access groups (for example `ren-free` for chosen Ren models). Team allowlist = the plan's groups ∩ the groups of providers that are on and connected. LiteLLM enforces it per call; the inference service, the only writer, applies the plan. No LiteLLM Organizations (Enterprise) |
