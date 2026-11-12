# Media models: one typed catalog, OpenCode's tool pattern

Status: phase 1A is implemented on `media-model-providers`, rebased onto `origin/main` (OpenCode 2.2.6). Its review gate is still open (§3.5). No later phase has started. Remove the completed phase when the gate closes.

Current contract: inference PR #24 exposes `GET /v1/catalog` as `{ baseUrl, models }`. It also exposes `GET /v1/search/providers` and `POST /v1/search`; Ren calls neither (D9). Ren uses the returned callable IDs and explicit protocols without upstream mode or vendor mappings. The review gate includes deploying this contract, the gateway-host routing below and the catalog key before Ren adoption.

Provider boundary:

- Ren is one registered model provider (`core/src/ren-inference/provider.ts`, id `ren`). `Models.layer` takes the deployment's providers. Each supplies a registration, its picker catalog and a key per brain. `Models.Service` aggregates them. Nothing downstream branches on a provider ID.
- Core reads catalogs with `REN_INFERENCE_GATEWAY_KEY` for its model picker. Registration and key grants do not depend on catalog availability. Keys come from `/v1/keys` (managed) or are the gateway key itself.
- A registration names the provider's reachable base URL and catalog protocol. For Ren, `REN_INFERENCE_BRAIN_URL` overrides `REN_INFERENCE_GATEWAY_URL`, with `REN_INFERENCE_URL` as the default. Model execution and `{baseUrl}/catalog` answer on that host. The inference deployment routes catalog paths to its API; execution reaches LiteLLM unchanged.
- The pull reply carries `providers`, without keys. Brain/cell stores these registrations and fetches each remote catalog directly with that provider's key. A provider may instead supply a static catalog. Discovery runs during periodic pulls, independently of OpenCode. A failed catalog read keeps its last successful value. Removing or changing a registration invalidates its cached catalog and rejects stale responses.
- Ren registers no web search provider (D9). The `websearch` tool uses OpenCode's built-in providers. Ren only sets the selection to `random` when nothing else sets it, so no consent form stops an agent; OpenCode's `websearch` config still overrides it. Vendor search goes through registry apps: an official MCP on the organization's account, or a managed MCP paid with Ren credits (`specs/integrations/README.md`).
- Model references are exact. Selections saved before the managed provider became `ren` are not converted: they fall back to the next layer's model, as any unavailable model does.

| Word          | Meaning                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Media model   | A model that is not a chat model: it makes or reads images, speech, audio or video, or answers decisions.                     |
| Type          | What a model does. Read native names from the inference API; upstream mappings belong to inference.                           |
| Gateway       | The LiteLLM proxy of `ren-inference`. It serves every Ren-paid model on one host with one key per brain.                      |
| Endpoint      | One provider connection: an ID, base URL, key and model inventory. Ren's managed gateway is the provider `ren`.               |
| Built-in tool | OpenCode's `experimental_image_generate` (`@opencode/core/tool/plugin/image-generate`).                                       |
| Media tool    | A tool that calls a media model. Image uses the built-in tool; the other types use Ren plugin tools in the same shape (§1.3). |

## 1. Target

### 1.1 Types

One catalog holds every model. `Models.Info.type` uses native names. Existing `defaultModels` API keys stay unchanged; `ModelTypes.modelType` maps those public keys to native model types.

| Ren type        | LiteLLM `mode`                          | OpenCode `Model.Type` | Tool                                   | Phase |
| --------------- | --------------------------------------- | --------------------- | -------------------------------------- | ----- |
| `chat`          | `chat`, `responses`, `completion`, none | `chat`                | the session itself                     | built |
| `image`         | `image_generation`                      | `image`               | built-in `experimental_image_generate` | 1A    |
| `transcription` | `audio_transcription`                   | `transcription`       | `audio_transcription` (Ren)            | 1A    |
| `decision`      | `decisions`                             | `decision`            | `decisions` (Ren)                      | 1A    |
| `speech`        | `audio_speech`                          | `speech`              | `speech_generate` (Ren, D5)            | 1B    |
| `realtime`      | `realtime`                              | not registered        | none: the app's voice call             | 2     |
| `video`         | `video_generation`                      | `video`               | `video_generate` (Ren)                 | 3     |

Search is not a model type or an endpoint capability (D9). Other modes, such as `embedding`, stay out.

### 1.2 Catalog and keys

- The Ren provider wraps the flat inference catalog in its one endpoint, `ren`. The catalog ID is the callable model ID; OpenCode's `id` and `modelID` use that value. The execution URL and protocol come from the catalog. Ren does not interpret vendor namespaces or construct wire aliases.
- The cell registers each implemented type on its endpoint's OpenCode provider (`ModelProviders.apply`). Speech, realtime and video remain unregistered until their phases. OpenCode keeps non-chat models out of chat model resolution. Ren also filters its public chat picker.
- A media tool gets its key from its provider connection, as a chat model does: `keyFor(endpoint.id)`. The managed connection uses `keyFor("ren")`. Keep the OAuth renewal method.

### 1.3 The media tool shape

Every media tool follows the built-in tool. A Ren tool copies its rules:

1. It is registered only while the catalog has an enabled model of its type.
2. A generation tool has `prompt` (or `text`), `model?` written as `endpoint/model#variant`, and `path?`. Existing synchronous tools keep their inputs. Their model reference is `endpoint/model`; a bare model ID still works with an agent default.
3. Without `model`, the tool uses the executing agent's default for its type. A `tool.hook("execute.before")` writes that default into the input (§3.6). Without a default, image uses OpenCode's selection rule. Synchronous tools select a model from the agent's chat endpoint, then the first listed model of the required type.
4. It asserts the permission action of its own name, with the resource `endpoint/model#variant`, before it spends money.
5. It reads input files and checks paths before the paid call.
6. A call that can take more than a few seconds runs as an OpenCode background job: `Job.Service` `start`, `background`, `wait`; then `Session.Service` `synthetic` with a `<{type} id state>` notice, then `completeBackground`. The tool returns at once with the job ID and the "do not poll" text.
7. It saves the output on the environment, with the extension of the real format.
8. Chat and Ren's transcription and decision clients attach usage claims (`UsageClaims.headers`). Native image generation uses OpenCode's provider transport directly.

Image keeps OpenCode's tool, job services and provider transport. Brain/cell registers the provider URL, image models and credentials. OpenCode resolves and refreshes expiring credentials through the existing integration. There is no image-specific request executor or 401 retry override. Its generation path does not run session request hooks, so it does not receive Ren's per-turn usage claims.

For later tools, Ren can reach `Job.Service` and `Session.Service` through `instances.provide(session)`, as `server.ts` reaches `Shell.Service`. OpenCode 2.2.6 exports both.

### 1.4 Defaults

`defaultModels` keeps its layers and order: chat, agent, space, organization, Ren (`brain/src/settings.ts:103-124`). It resolves against the typed catalog, not against `ModelTypes.Catalogs`. Each subagent resolves its own.

`Models.lookup` matches exact provider and model IDs. The settings resolver does not split IDs. Ren's model entries use one callable `id`, required native `type` and required `protocol`. Obsolete caches fail decoding and discovery replaces them; routing-alias and legacy-type conversion is removed.

Internal references use `{ providerID, id }`. The existing settings API keeps `{ providerId, modelId }`; its `modelId` is a catalog ID, not the wire `modelID`. A missing model on another configured connection must not fall back to the paid gateway through a legacy alias.

### 1.5 Provider convention across domains

Use stable IDs, metadata without secrets, a separate connection, and a typed execution contract. Do not create one universal registry or config union.

| Domain       | Registry and contract                                                   | Managed adapter                                   |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Models       | OpenCode's provider/model registry                                      | Inference catalog plus per-model runtime packages |
| Search       | OpenCode's web-search registry and its built-in providers               | None (D9); vendor search is a registry app        |
| Environments | Existing `EnvironmentProvider.Registry`; provision, connect and destroy | Existing Docker/E2B implementations               |

`ProviderHttp` shares HTTP credentials, headers and retry handling where those transports match; it is not a generic provider framework.

Search provider selection stays in OpenCode's registry. Ren adds no search provider and no per-agent engine default.

## 2. Decisions

| ID  | Decision                                                                                                                                                                                                                                                     | State                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| D1  | Use native model type names and `modelID` internally. Keep the existing public default keys and reference fields for API compatibility.                                                                                                                      | Implemented          |
| D2  | Treat `ren` as a real gateway provider for every model type. Keep complete model IDs, including slashes. Recognize known old vendor chat references through the catalog index, with exact connections first. Do not split references in settings resolution. | Implemented          |
| D3  | Image uses the built-in tool. Ren's `image_generation` tool goes. Lost inputs: `n`, `size`, `background`, `output_format`, `mask`. One image per call.                                                                                                       | Decided              |
| D4  | The image tool shows whenever the catalog lists an image model, as in OpenCode. An agent without a default gets the built-in rule. The permission `experimental_image_generate` is the switch per agent or space.                                            | Implemented          |
| D5  | Tool names: `speech_generate` (phase 1B), `video_generate` (phase 3). `audio_transcription` and `decisions` keep their names.                                                                                                                                | Proposed             |
| D6  | Transcription and decisions run in the call and return their result; the model needs it at once. Speech, image and video run as background jobs.                                                                                                             | Proposed             |
| D7  | Voice scope: the app controls sessions across Ren, as OpenCode desktop does, or talks to one chat.                                                                                                                                                           | Open, before phase 2 |
| D8  | Voice billing for WebRTC calls that LiteLLM does not bill: Ren meters through a sideband connection, a WebSocket relay through Ren, or no metering at first.                                                                                                 | Open, before phase 2 |
| D9  | Ren registers no web search provider, search catalog or engine default. `websearch` uses OpenCode's built-in providers, `random` unless configured. Paid vendor search is a registry app (official or managed MCP), not a Ren route through inference.       | Implemented          |

## 3. Phase 1A: refactor (no new feature)

The goal: the code has the structure of §1. Keep the existing model capabilities. Use the common selection and permission rules. Do the layers in this order. Each layer uses only the layers above it.

### 3.1 `schema`

- [x] R1. `models.ts`: `Models.Info` requires native `type` and `protocol`. `InferenceCatalog` uses `Schema.Array(Info)` directly. Remove Ren's `modelID`, `upstreamId` and their fallback resolver; only the OpenCode adapter sets its native `modelID` to Ren's `id`.
- [x] R2. `models.ts` `fromInference`: validate the flat catalog once and wrap it in the local connection. All models retain their declared type, protocol and callable ID. Upstream filtering and normalization belong to inference.
- [x] R3. `model-types.ts`:
  - Keep public default keys stable. Map them to native model types; add speech and realtime keys without enabling their tools.
  - Remove `Catalogs`, `fromInference` and `renTypes` (`:43-46`, `:61`, `:68-90`).
  - Search is not an LLM model type. Its metadata and discovery are gone (D9).
  - `ModelRef`: keep the public wire shape. Resolve through `Models.lookup` (D2).
- [x] R4. Tests: `core/test/models.test.ts` covers the inference catalog decoding, the provider registry and the Ren endpoint. `schema/test/models.test.ts` covers exact lookup.

### 3.2 `core`, `protocol`

- [x] R5. `core/src/session.ts`: the chat model list gives only `chat` models. The cell's managed lookup also filters them. Tests in `core/test/session.test.ts` and `cell/test/settings.test.ts` cover each public boundary.
- [x] R6. Superseded by the provider boundary: each endpoint's key is injected on its one base URL host; there are no extra hosts.
- [x] R7. `bun run generate` completed. The generated contract adds speech and realtime defaults. No field was removed.

### 3.3 `brain`

- [x] R8. `BrainSettings.resolve`: replace the `catalogs` argument with the typed catalog (`Models.Catalog`). A default matches when its endpoint has the model with the same type. The chat model lookup accepts only `chat` models.
- [x] R9. `brain/test/settings.test.ts` uses the typed catalog and covers a default whose model has another type.

### 3.4 `cell`

- [x] R10. Superseded by the provider boundary: the pull carries registrations; `model-discovery.ts` fetches each provider's catalog in brain/cell. `inference.ts` and selection conversion are gone. Original items:
  - `model-discovery.ts`: remove `providers()` (`:30-44`). Media models come with the endpoints. The search fetch is gone (D9).
  - `inference.ts`: restore only current catalog shapes, including an empty inventory and its execution URL. Discovery replaces obsolete cache formats. There is no legacy routing-alias conversion.
  - Before restart recovery, install the initial model credentials and convert known current selections for all saved native sessions, including children, through OpenCode's session API. Apply the same conversion after transcript import, before queued input can run. Do not rewrite historical message rows.
  - `harness/config.ts:13-14,27-28`, `server.ts:165-166`, `harness.ts:551-652`, `chat-settings.ts:33`: remove `modelCatalogs` and `modelProviders`.
- [x] R11. `model-providers.ts` `apply`: register each implemented model type with its OpenCode type (§1.1) and the package of its type. Do not register speech, realtime or video yet.
  - `image` → `@opencode/ai/providers/openai-compatible/images`
  - `transcription`, `decision` → no package override. Ren's tools call the gateway; OpenCode has no `openai-compatible` entrypoint for them yet (U2, §7).
  - Variants come only from `efforts`, as today.
- [x] R12. Image: remove Ren's `image_generation` tool. Delete `image-generation.ts` and `images.ts`. Add the `execute.before` hook of §3.6 for `experimental_image_generate`.
- [x] R13. Transcription and decisions:
  - `model-tools.ts`: `available` and `select` read the typed catalog and the endpoint. They do not read `modelProviders`.
  - The key is `keyFor(endpoint.id)`, not `"*"`. Keep the usage claims and the renewal after a 401 (`provider-http.ts`).
  - Names, inputs and outputs do not change.
  - The tools still call the gateway with Ren's clients (`transcription.ts`, `decisions.ts`). Moving them onto `@opencode/ai` is U2 (§7).
- [x] R14. Replace the line in `specs/runtime/opencode-upgrade.md` §4 that removes `experimental_image_generate`, keeping the rest of the upgrade notes intact.
- [x] R15. Tests:
  - `cell/test/settings.test.ts`: on the typed catalog. The built-in image tool uses the agent's default and goes away with its last image model.
  - `cell/test/model-discovery.test.ts`: the image models share the managed gateway provider with chat models.
  - Remove `cell/test/images.test.ts`.
  - Add one case: a chat with a media model in the catalog offers only chat models in OpenCode's session model list.

### 3.5 Gate before any feature

Do not start phase 1B until each item is true. Record the evidence (test name or command) next to each item.

- [x] G1. `settings.slow.test.ts`: the native image tool sends the configured model and key to the provider's image endpoint, saves its output, and disappears with its catalog. Covers the main agent and a subagent.
- [x] G2. `settings.test.ts`: native image generation refreshes an expired provider credential through OpenCode's integration and reports an authentication failure without a Ren transport override.
- [x] G3. `remote-tools.test.ts`: “the native image tool saves its default output in the chat's environment and read can open it”. `drive-files.slow.test.ts`: “show_file puts a native image job's default environment output in the drive and the transcript gives it as a card”. Both pass. The hook sets the default under the chat's `.ren/images/` folder.
- [x] G4. The G1 test also opens a non-session location and checks that it has no image tool.
- [ ] G5. Deployment action: list stored permission rules and approvals that name `image_generation`. Tell their owners to use `experimental_image_generate`. Source search found no stored-rule fixture that needs conversion. The G1 test proves that a deny rule for the new action and model blocks the paid call. No production permission inventory was read or changed.
- [ ] G6. `bun run check` passes. `bun run test` passes in `schema`, `brain`, `core` and `cell`. `bun run test:opencode` fails only where `opencode-bump` fails.
  - Current gateway/provider refactor: root checks pass (33 tasks); schema has 87 passes; brain has 12 passes; the serial cell run has 327 passes and 8 TODOs. The slow image regression passes. Core's gateway model tests have 2 passes. The Wrangler contract subset has 21 passes. New regressions cover migration of saved roots, children and imported sessions, including continuation with existing history and the correct gateway key.
  - Current core integration rerun is blocked: Postgres is not running, and Docker's daemon is unavailable, so `docker compose up -d` cannot start it. The earlier core and drive results below are historical, not a substitute for this rerun.
  - Before the gateway/provider revision:
  - Passed: root checks (52 tasks); schema (84 tests); brain (12 tests); core (366 tests, 1 skipped).
  - Passed: `REN_TEST_WORKERS=1 bun run test` in `cell`: 351 passes, 26 skips, 8 TODOs, no failures. The focused settings, discovery and remote-tools run has 73 passes. `REN_SLOW=1` runs of `settings.slow.test.ts` (1 test) and `drive-files.slow.test.ts` (2 tests) also pass.
  - The parallel cell run had two alarm-test timeouts. They pass in isolation and in the serial run. The baseline's parallel run also failed, at a different timeout.
  - The complete `test:opencode` matrix failed on both branches. This branch: 371 passes, 27 failures in the first stage; 21 Wrangler passes, no failures. Baseline `opencode-bump` at `e6ef4257d` (documentation-only changes since this branch's base): 317 passes, 79 failures and 3 errors in the first stage; 21 Wrangler passes, no failures. Many tests exceeded their time limit during these concurrent runs. The failure sets are not equal. This result does not prove the matrix gate.
- [x] G7. Static review of §1 is complete. Remaining feature types are catalog entries only. No speech, voice, video or BYOK tool was added.
- [ ] G8. Plan the provider-ID rollout before deployment. Existing brains must gain reader compatibility before they receive the new gateway catalog and references. Include already-running process brains. An optional schema field and an unchanged OpenCode version do not prove semantic compatibility with old model IDs. No deployment is part of this refactor.

### 3.6 The default-model hook

One `tool.hook("execute.before")` in `plugin.ts` serves every media tool. For a tool in the table of §1.1, when `input.model` is absent, it reads the default of `event.agent` for the tool's type and writes `endpoint/model` into the input. The event carries `agent` (`@opencode/plugin/effect/tool` `ToolHooks`). The tool then validates the model as usual.

## 4. Phase 1B: speech

The first new feature. It uses the shape of §1.3 completely.

- [ ] S1. `ren-inference`: list `audio_speech` models in LiteLLM. Outside this repository.
- [ ] S2. `model-providers.ts`: register `audio_speech` models as OpenCode type `speech`.
- [ ] S3. `cell`: the `speech_generate` tool (D5).
  - Input: `text`, `voice?`, `model?`, `path?`.
  - The call: `OpenAI.configure({ baseURL, apiKey, headers }).speech(model)` with `ai.experimental.speech` from `@opencode/ai`.
  - A background job (§1.3 rule 6), with the notice `<speech id state>`.
- [ ] S4. Tests in `cell`: the job saves the audio file and posts its notice; the tool goes away with its last speech model; a speech call sends the usage claims.

Limit until U1 (§7): a job that runs while the brain restarts is lost with no notice. OpenCode recovers only `shell`, `subagent` and `image` jobs (`@opencode/core/job/recovery`).

## 5. Phase 2: voice

Voice uses `realtime` speech-to-speech models. It does not use speech or transcription models. The Ren server sets up each call; the audio goes between the app and the provider; the app runs the call. The brain does not change.

How OpenCode does it (for reference): `@opencode/core/voice` lists a fixed set of engines (`gpt-live-1`, `gpt-realtime-2.1`, `grok-voice-3.0`, `gemini-3.8-live`; `@opencode/ai/experimental` `Realtime`) and opens a session with the server's own key. The desktop app (`packages/app/src/voice`, about 6,000 lines) runs the call. The voice model hands each request to a Responses model with ten tools that drive OpenCode sessions.

- [ ] V1. `ren-inference`: list realtime models in LiteLLM (`mode: realtime`). Add a route that opens a voice session for one member and meters it (D8). LiteLLM bills `/v1/realtime` and `/v1/live/sessions` over WebSocket. It does not bill a WebRTC `gpt-live-1` session.
- [ ] V2. `schema`: the voice connection shapes, from OpenCode's `VoiceTransport` and `VoiceTransportInput`.
- [ ] V3. `core`: a `Voice` service. `models(actor)` gives the `realtime` models. `session(actor, model, transport)` calls V1's route. Only a member of the organization can open one; the rule goes in a `policy.ts`.
- [ ] V4. `protocol`, `server`: the `voice.models` and `voice.session` endpoints, then `bun run generate`.
- [ ] V5. `app`: port the call logic and the WebRTC connection; write the UI in React. Map the voice tools to the Chat API (D7): list, read, send a message, interrupt, switch the model. A spoken request reaches a chat as a user message from the member.
- [ ] V6. Tests: `core` refuses a person who is not a member; `app` maps each voice tool to its Chat API route.

## 6. Phase 3: video

- [ ] W1. `@opencode/ai`: an OpenAI-style video protocol (create, poll, download) on the queued route. LiteLLM serves `/v1/videos` this way. Upstream, or a Ren package with the same `model(modelID, settings)` export.
- [ ] W2. `ren-inference`: a video provider key in LiteLLM. Today it has only an OpenRouter key (`specs/integrations/references/providers.md:67`).
- [ ] W3. `cell`: register `video_generation` models as OpenCode type `video`; the `video_generate` tool in the shape of §1.3, with the notice `<video id state>`.

## 7. Phase 4: upstream OpenCode

- [ ] U1. One generic recovery kind in `core/src/job/recovery.ts`, for example `{ kind: "media", tool, sessionID, path, model }`, with its restart notice. It replaces `image`. A restart cancels running work and delivers a notice. It does not resume or repeat a paid request. A completed job retains its result notice.
- [ ] U2. Entrypoints `providers/openai-compatible/{speech,transcriptions,videos,decisions}`, `ModelResolver` and `Generate` for these types, and the types in `models-dev.ts` `TYPES`. Ren's tools can then call `ctx.experimental.generate` and drop their own clients (`transcription.ts`, `decisions.ts`, `provider-http.ts`).

## 8. Phase 5: bring your own key

- [ ] B0. Before enabling direct connections that share old vendor IDs, write known legacy settings references in their canonical gateway form. Do not use compatibility aliases to choose the payer after a new connection is added.
- [ ] B1. `schema`: an endpoint's payer: Ren or the customer.
- [ ] B2. `db`: a table of an organization's providers and models. Each key is a `credential` row with `hosts` and `inject`; the brain never holds it.
- [ ] B3. `core`: add the organization's endpoints to the brain's grant. The egress injects the customer's key. Usage rows have payer `customer`.
- [ ] B4. The provider list comes from models.dev, every type. It needs U2.
- [ ] B5. Voice with a customer key for `openai`, `xai` or `google`.
- [ ] B6. `app`: "connect a key" and "pick a provider" on the providers page; a default model per type in the organization, space and agent settings.
- [ ] B7. A fal provider for `@opencode/ai`.
