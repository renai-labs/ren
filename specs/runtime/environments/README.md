# Brains, hands and machines: pending

Status: not built. Today a brain runs in an E2B sandbox and runs its tools in the same sandbox. Environment templates, environments, the Docker provider and `Environments.bind` exist (`core/src/environment-templates.ts`, `core/src/environments.ts`, `core/src/environment-provider/docker.ts`), but no code picks a template for a chat. This spec replaces the draft in PR #197.

References:

- [`references/decisions.md`](references/decisions.md): each decision (EN1–EN47) and its reason.
- [`references/chaos.md`](references/chaos.md): the invariants (I1–I13), the chaos test list, and how the tests run.
- [`references/lessons.md`](references/lessons.md): lessons from an earlier version of Ren that this design answers.
- [`references/ecs-brain.md`](references/ecs-brain.md): what OpenCode runs on the brain machine, and the spike for brains on ECS.
- [`references/naming.md`](references/naming.md): the naming rules for this work.

Words:

| Word             | Meaning                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Brain            | The harness (OpenCode today) and Ren's code around it. It serves one chat or every chat of a space (`brainScope`).                      |
| Hand             | The machine where a chat's file and shell tools run. Its executor serves the Environment API. In code: environment.                     |
| Machine          | A computer that runs a brain, a hand, or both: an E2B sandbox, a Docker container, a Durable Object, a laptop.                          |
| Co-located       | The brain and its hand are one machine. The brain calls the executor at `127.0.0.1:4100`.                                               |
| Remote           | The hand is another machine. The brain calls it at a URL that Ren gives, such as `https://4100-<sandbox>.e2b.app`.                      |
| Managed machine  | A machine whose existence Ren controls: E2B, Daytona, Docker, a local process, an ECS task, a Durable Object.                           |
| Attached machine | A machine whose existence Ren does not control. It connects to Ren: a laptop, a phone.                                                  |
| Brain provider   | Makes brain machines of one kind. Few, and each one works with Ren's egress. Ren's deployment registers them.                           |
| Hand provider    | Makes hand machines of one kind. In code: `EnvironmentProvider`.                                                                        |
| Template         | An org admin's saved hand config: provider, provider config (packages, build commands, CPU, memory), networking. `EnvironmentTemplate`. |
| Bundle           | Ren's own code for a machine: the brain bundle and the executor bundle. Each has a version, the hash of its files.                      |
| Asleep           | A paused machine. Its memory and files stay.                                                                                            |
| Replace          | Ren destroys a managed machine and makes a new one with generation + 1. The workspace files on it are lost.                             |

## 1. What it does

1. A space chooses a brain provider and a hand. Today the only brain provider is `e2b`, and the app hides the choice.
2. The hand is one of:
   - **co-located**: the brain's own machine. With a template, the brain machine runs from the template's image. Without one, it runs from Ren's system image.
   - **remote**: machines of a template, which up to 8 chats share.
   - **none**: no file or shell tools.
3. An org admin creates a template. Ren builds its image when the admin saves it.
4. A change to a template or to a space reaches a machine when the machine wakes from sleep.
5. A Ren deploy updates Ren's code on each machine at its next wake, in place. The files stay.
6. Every machine recovers without a person: from a crash, a hang, an E2B outage, a Ren outage and a Ren restart.

Done when:

1. An admin creates an E2B template with apt `ffmpeg`, npm `typescript` and `limited` networking that allows `api.example.com`. A member selects it as the co-located hand of a space. A chat runs `ffmpeg -version` and `tsc -v`, reaches `api.example.com`, and cannot reach `example.org` or an ngrok host.
2. The admin adds pip `requests`. After the brain sleeps and wakes, the chat runs `python -c "import requests"`, and its earlier files are still there.
3. Ren deploys a new brain bundle. After the next wake, the chat's files and a background `python -m http.server` are still there.
4. The same template as a remote hand passes 1, and revert, the workspace panel and long tool outputs work on the hand.
5. Every row of [`references/chaos.md`](references/chaos.md) passes, and every invariant holds in the seeded runs and the 1-hour soak.

## 2. Model

### Settings flow

```
 ┌──────────────────────────────┐   canColocate = true    ┌──────────────────────────────────┐   optional    ┌──────────────────────────────┐
 │                              │ ──────────────────────> │                                  │ ────────────> │                              │
 │  1. brain provider           │                         │  2a. co-located hand             │               │  template of the same        │
 │     e2b (today)              │                         │      the brain's own machine     │               │  provider: packages, CPU,    │
 │     ecs, durable object,     │                         │                                  │               │  memory, networking          │
 │     laptop (later)           │                         │      no template: system image   │               │                              │
 └──────────────────────────────┘                         └──────────────────────────────────┘               └──────────────────────────────┘
                │
                │   canColocate = false, or the space picks remote
                ▼
 ┌──────────────────────────────┐   pick one              ┌──────────────────────────────────┐
 │                              │ ──────────────────────> │                                  │
 │  2b. remote hand             │                         │  template of any hand provider   │
 │      or none                 │                         │  e2b, docker; laptop, phone      │
 │                              │                         │  (later)                         │
 └──────────────────────────────┘                         └──────────────────────────────────┘
```

### Seams

Each seam is an Effect service with layers. Only a composition root picks a layer. Core never asks which vendor or which harness it has (EN11).

```
 ┌──────────────────────────────┐   BrainApi (host-api)         ┌──────────────────────────────┐   Environment API      ┌──────────────────────────────┐
 │                              │   start, send, wake           │                              │   files, spawn, token  │                              │
 │  Ren server (core)           │ ────────────────────────────> │  Brain                       │ ─────────────────────> │  Hand                        │
 │                              │                               │                              │                        │                              │
 │  Brains → MachineAccess      │ <──────────────────────────── │  harness adapter             │                        │  executor                    │
 │  Environments → MachineAccess│   RenHostApi: pull, sync      │  + its hand bridge           │                        │                              │
 │                              │   (through the egress)        │                              │                        │                              │
 └──────────────────────────────┘                               └──────────────────────────────┘                        └──────────────────────────────┘
```

| Seam                       | Contract                                                                                       | Built in this work               | Later                                |
| -------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------ |
| `MachineAccess`            | `ensure`, `access`, `release`, `status`, `retire` for one machine (EN1)                        | brain machines and hand machines |                                      |
| Managed family             | `MachineLifecycle` on a `MachineProvider` with flags (EN5, EN6)                                | E2B, Docker, local               | Daytona, ECS, Durable Object         |
| Attached family            | The device connects out to Ren; Ren relays (EN7)                                               | nothing                          | laptop, phone, and their policies    |
| Transport                  | direct URL, `127.0.0.1`, or relay through Ren (EN8)                                            | direct URL and `127.0.0.1`       | relay                                |
| Secrets mode               | placeholders through the egress, real tokens, or none (EN9)                                    | placeholders                     | real tokens, none                    |
| Harness adapter and bridge | One adapter per harness; its bridge connects the harness's tools to the Environment API (EN11) | OpenCode                         | Pi                                   |
| Hand features              | `executor.hello` lists what the hand can do; the bridge builds the tool list from it           | nothing                          | a phone with files and no shell      |
| Transcript                 | Ren's Postgres transcript owns resume (EN10)                                                   | as today (OpenCode rows)         | harness-neutral rows (e2b-brain E30) |

### Machine families

| Family   | Who controls its existence | How Ren reaches it            | States                                                                                              |
| -------- | -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Managed  | Ren                        | a URL from the provider       | `creating`, `booting`, `ready`, `resuming`, `updating`, `waking`, `replacing`, `capacity`, `failed` |
| Attached | the device's owner         | a connection the device opens | `offline`, `online`, `revoked` (later)                                                              |

People and core see one status for every machine: `starting`, `ready`, `asleep`, `offline`, `capacity` or `failed`.

### Managed machine lifecycle

One state machine serves brain machines and remote hand machines. A co-located hand has no row of its own: it is up when its brain machine is `ready` (EN4).

```
 ┌────────────┐   provider.create       ┌────────────┐   ready check passes      ┌────────────┐
 │            │   → binding, url        │            │   within 120 s            │            │
 │  creating  │ ──────────────────────> │  booting   │ ────────────────────────> │   ready    │
 │            │                         │            │                           │            │
 └────────────┘                         └────────────┘                           └────────────┘
       ▲                                                                                 │
       │   generation + 1, destroy the old machine,                                      │   keep-alive ended:
       │   busy chats interrupted                                                        │   the provider pauses it
 ┌────────────┐                         ┌────────────┐                           ┌────────────┐
 │            │   outdated in a way     │            │   provider.connect        │            │
 │ replacing  │ <────────────────────── │  resuming  │ <──────────────────────── │  asleep    │
 │            │   in-place cannot fix,  │            │   on the next access      │            │
 └────────────┘   or Gone               └────────────┘                           └────────────┘
                                              │
                                              │   bundle or packages outdated
                                              ▼
                                        ┌────────────┐   new version answers     ┌────────────┐   wake call       ┌────────────┐
                                        │            │   within 120 s            │            │   within 60 s     │            │
                                        │  updating  │ ────────────────────────> │  waking    │ ────────────────> │   ready    │
                                        │            │                           │            │                   │            │
                                        └────────────┘                           └────────────┘                   └────────────┘
   plus: capacity (wait for the provider's Retry-After), failed (timed retry and the Retry button)
```

Ready check: a brain answers `brain.state` and has pulled from Ren (`core/src/brain-lifecycle.ts:239-276`). A hand's executor answers `executor.hello`.

## 3. Rules

### Providers and families

1. `MachineAccess` is the only contract that `Brains` and `Environments` call for a machine. Each family meets it (EN1).
2. A managed provider has `create(image, size, network, env, labels)`, `connect`, `keepAlive`, `status`, `lastSample`, `list`, `destroy` and an optional `build`. Its flags are `canPause`, `canSample`, `canEgress`, `canLimitHosts`, `canColocate` and `canMount`. A step that a provider does not have does nothing: a Durable Object's `create` names it by id, and it never pauses (EN6).
3. `SandboxProvider` and `EnvironmentProvider` become this one contract. Core never branches on a provider's name.
4. Each managed machine carries labels: Ren's owner name, the kind (`brain` or `hand`), its id, its generation, its organization and its space. Every step finds its earlier work by kind, id and generation before it acts, so a step that runs twice makes one machine (EN34).
5. The deployment registers its brain providers and hand providers. A space picks one of each. Ren refuses to start when a space or template names a provider that the deployment does not register; the error lists them (EN24).
6. An attached machine connects out to Ren, and Ren relays the Brain API and the Environment API over that connection. Nothing in this work builds it (EN7).

### Space settings

1. `space.hand` is `{ placement: "colocated", environmentTemplateId: null | id }`, `{ placement: "remote", environmentTemplateId }` or `{ placement: "none" }`. New spaces get co-located with no template. It replaces the `SpaceEnvironmentTemplate` link table.
2. Co-located is possible only when the space's brain provider has `canColocate`, and its template must be of that provider (EN3). A brain provider change that makes co-located impossible is refused until the space picks remote or none (EN24).
3. A space cannot pick a template that has never built (`image` is null).
4. `SessionRunner.create` reads `space.hand` once and puts it in `Session.StartInput`. No other caller builds it.
5. Only space members change `space.hand`, the brain provider and `brainScope`. An org admin joins a shared space first (EN45).
6. Only org admins create, edit and archive templates. Archiving a template that a space uses is refused, with the list of spaces (EN24).

### When a change applies

1. A machine is outdated when its image, bundle, provider or placement differs from what its space wants now. Ren checks this only in `resuming`, so a machine changes only when it wakes from sleep. Several changes before a wake count as the last one (EN21).
2. In `resuming`, Ren updates in place when it can: a newer bundle, or a template change that only adds packages or build commands. The files stay (EN22, EN27).
3. Ren replaces the machine for a new CPU or memory size, a removed package, a different provider, a placement change, or an in-place step that failed 3 times.
4. Hand → none: the plugin refuses file and shell tool calls of existing chats at the next pull, with "this space has no hand now". None → hand: only new chats get tools, because the brain fixes a chat's workspace link when it creates the chat (`cell/src/harness/opencode/harness.ts:167-180`) (EN23).
5. A change to `brainScope` applies to new chats only.

### Images, bundles and templates

1. An image holds the system and tools only: OS, Bun, rclone, and the template's packages. It holds no Ren code (EN26).
2. Ren's code is two bundles: brain and executor. Ren builds them at deploy and serves them by hash. A machine pulls each bundle from Ren with a token that Ren signs for it, checks the sha256, and unpacks it to `/opt/ren/<hash>`. It stops the old process only after the new one is unpacked.
3. The current bundle is one value per kind in Postgres. A server sets it only to a newer build. A server never moves a machine to an older bundle (EN29).
4. The brain and the executor have separate versions. Ren restarts only the process whose version changed, so most deploys keep background processes (EN27).
5. Ren cancels a restart when a turn started after its decision, and waits until the brain is idle again (I13).
6. When the OpenCode version changes, in either direction, the brain flushes sync, deletes its local OpenCode database, and restores it from Postgres. The files stay (EN28).
7. Every command that Ren runs on an E2B machine through E2B's process API sets `timeout 0`. E2B's default stops a command after 60 s.
8. A template has `provider`, `config`, `networking` and `sessionsPerEnvironment` (default 8, used only by remote). The E2B config is `cpuCount`, `memoryMiB`, `packages { apt, npm, pip, go }` and `buildCommands` (at most 50, each at most 4096 characters). The sizes are 1/1024, 2/2048 (default), 4/4096, 6/6144 and 8/8192.
9. Saving a changed config queues a build. Each template runs at most one build. A save during a build waits, and when the build ends, the newest config builds. A result counts only while the template still has the config that it built (EN30).
10. A template keeps `build_status` (`queued`, `building`, `ready`, `failed`), `image` (the last `ready` image) and `build_error`. Machines use the last `ready` image while a build runs or after it fails. A build that runs longer than 45 min fails. At start, Ren builds again a template that stays `queued` or `building` without a running build.
11. The E2B build starts from Ren's system image and adds one `RUN` per package manager, then one `RUN` per build command. CPU and memory are set at build time, because E2B fixes them per template.

### Networking

1. `networking` is `{ type: "unrestricted" }` or `{ type: "limited", allowPackageManagers, allowMcpServers, allowedHosts }`, with at most 100 `allowedHosts`.
2. `limited` needs a provider with `canLimitHosts`. E2B has it; Docker does not.
3. Core makes the host list: `allowedHosts`; the package manager hosts when `allowPackageManagers` is set; the hosts of the space's MCP servers when `allowMcpServers` is set; the hosts of the credentials that the space can use, always. For `*.example.com`, the list also has `example.com`.
4. A co-located machine also runs the brain, so its list also has Ren's own hosts: the server, inference and the egress (EN40).
5. E2B gets the list as `allowOut`, with `denyOut: ["0.0.0.0/0"]` and the egress proxy. E2B checks the HTTP `Host` and the TLS SNI before the traffic reaches the egress.
6. Every `connect` sends the current list, so a change reaches a running machine at its next access. E2B refuses a network update of a paused sandbox, so Ren never sends one before `connect`.
7. The egress keeps only its credential checks.

### Remote hands

1. Up to `sessionsPerEnvironment` chats share one hand machine. A chat whose turn ends calls `release`. A `release` while another chat on the machine is busy does not shorten the keep-alive.
2. Every hand uses one folder per chat: `/home/user/workspace/<sessionId>`.
3. Ren's server owns hand machines. Ren's OpenCode workspace driver stays thin: it asks Ren for `{ url, token }` (EN12).
4. When the brain cannot reach its hand, it says so in its next `access`. Ren then checks that machine: Gone or frozen → replace; running → keep and log (EN15).
5. A brain that boots with `REN_HAND_PLACEMENT=remote` replaces four OpenCode services so they run on the hand: `ToolOutput`, `FileSystem`, `Vcs` and `Snapshot`. A co-located brain keeps OpenCode's own services and today's three replacements (workspace driver, `rg`, `RenShell`; `workspace-driver.ts:81-95`). All of these live in one module of the OpenCode adapter (EN13, EN14).

### Keep-alive and detection

1. Each `access` keeps a machine awake for 10 min. Each pull with progress during a turn keeps it awake for 30 min. A turn with no progress for 30 min gets no more time (today, `brain-lifecycle.ts:81-93`).
2. While the executor reports a background process, Ren keeps the machine awake, up to 2 h after the last turn (EN25).
3. Ren checks a machine when a call to it fails, and in the hourly cleanup. There is no sweeper (EN16).
4. A brain that gives no answer for 5 min, after `start.sh` restarted it, is replaced, also when its machine runs (EN17).
5. An unknown answer never destroys a machine: a provider error, an unreadable status or an unreadable version means keep (I11). Nothing is destroyed because a list does not show it (I12).

### Failure and recovery

1. Three failures in a row, of any kind, put a machine in `failed` (EN18).
2. Ren retries a `failed` machine 10 min after the failure, then after 30 min, then every hour. The Retry button stays (EN19).
3. A forced replace (Gone, frozen, silent for 5 min) marks the busy chats interrupted. After the replace, each of them continues once with the message: "The machine was replaced during your turn. Workspace files are gone. Check the state before you repeat an action." (EN35)
4. Right after a replace, Ren restores the chats that have waiting messages, so the messages are sent (EN36).
5. Ren sends a PostHog error report, with the reason, when a machine enters `failed` or `capacity`, at a forced replace, and when a build fails (EN38).

### Ren server

1. One Ren server runs. `DurableRunner` uses Effect's `SingleRunner`, which is single-process. Ren gets a memory alarm and a load test (EN31).
2. Environment tokens last 15 min. While Ren is down, a tool call uses the token it has. After Ren is back, the next call gets a new token within 30 s (EN32).
3. Version N and version N-1 work together in both directions: Ren and the brain, and the brain and the executor (EN33).

### Sync

1. A message larger than the sync limit (8 MB) syncs as a short stand-in, "output too large, not saved", and the rest of the chat keeps syncing (EN37).

## 4. Contract changes

| Where                                  | Change                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema/space.ts`                      | `hand` and `brainProvider` in `Info` and `UpdateInput`.                                                                                                                                                      |
| `schema/session.ts`                    | `StartInput.environmentTemplateId` becomes `hand`.                                                                                                                                                           |
| `schema/environment-template.ts`       | `networking`; `Info` gets `buildStatus`, `image`, `buildError`.                                                                                                                                              |
| `schema/space-environment-template.ts` | Removed, with its protocol group, core service, policy and table.                                                                                                                                            |
| `db`                                   | `space`: hand placement, template, brain provider. `environment_template`: networking, build fields. `brain` and `environment`: image, bundle versions, retry time. A table for the current bundle per kind. |
| `core/machine-access.ts`               | New: the outer contract.                                                                                                                                                                                     |
| `core/machine-provider.ts`             | New: the managed provider contract. `SandboxProvider` and `EnvironmentProvider` move to it. E2B REST calls live in one module.                                                                               |
| `core/machine-lifecycle.ts`            | New: the managed state machine, taken out of `BrainLifecycle`.                                                                                                                                               |
| `core/brain-host.ts`                   | A registry of brain providers instead of one `SANDBOX_PROVIDER`.                                                                                                                                             |
| `core/environments.ts`                 | Remote hand machines on `MachineLifecycle`; the "hand unreachable" check.                                                                                                                                    |
| `core/environment-templates.ts`        | One build at a time per template; archive refused while in use.                                                                                                                                              |
| `environment-api`                      | The executor reports its running background processes. Later: a feature list in `hello`.                                                                                                                     |
| `cell`                                 | One OpenCode hand-bridge module chosen by `REN_HAND_PLACEMENT`; the plugin refuses tools of a space with no hand.                                                                                            |
| `cell/e2b`, executor image             | Images without Ren code; `start.sh` pulls bundles and restarts one process at a time.                                                                                                                        |
| `brain/opencode-sync.ts`               | A stand-in for a message over 8 MB.                                                                                                                                                                          |
| `server`                               | A bundle route; the start check for missing providers.                                                                                                                                                       |
| `app`                                  | Settings → Environments; space settings for the hand (the brain provider choice stays hidden while one exists).                                                                                              |
| `infra/aws`                            | A memory alarm for the server.                                                                                                                                                                               |

Run `bun run generate` after the protocol changes.

## 5. Pull requests

Each pull request is based on the one before it. Each one passes its own rows of [`references/chaos.md`](references/chaos.md) live before it merges. The full suite runs once more before the last merge.

| #   | Branch                      | Change                                                                                                  |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `hand-design-spec`          | This spec.                                                                                              |
| 2   | `machine-provider-contract` | `MachineAccess` and the managed provider contract. No change in behaviour.                              |
| 3   | `machine-lifecycle`         | `MachineLifecycle`, taken out of `BrainLifecycle`. No change in behaviour.                              |
| 4   | `chaos-invariants`          | The seeded runs that check I1–I13, and the restore measurement.                                         |
| 5   | `lifecycle-recovery`        | Timed retry, the 5-min replace, PostHog reports.                                                        |
| 6   | `turn-recovery`             | Interrupted turns continue once, waiting messages after a replace, the 8 MB stand-in.                   |
| 7   | `background-keep-awake`     | Background processes keep a machine awake up to 2 h.                                                    |
| 8   | `bundle-serving`            | Bundles built, served by hash, and the current version in Postgres.                                     |
| 9   | `bundle-update`             | Images without Ren code; `updating`; the OpenCode version rule.                                         |
| 10  | `brain-provider-registry`   | Brain providers with `canColocate`; the space's choice, hidden.                                         |
| 11  | `space-hand-choice`         | `space.hand`, `SessionRunner`, tools refused with no hand, the refusals of §3.                          |
| 12  | `template-image-build`      | Networking, build status, one build at a time, E2B builds from the system image.                        |
| 13  | `colocated-template-brain`  | The brain machine from the template image; Ren's hosts in `limited`; packages in place.                 |
| 14  | `environments-settings-ui`  | Settings → Environments and the space's hand settings.                                                  |
| 15  | `remote-e2b-hand`           | Remote hand machines on `MachineLifecycle`, seats, the unreachable check, the remote option in the app. |
| 16  | `remote-hand-services`      | `REN_HAND_PLACEMENT`; `ToolOutput`, `FileSystem` and `Vcs` on the hand.                                 |
| 17  | `remote-hand-snapshot`      | `Snapshot` on the hand: revert works on a remote hand.                                                  |
| 18  | `soak-and-alarms`           | The 1-hour soak, the memory alarm, the load test.                                                       |

## 6. How to build it

These rules apply to every pull request of §5, together with the root `AGENTS.md`, the `AGENTS.md` of each package that a change touches, and the `effect` skill.

### Open source

1. This repository is public. Spec, code, tests, fixtures, logs, commit messages and pull request descriptions contain no secrets, keys, tokens, internal host names, account ids, customer data, personal data, production data, or content of private repositories.
2. Secrets reach a process only through its environment, set from the deployment's secret store. They never appear in a file in the repository.
3. A test that needs data shaped like production uses data that it makes, with the same shape (sizes and counts). Production data never enters the repository.

### Design first

1. Classify each problem before you change code: design flaw, code bug, missed edge case, or test bug.
2. Fix a design flaw in the design. Stop, change this spec, then change the code. Do not work around a design flaw in code. Find design flaws while you build, not after a review.
3. If the spec does not fit the code, stop and change the spec first.
4. Each change traces to a rule, a contract change or a chaos row of this spec. No drive-by refactors or renames.

### Simple and minimal

1. Keep the code simple to read and as small as possible.
2. Swappable parts stay behind their seam (§2). Core never asks which vendor, provider or harness it has. A provider says what it can do with a flag; core reads the flag.
3. No speculative abstraction. Add a contract method or a flag only with its first real user.
4. Do not handle a case that an earlier check already makes impossible. Validate input once at its boundary, then trust its type.
5. Do not write what Effect, Bun, Node or OpenCode already give. Read their source first (`repos/effect`, OpenCode's repository). Examples: `Schedule` and `Effect.retry` for retries, `Clock` and `TestClock` for time, `Semaphore`, `RcMap` and `Cache` for shared resources, `Schema` for every boundary, `Config` for settings, `DurableRunner` (Effect `Workflow`) for runs that survive a restart, `Bun.file`, `Bun.spawn` and `Bun.CryptoHasher` for files, processes and hashes, and OpenCode's own services on a co-located brain (EN13).
6. Before a new pattern or helper, look for one in this repository, then in `repos/effect` and OpenCode.

### Names

Follow [`references/naming.md`](references/naming.md). The repository's `AGENTS.md` wins over it. For this work:

1. Full words: `environment`, not `env`, in new names. `terminal`, not `pty`.
2. One word for one meaning: "machine" is a computer that runs a brain or a hand; "hand" is where tools run (`environment` in code); "sandbox" is a machine at a provider; "seat" is one chat on a remote hand.
3. Booleans read as conditions and match their neighbours: `canColocate` beside `canMount`.
4. A `Duration` carries its unit: `keepAlive(binding, duration)`. A number has the unit in its name: `timeoutMs`.
5. Errors are named after what happened: `NotReady` for a template with no `ready` image, not `BuildError`.

## 7. Later

1. A sweeper that watches each brain's pulls, to find a silent brain before anyone uses it.
2. An "Apply now" button that replaces a machine at once.
3. A maximum wait for a space that never sleeps.
4. More than one Ren server: a runner with health checks across servers.
5. The egress is one EC2 instance: a second one, and a memory alarm.
6. Attached machines: the relay, the device's states, and who may use a device and which secrets reach it.
7. Daytona, ECS and Durable Object brain providers. For ECS, see [`references/ecs-brain.md`](references/ecs-brain.md).
8. A harness-neutral transcript (e2b-brain E30), then Pi.
9. A feature list in `executor.hello`, and a tool list built from it.
10. UDP DNS to `8.8.8.8` leaves outside the firewall and the egress (E2B docs). Close it with `dnsServers` and a resolver that Ren runs.
