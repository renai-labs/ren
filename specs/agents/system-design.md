# Agents: system design

Services, Layers, data and the cell adapter for [v1.md](v1.md). Names are proposals and follow the `AGENTS.md` files.

The document is written in ASD-STE100 Simplified Technical English.

- [1. Rules for the design](#1-rules-for-the-design)
- [2. The parts and their packages](#2-the-parts-and-their-packages)
- [3. Schema](#3-schema)
- [4. Database](#4-database)
- [5. Core services](#5-core-services)
- [6. Merge services: how to change a rule fast](#6-merge-services-how-to-change-a-rule-fast)
- [7. Resolve](#7-resolve)
- [8. Live settings: push and pull](#8-live-settings-push-and-pull)
- [9. The cell adapter](#9-the-cell-adapter)
- [10. HTTP API](#10-http-api)
- [11. Tests](#11-tests)
- [12. Work list](#12-work-list)

## 1. Rules for the design

- Core resolves. The cell applies. The cell knows only resolved settings, not orgs, spaces, agents or layers.
- One merge service for each field. A new rule is a new Layer in the deployment. Callers do not change.
- Merge methods are plain functions, not Effects. The service exists only so that a Layer can replace them.
- Permissions are a set of deny and ask rules (P11). Core sends one list. The cell needs no permission logic of its own.
- Core and the Brain API use Ren names. The adapter maps them to harness names.
- Ren checks a model against the catalog on write and on resolve.

## 2. The parts and their packages

```

  @ren/schema       Settings · Permission · Agent · AgentMembership · Session.Settings (resolved)
       │
       ├──────────────────────────────┬──────────────────────────────┐
       ▼                              ▼                              ▼
  @ren/db                        @ren/protocol                  @ren/brain-api
  system_settings (Ren)          agent, agent-membership        brain.configureSettings  (push)
  space_settings                 space and session changes      settings.get             (pull)
  organization_settings
  agent · agent_membership
  agent_session (+2 columns)
       │                              │                              │
       └──────────────┬───────────────┘                              │
                      ▼                                              │
  @ren/core                                                          │
    Agent · AgentMembership · Defaults           (primitives, data)  │
    InstructionsMerge · ModelMerge · PermissionsMerge  (rules)       │
    Settings                                     (resolve)           │
    Session (PR #32)                             (create, update)    │
    SettingsSync                                 (push)  ────────────┤
                      │                                              │
                      ▼                                              ▼
  @ren/server   handlers only                    @ren/cell   OpenCode adapter + Ren plugin

```

## 3. Schema

All shapes are in `@ren/schema`.

```ts
// @ren/schema/permission.ts
export const Effect = Schema.Literals(["ask", "deny"])
export const Rule = Schema.Struct({ action: Schema.NonEmptyString, resource: Schema.NonEmptyString, effect: Effect })
export const RuleList = Schema.Array(Rule)

// @ren/schema/settings.ts
export const Settings = Schema.Struct({
  instructions: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Session.Model),
  permissions: RuleList.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
})

// @ren/schema/agent.ts
export const Info = Schema.Struct({
  id: ID,
  organizationId,
  ownerSpaceId: Space.ID,
  name,
  description: Schema.NullOr(Schema.String),
  isSubagent: Schema.Boolean,
  settings: Settings,
  createdAt,
  updatedAt,
  archivedAt,
})

// @ren/schema/agent-membership.ts
export const Info = Schema.Struct({ id: ID, spaceId: Space.ID, agentId: Agent.ID, isOwner: Schema.Boolean, createdAt })

// @ren/schema/session.ts
export const Settings = Schema.Struct({
  version: Schema.NonEmptyString,
  model: Model,
  instructions: Instructions,
  permissions: Permission.RuleList,
  subagents: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      name: Schema.String,
      description: Schema.String,
      model: Model,
      instructions: Instructions,
      permissions: Permission.RuleList,
    }),
  ),
})
```

`Session.StartInput` changes: `agent`, `model` and `instructions` go. One field `settings: Session.Settings` replaces them. `harness`, `interactive` and `environment` stay.

## 4. Database

Tables are in `@ren/db/src/*.sql.ts`, with snake_case keys.

```

  system_settings (Ren)                organization_settings                space_settings
  ─────────────────────                ─────────────────────                ──────────────
  id               PK, one row         organization_id  PK → organization   space_id  PK → space
  settings         jsonb (Settings)    settings         jsonb (Settings)    settings  jsonb (Settings)
  updated_at                           updated_at                           updated_at


  agent                                         agent_membership
  ─────                                         ────────────────
  id               PK                           id          PK
  organization_id  → organization               space_id    → space
  owner_space_id   → space                      agent_id    → agent
  name             unique in org (A8)           created_at
  description                                   unique (space_id, agent_id)
  is_subagent      boolean                      only spaces that are not the owner (O2)
  settings         jsonb (Settings)
  created_at · updated_at · archived_at


  agent_session  (PR #32, two new columns)
  ─────────────
  agent_id         → agent, nullable, on delete set null     null = Ren (N1, W6)
  overrides        jsonb (Settings), nullable                the session layer (W6)
  start_input      jsonb   now a copy of the last resolved settings (L4)

```

- Operators seed `system_settings`. A migration makes the row. The app has no endpoint that writes it (C9).
- `organization_settings` is a Ren table, because Better Auth owns `organization`. A missing row means an empty Settings.
- The member spaces of an agent are `owner_space_id` plus its `agent_membership` rows. The API joins them into one list with `isOwner`.
- Moving ownership is one transaction (O5). It deletes the membership row of the new owner, if any. It sets `owner_space_id`, and adds a membership row for the old owner.
- Archiving a space fails with `Conflict` while it owns a live agent (O6).
- Archiving an agent deletes its `agent_membership` rows in the same transaction (A6).
- Sessions keep `agent_id` after the archive. Resolve skips an agent that is archived or not a member of the space of the session. The session is then a Ren session (W9).

## 5. Core services

Each service follows `packages/core/AGENTS.md`: `Interface`, `Service`, `layer`, methods with `Effect.fn("<Name>.<method>")`. A primitive takes the `Actor.Info` first and fails only with `NotFound`, `Forbidden` or `Conflict`.

```

  SERVICE             KIND        NEEDS                                   GIVES
  ──────────────────  ──────────  ──────────────────────────────────────  ─────────────────────────────────────
  Agent               primitive   Database, Access, Models                list · get · create · update · archive
                                                                          · transferOwnership
  AgentMembership     primitive   Database, Access                        list · create (add) · archive (remove)
  Defaults            data        Database, Access, Models                ren: get (no write)
                                                                          org: get · update
                                                                          space: get · update
  InstructionsMerge   rule        —                                       merge(layers) → Instructions
  ModelMerge          rule        —                                       merge(layers) → Model | undefined
  PermissionsMerge    rule        —                                       merge(layers) → RuleList
  Settings            logic       Database, Models, the three merges      resolve(sessionId) → Session.Settings
  Session (PR #32)    primitive   Database, BrainHost, Settings           create · send · update overrides
  SettingsSync        logic       Database, Settings, BrainHost           changed(scope) → push to open cells

```

The access rules (C1 to C9) go into the policy documents of `Access`, the same as `SpacePolicy`. New relationships:

- `agent.ownerMember`: member of the owner space.
- `agent.spaceMember`: member of a space where the agent is a member.
- `target.spaceMember`: member of the target space of an add or a transfer.

Org admins use the existing `everywhere` statements.

## 6. Merge services: how to change a rule fast

A merge service gets the layers in order and gives one value. It does not know which layer is which.

```ts
// @ren/core/settings/merge.ts
export interface Layer {
  readonly instructions?: string
  readonly model?: Session.Model
  readonly permissions: Permission.RuleList
}

export class InstructionsMerge extends Context.Service<
  InstructionsMerge,
  {
    readonly merge: (layers: ReadonlyArray<{ readonly key: string; readonly layer: Layer }>) => Session.Instructions
  }
>()("@ren/core/InstructionsMerge") {}

export class ModelMerge extends Context.Service<
  ModelMerge,
  {
    readonly merge: (layers: ReadonlyArray<Layer>) => Session.Model | undefined
  }
>()("@ren/core/ModelMerge") {}

export class PermissionsMerge extends Context.Service<
  PermissionsMerge,
  {
    readonly merge: (layers: ReadonlyArray<Layer>) => Permission.RuleList
  }
>()("@ren/core/PermissionsMerge") {}
```

The v1 Layers, and examples of other Layers:

```

  SERVICE             v1 LAYER                 WHAT IT DOES                           OTHER LAYERS TO TRY
  ──────────────────  ───────────────────────  ─────────────────────────────────────  ──────────────────────────────
  InstructionsMerge   layerAppend              one entry for each layer key           layerReplace (last text wins)
                                                                                      layerLockable (a layer locks a key)
  ModelMerge          layerLaterWins           the last layer that sets a model       layerAgentLocked (session cannot
                                                                                      change the model of an agent)
  PermissionsMerge    layerUnion               all rules of all layers, without       layerOnly (adds a per-layer
                                               duplicates, sorted                     allowlist, intersected)

```

To change a rule, change one line in the deployment:

```ts
Settings.layer.pipe(
  Layer.provide([InstructionsMerge.layerAppend, ModelMerge.layerLaterWins, PermissionsMerge.layerUnion]),
)
```

Each Layer has its own test file. The test gives layers and checks the value. It needs no database.

## 7. Resolve

```

  Settings.resolve(sessionId)
     │
     ├─ read  agent_session            → org, space, agent_id, overrides, interactive
     ├─ read  system_settings          → Ren layer
     ├─ read  organization_settings    → org layer
     ├─ read  space_settings           → space layer
     ├─ read  agent                    → agent layer, only if it is live AND a member of the space (W9)
     ├─ read  member subagents         → one resolve each: org + space + subagent (S2)
     │
     ├─ layers = agent?  [org, space, agent, overrides?]          (explicit agent)
     │                 : [ren, org, space, overrides?]            (Ren, N5)
     │
     ├─ instructions = InstructionsMerge.merge(keyed layers)
     ├─ model        = ModelMerge.merge(layers) ?? Ren's model    (N6, M3)
     │                 check model and variant in Models.catalog → fail UnknownModel (M4, M5)
     ├─ permissions  = PermissionsMerge.merge(layers)
     │
     ├─ subagents[i] = org + space + subagent, model fallback Ren's model
     │   .permissions = PermissionsMerge.merge([org, space, subagent, parent agent?, overrides?])
     │                  (S4: the rules of the parent apply too)
     │
     └─ version = SHA-256 of the canonical bytes (all lists sorted by id)
```

- Equal inputs give equal bytes. An equal version means no change.
- `Settings.UnknownModel` is a tagged error. It names the model and the layer.
- `Session.create` calls resolve, writes `start_input`, then calls `BrainHost.start`. `Session.update` writes `overrides`, then calls `SettingsSync`.

## 8. Live settings: push and pull

```

     write (Ren, org defaults, space defaults, agent, membership, ownership, session overrides)
        │
        │   same transaction: no push yet
        ▼
     commit
        │
        ▼
     SettingsSync.changed(scope)
        │
        │   scope              sessions that it affects
        │   ───────────────    ─────────────────────────────────────────────────────
        │   Ren                all root sessions with no live agent, in all orgs
        │   org                all root sessions of the org
        │   space              all root sessions of the space
        │   agent (primary)    sessions with this agent_id
        │   agent (subagent)   all root sessions of the spaces where it is a member
        │   membership         all root sessions of the space
        │   ownership          nothing. Ownership does not change resolution (Q6)
        │   overrides          the session
        │
        ▼
     for each session with recent activity:            (push, fast)
        Settings.resolve ──▶ BrainHost.configureSettings(sessionId, settings)
                                    │
                                    ▼
                               cell: same version? do nothing. Else apply.


     cell opens, or a turn starts:                     (pull, sure)
        cell ──▶ settings.get (host token) ──▶ Settings.resolve ──▶ settings + version
```

- Push is best effort. A failed push does not fail the write. Pull catches every missed push.
- Push goes only to sessions with recent activity, because a push to a closed cell opens it. "Recent" is open ([edge cases](edge-cases.md#5-live-settings)).
- `settings.get` uses the host token, the same as `models.refresh` (`@ren/brain-api/models-api.ts`) and the sync API of PR #32.

## 9. The cell adapter

The adapter maps `Session.Settings` to OpenCode calls, and keeps the last applied version in memory.

```

  RESOLVED SETTINGS        OPENCODE                                        WHEN
  ───────────────────────  ──────────────────────────────────────────────  ────────────────────────────
  model                    session.switchModel                             next model call
  instructions             session.instructions.entry put / remove          next model call
  permissions              agent.permissions, sorted (9.1)                 next tool call
  subagents                agent.transform: update(id, mode "subagent",    next subagent start
                           model, system, permissions) and remove old ids
  built-in agents          agent.transform: remove build, plan, general,   at open
                           explore. Add one primary agent "ren" (S7)
  interactive false        permission hook: ask → deny, with a message     next tool call (P8)

```

### 9.1 Strictest answer in the cell

OpenCode takes the last matching rule (`Permission.evaluate`). The adapter sorts the list so that the last match is the strictest:

```

  agent.permissions  =  [ * * allow ]               no match gives allow (P7). OpenCode alone gives ask.
                        ++ ask rules
                        ++ deny rules, specific resources
                        ++ deny rules, resource "*"   last, so that OpenCode hides the tool (P10)

```

- A matching deny is always after a matching ask. Thus deny wins, then ask, then allow.
- A subagent gets its own sorted list in its agent definition. Its list holds the rules of the parent (S4).
- OpenCode hides a tool when the last rule for its action has resource `*` and effect `deny`. The sort puts these rules last. A test checks this (P10).

### 9.2 Headless sessions

The only Ren permission hook. For a session with `interactive` false, the `permission.hook` `evaluate` changes `ask` into `deny` and sets a message for the model (P8). OpenCode does not call the hook after a deny, so the hook never sees a deny.

### 9.3 Action names

Ren action names are the OpenCode 2 names today. The OpenCode adapter uses an identity map. A later adapter (for example Claude Code) has its own map. The map is in the adapter, not in core (P3).

## 10. HTTP API

All groups are primitive groups (`packages/protocol/AGENTS.md`).

```

  GROUP                   OPERATIONS
  ──────────────────────  ─────────────────────────────────────────────────────────
  agent                   list · get · create · update · archive
  agent                   + action transferOwnership (target space)
  agent-membership        list · create (add) · archive (remove)
  space                   update: also takes `defaults` (Settings) · archive: Conflict while it owns a live agent
  organization-settings   get · update
  session                 create: takes `agentId?` · update: takes `overrides`

```

The Brain API (`@ren/brain-api`) gets two endpoints:

```

  brain.configureSettings   PUT  /ren/settings              Ren → cell    push    server scope
  settings.get              GET  /brain/settings            cell → Ren    pull    host token

```

## 11. Tests

```

  LEVEL            WHAT                                                         WHERE
  ───────────────  ───────────────────────────────────────────────────────────  ───────────────────────
  merge Layers     each rule with layers in, value out. No database.             core/test/settings/
  resolve          real Postgres. Layers, archive, detach, catalog errors.       core/test/settings.test.ts
  access           C1 to C6 for each operation.                                  core/test/agent*.test.ts
  push             a write reaches an open cell. A failed push loses nothing.    core/test/settings-sync
  adapter          resolved settings in, OpenCode state out.                     cell/test/brain-api
  permissions      sort order, no-match allow, headless ask, tool hiding.      cell/test/permissions
  end to end       space makes an agent, adds it to a second space, starts a     e2e
                   chat there, edits it, moves ownership.

```

## 12. Work list

1. Schema: `Permission`, `Settings`, `Agent`, `AgentMembership`, `Session.Settings`. Change `StartInput`.
2. Database: five tables, the seeded Ren row, two columns on `agent_session`. One migration.
3. Core: the three merge services with their v1 Layers and tests.
4. Core: `Defaults`, `Agent` (with transfer), `AgentMembership`, the space archive check, with their policy documents.
5. Core: `Settings.resolve` and `Settings.UnknownModel`.
6. Core: `Session.create` with `agentId`, `Session.update` with `overrides`.
7. Brain API: `brain.configureSettings`, `settings.get`.
8. Cell: adapter mapping, sorted permissions, headless hook, built-in agents, subagents.
9. Core: `SettingsSync` push.
10. Protocol, server and generated clients.
11. App: defaults forms, space membership tab (users and agents, new agent), agent pages, picker with Ren, session edit panel.
