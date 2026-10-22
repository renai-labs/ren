# Hot reload

Status: proposal. Nothing in this document is built yet.

This document uses ASD-STE100 (Simplified Technical English) style.

## 1. Purpose

A brain is one OpenCode instance in a cell. The brain runs for a long time. During that time, Ren data can change. Examples: an administrator adds a model, or a model key expires.

Hot reload sends these changes to a brain that is running. The brain does not restart.

## 2. Terms

| Term     | Meaning                                                                            |
| -------- | ---------------------------------------------------------------------------------- |
| Brain    | One OpenCode instance in a cell. It runs one session.                              |
| Source   | One Ren domain that gives data to the brain. Example: models.                      |
| Config   | The public part of the data. OpenCode reads it as configuration.                   |
| Secret   | The private part of the data. Example: a model key. A secret has an expiry time.   |
| Revision | A short string. It changes when the config of a source changes.                    |
| Hash     | The SHA-256 of the revisions of all sources for one session.                       |
| Poke     | A call from the cell to OpenCode. It makes OpenCode get its config from Ren again. |

## 3. Rules

1. Hot reload applies only to the data of a source. Do not use it for other data.
2. A domain is hot-reloaded only when it is in the list of sources. The list is the one place that shows this.
3. A secret must not go into the config. A secret must not go into the hash.
4. Core must not compute the config on each turn. Core computes the config only when the hash changes.
5. The cell and OpenCode must not know the names of sources. They see one hash and one config.

## 4. Approach

### 4.1 The interface

Each source implements one interface:

```ts
export * as HotReload from "./hot-reload.js"

export interface Source {
  readonly name: string
  readonly revision: (subject: Subject) => Effect.Effect<string>
  readonly config: (subject: Subject) => Effect.Effect<Config>
  readonly secrets?: (subject: Subject) => Effect.Effect<ReadonlyArray<Secret>>
}

export interface Interface {
  readonly hash: (subject: Subject) => Effect.Effect<string>
  readonly config: (subject: Subject) => Effect.Effect<Config>
  readonly secrets: (subject: Subject) => Effect.Effect<ReadonlyArray<Secret>>
}

export const layer = (sources: ReadonlyArray<Source>) => ...
```

The wiring shows all sources in one list:

```ts
HotReload.layer([Models.source])
```

### 4.2 Two paths

A source gives two types of output. Each type has its own path.

```
                        Source
               ┌──────────┴──────────┐
            config                 secrets
               │                      │
  each turn: did the hash change?   each model call: does the key expire soon?
               │                      │
  the cell pokes OpenCode          OpenCode calls the Ren refresh method
               │                      │
  OpenCode gets the config         the cell gets the secrets from Ren
               │                      │
  OpenCode reloads                 OpenCode updates the credential
```

### 4.3 The config path, one turn

```
core   read the revisions ─▶ hash ─▶ send { configHash }
                                          │
cell                          is the hash the same as before?
                                 │ yes             │ no
                                 ▼                 ▼
                              prompt        1. get the secrets, write the credentials
                                            2. poke OpenCode
                                            3. wait for config.updated
                                            4. keep the new hash
                                            5. prompt
```

Step 1 occurs before step 2. Thus a new model has its key when it appears.

### 4.4 How OpenCode gets the config

OpenCode 2 has a feature for remote configuration ("well-known"). Ren uses this feature. No change to OpenCode is necessary.

```
cell, at boot     integration.wellknown.add(REN_URL)
                  credential for REN_URL = the host token

OpenCode          GET REN_URL/.well-known/opencode
                    → { auth, remote_config: { url, headers: Authorization: Bearer {env:...} } }
                  GET remote_config.url
                    → the config of the session
                  the config changed? → config.updated → OpenCode reloads
                                         providers, models, agents, MCP, skills, commands

poke              integration.wellknown.add(REN_URL) again
                  → wellknown.updated → OpenCode gets the config again
```

OpenCode also gets the config every 10 minutes. This timer cannot be stopped. It is not a problem, because core keeps the config in a cache (see 4.6).

### 4.5 The secret path

This path exists today. It does not change.

```
OpenCode, before a model call
  credential of type oauth, method "ren"
  does it expire in less than 5 minutes?
    no  → use it
    yes → Ren refresh method → POST secrets → new key → credential.update → use it
```

### 4.6 The revision and the cache in core

```
per turn          revision of each source  ─▶ hash          (cheap)
on a config GET   cache[session, hash] ?: merge the config of each source
```

The models source makes its revision from the endpoint IDs and the model list. It does not use the keys.

## 5. Current state

| Data              | Is it hot-reloaded now?        | How                                                    |
| ----------------- | ------------------------------ | ------------------------------------------------------ |
| Model endpoints   | Yes                            | Core pushes `brain.configureModels`. The cell reloads. |
| Model keys        | Yes                            | Push (`Credentials.sync`) and refresh at use.          |
| Session settings  | Only at the next `brain.start` | Title, agent, model, permissions, instructions.        |
| `OPENCODE_CONFIG` | No                             | Read once at boot.                                     |
| Environments      | No (PR #31)                    | Fixed when the session is created. See section 8.      |
| Hand access       | Yes (PR #31)                   | The cell gets it on each tool call.                    |

In production, `Models.layerNone` gives no endpoints. Thus the model path does not run in production yet.

## 6. Changes

### 6.1 Core

1. Add `packages/core/src/hot-reload.ts`: `Source`, `Interface`, `Service`, `layer`.
2. Add `Models.source`. Make `revision` from the endpoint IDs and models. Make `secrets` from the keys.
3. Add the cache of the config, with the key (session, hash).
4. In `BrainHost.start` and `BrainHost.send`: add `configHash` to the payload.
5. In `BrainHost`: remove `withModels` and `configure`. Remove the call to `brain.configureModels`.
6. In `BrainHost.revokeModels`: remove the call to `brain.removeModels`. Revocation then occurs at key expiry. See section 7.

### 6.2 brain-api

1. In `BrainApi`: add `configHash` to the payloads of `brain.start` and `brain.send`.
2. In `BrainApi`: remove `brain.configureModels` and `brain.removeModels`.
3. In `HostApi`: add `GET /brain/config`. It uses the host token.
4. In `HostApi`: add `GET /.well-known/opencode`. It has no authentication.
5. In `HostApi`: replace `models.refresh` with `secrets`. It returns the secrets and a new host token.

After these changes, run `bun run generate`.

### 6.3 Cell

1. In `Host.make`: call `integration.wellknown.add(REN_URL)`. Write the host token as the credential of `REN_URL`.
2. In `OpenCodeHarness.start` and `OpenCodeHarness.send`: compare `configHash` with the last hash. If it is different, do the steps of 4.3.
3. Do the steps of 4.3 outside the `mutations` semaphore, or before the call takes the semaphore. If not, a deadlock can occur.
4. Keep the last hash in Durable Object storage. Then a restart of the cell does not lose it.
5. Remove `Host.configure`, the `reloads` list, `ModelProviders.apply` and the provider transform of `RenPlugin`.
6. Keep the integration transform and the `refresh` method of `RenPlugin`. The transform gets the endpoint IDs from `ModelStore`.
7. Remove the handlers of `brain.configureModels` and `brain.removeModels`.

### 6.4 Tests

1. Core: a change to a source changes the hash. A write that changes nothing does not change the hash.
2. Core: the second GET of the config with the same hash does not compute the config again.
3. Cell: a new `configHash` makes OpenCode show a new model before the prompt starts.
4. Cell: the same `configHash` does not poke OpenCode.
5. Cell: a key that expires during a turn is refreshed. The turn continues.

## 7. Known limits

1. **Revocation.** If Ren refuses the config, OpenCode uses its last config from cache. Thus a revoked model stays until its key expires. Keep the key lifetime short.
2. **Poke completion.** A poke returns before OpenCode completes the reload. The cell waits for `config.updated`. This event occurs only when the config changed. The cell pokes only when the hash changed, so the event occurs.
3. **Host token rotation.** `credential.update` does not send an event. A poke reads the newest credential, so this is not a problem.
4. **Removed model.** A session that uses a model that Ren removed fails at its next model call. The error must tell that Ren removed the model.

## 8. Not in scope

1. **Environments.** Environments are not OpenCode config. They go through `hands.access`, not through this path. Two decisions are necessary before they can change in a session that runs:
   - A session must be able to move to a new location in OpenCode.
   - A policy must tell what occurs to busy hands when an environment config changes.
2. **Primitive-backed sources.** A later source can come from a primitive (`Space`, `Environment`). Its revision must change on each write. Two options exist: a wrapper around the write methods of the primitive, or a Postgres trigger. Decide when the first such source is necessary.

## 9. To verify first

Do a test before the work starts. Do these steps in a test cell:

1. Serve a static `/.well-known/opencode` and a static `/brain/config` with one agent.
2. Call `integration.wellknown.add` in `Host.make`.
3. Make sure that the agent appears.
4. Change the static config. Poke OpenCode.
5. Make sure that `config.updated` occurs and that the agent changes.

Also find the answers to these questions:

1. Do the well-known service and the config service operate in `ServerWorkerd`? The code shows no replacement for them. Nobody has run them.
2. Which config has priority: the remote config or `OPENCODE_CONFIG`? The load order puts the remote config first, so `OPENCODE_CONFIG` overrides it.
3. Core must return the OpenCode config format. Core must not import OpenCode. Decide where the format conversion occurs: in `brain-api`, or in a Ren schema that has the same shape.

## 10. Sources

- OpenCode 2.0.27, from the bundled `@opencode/core` and `@opencode/server` dist: `wellknown.ts`, `config.ts`, `config/plugin/provider.ts`, `integration.ts`, `model-resolver.ts`.
- QM (`yc-software/qm`): version counters inside one process, hashes across boundaries.
- Cloudflare OS (`cloudflare/cloudflare-os`): the config is computed on write and read on each turn.
