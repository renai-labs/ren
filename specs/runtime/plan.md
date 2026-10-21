# Runtimes: plan

Today every brain runs in a cell, a Durable Object per session. OpenCode's workerd profile, which the cell runs, has no filesystem, terminal, snapshots, Vcs or stdio MCP, so many ren-v1 features cannot work there. The hot path moves to `e2b-space`: one E2B sandbox per space runs the brain with OpenCode's process profile, and tools run natively in the same sandbox, as in ren-v1. `docker-space` is its local stand-in. The cell stays as a second runtime.

A space chooses its runtime; switching is a data change, not a code change. [README.md](README.md) tracks the runtimes, their capabilities and the feature flags.

- [1. Decisions](#1-decisions)
- [2. Design](#2-design)
- [3. Build order](#3-build-order)
- [4. Verified risks](#4-verified-risks)
- [5. Open decisions](#5-open-decisions)
- [6. Tests](#6-tests)

## 1. Decisions

| ID  | Decision                                                                                                                                                                                                       | Why                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| D1  | A runtime has four axes: harness, host, environment and scope. A profile names one valid combination.                                                                                                          | Each axis changes on its own; new harnesses are a new option, not a new code path.               |
| D2  | The runtime is placement data: `space.runtime` holds a profile, and the server's `REN_RUNTIME` is the default for spaces without one. It is set by a script, never through the public API.                     | Tenant placement in cell-based architectures; a flag service outage cannot move a space.         |
| D3  | A session pins its runtime in `agent_session.runtime` when it is created. A space that changes runtime affects only new sessions. A fork takes the space's current runtime; its harness must match the source. | Nothing migrates between hosts.                                                                  |
| D4  | Each axis is an Effect `Schema`; invalid combinations fail a `Schema` check.                                                                                                                                   | An invalid runtime fails where it is decoded, from any source.                                   |
| D5  | Implementations are chosen with a `LayerMap` per axis. Only the server's composition root reads runtime options; every other module asks for a capability.                                                     | Branch by abstraction. Layers build lazily, so a deployment without E2B credentials still boots. |
| D6  | `SessionCapabilities.of` takes the runtime, not only the harness. A capability is on only when every axis supports it.                                                                                         | The app hides what a runtime cannot do instead of breaking.                                      |
| D7  | Feature flags go through OpenFeature, with PostHog's provider and local evaluation. Core evaluates them; values a brain needs travel in `start`.                                                               | A standard API with a swappable vendor. The PostHog key never reaches a sandbox.                 |
| D8  | In `docker-space` and `e2b-space` the brain runs OpenCode's process profile and its tools run natively in the brain's sandbox: no executor.                                                                    | Parity with ren-v1, and the features workerd lacks.                                              |
| D9  | ACP (Agent Client Protocol) is deferred. A later ACP harness is one more `Harness` option.                                                                                                                     | It needs its own design; nothing here blocks it.                                                 |

## 2. Design

### 2.1 Runtime and pinning

```ts
// @ren/schema/runtime.ts
export const Runtime = Schema.Struct({
  harness: Schema.Literals(["opencode"]),
  host: Schema.Literals(["cell", "docker", "e2b"]),
  environment: Schema.Literals(["none", "colocated", "docker", "e2b"]),
  scope: Schema.Literals(["session", "space"]),
}).check(/* the invalid combinations in README.md */)

export const profiles = { cell: { … }, "cell-docker": { … }, "docker-space": { … }, "e2b-space": { … } }
```

- `space.runtime` holds a profile key. `Session.create` resolves the space's profile, or `REN_RUNTIME`, into a `Runtime` and stores it in `agent_session.runtime`, next to `harness`.
- Every existing session gets `cell` in the migration.

### 2.2 Choosing layers

```ts
class BrainHosts extends LayerMap.Service<BrainHosts>()("@ren/core/BrainHosts", {
  layers: { cell: CellHost.layer, docker: SandboxHost.docker, e2b: SandboxHost.e2b },
}) {}
```

`BrainHost.Service` keeps its interface. Each call reads the session's pinned runtime and runs on `BrainHosts.get(runtime.host)`. Today's `BrainHost.layer` becomes `CellHost.layer`. The `EnvironmentProvider` registry already works this way.

### 2.3 The sandbox host

**Shared brain code.** Two services replace `DurableObjectStorage` in `Cell.layer`, `Sync.layer` and `OpenCodeHarness.layer`:

- `BrainStorage`: a key-value store (`ren:models`, `ren:host-token`, `ren:restoring`), the reader sync uses (`storage.sql.exec`, or `SqliteReader` from `@ren/brain`), and how OpenCode opens its database.
- `Scheduler`: the next reconcile time and how to set it. In a cell this is the alarm. In Bun it is a fiber that also runs reconcile once at boot, which replaces an alarm firing after a restart.

`session-cell.ts` and `worker.ts` become the workerd entry. A Bun entry builds the same `ManagedRuntime` and serves it with `Bun.serve`. `IdentityTransformStream` does not exist in Bun; use `TransformStream`.

**OpenCode.** A second `OpenCodeServer.open` takes a database path: `createEmbeddedRoutes({ database: { path }, … }, [])`. `OpenCodeServer.make` stays unchanged; `test/lib/brain.ts` already runs it this way. The Ren plugin gets a native-tools mode, separate from having environment connections: today it removes file and shell tools and denies them when a brain has no environment.

**Image.** Debian `oven/bun:1.4` with `git` and `ripgrep`, and `bun install` run on Linux so it picks the Linux PTY packages. The file watcher stays off.

**Life cycle.** Ren creates or resumes the sandbox on `start`, `send` and `access`, once per brain at a time (a row lock, as `Environments.assign` does). The sandbox pauses once every session is idle. A sandbox that holds work is never killed. ren-v1's E2B provider and its `pod-sandbox` workflow are the reference.

### 2.4 Space scope

A `brain` table holds the id, space, runtime, sandbox binding (id and URL), generation and status. A session references its brain; `Brain.ofSession` stays only for session scope.

About 25 places assume one session per brain. They group as:

| Area           | Today                                                                                             | Change                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Chat isolation | Chat routes accept any session id; the event stream and status cover the whole brain              | Every request and event is limited to the token's root session and its children |
| Tokens         | Host and client tokens carry one `sid`                                                            | Host `{ brain, space, org }`; client `{ brain, sid, sub }`                      |
| Brain API      | `start`, `send` and `setModel` refuse any other session; `removeModels` and `sync` are brain-wide | Accept any session of the brain's space; models are granted per space           |
| Settings       | Configured from the first root session; one resolved agent set per brain                          | Per space, except what [O2](#5-open-decisions) keeps per session                |
| Sync           | Ren accepts only `root_id == host.sessionId`; one `restoring` flag per brain                      | Accept any session in the host's space; `restoring` per session                 |
| Routing        | `worker.ts` routes by `sid`; `Cell.Info.sessionId` comes from the Durable Object's name           | The sandbox is the brain; `BrainHost.access` returns its URL                    |

### 2.5 Tokens

Today the brain holds `CELL_KEYS`, the HMAC secret that signs every token. In a sandbox the agent can read it and mint a token for any session. This applies to every host:

- Move `Signature` (Ed25519) from `environment-api` to `@ren/util`. Ren signs session tokens with `SESSION_KEYS`; brains hold only `SESSION_PUBLIC_KEYS`.
- Every token names the brain it is for, so brain A refuses a token for brain B.
- The host token is opaque to the brain, which reads only its expiry, as `ModelStore` already does.
- `CELL_KEYS` leaves the brain's environment, and the `server` scope reaches only `/ren/*`, not OpenCode's full API.

### 2.6 Client access

- `BrainHost.access` finds the session's brain, makes sure it runs, restores the session if the brain lacks it, and returns `{ url, token, expiresAt }`. While the brain starts it answers a retryable 503.
- `@ren/chat` drops its cached access on any transport error, 401, 502, 503 or a typed "not on this brain" error, from every call and not only the event stream. Reconnects back off exponentially with jitter instead of every second.
- The Bun entry answers CORS for `/chat/*` as `worker.ts` does.

### 2.7 Restore

Today a session restores only through `BrainApi.start`, which `SessionRunner.send` calls on `SessionNotStartedError`; a client that prompts the brain directly gets a 404. `access` restores too (§2.6). What does not come back: the sandbox's files, queued input, open questions and permissions, running shells, and environment workspaces. Files survive only through E2B pause ([O4](#5-open-decisions)).

### 2.8 Feature flags

A `FeatureFlags` service in core wraps an OpenFeature client in its own domain (`ren`) with `PostHogServerProvider`:

- `posthog-node` with `strictLocalEvaluation: true`. Without it a flag that cannot be evaluated locally costs one PostHog request per evaluation.
- `requestTimeout` of a few seconds, and the flag's default until `isLocalEvaluationReady()`. Until definitions load, every evaluation waits on a fetch.
- `sendFeatureFlagEvents: false`, and `posthog.shutdown()` on release. The provider does not close the client.
- The evaluation context: `targetingKey` is the entity a rollout buckets by (usually the space), plus `spaceId`, `organizationId` and `userId` as properties. No Group Analytics needed. Never name a property `groups` or `groupProperties`; the provider reads them as PostHog groups.
- Without `POSTHOG_PROJECT_KEY` and `POSTHOG_SECRET_KEY`, every flag returns its default. Tests use OpenFeature's in-memory provider.
- Each flag is declared once in code with its default and listed in README.md.
- If PostHog's UI does not offer `spaceId` as a property before one is ingested, create the flag through the API.

## 3. Build order

Each step ships on its own and keeps every built profile working.

| Step | Work                                                                                                 | Done when                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1    | This spec, and the vocabulary in `AGENTS.md`                                                         | Merged                                                                                                  |
| 2    | `Runtime` schema, `space.runtime`, `agent_session.runtime`, `BrainHosts` with one entry (`cell`)     | Sessions pin `cell`; no behaviour change                                                                |
| 3    | `SessionCapabilities.of(runtime)`                                                                    | The app reads capabilities from the runtime                                                             |
| 4    | Ed25519 session tokens with a brain audience (§2.5)                                                  | The cell holds no `CELL_KEYS`; a token for one brain is refused by another                              |
| 5    | `BrainStorage` and `Scheduler` (§2.3)                                                                | The cell suites pass on the new services                                                                |
| 6    | The Bun entry, OpenCode's process profile, native tools and the `docker` host, one session per brain | The cell's Brain and Chat API suites pass against a brain in Docker, and a session edits files natively |
| 7    | Client access and restore on `access` (§2.6, §2.7)                                                   | A replaced brain is found again without a reload                                                        |
| 8    | Space scope (§2.4): the `brain` table, tokens, chat isolation, settings, models and sync             | `docker-space`: two members' sessions share one brain and neither reads the other's session             |
| 9    | The `e2b` host: template, life cycle and pause                                                       | `e2b-space` passes the same suites; an idle space pauses and resumes                                    |
| 10   | `FeatureFlags` with PostHog (§2.8). Independent of steps 2–9                                         | A flag targets one space through local evaluation                                                       |
| 11   | `e2b-space` becomes the default                                                                      | `REN_RUNTIME=e2b-space` in deployed environments                                                        |

## 4. Verified risks

Checked against docs and code, without running spikes.

| ID  | Risk                                       | Verdict             | Evidence and change                                                                                                       |
| --- | ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| R1  | OpenCode's process profile embedded in Bun | Works with changes  | `test/lib/brain.ts` and `test/tool-parity.test.ts` already run it. Needs a second `open` and the native-tools mode (§2.3) |
| R2  | Brain code tied to the Durable Object      | Small               | Storage, alarms, the sync reader, `IdentityTransformStream` and the entries, in five files (§2.3)                         |
| R3  | One OpenCode instance for many sessions    | Works with changes  | OpenCode supports it (`tool-parity.test.ts` J29) and sync reads every session. Ren's cell needs the changes in §2.4       |
| R4  | OpenCode's native modules on Linux         | Works with changes  | `@opencode-ai/pty` needs its Linux package; ripgrep and git from the image (§2.3)                                         |
| R5  | OpenCode in E2B                            | Assumed             | ren-v1 runs it there                                                                                                      |
| R6  | PostHog through OpenFeature under Bun      | Works with settings | Property targeting is local and needs no Group Analytics. Needs the settings in §2.8. Read from source, not run           |
| R7  | Secrets in a sandbox                       | Must fix first      | The brain holds `CELL_KEYS` (§2.5)                                                                                        |
| R8  | A brain URL that changes                   | Works with changes  | Only the event stream drops cached access, and it retries every second (§2.6)                                             |
| R9  | Restore after a lost sandbox               | Partial             | Transcripts restore from Postgres through `start` only; files do not (§2.7)                                               |

## 5. Open decisions

| ID  | Decision                                                  | Proposal                                                                                                                  |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| O1  | What must ship before a space-scoped brain runs anywhere  | Tokens (§2.5) and chat isolation (§2.4)                                                                                   |
| O2  | Which settings stay per session in a space-scoped brain   | Instructions and agents per space; model and `interactive` per session. Fully per-session settings are the hardest change |
| O3  | Secrets the agent can read in a colocated sandbox         | Accept ren-v1's model with short-lived keys scoped to one brain, or run tools as a separate OS user                       |
| O4  | What survives the loss of a sandbox                       | Transcripts from Postgres; files only through E2B pause, so a sandbox that holds work is never killed                     |
| O5  | Where the sandbox host lives                              | A new package, or `cell` split into shared brain code with a workerd and a Bun entry                                      |
| O6  | An organization level between `REN_RUNTIME` and the space | Not until a case needs it                                                                                                 |
| O7  | Who pauses an idle sandbox                                | The brain reports idle to Ren, or E2B's timeout, extended while a session is busy (ren-v1)                                |
| O8  | The cell's future                                         | Keep it supported, or freeze it as experimental                                                                           |
| O9  | A profile whose options change later                      | A new profile key, so pinned sessions keep the old one                                                                    |
| O10 | A pinned runtime this deployment cannot serve             | Fail with a clear error                                                                                                   |

## 6. Tests

- The cell's integration suites (Brain API, Chat API, tool parity) run against each host. The `docker` host runs on CI; `e2b` runs under `test.skipIf` without credentials.
- `packages/e2e/script/serve.ts` takes a profile, and the chat journey runs once per built profile.
- Chat isolation gets its own test: a client token for one session in a space-scoped brain reads nothing of another session.
