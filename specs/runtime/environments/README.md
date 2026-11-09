# Brains, hands and machines: pending

Status: in progress. Today a brain runs in an E2B sandbox and runs its tools in the same sandbox. Environment templates, environments and the Docker provider exist (`core/src/environment-templates.ts`, `core/src/environments.ts`, `core/src/machine-provider/docker.ts`). A space picks its hand in `space.hand`, and a chat keeps the hand of its space at creation (`core/src/session/runner.ts`). Brain and environment providers share one contract, `MachineProvider` (`core/src/machine-provider.ts`). This spec replaces the draft in PR #197.

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
2. A managed provider is a `MachineProvider` (built). Later pull requests add `image`, `size` and `network` to `create`, an optional `build`, and the flags `canPause` and `canLimitHosts`, each with its first caller. A step that a provider does not have does nothing: a Durable Object's `create` names it by id, and it never pauses (EN6). Core never branches on a provider's name.
3. Each managed machine carries labels: Ren's owner name, the kind (`brain` or `hand`), its id, its generation, its organization and its space. Every step finds its earlier work by kind, id and generation before it acts, so a step that runs twice makes one machine (EN34).
4. The deployment registers its brain providers and hand providers, and Ren does not start when a space or a template names one it does not register (built: `BrainProvider.Registry`, `ProviderCheck`). A space picks its hand provider through `space.hand` (§ Space settings).
5. An attached machine connects out to Ren, and Ren relays the Brain API and the Environment API over that connection. Nothing in this work builds it (EN7).

### Space settings

Built: `Space.Hand` (`schema/space.ts`), its checks in `Space.update` (EN3, EN24, EN44, EN45), `SessionRunner.create`, and the refused archive of a template in use (`core/src/environment-templates.ts`). New spaces get co-located with no template.

### When a change applies

Built for brain machines (EN21, EN22, EN27): `MachineLifecycle` compares the machine's image (`template`, `template_config`) with what its owner `wants` only in `resuming`. It updates in place a newer bundle, or a template config that only adds packages or build commands (the provider's `stepsBetween`; the brain runs the steps with `brain.update`, root steps through sudo). It replaces the machine for any other image change, a different provider, or an in-place update that failed 3 times.

1. Remote hand machines follow the same rules (PR 16).
2. Hand → none: at the next pull, the existing chats lose their file and shell tools (built: `PullChat.hasHand`, the Ren plugin). None → hand: only new chats get tools, because the brain fixes a chat's workspace link when it creates the chat (EN23).
3. A change to `brainScope` applies to new chats only.

### Templates

Ren's code reaches machines as bundles, not in images (EN26-EN29; `cell/e2b/bundle.ts`, `cell/e2b/start.sh`, `core/src/bundles.ts`). A template image holds the system and the template's packages only. The deploy builds Ren's system image with the current dependencies bundle in it, and the image's tag ends with their version (`<name>:<system>-<dependencies>`, `cell/e2b/stage.ts`, `E2B_TEMPLATE_SEED`): a new machine downloads only the sources. Ren ignores that part of a tag when it compares a machine's image (`machine-lifecycle.ts`, `systemOf`), so new dependencies never replace a machine; its bundles update them in place.

Built: the template fields, the E2B config and its build (`core/src/machine-provider/e2b.ts`), one build at a time per template and its status (`core/src/environment-templates.ts`, EN30, EN44).

A co-located machine uses the template's last `ready` image while a build runs or after it fails (`image`, `image_config`).

1. A new system image (`E2B_TEMPLATE`) does not rebuild the template images: an admin saves the template again.

### Networking

Built: `EnvironmentTemplate.Networking`, and `limited` only on a provider with `canLimitHosts`. `EnvironmentNetwork.hostsOf` makes the host list: `allowedHosts`, the package manager hosts, the hosts of the space's MCP servers, and the named hosts of the credentials the machine's workload can use. A co-located machine's list also has Ren's server and inference (EN40). The provider gets it in `network` at `create` and at every `connect`; E2B sends it as `allowOut` with `denyOut: ["0.0.0.0/0"]` after the resume, and `*.example.com` also allows `example.com`.

1. The egress keeps only its credential checks.

### Remote hands

Built: remote hand machines on `MachineLifecycle` (`core/src/environments.ts`, columns of `MachineLifecycle.Row` on `environment`), with seats (EN43), the provider's workspace for chat folders (`MachineProvider.workspace`, EN42), the executor's answer as the ready check, and the unreachable check (`environments.access?unreachable=true`, EN15). On E2B a hand runs `start.sh` with `REN_HAND=1`: the executor only, open to Ren and the brains.

1. Built: a remote hand goes through the egress like a brain, with a proxy login of its own generation (`SandboxEgress`, workload `hand`). Its credentials are those of its space: one space per environment (`Credentials.scopeOf`).
2. A remote hand does not update in place: a newer template config replaces it at its wake, and it keeps its executor version until it is replaced.
3. Built: a brain made for a remote hand (`brain.hand_placement`, `REN_HAND_PLACEMENT=remote`) runs OpenCode's `ToolOutput`, `FileSystem`, `Vcs` and `Snapshot` on the hand (`cell/src/harness/opencode/workspace-driver.ts`, EN13, EN14). A change of the space's hand to or from remote replaces the brain at its wake.
4. A chat keeps its hand when its space changes the hand, but the space's brain is made for the new hand. Then that chat's saved tool output, files, diff and revert read the other machine's disk. This is accepted: a change of hand moves the chats.
5. On a remote hand, `Vcs` gives the branches and the diff only; its status, branch list and review base are empty.
6. Built: Ren waits up to 5 s for a chat's hand (`Environments.startingAfter`), under the 10 s for which its server keeps a quiet connection. A hand that takes longer answers `EnvironmentStartingError`, and the brain asks again every 2 s for up to 3 min (`HostAccess.handStartsWithin`). A chat's first tool call waits while a new hand starts; it does not fail.
7. Built: on a remote hand, snapshots are a git store per repository in `$XDG_DATA_HOME/ren/snapshot` on the hand (`cell/src/harness/opencode/snapshot.ts`). As with OpenCode's own, a revert finds file changes only in a git repository. Unlike OpenCode's, the store is never packed.

### Keep-alive and detection

1. Each `access` keeps a machine awake for 10 min. Each pull with progress during a turn keeps it awake for 30 min. A turn with no progress for 30 min gets no more time (today, `brain-lifecycle.ts:81-93`).
2. Ren checks a machine when a call to it fails, and in the hourly cleanup. Every 30 s, Ren also checks each awake brain that has not pulled for 90 s (`BRAIN_PULL_TIMEOUT`), so a silent brain is found with no access (EN16). A remote hand does not pull, so only the first two find it.
3. An unknown answer never destroys a machine: a provider error, an unreadable status or an unreadable version means keep (I11). Nothing is destroyed because a list does not show it (I12).

### Failure and recovery

1. Three failures in a row, of any kind, put a machine in `failed` (EN18).
2. Failed machines, capacity, forced replaces and failed builds send a PostHog error report with the reason (EN38; `machine-lifecycle.ts`, `environment-templates.ts`).

### Ren server

1. One Ren server runs. `DurableRunner` uses Effect's `SingleRunner`, which is single-process (EN31). Built: the load test of chaos row 58 (`e2e/script/sync-load.ts`). Measured on the local stack (macOS), 20 brains each syncing 8,387,746 bytes at once: Ren's memory peaked at 1030 MB and 1063 MB in two runs (from 270 MB and 224 MB, all 20 sent within 2 s), above the server's default 1024 MB (`infra/aws/variables.tf`), and was back under 150 MB 30 s later; about 40 MB per upload. Accepted for now (user, 2026-11-07); see §7.
2. Environment tokens last 15 min. While Ren is down, a tool call uses the token it has. After Ren is back, the next call gets a new token within 30 s (EN32).
3. Version N and version N-1 work together in both directions: Ren and the brain, and the brain and the executor (EN33).

## 4. Contract changes

| Where                      | Change                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`                       | `environment`: bundle versions.                                                                                                                         |
| `core/machine-access.ts`   | `release`, `status` and `retire`, each with its first caller. Today: `ensure`, `access`, `check`, `retry`.                                              |
| `core/machine-provider.ts` | `size` in `create` for a provider that sizes a machine there; the flag `canPause`. Built: `image`, `network`, `build`, `stepsBetween`, `canLimitHosts`. |
| `environment-api`          | Later: a feature list in `hello`.                                                                                                                       |

Run `bun run generate` after the protocol changes.

## 5. Pull requests

Each pull request is based on the one before it. Each one passes its own rows of [`references/chaos.md`](references/chaos.md) live before it merges. The full suite runs once more before the last merge.

| #   | Branch                      | Change                                                                                                  |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `hand-design-spec`          | This spec.                                                                                              |
| 2   | `machine-provider-contract` | The managed provider contract. No change in behaviour.                                                  |
| 3   | `machine-lifecycle`         | `MachineLifecycle`, taken out of `BrainLifecycle`, and `MachineAccess`. No change in behaviour.         |
| 4   | `chaos-invariants`          | The seeded runs that check I1–I13, and the restore measurement.                                         |
| 5   | `lifecycle-recovery`        | Timed retry, the 5-min replace, PostHog reports.                                                        |
| 6   | `turn-recovery`             | Interrupted turns continue once, waiting messages after a replace, the 8 MB stand-in.                   |
| 7   | `background-keep-awake`     | Background processes keep a machine awake up to 2 h.                                                    |
| 8   | `bundle-serving`            | Bundles built, served by hash, and the current version in Postgres.                                     |
| 9   | `bundle-update`             | Images without Ren code; `updating`; the OpenCode version rule.                                         |
| 10  | `brain-provider-registry`   | Brain providers with `canColocate`; the space's choice, hidden.                                         |
| 11  | `space-hand-choice`         | `space.hand`, `SessionRunner`, tools refused with no hand, the refusals of §3.                          |
| 12  | `template-image-build`      | Networking, build status, one build at a time, E2B builds from the system image; no never-built hand.   |
| 13  | `colocated-template-brain`  | The brain machine from the template image; Ren's hosts in `limited`; packages in place.                 |
| 14  | `environments-settings-ui`  | Settings → Environments and the space's hand settings.                                                  |
| 15  | `remote-e2b-hand`           | Remote hand machines on `MachineLifecycle`, seats, the unreachable check, the remote option in the app. |
| 16  | `remote-hand-services`      | `REN_HAND_PLACEMENT`; `ToolOutput`, `FileSystem` and `Vcs` on the hand.                                 |
| 17  | `remote-hand-egress`        | A remote hand behind the egress, with its space's credentials.                                          |
| 18  | `remote-hand-snapshot`      | `Snapshot` on the hand: revert works on a remote hand.                                                  |
| 19  | `soak-and-alarms`           | The load test (chaos row 58). The soak and rows 38, 39 run with the full suite before the last merge.   |

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

1. An "Apply now" button that replaces a machine at once.
2. A maximum wait for a space that never sleeps.
3. More than one Ren server: a runner with health checks across servers.
4. The egress is one EC2 instance: a second one, and a memory alarm.
5. Attached machines: the relay, the device's states, and who may use a device and which secrets reach it.
6. Daytona, ECS and Durable Object brain providers. For ECS, see [`references/ecs-brain.md`](references/ecs-brain.md).
7. A harness-neutral transcript (e2b-brain E30), then Pi.
8. A feature list in `executor.hello`, and a tool list built from it.
9. UDP DNS to `8.8.8.8` leaves outside the firewall and the egress (E2B docs). Close it with `dnsServers` and a resolver that Ren runs.
10. A memory alarm for the server. Infra has no notification target yet (no SNS topic), so an alarm would tell no one.
11. Ren's memory under many large syncs at once (row 58 failed against 1024 MB): handle at most a few `uploadMessages` at once and answer 503 to the rest (brains retry), or a larger server.
