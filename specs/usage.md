# Usage: pending

Status: the billing seam with `layerNone` and usage events up to `usage_event` are built (`core/src/billing.ts`, `core/src/usage.ts`, `POST /usage/v1/events`). This file keeps the parts that are not built. Remove each part of this file in the change that builds it.

A usage event records one cost: what ran, how much, who pays and why. Ren keeps usage events in its own Postgres. A closed billing service turns them into charges. Billing itself is not in this file.

This file follows one example chat from the first click to the money. Each piece says what happens, what to build, what can fail and where the load is. §1 has the rules that every piece uses.

| Word          | Meaning                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Usage event   | One row in `usage_event`: one cost at one time. It does not change after Ren stores it.                                          |
| Producer      | The part that sees a cost and sends the event, for example the model gateway.                                                    |
| Provider cost | `cost_micro_usd`: the cost of the call at the rates of the deployment that ran, in millionths of a US dollar. It is not a price. |
| Price         | What a customer pays. Only the closed billing service knows it.                                                                  |
| Payer         | `ren` (Ren's pool or key) or `customer` (the organization's own subscription or key).                                            |
| Open, closed  | Open: this repository. Closed: a private repository that only Ren Cloud runs.                                                    |
| Workload      | Code that runs for Ren in one generation of its machine: `brain:<id>:<generation>` or `hand:<environment id>:<generation>`.      |
| Turn          | One user message and all the work that it causes, until the agent stops. Its ID is the ID of that user message.                  |

## 1. Rules

### 1.1 Placement

1. Code goes in one of two places: open or closed. There is no `ee/` directory.
2. Code is closed when it holds Ren's money, prices, provider keys or provider accounts, or when it only makes sense in Ren Cloud.
3. Open code reaches closed code only through a core service with two layers: `layerNone` for a self-hosted Ren, and a layer that calls the closed service over versioned HTTP with a token from `Signer`. The precedent is `Models.layerNone` and `RenInference.layer` (`core/src/ren-inference.ts:58`).
4. A closed service gets only the data that it needs.

| Part                                                                                                                | Place                                             |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `usage_event`, the ingest route, `Usage.Service`                                                                    | Open                                              |
| `Billing.Service`, `Billing.layerNone`, `Billing.layerRenCloud` (the HTTP client)                                   | Open                                              |
| The usage page of a person, a space and a session                                                                   | Open. The money column comes from `Billing` (§8). |
| Billing service: prices, markup, the Dodo client, Dodo webhooks, customer and subscription tables, the credit check | Closed (O1)                                       |
| Model gateway: LiteLLM, its rates, the usage logger                                                                 | Closed (`../ren-inference`)                       |
| Integration gateway: Ren's keys for search, image, audio, video, browser use and treg (REN-1540)                    | Closed, later (§9)                                |
| The PostHog export of usage events and transcript events (§7)                                                       | Open. It runs only when Ren has a PostHog key.    |
| Organization analytics, exports, budgets, alerts                                                                    | Closed, later                                     |

### 1.2 One place for each fact

Each fact has one owner. Another system gets only what its job needs, from the owner, in one direction.

| Fact                                   | Owner             | Other systems                                                                                                                                                                    |
| -------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One row for each cost (a model call)   | Ren `usage_event` | PostHog gets a one-way copy of each row as `$ai_generation`, without message content, for HogQL analysis (§7). Pages and billing never read PostHog. LiteLLM spend logs are off. |
| Charged amount for each organization   | Dodo meter        | The billing service sends it, from Ren's usage events (§8).                                                                                                                      |
| Credit balance, subscription, invoices | Dodo              | The billing service keeps what its checks need.                                                                                                                                  |
| Transcript                             | Ren Postgres      | PostHog gets turn and tool events built from it, with no content, no tokens and no cost (§7).                                                                                    |
| Product events, errors, logs           | PostHog           | None.                                                                                                                                                                            |

### 1.3 Identity

1. Each key that Ren issues to a workload names one workload: `brain:<id>:<generation>` or `hand:<environment id>:<generation>` (`schema/src/workload.ts:21`). The model key names the brain and the organization's team (`../ren-inference` `packages/api/src/server/routes/v1.ts:106`).
2. A producer sends only `workload`. Ren stamps `organization`, `space` and `brain` with `Credentials.scopeOf` (`core/src/credentials.ts:236`), the same function that the egress uses (`core/src/egress.ts:159`). It reads only the ID.
3. Brains and hands are hostile. They never write usage. A trusted part that the workload must pass through to spend money records the cost: the model gateway, later the integration gateway.
4. The headers are claims from the brain. Ren checks `root_session`, `session`, `member` and `agent` against the workload, and keeps `turn`, `kind`, `variant` and `agent_name` as sent (§4.3). A space brain serves many sessions and many people, so it can give a wrong session or person in its own space. It cannot move a cost to another organization or space.
5. Each paid service accepts a short-lived key from Ren, scoped to one workload. The egress is one way to attach that key without the workload seeing it. A host that cannot use the egress (a Durable Object cell) sends the key itself, and the identity is the same.

## 2. The example chat

| Item                | Value                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization, space | Porcellia `org_P`, space "Growth" `spc_G`                                                                                                                                                                                           |
| Person              | Asha, member `mem_A`                                                                                                                                                                                                                |
| Chat (root session) | `ses_4`, agent "Analyst" `agt_7` (a custom agent, not system Ren)                                                                                                                                                                   |
| Brain               | `brain:brn_7:3`: an E2B sandbox, `e2b-space` profile, behind the egress                                                                                                                                                             |
| Message             | "Compare our churn with last quarter and draft a summary" (turn `msg_01`)                                                                                                                                                           |
| What the turn does  | The main agent thinks and calls a tool. It starts subagent `explore` (child session `ses_5`). One subagent call gets 429 and LiteLLM falls back to another deployment. A compaction runs. A title call runs. The answer is written. |

| Piece | Section | What happens                                    | Status                   |
| ----- | ------- | ----------------------------------------------- | ------------------------ |
| 1     | §3      | The turn starts: credit check                   | First build (seam)       |
| 2     | §4      | One model call, end to end, into `usage_event`  | First build              |
| 3     | §5      | Subagent, failure, fallback: the rows of a turn | First build              |
| 4     | §6      | Tool calls and the transcript                   | Exists; nothing to build |
| 5     | §7      | After the turn: PostHog                         | Later                    |
| 6     | §8      | Money: billing service, Dodo, reconciliation    | Later                    |
| 7     | §9      | Failure map, bottlenecks, other later steps     | —                        |

## 3. Piece 1: the turn starts

```
 ┌──────────────────────────────┐                                        ┌──────────────────────────────┐                                        ┌──────────────────────────────┐
 │                              │                                        │                              │                                        │                              │
 │  app                         │  POST message                          │  Ren server                  │  start turn msg_01                     │  brain brn_7:3               │
 │  Asha clicks send            │  session ses_4                         │  SessionRunner.send          │  after Billing.check ok                │  OpenCode, agent             │
 │                              │  ───────────────────────────────────>  │                              │  ───────────────────────────────────>  │  Analyst                     │
 │                              │  202 accepted                          │                              │  wakes sandbox if asleep               │                              │
 │                              │                                        │                              │                                        │                              │
 └──────────────────────────────┘                                        └──────────────────────────────┘                                        └──────────────────────────────┘
```

### 3.1 Steps (10:04:00)

1. Asha sends the message. `SessionRunner.send` (`core/src/session/runner.ts:117`) reads the session row: `ses_4` → `org_P`, `spc_G`, `brn_7`.
2. Ren calls `Billing.check(org_P)`. The first build uses `layerNone`, which always allows. Later, `layerRenCloud` asks the billing service (§8).
3. When the sandbox is asleep, `BrainLifecycle` calls `check` again before it creates the sandbox (`core/src/brain-lifecycle.ts:164`), then wakes it.
4. The brain gets the message. Its ID, `msg_01`, is the turn ID: each cost in this turn carries it.
5. The brain already has its settings from the waterfall (Ren, organization, space, agent): agent Analyst, model `claude-sonnet-4-5`, thinking mode `high`.

Nothing is written to `usage_event` in this piece. A usage row exists only when a paid call ends.

### 3.2 The billing seam

`Billing.Service` in core is the only code that talks to billing.

| Member  | Signature                                         | First build                  | Later                                     |
| ------- | ------------------------------------------------- | ---------------------------- | ----------------------------------------- |
| `check` | `(organization) => Effect<void, Billing.Refused>` | `layerNone`: always succeeds | `layerRenCloud`: `POST /billing/v1/check` |

1. `Billing.Refused` has a `reason`: `insufficient_credits` or `budget_unreadable`. When Ren cannot read the balance, the reason is `budget_unreadable`, not `insufficient_credits` (ren-v1 billing ledger row 55).
2. Built: `SessionRunner.send`, and `SessionRunner.create` with a first message, call `check` before a turn starts. `BrainLifecycle` calls `check` before it creates a sandbox; a refused brain stays `creating`.
3. Not built: the app sends its messages to the brain's Chat API directly (`chat/src/chat-session.ts:630`), not through `SessionRunner.send`. `Session.access` must call `check` before it gives chat access.
4. A check is necessary because Dodo does not stop usage at zero, and its balance is late by one minute or more.
5. `layerRenCloud` keeps the answer for each organization for 30 s (`Cache.makeWith`, as `core/src/mcp-provider.ts:147`). When the billing service does not answer, it uses the last answer for that organization for at most 10 minutes. After 10 minutes, or with no last answer, it refuses with `budget_unreadable`.

### 3.3 Failure points

| What fails                             | What happens                                                                        | Cost leak?                |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------- |
| The Ren server (one copy today, O7)    | The message cannot be sent. No turn starts.                                         | No                        |
| The billing service (later)            | Ren uses the last answer for at most 10 min, then refuses with `budget_unreadable`. | No; the person is blocked |
| The organization has no credit (later) | Refused with `insufficient_credits`                                                 | No                        |
| The sandbox cannot be created          | No turn                                                                             | No                        |

Load: one database read and one cached check. Not a bottleneck.

## 4. Piece 2: one model call, end to end

Step 1 of turn `msg_01`: the Analyst agent thinks, then asks for a tool.

```
 ┌────────────────────────┐                                  ┌────────────────────────┐                                  ┌────────────────────────┐                                  ┌────────────────────────┐
 │                        │                                  │                        │                                  │                        │                                  │                        │
 │  brain brn_7:3         │  model request                   │  egress                │  real key put in                 │  LiteLLM               │  deployment that ran             │  Anthropic             │
 │  step 1 of msg_01      │  ren-* headers                   │  login → workload      │  x-ren-* removed                 │  key → org_P, brn_7    │  claude-sonnet-4-5               │                        │
 │                        │  ─────────────────────────────>  │                        │  ─────────────────────────────>  │                        │  ─────────────────────────────>  │                        │
 │                        │  placeholder key                 │                        │                                  │                        │  stream back                     │                        │
 │                        │                                  │                        │                                  │                        │                                  │                        │
 └────────────────────────┘                                  └────────────────────────┘                                  └────────────────────────┘                                  └────────────────────────┘

 ┌────────────────────────┐                                  ┌────────────────────────┐                                  ┌────────────────────────┐
 │                        │                                  │                        │                                  │                        │
 │  LiteLLM logger        │  POST /usage/v1/events           │  Ren server            │  scopeOf, checks claims          │  usage_event           │
 │  after the stream ends │  usage key, 1 event              │  Usage.record          │  INSERT … ON CONFLICT            │                        │
 │                        │  ─────────────────────────────>  │                        │  ─────────────────────────────>  │                        │
 │                        │  200 inserted: 1                 │                        │  commit                          │                        │
 │                        │                                  │                        │                                  │                        │
 └────────────────────────┘                                  └────────────────────────┘                                  └────────────────────────┘
```

### 4.1 Steps (10:04:01 to 10:04:13)

1. The brain sends the request with the placeholder key `ren:MODELS` (`schema/src/models.ts:77`). The plugin adds `ren-member` (a placeholder for `mem_A`), `ren-root-session: ses_4`, `ren-session: ses_4`, `ren-turn: msg_01`, `ren-agent: analyst`, `ren-request-kind: primary` and `ren-model-variant: high`.
2. The egress finds the workload from the proxy login: `brain:brn_7:3` (it asks Ren once for each connection). Ren's answer, kept 30 s, puts the real brain key in place of `ren:MODELS` and checks the member placeholder against `spc_G`.
3. LiteLLM finds `brn_7` and team `org_P` from the key, chooses a deployment and streams the answer back. The stream ends at 10:04:12 with `stop_reason: tool_use`.
4. LiteLLM's success hook (`dodo_logger.py`) sends one event: `workload: brain:brn_7`, the claims from the headers, the tokens, `cost_micro_usd: 31400`, `latency_ms: 11200`, `time_to_first_token_ms: 900`, `stop_reason: tool_use`.
5. Ren checks the usage key (producer `ren-inference`, the same as `source`), stamps `org_P` and `spc_G` with `scopeOf`, keeps the root session (on `brn_7`, no parent), keeps `mem_A` (a member of `spc_G`), turns `analyst` into `agt_7`, inserts one row, commits and answers 200.

### 4.2 Unit

One usage event is one model call, not one turn. A turn causes many calls: steps of the main agent, subagent steps, retries, fallbacks, compaction and the title. The cost of a turn is the sum of the events with that `turn`. A call is the unit because each call has its own model, its own tokens and its own price, and the gateway sees calls, not turns.

### 4.3 Event fields

The event is the contract. Producers in other repositories code against it, so it is expensive to change.

1. Add a field only as optional. Do not rename or remove a field.
2. Add a type to `Usage.Type` before a producer sends it. Ren refuses an unknown type.

The trust column says who gives the value:

- **Proven:** Ren's key or the gateway gives it. The brain cannot change it.
- **Checked:** the brain claims it in a header, and Ren keeps it only when it matches a proven value.
- **Claimed:** the brain claims it, and Ren cannot check it.

| Field                                    | Given by                    | Trust   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`, `id`                           | Gateway                     | Proven  | `source` must be the producer of the ingest key (§4.7). `id` is unique in `source`, made from the producer's own data, so a retry sends the same `id` (§4.5). Ren ignores a repeat of `(source, id)`.                                                                                                                                                                                                                                               |
| `type`                                   | Gateway                     | Proven  | `model.call` (§4.6).                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `time`                                   | Gateway                     | Proven  | The end of the response. At most 30 days in the past and 5 minutes in the future.                                                                                                                                                                                                                                                                                                                                                                   |
| `workload`                               | Gateway, from the model key | Proven  | `brain:<id>` or `hand:<id>`, then `:<generation>` when known (§1.3). Only a producer inside Ren with no workload (email, later) gives `organization` instead.                                                                                                                                                                                                                                                                                       |
| `organization`, `space`, `brain`         | Ren                         | Proven  | `Credentials.scopeOf(workload)` (§1.3).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `root_session`                           | Header `ren-root-session`   | Checked | Ren keeps it when that session is on `brain` and has no parent. Else Ren removes `root_session`, `session`, `turn` and `agent`.                                                                                                                                                                                                                                                                                                                     |
| `session`                                | Header `ren-session`        | Checked | The session of the call: the root, or a subagent's child session. Ren keeps it when it is the root, or when its row names `root_session` as its root. A child session that has not synced yet has no row: Ren keeps it.                                                                                                                                                                                                                             |
| `turn`                                   | Header `ren-turn`           | Claimed | The ID of the newest user message of the root session.                                                                                                                                                                                                                                                                                                                                                                                              |
| `member`                                 | Header `ren-member`         | Checked | The person who sent the turn's message: the sender of the root session's newest user message (`cell/src/harness/opencode/plugin.ts:545`). A subagent or compaction call names the sender of its root turn. A title call names nobody. Ren keeps it when the member is in `space`. It reads the placeholder `ren:PERSON.<member>` the same way, for a host or proxy that does not replace it. The user comes from `member` by join.                  |
| `agent`                                  | Header `ren-agent`          | Checked | The agent that made the call: the chat's agent, a subagent, or the system Ren agent when no other agent applies. The brain sends the agent name. Ren turns it into an agent ID from the agents that the brain's space can use (the same list as `Settings.pull`, `core/src/settings.ts:82`). When no agent matches (OpenCode's built-in agents, for example `explore`, `compaction`, `title`), `agent` is empty and the name stays in `agent_name`. |
| `agent_name`                             | Header `ren-agent`          | Claimed | The agent name as sent, when it matches no Ren agent.                                                                                                                                                                                                                                                                                                                                                                                               |
| `kind`                                   | Header `ren-request-kind`   | Claimed | `Usage.Kind`: `primary`, `compaction`, `title` or `generate`. Each harness maps its own kinds to these. Ren stores another value as null.                                                                                                                                                                                                                                                                                                           |
| `requested_model`                        | Gateway                     | Proven  | The model that the request asked for.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `variant`                                | Header `ren-model-variant`  | Claimed | The thinking mode of the request (OpenCode `Model.Ref.variant`), for example `high`. Absent when the model has no variants.                                                                                                                                                                                                                                                                                                                         |
| `payer`                                  | Gateway                     | Proven  | `ren`, or `customer` when the call used the organization's own subscription or key. Ren keeps the row.                                                                                                                                                                                                                                                                                                                                              |
| `provider`, `served_model`               | Gateway                     | Proven  | The provider and the deployment that ran (LiteLLM `deployment_model_name`), not the ones that the request asked for.                                                                                                                                                                                                                                                                                                                                |
| `input_tokens` … `cache_write_1h_tokens` | Gateway                     | Proven  | Integers, 0 or more. One field for each price. `input_tokens` does not include cache reads or cache writes.                                                                                                                                                                                                                                                                                                                                         |
| `cost_micro_usd`                         | Gateway                     | Proven  | Provider cost. Null when the gateway has no rate. Ren keeps the row.                                                                                                                                                                                                                                                                                                                                                                                |
| `latency_ms`, `time_to_first_token_ms`   | Gateway                     | Proven  | Optional. From the start of the request to the end of the response, and to the first token of a stream.                                                                                                                                                                                                                                                                                                                                             |
| `stop_reason`                            | Gateway                     | Proven  | Optional. As the provider gives it, for example `end_turn`, `tool_use`, `max_tokens`.                                                                                                                                                                                                                                                                                                                                                               |
| `error`                                  | Gateway                     | Proven  | Optional. Set when the call failed: the status and a short message, no content. A failed call is an event too, with the tokens and the cost that the provider charged, often 0.                                                                                                                                                                                                                                                                     |
| `received_at`                            | Ren                         | Proven  | The time of the insert.                                                                                                                                                                                                                                                                                                                                                                                                                             |

Rules:

1. Ren stores the result of the settings waterfall (Ren, organization, space, agent), not the layer that gave it: `agent`, `requested_model` and `variant` are the values that the call used.
2. Ren stamps `agent` and `root_session` on the row when it stores it. A child session's row has no agent (`core/src/session-sync.ts:141`), and a session can be deleted, so a join later cannot give them.
3. The user, the agent's name and the chat's origin (app, schedule, channel, task) come by join. They are not on the row.

### 4.4 Example payload

What the brain adds to a request to a Ren model, next to the key:

```
ren-root-session:   ses_01JB4R
ren-session:        ses_01JB7K          (a subagent's child session)
ren-turn:           msg_01JB7F
ren-member:         mem_01M2Q8
ren-agent:          researcher
ren-request-kind:   primary
ren-model-variant:  high
```

What the gateway sends (`POST /usage/v1/events`):

```json
{
  "events": [
    {
      "source": "ren-inference",
      "id": "chatcmpl-8f3a91:anthropic-sonnet-1",
      "type": "model.call",
      "time": "2026-10-28T10:04:12Z",
      "workload": "brain:brn_01JA2X",
      "root_session": "ses_01JB4R",
      "session": "ses_01JB7K",
      "turn": "msg_01JB7F",
      "member": "mem_01M2Q8",
      "agent": "researcher",
      "kind": "primary",
      "requested_model": "claude-sonnet-4-5",
      "variant": "high",
      "payer": "ren",
      "provider": "anthropic",
      "served_model": "anthropic/claude-sonnet-4-5",
      "input_tokens": 2140,
      "output_tokens": 512,
      "reasoning_tokens": 300,
      "cache_read_tokens": 48900,
      "cache_write_tokens": 0,
      "cache_write_1h_tokens": 0,
      "cost_micro_usd": 31400
    }
  ]
}
```

What Ren stores after it resolves the event:

| Field                                | Stored value                                      | How Ren got it                                      |
| ------------------------------------ | ------------------------------------------------- | --------------------------------------------------- |
| `organization`, `space`, `brain`     | `org_01M280`, `spc_01J9ZT`, `brn_01JA2X`          | `scopeOf("brain:brn_01JA2X")`                       |
| `root_session`                       | `ses_01JB4R`                                      | Kept: on `brn_01JA2X`, no parent                    |
| `session`                            | `ses_01JB7K`                                      | Kept: not synced yet, so no row to contradict it    |
| `turn`                               | `msg_01JB7F`                                      | As sent                                             |
| `member`                             | `mem_01M2Q8`                                      | Kept: a member of `spc_01J9ZT`                      |
| `agent`                              | `agt_01J0EX` (`researcher`)                       | The name, turned into an ID from the space's agents |
| `kind`, `requested_model`, `variant` | `primary`, `claude-sonnet-4-5`, `high`            | As sent                                             |
| `payer`, `provider`, `served_model`  | `ren`, `anthropic`, `anthropic/claude-sonnet-4-5` | As sent                                             |
| Tokens, `cost_micro_usd`             | as sent, `31400`                                  | As sent                                             |
| `received_at`                        | `2026-10-28T10:04:13Z`                            | Ren                                                 |

### 4.5 IDs

| Producer                   | `source`           | `id`                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model gateway (Ren Cloud)  | `ren-inference`    | `<provider response ID>:<deployment ID>`. A failed attempt has no response ID: `<LiteLLM call ID>:<random>:<deployment ID>`, made once and kept when the logger sends it again. The LiteLLM call ID alone is not unique: every retry and fallback of one request has it, and a client can set it (`x-litellm-call-id`). |
| Later: self-hosted LiteLLM | `litellm`          | The LiteLLM call ID                                                                                                                                                                                                                                                                                                     |
| Later: integration gateway | `ren-integrations` | `<request ID>:<attempt>`                                                                                                                                                                                                                                                                                                |

### 4.6 Types

`Usage.meters` maps each type to the quantities that it allows. Ren refuses any other quantity.

| Type         | Quantities                                                                                                              | Status |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| `model.call` | `input_tokens`, `output_tokens`, `reasoning_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cache_write_1h_tokens` | First  |

### 4.7 Ingest route

| Item  | Value                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route | `POST /usage/v1/events`, in a new `UsageIngestApi` group in `@ren/protocol`                                                                                                       |
| Auth  | A bearer key: a `RegisteredKey` of kind `usage`. Ren keeps the SHA-256 hash of the secret and the producer that the key names. `core/script/usage-key.ts <producer>` makes one.   |
| Body  | `{ events: Array<Usage.Event> }`, 1 to 500 events                                                                                                                                 |
| 200   | `{ inserted: number }`. Each event is stored now or was stored before.                                                                                                            |
| 400   | An event is not valid: an unknown type, a quantity that its type does not allow, a `time` out of range, or a `workload` that Ren does not know. Ren stores no event of the batch. |
| 403   | The `source` of an event is not the producer of the key.                                                                                                                          |
| 503   | The store is not available. The producer sends the same batch again with backoff.                                                                                                 |

Ren answers 200 only after the insert commits.

A producer outside Ren keeps each event until Ren answers 200:

1. On 503, a network error or a timeout, it sends the same batch again with exponential backoff, at most 60 s between tries, with no limit on the number of tries.
2. It keeps unsent events in a bounded buffer (for example 100,000 events). When the buffer is full, it drops the oldest event, writes a log, adds 1 to a counter and raises an alert. The daily reconciliation (§8) shows the gap.
3. On 400 it does not retry. It writes the batch to its log and raises an alert, because a 400 is a bug in the producer.
4. On shutdown it tries to send the buffer before it stops.

### 4.8 Not built

1. An automated end-to-end case in `packages/e2e/chaos/cases/`. The harness starts its own Ren server, so it needs its own LiteLLM container whose logger sends to that server.
2. The logger's buffer is in memory (O4).

### 4.9 Failure points

| What fails                                 | What happens                                                                                                             | Cost leak?                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| One egress copy                            | The load balancer sends traffic to another copy (2 or more run)                                                          | No                                               |
| All egress copies                          | The request fails before LiteLLM. The brain tries again.                                                                 | No                                               |
| LiteLLM                                    | The request fails                                                                                                        | No                                               |
| Ren is down; the egress has a kept answer  | The egress serves for at most 15 min, so the call runs. The logger keeps the event in its buffer (§4.7).                 | Yes, when the buffer fills or LiteLLM stops (O4) |
| Ren answers 400                            | The batch is refused; the logger logs it and raises an alert                                                             | Yes, until the producer bug is fixed             |
| The brain disconnects during the stream    | ren-v1 made LiteLLM read the answer to the end, so the full cost is logged (`59057dac8`). Not verified in ren-inference. | Yes, if that fix is not there                    |
| The brain claims a wrong session or person | Ren removes the claim. The cost stays on the organization and space.                                                     | No                                               |

Load: one insert for each call. At the target that is 0.4 a second on average and 27 a second at worst, against about 1,000 inserts a second. Not a bottleneck.

## 5. Piece 3: subagent, failure, fallback

One turn gives many rows.

```
turn msg_01   (Asha's message, root chat ses_4)
│
├── ses_4   agent Analyst
│     row 1   step 1: thinks, asks for a tool        (§4)
│     row 5   step 2: reads the subagent's result
│     row 6   compaction: the chat got too long
│     row 7   title for the chat
│     row 8   step 3: final answer
│
└── ses_5   subagent explore   (child session, started by the task tool)
      row 2   step 1
      row 3   step 2: Anthropic answers 429
      row 4   step 2 again: LiteLLM falls back to another deployment
```

| Row | Time     | `session` | `agent` / `agent_name` | `kind`     | `requested_model` | `served_model`       | Result       | Cost   |
| --- | -------- | --------- | ---------------------- | ---------- | ----------------- | -------------------- | ------------ | ------ |
| 1   | 10:04:12 | `ses_4`   | `agt_7`                | primary    | sonnet-4-5        | anthropic/sonnet-4-5 | tool_use     | $0.031 |
| 2   | 10:04:20 | `ses_5`   | — / `explore`          | primary    | haiku-4-5         | anthropic/haiku-4-5  | tool_use     | $0.004 |
| 3   | 10:04:31 | `ses_5`   | — / `explore`          | primary    | haiku-4-5         | anthropic/haiku-4-5  | `error`: 429 | $0     |
| 4   | 10:04:34 | `ses_5`   | — / `explore`          | primary    | haiku-4-5         | bedrock/haiku-4-5    | end_turn     | $0.005 |
| 5   | 10:05:02 | `ses_4`   | `agt_7`                | primary    | sonnet-4-5        | anthropic/sonnet-4-5 | tool_use     | $0.042 |
| 6   | 10:05:40 | `ses_4`   | — / `compaction`       | compaction | sonnet-4-5        | anthropic/sonnet-4-5 | end_turn     | $0.060 |
| 7   | 10:05:41 | `ses_4`   | — / `title`            | title      | haiku-4-5         | anthropic/haiku-4-5  | end_turn     | $0.001 |
| 8   | 10:06:10 | `ses_4`   | `agt_7`                | primary    | sonnet-4-5        | anthropic/sonnet-4-5 | end_turn     | $0.038 |

All 8 rows have `turn: msg_01`, `root_session: ses_4`, `org_P` and `spc_G`. All rows except the title (row 7) have `member: mem_A`. The cost of the turn is the sum of the rows with `turn = msg_01`: $0.181.

1. Subagent (rows 2 to 4). `ses_5` has no row in Ren until it syncs (§6). Ren keeps it, because no row contradicts it. The root `ses_4` is checked.
2. Fallback (row 4). `requested_model` is what the request asked for. `served_model` is the deployment that ran (ren-v1 `52d93bb9f`).
3. Failure (row 3). The error is a row with cost 0, so PostHog can count the 429 rate.
4. Compaction and title (rows 6 and 7). `kind` tells them apart. Their cost counts in the turn that caused them.
5. An OpenCode retry (`session.retry.scheduled`) is a new gateway request with a new call ID, so it is a new row. A LiteLLM fallback is inside one gateway request, so the `id` carries the deployment ID (§4.5).

Nothing more to build: the build of §4 covers this piece.

### 5.1 Failure points

| Risk                                                                   | What happens                                                                            | Cost leak? | Status            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | ----------------- |
| The 429 attempt and the fallback have the same LiteLLM call ID         | Without the deployment ID in `id`, row 4 hits `ON CONFLICT … DO NOTHING` and is dropped | Yes        | Prevented by §4.5 |
| LiteLLM calls the failure hook once for each request, not each attempt | Row 3 does not exist                                                                    | No         | Not verified      |
| The brain gives a child session ID that does not exist                 | Kept as a claim under the checked root                                                  | No         | Accepted (§1.3)   |

Load: one turn gives 8 inserts. Five subagents at once give about 40 inserts in a minute. Not a bottleneck.

## 6. Piece 4: tool calls and the transcript

Model calls go from the gateway to `usage_event`. All other work of the agent (tools, shell, thinking, the outcome of the turn) is only in the transcript. The brain writes the transcript and syncs it to Ren's Postgres: another path, another writer, another level of trust.

```
 ┌──────────────────────────────┐                                        ┌──────────────────────────────┐                                        ┌──────────────────────────────┐
 │                              │                                        │                              │                                        │                              │
 │  brain brn_7:3               │  POST /host/sync/sessions/:id          │  Ren server                  │  upsert rows                           │  Ren Postgres                │
 │  OpenCode writes parts       │  /uploads → messages → commit          │  SessionSync                 │  only sessions of this brain           │  agent_session               │
 │  locally during the turn     │  ───────────────────────────────────>  │                              │  ───────────────────────────────────>  │  opencode_message            │
 │                              │  BrainToken (host scope)               │                              │  creates child ses_5 row               │                              │
 │                              │                                        │                              │                                        │                              │
 └──────────────────────────────┘                                        └──────────────────────────────┘                                        └──────────────────────────────┘
```

| Time     | Session | Part            | What it holds                                                                             |
| -------- | ------- | --------------- | ----------------------------------------------------------------------------------------- |
| 10:04:12 | `ses_4` | tool `task`     | Starts subagent `explore`. Status completed.                                              |
| 10:04:21 | `ses_5` | tool `grep`     | Created, ran and completed at 10:04:21. Status completed.                                 |
| 10:04:35 | `ses_5` | tool `webfetch` | Status error (timeout). It went to the public web through the egress.                     |
| 10:05:03 | `ses_4` | tool `bash`     | Created 10:05:03, ran 10:05:19: it waited 16 s for Asha's permission. Completed 10:05:31. |
| 10:05:03 | `ses_4` | shell           | `exit: 1` on the first run of a script                                                    |
| 10:04:01 | `ses_4` | reasoning       | 10:04:01 to 10:04:10: 9 s of thinking                                                     |
| 10:06:10 | `ses_4` | end of turn     | OpenCode `session.execution.succeeded`                                                    |

A tool part has `name`, `state.status` (`completed` or `error`), `error`, and the times `created`, `ran` and `completed` (`opencode/packages/schema/src/session-message.ts:163`). A shell part has `exit` and times (`:113`). A reasoning part has times (`:190`). The outcome of a turn is an OpenCode event: `session.execution.succeeded`, `failed` or `interrupted` (`session-event.ts:245`).

### 6.1 Steps

1. During the turn, OpenCode writes each part on the sandbox's disk.
2. The brain opens an upload, sends the messages and commits (`host-api/src/sync-api.ts:33`, `:52`, `:65`), with its `BrainToken`.
3. `SessionSync` accepts only sessions of this brain (`core/src/session-sync.ts:75`). At the first sync of `ses_5` it creates the child row with `parent_id: ses_4`, `root_id: ses_4` and no agent (`:141`).
4. Nothing is copied into `usage_event`. These tools cost nothing for each call: `grep` and `bash` run in the sandbox, and `webfetch` goes through the egress.
5. A tool that costs money (later: search, image, treg) goes through the integration gateway, which writes an `api.call` row the same way as §4 (§9).

The brain wrote all of this. It is good for analytics. Ren never takes money from it.

Nothing to build: sync exists. §7 reads the transcript.

### 6.2 Failure points

| What fails                                | What happens                                                                                                          | Cost leak? |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| The brain cannot reach Ren                | Parts wait on the sandbox; sync tries again. The transcript is late.                                                  | No         |
| The sandbox is lost before sync           | The parts not yet synced are lost (`runtime/README.md`: on `e2b-space` only transcripts survive the loss of the host) | No         |
| The brain reports a false tool outcome    | Analytics are wrong                                                                                                   | No         |
| A message larger than 2 MB on a cell host | celld refuses the row (`runtime/README.md`)                                                                           | No         |

Load: sync is the largest writer in Ren's Postgres, not usage. In ren-v1, Porcellia had 427,000 sync events and 33,985 model calls from 1 to 28 Oct, about 12 sync writes for each usage row (§11.1). When Postgres is slow, sync is slow first, and usage inserts wait on the same database.

## 7. Piece 5: after the turn, PostHog

Status: later. Two loops in the Ren server send copies to PostHog. The records stay in Postgres.

```
usage_event (8 rows)   ──── loop A ────►  8 × $ai_generation
transcript  (turn)     ──── loop B ────►  1 × $ai_trace  +  7 × $ai_span
```

### 7.1 Loop A: `usage_event` → `$ai_generation`

1. Each Ren server runs the loop. It claims up to 500 rows `WHERE posthog_sent_at IS NULL` with `FOR UPDATE SKIP LOCKED` (as `core/src/schedule-trigger.ts:39`), sends them to PostHog's batch endpoint, sets `posthog_sent_at` and commits.
2. When the claim had 500 rows, the loop runs again at once; with fewer, it waits 60 s. A failed send waits with `Schedule.exponential` and keeps the rows unsent.
3. It runs only when Ren has a PostHog key. Without a key the column stays null.

One row gives one `$ai_generation` event. PostHog removes a repeat only when `uuid`, `event`, `timestamp` and `distinct_id` are the same, so the export makes each of them from the row.

| PostHog field                                                                                                                                                                                     | From the row                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event`                                                                                                                                                                                           | `$ai_generation`                                                                                                                                                                                                                   |
| `uuid`                                                                                                                                                                                            | UUIDv5 of `<source>:<id>`                                                                                                                                                                                                          |
| `timestamp`                                                                                                                                                                                       | `time`                                                                                                                                                                                                                             |
| `distinct_id`                                                                                                                                                                                     | The user of `member` (by join), else `workload`                                                                                                                                                                                    |
| `$ai_trace_id`                                                                                                                                                                                    | `turn`, else `<source>:<id>`                                                                                                                                                                                                       |
| `$ai_session_id`                                                                                                                                                                                  | `root_session`, else null                                                                                                                                                                                                          |
| `$ai_span_id`, `$ai_span_name`                                                                                                                                                                    | `id`, `kind`                                                                                                                                                                                                                       |
| `$ai_parent_id`                                                                                                                                                                                   | The `subagent` span of `session` when `session` is not `root_session` (§7.2), else absent. Needs OpenCode's `task` tool part to name its child session (O11).                                                                      |
| `$ai_model`, `$ai_provider`                                                                                                                                                                       | `served_model`, `provider`                                                                                                                                                                                                         |
| `$ai_input_tokens`, `$ai_output_tokens`                                                                                                                                                           | `input_tokens`, `output_tokens`                                                                                                                                                                                                    |
| `$ai_cache_read_input_tokens`                                                                                                                                                                     | `cache_read_tokens`                                                                                                                                                                                                                |
| `$ai_cache_creation_5m_input_tokens`, `$ai_cache_creation_1h_input_tokens`                                                                                                                        | `cache_write_tokens`, `cache_write_1h_tokens`                                                                                                                                                                                      |
| `$ai_cache_reporting_exclusive`                                                                                                                                                                   | `true` (§4.3: `input_tokens` has no cache tokens)                                                                                                                                                                                  |
| `$ai_total_cost_usd`, `$ai_cost_passthrough`                                                                                                                                                      | `cost_micro_usd` ÷ 1,000,000, and `true`. Both absent when the cost is null.                                                                                                                                                       |
| `$ai_latency`, `$ai_time_to_first_token`                                                                                                                                                          | `latency_ms` ÷ 1,000, `time_to_first_token_ms` ÷ 1,000. LiteLLM gives no first token time on its Anthropic messages route, so for those calls loop B takes it from the transcript: the start of the first part of the step (§7.2). |
| `$ai_stop_reason`                                                                                                                                                                                 | `stop_reason`                                                                                                                                                                                                                      |
| `$ai_is_error`, `$ai_error`                                                                                                                                                                       | `error` is set, `error`                                                                                                                                                                                                            |
| `ren_organization`, `ren_space`, `ren_brain`, `ren_session`, `ren_member`, `ren_agent`, `ren_agent_name`, `ren_requested_model`, `ren_variant`, `ren_payer`, `ren_reasoning_tokens`, `ren_source` | The fields of the same names (`ren_requested_model` is the model that the request asked for)                                                                                                                                       |

1. The event has no `$ai_input` and no `$ai_output_choices`. PostHog gets no message content.
2. `$ai_*` events make no person profile in PostHog.
3. An agent that reviews past sessions finds them with HogQL, then reads them from Postgres by ID.

### 7.2 Loop B: transcript → `$ai_trace` and `$ai_span`

When a turn ends, Ren builds one `$ai_trace` for the turn and one `$ai_span` for each tool call, shell command, compaction and subagent run, from the synced transcript. Each event has a fixed `uuid`, so a repeat is harmless. The loop itself is open item O9.

They follow OpenTelemetry's `invoke_agent` and `execute_tool` spans and Langfuse's trace and `tool` observations. The transcript is written by the brain, so these events carry no tokens and no cost: PostHog adds up a turn's cost from its `$ai_generation` events. They carry no message content, no tool arguments and no tool results.

| Event       | Field                                                                                                                   | From the transcript                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both        | `$ai_trace_id`, `$ai_session_id`                                                                                        | The turn (its user message ID) and the root session                                                                                                                                                                        |
| Both        | `uuid`                                                                                                                  | UUIDv5 of `trace:<turn>` or `span:<session>:<part ID>`                                                                                                                                                                     |
| Both        | `ren_organization`, `ren_space`, `ren_agent`, `ren_member`                                                              | As on the usage rows of the same turn                                                                                                                                                                                      |
| `$ai_trace` | `$ai_latency`                                                                                                           | From the user message to the end of the turn                                                                                                                                                                               |
| `$ai_trace` | `$ai_is_error`, `$ai_error`                                                                                             | The turn's outcome: OpenCode `session.execution.succeeded`, `failed` (with the error class) or `interrupted` (with `user`, `shutdown`, `superseded` or `inactivity`) (`opencode/packages/schema/src/session-event.ts:245`) |
| `$ai_trace` | `ren_steps`, `ren_tool_calls`, `ren_tool_errors`, `ren_retries`, `ren_compactions`, `ren_subagents`, `ren_reasoning_ms` | Counts and the sum of reasoning time in the turn                                                                                                                                                                           |
| `$ai_span`  | `$ai_span_name`                                                                                                         | `tool:<name>`, `shell`, `compaction` or `subagent:<agent>`                                                                                                                                                                 |
| `$ai_span`  | `$ai_parent_id`                                                                                                         | The turn, or the subagent span for a call inside a subagent                                                                                                                                                                |
| `$ai_span`  | `$ai_latency`, `ren_wait_ms`                                                                                            | Tool part `time.ran` to `time.completed`, and `time.created` to `time.ran` (the wait, for example for a permission) (`session-message.ts:163`)                                                                             |
| `$ai_span`  | `$ai_is_error`, `$ai_error`                                                                                             | Tool part `state.status` `error` and the error class; for a shell command, a non-zero `exit` (`session-message.ts:113`)                                                                                                    |

### 7.3 What PostHog shows for turn `msg_01`

```
$ai_trace  msg_01    succeeded · 130 s · $0.181 (sum of the generations)
├─ $ai_generation  rows 1, 5, 6 (compaction), 7 (title), 8 (final)
├─ $ai_span        tool:task
├─ $ai_span        subagent:explore
│   ├─ $ai_generation  rows 2, 3 (429), 4 (bedrock)
│   ├─ $ai_span        tool:grep
│   └─ $ai_span        tool:webfetch       error: timeout
├─ $ai_span        tool:bash           ren_wait_ms 16000 (permission)
├─ $ai_span        shell               error: exit 1
└─ $ai_span        compaction
```

| Question for self-improvement                     | Query sketch (HogQL)                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Which tools fail most, for each agent?            | `$ai_span`: `countIf(properties.$ai_is_error) / count()` by `$ai_span_name`, `ren_agent`                                   |
| Where does it think too much?                     | `$ai_generation`: `sum(properties.ren_reasoning_tokens) / sum(properties.$ai_output_tokens)` by `ren_agent`, `ren_variant` |
| How often does a fallback occur?                  | `$ai_generation`: `countIf(properties.$ai_model != properties.ren_requested_model) / count()` by `$ai_provider`            |
| Which turns are slow, and is it permission waits? | `$ai_trace` p95 `$ai_latency` by agent, with the sum of `ren_wait_ms` of their spans                                       |
| What does a successful turn cost, for each agent? | Sum of `$ai_generation` cost by `$ai_trace_id`, joined to the outcome of `$ai_trace`                                       |

### 7.4 Build

| #   | Work                                                                                                                                                                                                                                                                                    | Package                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| P1  | Column `posthog_sent_at`, a partial index `WHERE posthog_sent_at IS NULL`, and loop A with the mapping of §7.1                                                                                                                                                                          | `@ren/db`, `@ren/core`     |
| P2  | Loop B with the mapping of §7.2, after O9 is decided                                                                                                                                                                                                                                    | `@ren/core`                |
| P3  | Link a model call to its step: when OpenCode's `model.request` hook gives the assistant message ID, the brain sends it in a `ren-message` header and the event gets an optional `message` field. Then a `$ai_generation` has its step's tool spans as siblings, not only its turn (O8). | `@ren/cell`, `@ren/schema` |
| P4  | Evals run in Ren and read the transcript from Postgres, because PostHog gets no content. They send only a score to PostHog.                                                                                                                                                             | Later                      |

### 7.5 Failure points

| What fails                                                    | What happens                                                      | Data lost?                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| PostHog is down                                               | Rows stay unsent; the loop sends the backlog when PostHog is back | No                             |
| Ren stops after the send and before it sets `posthog_sent_at` | The same `uuid` goes again; PostHog removes the repeat later      | No; a repeat shows for a while |
| `mem_A` is deleted between two tries                          | `distinct_id` changes, so PostHog keeps both                      | One repeat (rare)              |
| The transcript is late or lost (§6)                           | `$ai_trace` and `$ai_span` are late or missing (O9)               | Analytics only                 |
| No PostHog key (self-host)                                    | No loops; the column stays null                                   | Nothing is sent, as designed   |

Load: not the database; one claim sends 500 rows. The cost is PostHog's price: about 1.1M generations a month at the target, plus about 8 spans for each turn. `$ai_*` events are priced as AI Observability events. The price is not checked.

## 8. Piece 6: money

Status: later. It needs the closed billing service (O1). Ren keeps only provider cost; prices and markup are only in the closed service.

```
 ┌──────────────────────────────┐                                        ┌──────────────────────────────┐                                        ┌──────────────────────────────┐
 │                              │                                        │                              │                                        │                              │
 │  usage_event                 │  billing loop, SKIP LOCKED             │  billing service             │  meter event per row                   │  Dodo                        │
 │  8 rows, provider cost       │  billing_sent_at IS NULL               │  (closed)                    │  event_id = source:id                  │  meter: Sum of micros        │
 │                              │  ───────────────────────────────────>  │  price = cost + markup       │  ───────────────────────────────────>  │                              │
 │                              │  POST /billing/v1/events               │                              │  webhook credit.* back                 │                              │
 │                              │  200 after it stores them              │                              │                                        │                              │
 │                              │                                        │                              │                                        │                              │
 └──────────────────────────────┘                                        └──────────────────────────────┘                                        └──────────────────────────────┘

 ┌──────────────────────────────┐                                        ┌──────────────────────────────┐                                        ┌──────────────────────────────┐
 │                              │                                        │                              │                                        │                              │
 │  Ren                         │  Billing.check(org_P)                  │  Billing.layerRenCloud       │  POST /billing/v1/check                │  billing service             │
 │  next turn starts            │  ───────────────────────────────────>  │  cache 30 s                  │  ───────────────────────────────────>  │  Dodo balance                │
 │                              │  allow | Refused(reason)               │                              │  last answer ≤ 10 min                  │  − price not yet sent        │
 │                              │                                        │                              │                                        │                              │
 └──────────────────────────────┘                                        └──────────────────────────────┘                                        └──────────────────────────────┘
```

### 8.1 Steps

1. The billing loop claims the rows of turn `msg_01` (and all other rows `WHERE billing_sent_at IS NULL`) and sends `POST /billing/v1/events`. When the billing service answers 200, Ren sets `billing_sent_at` and commits.
2. The billing service gives each row a price. Example only: the real markup is closed and not decided.

   | Rows                         | Provider cost         | Price (example: +20%)         |
   | ---------------------------- | --------------------- | ----------------------------- |
   | 1, 2, 4 to 8                 | $0.181                | $0.217                        |
   | 3 (the 429)                  | $0                    | $0                            |
   | A row with `payer: customer` | $0 (own subscription) | $0 or a fee (closed decision) |

3. The billing service sends Dodo one meter event for each row, with `event_id` = `<source>:<id>` and `cost_micros` = the price. Dodo ignores a repeat of `event_id`. The meter adds up the micros.
4. Dodo lowers the credit balance one minute or more later and sends `credit.*` webhooks. The billing service refreshes its copy of the balance.
5. The credit check of the next turn (§3) gets: the Dodo balance minus the price of the events that the billing service has not yet sent to Dodo.
6. Each day, a closed job compares the `usage_event` total of each provider with the provider's bill and alerts on a gap. Example: Anthropic $1,204.10 in `usage_event`, $1,231.40 on the bill, a gap of 2.2%. A gap shows events that were lost on the way (§4.9, §5.1).

### 8.2 Build

| #   | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Where                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| M1  | Billing delivery: a column `billing_sent_at` and a partial index `WHERE billing_sent_at IS NULL`. `Billing.layerRenCloud` runs a loop in each Ren server: it claims 500 rows `FOR UPDATE SKIP LOCKED`, sends `POST /billing/v1/events`, sets `billing_sent_at`, and commits. When the claim had 500 rows, the loop runs again at once; with fewer, it waits 60 s. A failed send waits with `Schedule.exponential` and keeps the rows unsent. `layerNone` has no loop. | `@ren/core`, `@ren/db`  |
| M2  | The billing service ignores a repeat of `(source, id)`. It answers 200 only after it has stored the events, so a crash after 200 loses nothing.                                                                                                                                                                                                                                                                                                                       | Closed                  |
| M3  | `check` over HTTP: `POST /billing/v1/check`, with the cache and the 10-minute rule of §3.2 item 5. The billing service subtracts the price of the events that it has not sent to Dodo from the Dodo balance.                                                                                                                                                                                                                                                          | `@ren/core`, closed     |
| M4  | Daily reconciliation: a closed job compares each day's `usage_event` totals with each provider's bill (model providers, treg, E2B) and alerts on a gap. It finds drops that the producers did not see.                                                                                                                                                                                                                                                                | Closed                  |
| M5  | Usage page: reads `usage_event` with `GROUP BY` on `(organization, time)`. A session includes its child sessions through `agent_session.root_id`. Money: `layerNone` shows `cost_micro_usd`; `layerRenCloud` gets the charged amounts from the billing service. Ren stores no price.                                                                                                                                                                                  | `@ren/app`, `@ren/core` |
| M6  | Usage of a private space, after the usage page: [`runtime/private-spaces/README.md`](runtime/private-spaces/README.md) item 1.                                                                                                                                                                                                                                                                                                                                        | `@ren/app`              |

### 8.3 Failure points

| What fails                                                   | What happens                                                                                                                                            | Money lost?                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| The billing service is down                                  | Rows stay unsent. The check uses the last answer for 10 min, then refuses: all turns of Ren Cloud stop.                                                 | No; people are blocked                                  |
| The billing service answers 200, then stops before it stores | Prevented by M2                                                                                                                                         | No                                                      |
| Dodo is down                                                 | The billing service keeps the events and tries again (closed design)                                                                                    | No, if it stores first                                  |
| Dodo's balance is late                                       | A burst of turns can spend too much. "Minus the price not yet sent" covers Ren's side; Dodo's overage limit (about one expensive turn) covers the rest. | Small, limited                                          |
| A long turn runs out of credit during the turn               | Ren checks only at the start of a turn and of a sandbox. The turn ends and spends too much.                                                             | Yes, one turn. The check for each request is later (§9) |
| From the first build until billing delivery                  | Dodo receives no usage (§4.8, ren-inference change 5)                                                                                                   | Yes, if Ren Cloud bills v2 today                        |
| Dodo's rate limit or batch size                              | Not checked. ren-v1 `4337003f4` hit Dodo's rate limit when it read the ledger.                                                                          | Late, not lost, if the billing service tries again      |

Load: Dodo's API, not Ren. At the target that is 1.1M meter events a month, 0.4 a second. Dodo's ingest limits are not checked. If they are low, the billing service can send one total for each organization and hour instead of one event for each row (a closed decision).

## 9. Piece 7: failure map, bottlenecks, other later steps

### 9.1 The chat in one table

| Piece | Path                                    | Record                                                  | Writer          | Trust                  |
| ----- | --------------------------------------- | ------------------------------------------------------- | --------------- | ---------------------- |
| 1     | app → Ren → brain                       | None                                                    | —               | —                      |
| 2, 3  | brain → egress → LiteLLM → logger → Ren | `usage_event`, 8 rows                                   | Gateway         | Money is proven        |
| 4     | brain → sync → Ren                      | Transcript                                              | Brain           | Claims; analytics only |
| 5     | Ren loops → PostHog                     | Copies: 8 `$ai_generation`, 1 `$ai_trace`, 7 `$ai_span` | Ren             | Copies                 |
| 6     | Ren loop → billing service → Dodo       | Charged amount in Dodo                                  | Billing service | From the proven rows   |

### 9.2 Single points of failure, worst first

| #   | Part                           | Copies today                                                                                     | When it fails                                                                                                | Cost leak?               |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1   | Ren server and its Postgres    | 1 server (`infra/aws/terraform.tfvars:9`, O7). A Postgres standby in another zone: not verified. | No new turns; ingest is down; sync and all loops stop                                                        | Yes, through #2          |
| 2   | The logger's buffer in LiteLLM | —                                                                                                | Holds events while Ren is down (§4.7); lost when it fills or LiteLLM stops (O4)                              | Yes: the real leak point |
| 3   | Billing service (later)        | —                                                                                                | Rows wait. After 10 min each check refuses, so all turns of Ren Cloud stop.                                  | No; people are blocked   |
| 4   | LiteLLM / ren-inference        | —                                                                                                | Calls fail                                                                                                   | No                       |
| 5   | Egress                         | 2 or more                                                                                        | One copy fails over; with none, no request reaches a provider                                                | No                       |
| 6   | PostHog, Dodo                  | External                                                                                         | Copies wait and are sent later                                                                               | No (M2)                  |
| 7   | Brain or sandbox (hostile)     | —                                                                                                | It can claim a wrong session or person in its own space. A lost sandbox loses the transcript not yet synced. | No                       |

### 9.3 Bottlenecks, largest first

| #   | Where                    | Size at the target                                                         | Status                      |
| --- | ------------------------ | -------------------------------------------------------------------------- | --------------------------- |
| 1   | Writes to Ren's Postgres | Sync writes about 12 times as often as usage (§6.2). Usage adds about 8%.  | The load is sync, not usage |
| 2   | Dodo's ingest API        | 1.1M meter events a month, 0.4 a second                                    | Limits not checked          |
| 3   | PostHog's price          | 1.1M generations a month, plus about 8 spans for each turn                 | Price not checked           |
| —   | The ingest route         | 0.4 a second on average, 27 at worst, against about 1,000 inserts a second | Not a bottleneck            |

### 9.4 Other later steps

| Step                     | Starts when                                                              | Design                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted model calls  | A self-hoster needs usage                                                | A LiteLLM callback in this repository that sends to the ingest route with `source: litellm`.                                                                                                                                                                                                                                                                          |
| Integration gateway      | REN-1540                                                                 | A closed HTTPS service with Ren's provider keys, separate from LiteLLM. It accepts a workload key (§1.3 item 5), so a sandbox reaches it through the egress and a cell reaches it directly. It chooses the provider and the fallback order. Each attempt at an upstream provider is one `api.call` event, `id` `<request ID>:<attempt>`. The egress records no usage. |
| Email                    | Ren pays for it (Postmark)                                               | `Mailer.send` records `email.sent` with `organization` and no `workload`.                                                                                                                                                                                                                                                                                             |
| Corrections              | The first cost that is known only later                                  | An optional field `charge` joins an estimate and its correction. A correction can be negative.                                                                                                                                                                                                                                                                        |
| Totals table             | A usage query takes more than 1 s                                        | `usage_hourly`, rebuilt from raw rows. Readers move to it.                                                                                                                                                                                                                                                                                                            |
| Expiry                   | `usage_event` holds more than 100M rows                                  | One partition for each day. Old days are dropped. The totals table stays.                                                                                                                                                                                                                                                                                             |
| Column store             | More than 1,000 events a second for one hour                             | Replace the store behind `Usage.Service`. The event and the ingest route do not change.                                                                                                                                                                                                                                                                               |
| Budget check per request | [`runtime/credentials/README.md`](runtime/credentials/README.md) line 38 | The egress checks credit for each request, not only at the start of a turn.                                                                                                                                                                                                                                                                                           |

## 10. Open items

| ID  | Item                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Where the closed billing service lives: a new private repository, or `../ren-inference`.                                                                                                 |
| O4  | The logger's buffer (§4.7) is in memory. Events in it are lost when the LiteLLM process stops before Ren answers 200. Decide whether this loss is acceptable or the buffer goes to disk. |
| O5  | How open code turns on a paid Ren Cloud feature without `ee/`.                                                                                                                           |
| O6  | The factory dashboard reads cost from synced `opencode_session` rows ([`tasks.md`](tasks.md) §4). Under §1.2 it reads `usage_event`.                                                     |
| O7  | Ren runs one server copy (`infra/aws/terraform.tfvars:9`). The ingest route is down when that copy is down.                                                                              |
| O8  | OpenCode's `model.request` hook has no assistant message ID (`opencode/packages/plugin/src/effect/session.ts:64`), so a model call links only to its turn.                               |
| O9  | The loop that sends turn and tool events: which synced rows mark a turn as ended, and how a re-send after a late sync finds that turn again.                                             |
| O11 | Whether OpenCode's `task` tool part names the child session that it starts. Not verified.                                                                                                |

## 11. Evidence

### 11.1 Load

ren-v1 production, read only, 28 Oct 2026 (`LiteLLM_SpendLogs` and the `ren` database).

| Item                                         | Value                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Porcellia (the second largest of 1,413 orgs) | 32 members, 67 spaces, 33,985 model calls from 1 to 28 Oct (about 36,400 a month), peak 53 in one minute |
| Porcellia sync events, 1 to 28 Oct           | 427,000 (`opencode_event`)                                                                               |
| All of ren-v1, Oct 2026                      | 242,990 model calls                                                                                      |
| Target: 30 customers as large as Porcellia   | About 1.1M model calls a month                                                                           |
| Database                                     | `db.m7g.large`: 2 vCPU, 8 GB, Postgres 17.9                                                              |
| One event row                                | About 1 KB with indexes                                                                                  |

At 1.1M events a month, `usage_event` reaches 100M rows in about 7.5 years.

### 11.2 Prior art

| Project                       | Fact                                                                                                                                                      | Rule here                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Lago                          | Postgres to 10,000 events a second. It moved to ClickHouse later and kept the event format (doc.getlago.com).                                             | §9.4 column store              |
| OpenMeter, Stripe meters      | An event has a unique `id` and `source`, a customer, a type, a time and values. A correction is a new record.                                             | §4.3, §9.4 corrections         |
| LiteLLM                       | Updates of total rows on each request gave deadlocks at about 1,000 requests a second. Its UI reads daily total tables (docs.litellm.ai/docs/proxy/prod). | No totals on write             |
| PostHog                       | Duplicates are removed only eventually, and only when `uuid`, `event`, `timestamp` and `distinct_id` are the same (posthog.com/docs/data/events).         | PostHog is not a record (§1.2) |
| OpenTelemetry GenAI, Langfuse | A session holds turns (`invoke_agent` / trace); a turn holds model calls (`chat` / generation) and tool calls (`execute_tool` / tool). Content is opt-in. | §7.1, §7.2                     |

### 11.3 ren-v1 errors

| v1                       | Error                                                                                    | Rule here                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `a54be6d8c`              | Two writers recorded one call with two numbers.                                          | One producer for each cost (§1.2)                                  |
| `52d93bb9f`, `598358adf` | A fallback was recorded under the name of the model that the caller asked for.           | `served_model` is the deployment that ran                          |
| `59057dac8`              | A client stopped after 2 s; the model ran for 70 s. The harness never saw the full cost. | The gateway is the producer                                        |
| `2fa27e274`              | A charged call priced at zero was dropped.                                               | `cost_micro_usd` null; Ren keeps the row                           |
| `e75c20685`, `8553e9af4` | Cache reads and 1-hour cache writes had the wrong rates.                                 | One quantity for each price                                        |
| `8ba98ecc0`              | Calls on a customer's own subscription showed as charges.                                | `payer: customer`                                                  |
| `4337003f4`              | A page read Dodo's ledger day by day and hit its rate limit.                             | Pages read `usage_event`                                           |
| OI-6                     | The browser named the person of a turn.                                                  | Who pays comes from credentials; Ren checks `session` and `member` |
| OI-18                    | Traces used the user ID; spend used the member ID.                                       | One `member` field                                                 |
