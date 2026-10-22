# Infra

Status: proposal. Nothing in this document is built yet. Sections 1 to 7 are decided. Section 8 lists the open areas.

## 1. Purpose

A `.ren/` folder declares a whole organization: its spaces, agents, apps, schedules, webhooks, channels and environments. `ren infra apply` makes the live organization match the folder. `ren infra pull` writes the live organization back to the folder.

The registry holds templates: listings for apps and factories. Installing a template copies its contents into the folder as ordinary declarations. ren-v1's blueprints (`ren-v1/registry/blueprints/`) and its spec (`ren-v1/packages/api/src/blueprint/spec.ts`) are the reference. v1 installs a blueprint once and merges it. Infra replaces that with a declaration that Ren reconciles on every apply.

## 2. Terms

| Term         | Meaning                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Spec         | The `.ren/` folder. It declares one organization.                                                          |
| Bindings     | `deploy.yaml`. The values that belong to one deployment: channel ids, credentials, timezone, secrets.      |
| Managed kind | A kind of row that the spec declares. Every row of a managed kind in the organization belongs to the spec. |
| Plan         | The diff between the spec and the live organization.                                                       |
| Digest       | A hash of one plan. Apply uses it to find a stale plan.                                                    |
| App          | Skills, MCPs, required credentials and environment packages that a space can use.                          |
| Listing      | A registry entry for an app or a factory. It is a template. Only a listing has seeds, never an app.        |
| Seed         | Listing content that installation copies into the spec, for example crons. It exists only in the registry. |
| Factory      | A listing that is a template for one space and its agents.                                                 |

## 3. Scope

1. One spec declares one whole organization.
2. The managed kinds are: spaces, agents, agent memberships, custom apps, app uses, settings (organization, space, agent), environments, crons, webhooks and channel mappings.
3. These are not in the spec: human members and their roles, sessions, tasks and credential values.
4. A row of a managed kind that the spec does not declare shows in the plan as a removal. Apply archives it. To keep a row that someone made in the UI, run `ren infra pull` first.

## 4. Layout

### 4.1 One place for each resource

1. Each resource is defined in one place only. Other places refer to it by name. Nothing is defined twice.
2. The file structure is the declaration. A folder that exists is a resource. There is no separate list of resources.
3. Every reference is explicit. Validation fails on a reference to a resource that the spec does not define.

### 4.2 Schema

`Infra.Spec` in `@ren/schema` (`packages/schema/src/infra.ts`) is the one definition of the spec. It composes the declaration of each primitive. It does not define the fields of a primitive again:

| Spec part                     | Composed from                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `org`                         | `OrganizationSettings.UpdateInput`                                                                       |
| `spaces.<slug>`               | `Infra.SpaceDeclaration`: `Space.CreateInput` fields, `SpaceSettings.UpdateInput` `settings`, and `uses` |
| `spaces.<slug>.agents.<name>` | `Agent.Declaration`: `Agent.CreateInput` without `ownerSpaceId` and `name`                               |
| `spaces.<slug>.<kind>.<slug>` | The declaration of each other primitive (section 4.5)                                                    |
| `moved`                       | `Infra.Move`                                                                                             |

A primitive's declaration is its `CreateInput` without ids and without the fields that the position in the folder gives. When a primitive is implemented, it adds its declaration to its own module, and `Infra.Spec` adds one field for it.

`Infra.Spec` checks the rules that cross spaces: an agent defined in two spaces, a use of an agent that no space defines, and a use of an agent that the space owns.

### 4.3 Folder

The folder is a fixed mapping of `Infra.Spec`:

1. A record of resources becomes one folder for each key: `spaces/<slug>/`, `agents/<name>/`.
2. The other fields of a resource go in one yaml file named after its kind: `space.yaml`, `agent.yaml`.
3. A record of small entries, with no files of their own, becomes one yaml file keyed by slug: `crons.yaml`, `mcps.yaml`.
4. `settings.instructions` goes in `instructions.md` next to the yaml file.

Today the spec has these parts:

```
.ren/
  org.yaml                   # org.settings without instructions
  instructions.md            # org.settings.instructions
  spaces/
    <slug>/
      space.yaml             # name, description, settings, uses
      instructions.md
      agents/
        <name>/
          agent.yaml         # description, isSubagent, settings
          instructions.md
```

Each primitive adds its folder or file when it is implemented: `apps/<slug>/`, `crons.yaml`, `webhooks.yaml`, `channels.yaml`, `environment.yaml`, and `deploy.yaml` for bindings.

### 4.4 Ownership

1. A space owns each agent and custom app under its folder. This is the same ownership that v2 agents have today (`ownerSpaceId`).
2. A space uses everything it owns. Its `space.yaml` does not list them.
3. Another space uses an agent or a custom app through `uses` in its `space.yaml`. Apply makes that a membership, as v2 `AgentMembership` does for agents.
4. To transfer ownership, move the folder to the other space and add a `moved:` entry.

### 4.5 Primitives

Each primitive's declaration is in its own module in `@ren/schema`. This document keeps no copy of the shapes. The shapes come from ren-v1 and change when each primitive is implemented.

| Folder part                          | Schema                                                       | ren-v1 source                                         |
| ------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------- |
| `spaces/<slug>/apps/<slug>/app.yaml` | `App.Declaration`                                            | `registry/blueprints/apps/<slug>/blueprint.yaml`      |
| `apps/<slug>/skills/<slug>/`         | `Skill.Declaration`: `Skill.Content` or `Skill.Upstream`     | `registry/AGENTS.md` (content or pointer, never both) |
| `apps/<slug>/mcps.yaml`              | `Mcp.Declaration`                                            | `mcp.yaml`, `McpEntry` in `registry/src/content.ts`   |
| `requiredCredentials`                | `Credential.Requirement`, `Credential.SkillRequirement`      | `vault/requirements.ts`                               |
| `spaces/<slug>/crons.yaml`           | `Cron.Declaration`                                           | `cron_trigger`                                        |
| `spaces/<slug>/webhooks.yaml`        | `Webhook.Declaration`, `Webhook.Request`                     | `webhook_trigger` with `provider = "generic"`         |
| `spaces/<slug>/channels.yaml`        | `Channel.Declaration`                                        | `SpecChannelBinding` and the channel mapping tables   |
| `spaces/<slug>/environment.yaml`     | `EnvironmentTemplate.Declaration`                            | v2 `EnvironmentTemplate.CreateInput` without `name`   |
| `deploy.yaml`                        | `Infra.Bindings`, with `Channel.Target` and `Credential.Ref` | —                                                     |
| `moved.yaml`                         | `Infra.Move`, `Infra.Path`                                   | —                                                     |

Full tree:

```
.ren/
  org.yaml
  instructions.md
  moved.yaml
  deploy.yaml
  spaces/<slug>/
    space.yaml                 # name, description, settings, uses { agents, apps }
    instructions.md
    environment.yaml
    crons.yaml
    webhooks.yaml
    channels.yaml
    agents/<name>/
      agent.yaml
      instructions.md
    apps/<slug>/
      app.yaml
      mcps.yaml
      skills/<slug>/           # SKILL.md and its files, or skill.yaml
```

Rules that `Infra.Spec` checks across spaces, beyond the agent rules in section 4.2:

1. An app is defined in one space only. A space does not list an app it owns in `uses`.
2. A space that uses a custom app also uses each app in its `dependsOn`. A registry app's dependencies are checked by `plan`, because `validate` runs without the registry.
3. Each skill slug and MCP slug is defined in one custom app only.
4. A cron, webhook or channel names an agent that is in its space, or no agent.
5. A `from` path in `moved.yaml` does not exist in the spec, and a `to` path does.

An MCP with header or basic auth names credentials from its own `requiredCredentials` (`Mcp.Declaration`). A credential marked `optional` is not asked for at install.

An MCP declares no tool list. Ren reads its tools live with `tools/list` after a credential is connected, and refreshes them on `notifications/tools/list_changed`. A tool is read-only or destructive by its annotations (`readOnlyHint`, `destructiveHint`), or by Composio's tags. A tool with no annotations counts as a write. Annotations are hints, so Ren trusts them only from a trusted server. Overrides are `Permission.Rule` entries in settings.

All slugs use `Primitive.Slug`: lowercase letters and digits joined by single dashes, at most 64 characters. This is the Agent Skills name rule, so a skill folder name is also a valid `SKILL.md` name.

## 5. Rules

### 5.1 Template and bindings

1. The spec declares slots, such as a Slack channel with a purpose. `deploy.yaml` binds each slot to a real value.
2. The spec contains no value that belongs to one deployment. Two organizations can use the same spec with different bindings.

### 5.2 Agents

1. An agent is defined one time in the organization, in the folder of its owner space. A second definition with the same name fails validation.
2. Agent settings are the same in every space. A difference between spaces comes from space settings.

### 5.3 Apps

1. There is no organization-level install. Apps are resources of spaces.
2. An app contains skills, zero or more MCPs, required credentials and environment packages.
3. A space uses a registry app through a reference in `space.yaml` `apps`. The spec contains no versions and Ren keeps no lockfile. The app floats to the latest version. The row for each use records the version that apply applied, and the plan shows a new version as a change, for example `linear 1.2 → 1.3`. A new version reaches a space only through apply.
4. A custom app has the same folder format as a registry app, so it can be published later. A custom app with the slug of a registry app fails validation.
5. An app can depend on other apps by slug (`dependsOn`). A dependency is a reference, not a use. Validation fails when a space uses an app but does not use each of its dependencies.
6. Each skill slug and each MCP slug has one definition across all apps in the organization. A second definition fails validation. The error names both apps and tells the author to move the definition into a shared app that both depend on.
7. The environment of a space is its `environment.yaml` plus the union of the environment packages of the apps it uses. Two versions of the same package fail validation.
8. Required credentials are bound per space in `deploy.yaml`. Two spaces can use different accounts for one app.

### 5.4 Listings and seeds

1. Seeds exist only in a registry listing. The spec has no seeds and Ren keeps no seed state.
2. Installing a listing copies its seeds into the spec as ordinary declarations. Example: the crons of an app listing go into the `crons.yaml` of the installing space. Then `apply` reconciles them like any other declaration.
3. A seeded cron runs on the agent it names. A cron that names no agent runs on the space's `ren` agent. Validation fails if the named agent is not in the space.
4. Tasks are not infrastructure. Installing a listing drops its tasks. Reconciling them would reopen tasks that people closed.
5. Databases and dashboards are templates in the listing. Installing a listing tells the agent to build them. The result is live state that the agent owns. It is not in the spec.
6. A factory gets into the spec as a copy of its files. The copy has no link back to the registry.
7. "Usecase" is a browse category in the registry. It is not a kind of listing.

### 5.5 Drift

1. The spec wins. Apply overwrites a change that someone made in the UI. The plan shows that change before apply overwrites it.
2. The UI does not change. It shows no "managed" marker and locks no field.
3. No field can opt out of reconciliation. If a need for that comes up, add it later.

### 5.6 Removal

1. Apply archives a row that the spec no longer declares. It never hard-deletes the row. Sessions and history stay.
2. To remove everything, delete the folders and apply. There is no destroy command.
3. A `moved:` entry renames or moves a resource. Without one, a rename is an archive plus a create.

## 6. Plan and apply

### 6.1 No state

Terraform keeps state to map addresses to ids, to know what it created, and to tell spec changes from live edits. Ren needs none of these:

- Natural keys (unique per organization) map the spec to rows. `moved:` entries handle renames.
- The spec declares the whole organization, so a row of a managed kind that the spec does not declare is a removal.
- The spec wins in both cases, so a two-way diff of the spec and the live organization is enough.

Ren keeps no state for infra. No row keeps a hash.

### 6.2 Locking

1. Apply runs in one Postgres transaction. The transaction first locks the organization row (`SELECT … FOR NO KEY UPDATE`). A second apply waits, then runs against the result of the first.
2. Apply writes only database rows. Work that is slow or that calls an external service runs after the commit, from the new rows. Examples: provision an environment, schedule a cron, register a channel mapping. If that work fails, Ren retries it. The spec is never half-applied.
3. If the process stops, Postgres rolls back the transaction and releases the lock. No lock can stay held.

### 6.3 Stale plans

1. `plan` returns the diff and its digest.
2. `apply` sends the spec and the digest. In the lock, the server computes the diff again. If the digest is different, apply fails with "plan is stale, run ren infra plan again".
3. This finds every change since the plan: another apply, a UI edit, or a new registry version.
4. Two people who apply from two different local folders is a human problem. Each person must update their folder before they apply. Ren does not check where a folder came from.

## 7. Commands

All commands are in the `ren infra` group.

| Command    | Does                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `validate` | Checks the folder without the network: schema, references, duplicate definitions, reserved names.          |
| `plan`     | Diffs the folder against the live organization. Prints the plan and its digest.                            |
| `apply`    | Plans, asks for confirmation, then applies with the digest. Prints generated values, such as webhook URLs. |
| `pull`     | Writes the live organization to `.ren/`. It overwrites local files. Git keeps local changes safe.          |

## 8. Open areas

1. **Personal spaces.** `SpaceProvisioning` gives each user a personal space. The `space` table has no column that marks it. The spec declares the whole organization, so the first apply would archive every personal space. Decide: personal spaces are not a managed kind (add a marker column), or a personal space is a binding.
2. **Natural keys.** Spaces are keyed by `Primitive.Slug` in the schema, but the `space` table has no slug column yet. Plan cannot map a space folder to a row before the column exists. Make a list of each managed kind that needs a slug unique per organization. `EnvironmentTemplate` has only a name.
3. **Environment packages.** Section 5.3 rule 7 merges app packages into the environment of the space. v2 provider config is specific to each provider: the Docker provider takes an `image` and has no package list. Decide: a provider gets a package capability (it builds an image), or an app states its packages and validation checks that the image has them.
4. **Reserved agent names.** `AgentDefaults.reserved` (`ren`, `general`, `explore`, …) is in `@ren/core`, so `Infra.Spec` cannot check it. Move the list to `@ren/schema`, or check it in `validate`.
5. **The ren agent.** A cron without an agent runs on the space's `ren` agent. `ren` is a global agent (`organization_id` is null), not a space agent. Confirm that a cron session on a global agent gets the settings of its space.
6. **Credential tiers.** Section 5.3 binds credentials per space. v1 also had organization and user tiers (`vault`). A personal OAuth connection, for example a user's Gmail, is not a space value. Decide whether a binding can name a user credential.
7. **`pull` and bindings.** `pull` writes the spec. Decide whether it also writes `deploy.yaml` with the live channel ids and credential names. It never writes credential values.
8. **Installing a listing.** The command that copies a listing into a space, and what it writes.
9. **Agents.** Visual character and voice, and the view order of agents in a space.
10. **Runtimes.** `specs/runtime/plan.md` (PR #43) moves brains to one sandbox per space, with tools that run in the sandbox. Then a space's environment is its sandbox image, not an `EnvironmentTemplate`, and app packages become an image build. The plan also keeps `space.runtime` out of the public API, so it is not in the spec.
11. **Secrets in a sandbox.** In a sandbox shared by a space, the agent can read the values of the credentials that the space binds.
12. **Read-only installs.** A rule that denies every tool that is not read-only needs a permission rule that can match the live classification of a tool.
