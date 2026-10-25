# Apps

Status: in discussion. Topics 1 and 2 decided (A1, A2). Code under review: PR #51 (branch `apps`). Topics 3, 5 and 9, and A2, are replaced by [`../credentials/profiles.md`](../credentials/profiles.md) (P1, P2): no releases and no installs; profiles decide where an app runs.

This file is the core of the spec. Update it in the same change that makes or changes a decision. The references hold the evidence:

| Reference                                      | Contents                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| [`references/ren-v1.md`](references/ren-v1.md) | How ren-v1 did apps (blueprints), and the bugs it fixed       |
| [`references/pr-51.md`](references/pr-51.md)   | The gaps found in PR #51, each mapped to a topic of this spec |

## 1. Goal

A person installs an app in a space. The app's skills and MCP servers reach every brain of that space, and its packages reach the space's environments. A new version reaches them without a restart.

Done when:

- An install, an uninstall and a new release reach a running brain at its next turn, on every host.
- A change of the harness (OpenCode to another), the brain host (cell, Bun in a sandbox) or the environment provider is a new layer. App code does not change.

## 2. Words

| Word     | Meaning                                                                                      |
| -------- | -------------------------------------------------------------------------------------------- |
| App      | A named unit that gives skills, MCP servers, packages and credential requirements.           |
| Release  | One version of an app. It holds the app's content.                                           |
| Install  | The link between a space and an app. It can pin one release.                                 |
| Catalog  | Everything that the installed apps of one space give, in a form that no harness knows.       |
| Revision | A short string. It changes when the catalog of a space changes. It is cheap to compute.      |
| Render   | The step that turns a catalog into one harness's own config (for OpenCode: `opencode.json`). |
| Registry | The public list of apps that Ren publishes. Any org can install a listed app.                |

## 3. Topics

The spec is written one topic at a time. A topic is "decided" after the user chooses an option.

| #   | Topic                                                                        | Status  |
| --- | ---------------------------------------------------------------------------- | ------- |
| 1   | The pieces, and the contract between each pair                               | Decided |
| 2   | What an app is: a copy (ren-v1 blueprint) or a tracked package with releases | Decided |
| 3   | Versions and pins: the same release gives the same behaviour                 | Open    |
| 4   | Names: slugs across orgs and the registry; name clashes of components        | Open    |
| 5   | Install: owner, dependencies, uninstall, transfer                            | Open    |
| 6   | Delivery: how a change reaches a running brain, on each host, during a turn  | Open    |
| 7   | Render: each harness builds its config; which agents get which app           | Open    |
| 8   | Environment packages                                                         | Open    |
| 9   | Credential requirements and the "needs setup" state                          | Open    |
| 10  | Registry: publish, withdraw, checks across orgs                              | Open    |

## 4. Decisions

| ID  | Decision                                                                                                                                                                                                                         | Why                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | One service for each step of section 5. The steps talk only through the contract types of section 7, in `@ren/schema`. Resolve gives data that no harness knows. Delivery is a hot-reload source. Render is a layer per harness. | A harness, a host or an environment provider changes in one layer. ren-v1 built OpenCode's config in the API, and three bugs came from that one composer (INV-34, INV-35, INV-43). |
| A2  | An app is a tracked package. A space has an install record per app. A release is a row that never changes. A new release reaches every install without a pin; a pin holds one release.                                           | ren-v1 blueprints were copies with no update path; only their skills and MCP servers followed the latest version. A tracked package gives the whole app that path.                 |

## 5. System

```
 1 Author      2 Store            3 Install         4 Resolve             5 Deliver              6 Render               7 Run
 ┌─────────┐  ┌──────────────┐   ┌────────────┐   ┌────────────────┐   ┌─────────────────┐   ┌──────────────────┐   ┌──────────┐
 │ API, or │─▶│ App          │──▶│ SpaceApp   │──▶│ AppResolve     │──▶│ HotReload       │──▶│ AppRender        │──▶│ harness  │
 │ registry│  │ AppRelease   │   │            │   │ .catalog(space)│   │ source "apps"   │   │ (one per harness)│   │          │
 │ script  │  │ (Postgres)   │   │ (Postgres) │   │ .revision      │   │ one hash, one   │   │ catalog → config │   │          │
 └─────────┘  └──────────────┘   └────────────┘   └───────┬────────┘   │ config          │   │ + clashes        │   └──────────┘
                                                          │            └─────────────────┘   └──────────────────┘
                                                          ├── environment part ──▶ EnvironmentProvider (builds the machine)
                                                          └── requirements part ─▶ Credentials (connect cards, owner-access.md)
```

Each arrow is one contract (section 7). A step knows the contract on each side of it, and nothing else.

## 6. Services and layers

| Step | Service                    | Package                                   | Does                                                                                  | Layers now        | Layers later              | Chosen by            |
| ---- | -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- | ----------------- | ------------------------- | -------------------- |
| 2    | `App`, `AppRelease`        | `core`                                    | Stores apps and releases.                                                             | Postgres          | —                         | —                    |
| 3    | `SpaceApp`                 | `core`                                    | Installs, pins and uninstalls an app in a space.                                      | Postgres          | —                         | —                    |
| 4    | `AppResolve`               | `core`                                    | Gives the catalog of a space, and its revision.                                       | Postgres          | a cache keyed by revision | —                    |
| 5    | `HotReload.Source` `apps`  | `core` (source), `cell` (one hash)        | Sends the catalog on each pull ([`../hot-reload/spec.md`](../hot-reload/spec.md)).    | pull              | push (poke)               | `server/src/main.ts` |
| 6    | `AppRender`                | one package per harness, `schema` only    | Turns a catalog into the harness's config. Reports names that clash for that harness. | OpenCode          | each new harness          | the brain's runtime  |
| —    | `EnvironmentProvider`      | `core` (exists)                           | Builds the machine with the environment part.                                         | as today          | Daytona, Modal            | `server/src/main.ts` |
| —    | `Credentials` requirements | `core` (`../credentials/owner-access.md`) | Compares the requirements part with what resolves.                                    | as specified      | —                         | —                    |
| 1    | `AppRegistry`              | `core`                                    | Publishes and lists registry apps.                                                    | Postgres + script | —                         | —                    |

Rules:

1. `core` never imports a render package. A render package depends only on `schema`, as `opencode-transcript` does.
2. The cell and OpenCode never see the word "app". They see one config.
3. `AppResolve.catalog` runs on each pull: the pull has no hashes (HR9 in [`../hot-reload/README.md`](../hot-reload/README.md)).
4. A catalog holds no secret.

## 7. Contracts

| Arrow           | Contract                         | Shape (details in the topic named)                                                 |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| 3 → 4           | the installs of a space          | `{ app, release }` per install; topic 5                                            |
| 4 → 5           | `AppCatalog.Catalog`, `revision` | three parts: `brain` (skills, MCP servers), `environment`, `requirements`; topic 6 |
| 5 → 6           | the `brain` part of the catalog  | declarations with provenance (app, release, version); no harness names; topic 7    |
| 6 → 7           | the harness's own config         | for OpenCode: `mcp`, `skills`, `permission`; topic 7                               |
| 4 → environment | the `environment` part           | packages and build commands; topic 8                                               |
| 4 → credentials | the `requirements` part          | `Credential.Requirement` per app; topic 9                                          |

## 8. Open points

1. Where Render runs. The brain pulls the catalog ([`../hot-reload/spec.md`](../hot-reload/spec.md)), so Render runs in `cell`.
