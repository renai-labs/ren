# Environments: pending

Status: not built. Environment templates, environments, the Docker provider and `Environments.bind` are built (`core/src/environment-templates.ts`, `core/src/environments.ts`, `core/src/environment-provider/docker.ts`). No code picks a template for a chat, so every chat runs its tools in the brain's own sandbox. Decisions and reasons: [`references/decisions.md`](references/decisions.md). Brains on ECS: [`references/ecs-brain.md`](references/ecs-brain.md).

Words:

| Word                  | Meaning                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Brain                 | OpenCode and Ren's code around it. It serves one chat or every chat of a space. Ren's deployment chooses where it runs.       |
| Environment           | One running sandbox where a chat's tools run. Its executor serves the Environment API. Core calls the brain's own one `Hand`. |
| `EnvironmentTemplate` | The saved config of an environment: provider, provider `config`, `networking`, `sessionsPerEnvironment`.                      |
| `EnvironmentProvider` | Makes environments of one kind: `docker` today, `e2b` next, laptops later.                                                    |
| Seat                  | One chat on an environment. A seat is busy from the chat's first tool call in a turn to the end of that turn.                 |

## 1. What it does

The same as a ren-v1 environment, with the brain and the environment as separate parts:

1. An org admin creates an environment template: apt, npm, pip and go packages, build commands, CPU, memory and networking.
2. Ren builds the template's image when the admin saves it.
3. A space chooses `default`, a template, or `none`. Every chat of the space runs its tools there: chats, tasks, schedules, webhooks and channels.
4. A change to the template or to the space's choice reaches existing chats when their environment is idle. A change to or from `none` reaches new chats only.

Done when: an admin creates a template with apt `ffmpeg`, npm `typescript` and `limited` networking that allows `api.example.com`. A member selects it for a space. A chat in that space runs `ffmpeg -version` and `tsc -v`, reaches `api.example.com`, and cannot reach `example.org` or an ngrok host. The admin adds pip `requests`. After the chat is idle, its next shell call runs `python -c "import requests"`.

## 2. Model

```
 ┌────────────────────────┐   Environment API                    ┌───────────────────────────────────────────────┐
 │                        │   { url, token, directory }          │                                               │
 │  brain                 │   from Environments.access           │  space.environment                            │
 │  host and image set by │ ───────────────────────────────────> │                                               │
 │  Ren's deployment      │                                      │    default   Ren's standard environment       │
 │                        │                                      │              (today: the brain's own sandbox) │
 └────────────────────────┘                                      │    tpl_…     an environment of the template,  │
                                                                 │              made by its provider             │
                                                                 │    none      no file or shell tools           │
                                                                 │                                               │
                                                                 └───────────────────────────────────────────────┘

 ┌────────────────────────┐   save                ┌────────────────────────┐   build(config)         ┌────────────────────────┐   provision(image, hosts)   ┌────────────────────────┐
 │                        │   config changed      │                        │   → image               │                        │   at first tool call        │                        │
 │  EnvironmentTemplate   │ ────────────────────> │  build run             │ ──────────────────────> │  template.image        │ ──────────────────────────> │  Environment           │
 │                        │   key = tpl + hash    │  (DurableRunner)       │   build_status = ready  │                        │                             │  (E2B sandbox)         │
 └────────────────────────┘                       └────────────────────────┘                         └────────────────────────┘                             └────────────────────────┘
```

## 3. Rules

### Template

1. A template has the fields of today (`schema/src/environment-template.ts:24`) and a new top-level `networking` field (§3 Networking).
2. The provider defines the rest in `config`. The E2B provider's config is `cpuCount`, `memoryMiB`, `packages { apt, npm, pip, go }` and `buildCommands` (at most 50, each at most 4096 characters). `packages` and `buildCommands` reuse `App.Environment` (`schema/src/app.ts:26-32`). The CPU and memory sizes are ren-v1's: 1/1024, 2/2048 (default), 4/4096, 6/6144, 8/8192.
3. Only org admins create, edit and archive templates, as today (`core/src/environment-templates/policy.ts:20`). Every org member can list and read them.

### Build

1. Saving a template with a changed config starts one build run in `DurableRunner` (`core/src/durable-runner.ts:16`). Its key is `environment-build:<templateId>:<hash>`. The hash covers the base image tag and the config, so saving the same config again starts nothing. A key that finished does not run again, so a save that returns to an earlier config (A, B, then A) runs the build of A again outside `DurableRunner`; the provider gives the image of a tag that it built before without building it again.
2. The E2B provider builds `FROM ren-environment-base:<hash>`, Ren's image with the executor and its start script and no brain. It adds one `RUN` per package manager, with ren-v1's commands (`ren-v1/packages/app/src/lib/environment-config.ts:12-26`), then one `RUN` per build command. It sets CPU and memory at build time, because E2B fixes them per template (`cell/e2b/stage.ts:13`). Prior art for the build: `cell/e2b/stage.ts:155-178`.
3. The template keeps the state of its latest build: `build_status` (`queued`, `building`, `ready`, `failed`), `image` (the last `ready` image) and `build_error`.
4. While a build runs or after it fails, chats use the last `ready` image. A space cannot select a template that has no `ready` image yet.
5. A provider with no `build` step, such as Docker, is `ready` when the template is saved.
6. A new `ren-environment-base` changes every template's hash, so every template builds again. The Environment API stays readable by the oldest executor that still runs, as `host-api` does for brains (e2b-brain E120).

### Running environment

1. The first tool call of a chat calls `Environments.access`, which provisions an environment of the template's `image` when the chat has none, as today (`core/src/environments.ts:262`).
2. Up to `sessionsPerEnvironment` chats (default 8) share one environment. Chat 9 gets a new one (`core/src/environments.ts:205-229`). Chats share files across environments only through drives.
3. Ren keeps an environment awake. The E2B provider creates it with `autoPause: true`. Each `access` calls `keepAlive(30 min)`. Each `release` calls `keepAlive(10 min)`, but only when no other seat on the environment is busy. E2B pauses it when the time ends; the next `connect` resumes it with its files and memory. Prior art: the brain sandbox (`core/src/brain-lifecycle.ts:62-63`, `core/src/sandbox-provider/e2b.ts:236`).
4. Each environment row keeps the `image` it was made from. An environment is outdated when its image is not the template's `image`, or when its template is not the space's current choice. At `access`, Ren replaces an outdated environment when every seat on it is idle: `replace` (`core/src/environments.ts:251`), then provision. A busy seat keeps the old environment until the next `access`. The chats of a replaced environment lose their workspace files and show the existing notice (`filesResetAt`).
5. Ren destroys an environment when every chat on it is archived, or when its template is archived (`core/src/environment-templates.ts:223`, today).

### Choice per space

1. `space.environment` is `{ kind: "default" }`, `{ kind: "template", environmentTemplateId }` or `{ kind: "none" }`. It replaces the `SpaceEnvironmentTemplate` link table. New spaces get `default`.
2. `default` is Ren's standard environment. Its meaning for a user is the same on every brain host. Today it is the brain's own sandbox (`Hand`, `core/src/environments.ts:267-283`). On a host without its own sandbox it becomes a Ren-owned template (§7).
3. `none` gives no environment: no file, shell or stdio MCP tools.
4. `SessionRunner.create` reads `space.environment` once and puts it in `Session.StartInput`. No other caller builds it (today: `core/src/session.ts:337`, `task.ts:269`, `channels.ts:298` and `:405`, `schedules.ts:436`).
5. When the space changes between `default` and templates, existing chats follow at their next idle point (§3 Running environment, rule 4). This replaces the refusal "cannot change its environment template" (`core/src/environments.ts:377`). A change to or from `none` applies to new chats only: the brain sets a chat's tools when it creates the chat (`cell/src/harness/opencode/harness.ts:88`, `:174`).
6. Every environment uses one folder per chat: `/home/user/workspace/<sessionId>`, the folder of the brain's own E2B sandbox (`cell/e2b/start.sh:32`). The brain fixes a chat's folder when it creates the chat (`cell/src/harness/opencode/harness.ts:162`), so a chat can move only between environments with the same folder. `ENVIRONMENT_DIRECTORY` defaults to `/home/user/workspace` (today `/workspace`, `core/src/environments.ts:114`), and the Docker executor image creates it (`executor/Dockerfile:17`).
7. Space members and org admins set `space.environment`.

### Networking

1. `networking` is `{ type: "unrestricted" }` or `{ type: "limited", allowPackageManagers, allowMcpServers, allowedHosts }`, as in ren-v1. ren-v1 stored it and did not enforce it.
2. A template can be `limited` only when its provider says it can limit hosts (`canLimitHosts: true`). E2B can; Docker and laptops cannot.
3. Core makes the host list of a `limited` environment: `allowedHosts`; Ren's package manager hosts when `allowPackageManagers` is set (npm, PyPI and its file host, Debian and Ubuntu mirrors, the Go module proxy); the hosts of the MCP servers enabled in the space when `allowMcpServers` is set; and the hosts of the credentials the space can use, always.
4. The provider enforces the list. E2B gets it as `allowOut`, with `denyOut: ["0.0.0.0/0"]` and the egress proxy as today (`core/src/sandbox-provider/e2b.ts:21-25`). E2B checks the HTTP `Host` on port 80 and the TLS SNI on port 443 before the traffic reaches the egress, so hosts that the egress passes through without decryption (`tls.passthrough_hosts`, such as ngrok) are checked too. Every other port is blocked unless an IP is allowed.
5. For `*.example.com`, the provider also adds `example.com`: E2B does not match the apex with a wildcard.
6. Ren gives the provider the current list at every `connect`, so a change (template edit, a credential or MCP server added or removed) reaches a running environment at its next access: the first tool call of a turn, or a token refresh during a turn (EN26). An E2B update replaces the whole network config, so the provider sends the proxy again (prior art: `core/src/sandbox-provider/e2b.ts:194`).
7. Ren's egress keeps only its credential checks. It does not check hosts.
8. The limit applies to the environment's traffic only. The brain's own web access (webfetch, websearch) follows the `webfetch` and `websearch` permission rules.

### Brain settings

1. The brain host and the brain image are set by Ren's deployment (`SANDBOX_PROVIDER`, `E2B_TEMPLATE`). Users never see them.
2. Brain scope (`session` or `space`) stays a space setting (`schema/src/space.ts:76`). Space members and org admins change it. The app gets a toggle in the space settings (e2b-brain E17). A change applies to new chats only.
3. Org admins get `space.update` on shared spaces (`core/src/space/policy.ts:44-49` changes).
4. When a second harness exists, a space chooses it, and each chat keeps the harness it started with. This waits for harness-neutral sync (`../e2b-brain/README.md` §3).

## 4. Contract changes

| Where                                         | Change                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/environment-template.ts`              | `networking` in `Info`, `CreateInput`, `UpdateInput`. `Info` gets `buildStatus`, `image`, `buildError`.                                                                                                                                                       |
| `schema/space.ts`                             | `environment` in `Info` and `UpdateInput`.                                                                                                                                                                                                                    |
| `schema/session.ts`                           | `StartInput.environmentTemplateId` becomes `environment` (`default`, `template` with its id, or `none`).                                                                                                                                                      |
| `schema/space-environment-template.ts`        | Removed, with its protocol group, core service, policy and table.                                                                                                                                                                                             |
| `db`                                          | `environment_template`: `networking`, `build_status`, `image`, `build_error`. `environment`: `image`. `space`: the environment choice. `session_environment.environment_template_id` changes when the space's choice changes.                                 |
| `core/environment-provider.ts`                | Optional `build(config) → image`, `keepAlive(binding, duration)` and `updateNetwork(binding, hosts)`. `canLimitHosts` flag, beside `canMount` (`core/src/environment-provider.ts:37`). `provision` takes `image` and the host list (none for `unrestricted`). |
| `core/environment-provider/e2b.ts`            | New. The E2B REST calls move to one module that it shares with `sandbox-provider/e2b.ts` (e2b-brain E135).                                                                                                                                                    |
| `core/environments.ts`                        | Replace outdated environments at `access`; `keepAlive` on `access` and `release`; destroy when every chat is archived.                                                                                                                                        |
| `core/session/runner.ts`                      | Reads `space.environment` and fills `StartInput.environment`.                                                                                                                                                                                                 |
| `core/space/policy.ts`                        | Org admins: `space.update` on shared spaces.                                                                                                                                                                                                                  |
| `core/environments.ts`, `executor/Dockerfile` | `ENVIRONMENT_DIRECTORY` defaults to `/home/user/workspace`; the Docker executor image creates it for its user.                                                                                                                                                |
| A new script beside `cell/e2b/stage.ts`       | Builds `ren-environment-base:<hash>`: the executor and its start script.                                                                                                                                                                                      |
| `app`                                         | Settings → Environments (admins: list, create, edit, build status). Space settings → Environment (`default`, a template, `none`) and Brain scope.                                                                                                             |

Run `bun run generate` after the protocol changes.

## 5. Lifecycle states

| State                                                      | Behaviour                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Mid-turn                                                   | Each `access` (first tool call, token refresh every 10 min) extends the environment by 30 min.        |
| Mid-turn, another chat on the same environment ends a turn | Its `release` does not shorten the time.                                                              |
| Paused                                                     | The next `access` resumes it. A write of a saved tool output wakes it too.                            |
| Gone (killed, or lost by E2B)                              | `connect` fails with `Gone`; Ren gives the chats a new environment and the next generation, as today. |
| Outdated, every seat idle                                  | Replaced at the next `access`. Files are lost; the chat shows the notice.                             |
| Outdated, a seat busy                                      | Kept. Checked again at the next `access`.                                                             |
| Template building or failed                                | New environments use the last `ready` image.                                                          |
| Host list changes while it runs                            | At the next access, after `connect` resumes it, so E2B never gets an update while paused.             |
| Every chat archived                                        | Destroyed.                                                                                            |

## 6. Tests

| #   | Package | Test                                                                                                                                                                                               |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `core`  | A chat in a space with a template gets an environment of the template's `image` at its first tool call.                                                                                            |
| 2   | `core`  | A chat in a space with `none` gets no environment; a chat with `default` on the sandbox host gets the brain's own sandbox.                                                                         |
| 3   | `core`  | A task, a schedule run and a channel chat get the space's choice through `SessionRunner.create`.                                                                                                   |
| 4   | `core`  | Two saves with the same config start one build run; a failed build keeps the last `ready` image; a template without one cannot be selected.                                                        |
| 5   | `core`  | An outdated environment with all seats idle is replaced at `access`; with one busy seat it is kept.                                                                                                |
| 6   | `core`  | A `release` while another seat is busy does not call `keepAlive(10 min)`.                                                                                                                          |
| 7   | `core`  | Archiving the last chat on an environment destroys it.                                                                                                                                             |
| 8   | `core`  | A space that switches from template A to B, or from `default` to a template, moves its idle chats at their next `access`; a switch to `none` changes new chats only.                               |
| 9   | `core`  | A `limited` template gives `provision` the hosts of `allowedHosts`, the package managers, the space's MCP servers and its credentials. A credential added later is in the list of the next access. |
| 10  | `core`  | `limited` is refused for a provider without `canLimitHosts`.                                                                                                                                       |
| 11  | `core`  | Policy: a member cannot create a template; an org admin can update a shared space.                                                                                                                 |
| 12  | `core`  | Live E2B, only with `E2B_API_KEY`, and only after the user approves the sandbox: a `limited` environment reaches a listed host and cannot reach an unlisted host or an ngrok host.                 |

## 7. Code quality and best practices

These rules come from the Software Factory (`renai-labs/integrations`, `.ren/spaces/software-factory`: `agents/build`, `agents/review`, `agents/qa`, `skills/naming`, `skills/e2e-verification`). They apply to every pull request of this spec.

### Before code

1. Read the root `AGENTS.md` and the `AGENTS.md` of each package the change touches: `core`, `schema`, `db`, `protocol`, `cell`, `app`.
2. Each change traces to a rule, a contract change or a test of this spec. No drive-by refactors or renames.
3. If the spec does not fit the code, stop. Change the spec first, then the code. Do not work around the spec.

### Design

1. Swappable parts stay behind their interface. Core asks `EnvironmentProvider` for `build`, `keepAlive`, `updateNetwork` and `canLimitHosts`; it never asks "is this E2B". The same holds for `BrainHost`, `SandboxProvider` and the harness.
2. No speculative abstraction. Add an optional provider method only with its first real user: E2B for `build`, `keepAlive` and `updateNetwork`. Do not add a Docker `build` until a case needs it.
3. Reuse what exists before you write a new pattern:

   | Need                        | Use                                                                          |
   | --------------------------- | ---------------------------------------------------------------------------- |
   | Package lists, build limits | `App.Packages` and `App.Environment` (`schema/src/app.ts:19-32`)             |
   | The build run               | `DurableRunner` (`core/src/durable-runner.ts`)                               |
   | The E2B image build         | `cell/e2b/stage.ts:155-178`                                                  |
   | Keep-alive and pause        | the brain sandbox (`core/src/brain-lifecycle.ts`, `sandbox-provider/e2b.ts`) |
   | E2B network update          | `updateNetwork` in `core/src/sandbox-provider/e2b.ts:194`                    |
   | Host patterns               | `Credential.matchesHost` (`schema/src/credential.ts:206`)                    |
   | Config forms                | the provider's JSON Schema (`EnvironmentProvider.Info.configSchema`)         |

4. Do not add a check that upstream code already makes impossible, or code that Effect, OpenCode or a dependency already gives. Read its source first.

### Edge cases

Handle each case that a person or a caller can cause. Never remove handling for a case that can cause harm: a security gap, lost or wrong data, a stuck part, a leak, or a crash a user can cause.

| Case                              | In this spec                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Missing, invalid or expired input | a template without a `ready` image; `limited` on a provider that cannot limit hosts; an archived template           |
| Retries and duplicates            | `provision` stays idempotent per environment id; a build run with the same key runs once                            |
| Concurrent calls                  | two chats access one environment while it is replaced; a `release` while another seat is busy                       |
| A step that fails halfway         | a build that fails after its E2B template exists; provision that fails after the sandbox exists                     |
| Crash, restart, sleep, wake       | Ren restarts during a build run; an environment pauses mid-turn; a paused environment gets `updateNetwork`          |
| Memory against stored state       | a host list that changed while an environment was paused; an `environment.image` that differs from `template.image` |
| Permissions                       | a member edits a template; a member of another space selects a template; an admin on a private space                |
| Harm                              | a `limited` environment that reaches an unlisted host; an environment that is never destroyed                       |

### Names

Choose names with the factory's `naming` skill. The repository's `AGENTS.md` wins over it. For this spec:

1. Full words: `environment`, not `env`, in new names (`ren-environment-base`, not `ren-env-base`). Allowed short forms: `id`, `url`, `sql`, `http`, `api`, `json`, `ms`, `mcp`, `rpc`, `oauth`.
2. One word for one meaning: "environment" is where tools run; "sandbox" is a machine at a provider; "seat" is one chat on an environment. Do not use "hand" in new product code or API names; core's existing `Hand` type stays.
3. Booleans read as conditions and match their neighbours: `canLimitHosts` beside `canMount`.
4. Put the unit in the name when the type does not carry it: `keepAlive(binding, duration)` takes a `Duration`; a number is `timeoutMs`.
5. Errors are named after what happened: `NotReady` for a template with no `ready` image, not `BuildError`.

### Tests

1. Write the test first. It fails without the change and passes with it.
2. Use real parts: Postgres, a provider layer for tests, `TestClock` for the 30 min and 10 min windows. No mocks and no real-time waits.
3. The live E2B test runs only with `E2B_API_KEY` and after the user approves the sandbox.

### Pull requests

1. One branch and one draft pull request for each repository. The title states the outcome. The body follows the template and says only what the diff cannot: the cause with a fact (file:line, a value), the change in one sentence, its limits, and which checks ran and which did not, as commands and counts. A skipped check is not a passing check.
2. Write in plain words, in the style of ASD-STE100. No filler and no praise.
3. Act on each review finding: fix it and reply with the commit, or reply why not.
4. QA evidence, with the factory's `e2e-verification` skill:

   | Change                                                | Evidence                                                                                         |
   | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
   | Settings → Environments, Space settings → Environment | before and after screenshots at the same viewport, and a short video of create, build and select |
   | Build, provision, replace, networking                 | test output, and request and response of the API calls                                           |
   | Live E2B networking                                   | the output of `curl` to a listed host, an unlisted host and an ngrok host                        |

## 8. Later

1. `default` on a brain host without its own sandbox (ECS, a Durable Object): a Ren-owned template on the E2B provider.
2. UDP DNS to `8.8.8.8` leaves outside the firewall and the egress (E2B BYOP docs). It cannot leak a credential, but it can leak data. Close it with `dnsServers` and a resolver that Ren runs.
3. Not verified: whether E2B limits the number of domains in `allowOut`. The limit of 10 domains in the E2B docs is for transform `rules`.
4. Laptops as an environment provider. Today's provider contract is `provision → connect → destroy` (`core/src/environment-provider.ts:30-42`): Ren makes the machine. A laptop connects to Ren instead, so it needs a contract where the environment connects in.
5. Personal templates (ren-v1 "mine"). Not now: only admins write templates.
