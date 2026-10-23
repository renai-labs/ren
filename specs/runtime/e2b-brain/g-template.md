# Piece G: E2B template

Status: spec written. Decisions: E119–E125, E132, E133 (README §6). It also uses E66 (separate providers), E69 (boot poll), E80 (E2B layer), E81 (failure budget), E88 (capacity), E89 (amended by E120), E97 (the brain's own hand) and E105, E117 (lost files).

## Goal

A brain runs in an E2B sandbox made from a template that Ren's deployment picks. The image boots a working brain and its own hand. Each build is tagged with a hash of its inputs, checked by one smoke sandbox, and reported by the brain as its version. A brain moves to a new build when it is outdated and asleep. A brain always reaches Ren at Ren's current address, also after the address changes.

Brains are deployment infrastructure; users never pick a brain template (E121). Users bring compute only as hands, through `EnvironmentProvider`, `EnvironmentTemplates` and `Environments`.

Not in this piece:

- An in-place brain update that keeps the disk (E89, later piece).
- E2B lifecycle webhooks (E124, after M2).
- E2B as a hand provider and the template picker in the app (piece I).
- Default brain scope: already `space` (`db/src/space.sql.ts:23`).

## Layers

```
 build (developer, with the user's OK)                      run
 ┌──────────────────────────────────────────────┐           ┌──────────────────────────────────────────────────┐
 │ bun run template:e2b  (cell/e2b/stage.ts)     │           │ E2B sandbox  ren-brain-dev:<hash>  2 CPU / 2 GB   │
 │  1. stage the dependency closure of           │           │  start.sh (user "user"):                          │
 │     @ren/cell and @ren/executor               │  tag      │   wait for ~/.ren/brain.env (Ren writes it, E80)  │
 │  2. hash = staged files + Dockerfile +        │ ───────▶  │   loop: executor on 127.0.0.1:4100 (own hand)     │
 │     start.sh                                  │           │   loop: brain on :4800 (public, token checks)     │
 │  3. tag exists? skip. else build              │           │  REN_BRAIN_VERSION=<hash> in the image            │
 │  4. smoke: one sandbox → /ren/state ≤ 120 s   │           └──────────────────────────────────────────────────┘
 │  5. print the tag (only on success)           │                  ▲ create (tag)       │ /host/* at Ren's current
 └──────────────────────────────────────────────┘                  │                     ▼ address (E119)
                                    E2B_TEMPLATE=ren-brain-dev:<hash> → Ren (BrainLifecycle, SandboxProvider.layerE2B)
```

## Image

| Part            | Value                                                                                             | Source                    |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| Base            | `oven/bun:<version>`; the version comes from `packageManager` in the root `package.json`          | E122                      |
| System packages | `ripgrep git procps ca-certificates curl`                                                         | `cell/e2b/e2b.Dockerfile` |
| Ren code        | the staged dependency closure; `bun install --frozen-lockfile --production` for cell and executor | E122                      |
| OpenCode        | npm dependencies of `@ren/cell` (`@opencode/*`)                                                   | `cell/package.json`       |
| Version         | `REN_BRAIN_VERSION=<hash>`; the brain reports it on `/ren/state` and every `/host` call           | E120                      |
| Processes       | `start.sh`: executor loop on 127.0.0.1:4100, brain loop on :4800, as user `user`                  | E7, E97                   |
| Size            | 2 CPU, 2 GB                                                                                       | E124                      |
| Secrets         | none; `brain.env` holds `REN_URL`, brain id, generation, public keys (E69)                        | E80                       |

## Services and contracts

### Ren's address (E119)

- The server token (piece C, E43) gains a claim `ren`: Ren's current address, from `REN_URL` in Ren's config.
- Brain: a `RenAddress` service holds the current address. It starts from `REN_URL` in `brain.env`, then from `brain.db`. Each server token with a newer `ren` replaces it and saves it in `brain.db`. `HostToken`, `ModelRefresh`, `HotReload` (pull) and `Sync` read it for every call; none of them keeps its own copy.
- Ren boot: for each brain with `phase = ready` and `keep_alive_until` in the future, Ren sends `GET /ren/state` with a server token. A failure is logged and ignored; the next access or wake carries the address again.

### Build and version (E120, E122)

- `SandboxProvider` gains `template: string | null`: the build it creates sandboxes from (`layerE2B`: `E2B_TEMPLATE`; `layerLocal`: null). `create` stores it on the `brain` row (`brain.template`).
- `BrainLifecycle`, step `resuming`: when `brain.template` is not null and differs from `provider.template`, the step goes to `replacing` instead of `connect`. Only `resuming` does this, so a running or busy brain is never replaced for its build (ren-v1 INV-16). A brain that keeps running moves when it next pauses (keep-alive, E72).
- `host-api` changes stay readable by the oldest brain still running (ren-v1 skew rule 1).
- `cell/e2b/stage.ts`, as E122: closure of `workspace:*` dependencies, Bun version from `packageManager`, hash, skip an existing tag, smoke sandbox (`owner=ren-v2-dev`, test `brain.env`, `GET /ren/state` within 120 s, kill), print the tag and whether the tree had uncommitted files.

### Dead sandbox on access (E123)

- `Session.access` takes `unreachable?: boolean`. With `true` and `phase = ready`, Ren asks the provider for `status` before it answers:
  - `gone` → `replacing` → `starting { phase: "replacing" }`. Only a gone sandbox is replaced.
  - `paused` → `resuming` (connect, then `/ren/wake`) → `starting { phase: "resuming" }`. A paused sandbox is never replaced here.
  - `running` → `ready` with the same URL (a network failure on the app's side).
- The chat runtime sets `unreachable: true` on the access that follows a failed connection to the brain's URL.

### Wake timeout (E132)

- When `/ren/wake` is not confirmed within 60 s (E73), Ren asks `GET /ren/state`. An answer → `ready`, and a warning names the slow wake. No answer → `replacing`. A running brain is never replaced only because its wake was slow (ren-v1 DS-L1, OI-1).

### Brain host seam (E125)

```
 Brains (host-neutral)                             BrainHost (one layer per deployment)
  start/send: StartRun on every host      ──▶       target(brain)       → url, generation | starting | failed
  client tokens, prepare, flush, retry              access(brain)       → ready | starting | failed
  host-token checks, pull, model grants             ensure(brain)         sandbox: lifecycle run · cell: nothing
  accessEnvironment ─┐                              observe(brain, …)     sandbox: keep-alive (E72) · cell: nothing
                     │                              unavailable(brain)    sandbox: status check (E123) · cell: nothing
                     ▼                              retry(brain)          sandbox: reset failures (E81) · cell: nothing
 Environments: template → its environment           hand(brain)           sandbox: Some(127.0.0.1 executor) · cell: None
               none → hand(brain)                   layers: layerSandbox (SandboxProvider: e2b, local)
               else DEFAULT_ENVIRONMENT                     layerCell (CELL_URL: workerd, Cloudflare DO, celld)
               else no tools
```

- `Brains` takes the host-neutral body of today's `BrainHost.make` (`core/src/brain-host.ts`). `BrainHost` takes today's private `Locator` (`brain-host.ts:113-123`) as its interface.
- `StartRun` (E68) runs on every host. `layerCell` no longer drops a failed start (`brain-host.ts:509`).
- Not in M2 (E134). `DEFAULT_ENVIRONMENT` is deployment config: `{ provider, config }` for one `EnvironmentProvider`, not an org row. `Environments` provisions and pools it like a template's environment (`sessions_per_environment`). Unset and no own hand: the chat has no tools.
- One delivery contract for every sender (E133): the sender picks the message id; `Brains` ensures the brain is ready and calls `brain.send`; the brain restores on first request and skips a known id. Ren's own senders (crons, webhooks, channels) use a durable `send:<messageId>` run (E77), built with the first such sender.
- With piece I (E135), the E2B REST calls move from `sandbox-provider/e2b.ts` to one shared module; `SandboxProvider.layerE2B` uses it, and so will an E2B `EnvironmentProvider` (piece I).

## Behaviour

| Event                                          | Result                                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| New build, brains asleep                       | Next access: `resuming` sees an old tag → `replacing` → `creating` with the new tag. Chats restore on first use (piece E); users see E117's notice. |
| New build, brain running or busy               | Keeps running on its build. Moves at its next wake after a pause.                                                                                   |
| `E2B_TEMPLATE` names a tag that does not exist | `create` fails (`SandboxProvider.Failed`) with the tag in the message; 3 in a row give `failed` (E81).                                              |
| Tunnel (Ren's address) changes                 | Running brains learn it at Ren's boot; asleep brains at their wake (`/ren/wake` carries a server token). No replace.                                |
| Sandbox killed by E2B                          | The user's next access with `unreachable` replaces it at once (E123). Unopened chats: a failed Ren call or the daily cleanup (E82).                 |
| Build with a broken boot                       | The smoke sandbox does not answer within 120 s; the script prints no tag, so Ren never uses it.                                                     |

## Contract changes

| Package    | Change                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host-api` | Server token claims gain `ren` (piece C's `BrainToken`).                                                                                                                      |
| `db`       | `brain.template text`.                                                                                                                                                        |
| `core`     | `SandboxProvider.template`; `BrainLifecycle` resume check; Ren-boot ping of running brains; `Session.access` input `unreachable`.                                             |
| `protocol` | `Session.access` input `unreachable?: boolean`. Run `bun run generate`.                                                                                                       |
| `cell`     | `RenAddress` used by `HostToken`, `ModelRefresh`, `HotReload`, `Sync`; reads `ren` from server tokens; version from `REN_BRAIN_VERSION` (else `cell/package.json`).           |
| `cell/e2b` | `stage.ts` (E122); Dockerfile takes the Bun version as a build argument and sets `REN_BRAIN_VERSION`.                                                                         |
| `chat`     | `unreachable: true` on the access after a failed connection.                                                                                                                  |
| `core`     | `Brains` (host-neutral) and `BrainHost` (seam: `layerSandbox`, `layerCell`) (E125); `Environments` uses `BrainHost.hand`, then `DEFAULT_ENVIRONMENT`; shared E2B REST module. |
| `server`   | `main.ts`: Ren-boot ping after the server listens. Picks `BrainHost.layerCell` or `layerSandbox`, and reads `DEFAULT_ENVIRONMENT`.                                            |

## Lifecycle states

| State                      | What happens                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| asleep                     | The wake carries Ren's address (E119). An outdated build is replaced instead of resumed (E120).                                      |
| waking                     | Unchanged (E73). The wake's server token sets the address before the pull.                                                           |
| mid-turn                   | Never replaced for its build. Calls to Ren use the newest address.                                                                   |
| down (Ren)                 | Brains keep the last address. After Ren comes back at a new address, running brains get it from the boot ping, others at their wake. |
| restarting (brain process) | The address comes from `brain.db`, not from `brain.env`.                                                                             |
| gone                       | Found on the user's next access (E123), a failed Ren call, or the daily cleanup.                                                     |

## Tests

Write each test first. Each test must fail before its change. No mocks.

| #   | Package and file                    | Test                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `cell/test/ren-address.test.ts`     | A server token with `ren` = B on a brain started with `REN_URL` = A: the next pull and sync go to B. After a process restart, they still go to B (E119).                                                                                                                                                   |
| 2   | `core/test/brain-lifecycle.test.ts` | Ren restarts with a new address: each brain with a valid keep-alive gets `GET /ren/state`, and its next pull reaches the new address without a replace (E119).                                                                                                                                             |
| 3   | `core/test/brain-lifecycle.test.ts` | A paused brain with `brain.template` t1 while the provider's is t2: access replaces it and the new sandbox has t2. A running brain with t1 is not replaced (E120, INV-16).                                                                                                                                 |
| 4   | `core/test/brain-lifecycle.test.ts` | `create` with a tag the provider rejects fails with that tag in the reason; the third failure gives `failed` (E81).                                                                                                                                                                                        |
| 5   | `core/test/session.test.ts`         | `Session.access` with `unreachable: true` on a `ready` brain whose process is gone returns `starting { phase: "replacing" }` in the same call; a `ready` brain that is paused (SIGSTOP) returns `starting { phase: "resuming" }` and wakes without a replace; with a live brain it returns `ready` (E123). |
| 6   | `chat/test/connection.test.ts`      | A failed connection to the brain's URL makes the next access carry `unreachable: true`; a successful one does not (E123).                                                                                                                                                                                  |
| 7   | `cell/test/stage.test.ts`           | The staged files include every `workspace:*` dependency of `@ren/cell` and `@ren/executor`, followed through each level (INV-105). A changed staged file changes the hash; an unchanged tree gives the same hash (E122).                                                                                   |
| 8   | live, skipped without `E2B_API_KEY` | `bun run template:e2b`: the smoke sandbox answers `/ren/state`, is killed afterwards, and the tag is printed. A second run with no change skips the build (E122).                                                                                                                                          |
| 9   | live, skipped without `E2B_API_KEY` | Ren with address A creates a brain; Ren restarts with address B; the brain syncs to B without a replace (E119).                                                                                                                                                                                            |
| 10  | live, skipped without `E2B_API_KEY` | A space brain with 5 chats, 2 running shells: log peak memory and CPU of the sandbox (E124).                                                                                                                                                                                                               |
| 11  | `core/test/brains.test.ts`          | The `Brains` suite (start, send, access, pull) runs once on `BrainHost.layerCell` and once on `layerSandbox` (E125).                                                                                                                                                                                       |
| 12  | `core/test/brains.test.ts`          | On `layerCell`, a start while the cell answers 503 is delivered once the cell answers; it is not dropped (E125, today `brain-host.ts:509`).                                                                                                                                                                |
| 13  | `core/test/brains.test.ts`          | A chat without a template: on `layerSandbox` it gets the brain's own hand; on `layerCell` `accessEnvironment` fails with `EnvironmentNotFoundError` (E125). The `DEFAULT_ENVIRONMENT` case comes with E134.                                                                                                |
| 14  | `core/test/brain-lifecycle.test.ts` | A wake that never answers while `GET /ren/state` answers: the brain becomes `ready` and is not replaced. Neither answers: it is replaced (E132).                                                                                                                                                           |

Edge cases from ren-v1 that these tests cover: INV-16 (3), INV-105 (7), INV-10 and INV-2 (8: the image is built from the staged tree and must boot before its tag is used), DS-L1 (no replace of a running brain for its build, 3).
