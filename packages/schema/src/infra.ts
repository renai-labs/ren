export * as Infra from "./infra.js"

import { Effect, Schema, Struct } from "effect"
import { Agent } from "./agent.js"
import { App } from "./app.js"
import { AppProfile } from "./app-profile.js"
import { Channel } from "./channel.js"
import { Credential } from "./credential.js"
import { EnvironmentTemplate } from "./environment-template.js"
import { Factory } from "./factory.js"
import { FactoryCheck } from "./factory-check.js"
import { Memory } from "./memory.js"
import { OrganizationSettings } from "./organization-settings.js"
import { Primitive } from "./primitive.js"
import { Schedule } from "./schedule.js"
import { Settings } from "./settings.js"
import { Space } from "./space.js"
import { SpaceSettings } from "./space-settings.js"
import { Webhook } from "./webhook.js"

const runners = { schedules: "Schedule", webhooks: "Webhook", channels: "Channel" } as const

const RenamedFrom = Schema.optionalKey(
  Schema.Array(Primitive.Slug).annotate({
    description: "Earlier names. Apply renames the live row that has one of them, so its history stays.",
  }),
)

export interface Uses extends Schema.Schema.Type<typeof Uses> {}
export const Uses = Schema.Struct({
  agents: Schema.Array(Agent.Name).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({ identifier: "Infra.Uses" })

export interface FactoryEdgeDeclaration extends Schema.Schema.Type<typeof FactoryEdgeDeclaration> {}
export const FactoryEdgeDeclaration = Schema.Struct({
  agent: Agent.Name,
  max: Factory.Edge.fields.max,
  else: Schema.optionalKey(Agent.Name),
  start: Factory.Edge.fields.start,
}).annotate({ identifier: "Infra.FactoryEdgeDeclaration" })

export interface FactoryDeclaration extends Schema.Schema.Type<typeof FactoryDeclaration> {}
export const FactoryDeclaration = Schema.Struct({
  maxHandoffs: Factory.Info.fields.maxHandoffs,
  agents: Schema.Array(
    Schema.Struct({
      agent: Agent.Name,
      maxRuns: Factory.Entry.fields.maxRuns,
      to: Schema.optionalKey(Schema.Array(FactoryEdgeDeclaration)),
    }),
  ).check(
    Schema.isMaxLength(Factory.maximumAgents, {
      message: `A factory has at most ${Factory.maximumAgents} agents.`,
    }),
  ),
}).annotate({
  identifier: "Infra.FactoryDeclaration",
  description: "The space’s factory, with agent names. Without it, the factory has no agents.",
})

const PulledMemory = Memory.Files.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({})))

const MemoryFiles = Schema.Record(Memory.SafePath, Schema.String)
  .check(
    Schema.makeFilter(
      (files) => Object.keys(files).length === 0 || Memory.root in files || `A memory folder needs ${Memory.root}.`,
    ),
  )
  .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({})))

export interface SpaceDeclaration extends Schema.Schema.Type<typeof SpaceDeclaration> {}
export const SpaceDeclaration = Schema.Struct({
  ...Struct.omit(Space.CreateInput.fields, ["slug"]),
  renamedFrom: RenamedFrom,
  description: Schema.optionalKey(Schema.String),
  settings: SpaceSettings.UpdateInput.fields.settings.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({ permissions: [], references: [] })),
  ),
  agents: Schema.Record(Agent.Name, Schema.Struct({ ...Agent.Declaration.fields, renamedFrom: RenamedFrom })).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
  apps: Schema.Record(Primitive.Slug, Schema.Struct({ ...App.Declaration.fields, renamedFrom: RenamedFrom })).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
  schedules: Schema.Record(Primitive.Slug, Schedule.Declaration).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
  webhooks: Schema.Record(Primitive.Slug, Webhook.Declaration).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
  channels: Schema.Record(Primitive.Slug, Channel.Declaration).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
  environment: Schema.optionalKey(EnvironmentTemplate.Declaration),
  memory: MemoryFiles,
  factory: Schema.optionalKey(
    FactoryDeclaration.check(Schema.makeFilter((factory) => FactoryCheck.issues(factory.agents, "agent"))),
  ),
  uses: Uses.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({ agents: [] }))),
}).annotate({ identifier: "Infra.SpaceDeclaration" })

export interface Spec extends Schema.Schema.Type<typeof Spec> {}
export const Spec = Schema.Struct({
  org: OrganizationSettings.UpdateInput,
  memory: MemoryFiles,
  spaces: Schema.Record(Primitive.Slug, SpaceDeclaration),
})
  .check(
    Schema.makeFilter((spec) => {
      const spaces = Object.entries(spec.spaces)
      const owners = {
        agents: Map.groupBy(
          spaces.flatMap(([space, declaration]) => Object.keys(declaration.agents).map((name) => ({ space, name }))),
          (owned) => owned.name,
        ),
        apps: Map.groupBy(
          spaces.flatMap(([space, declaration]) =>
            Object.entries(declaration.apps).map(([name, app]) => ({ space, name, app })),
          ),
          (owned) => owned.name,
        ),
      }
      const apps = [...owners.apps.values()].flatMap((owned) => owned.slice(0, 1))
      return [
        ...App.dependencyCycles(new Map(apps.map((owned) => [owned.name, owned.app]))).map((cycle) => ({
          path: ["spaces"],
          issue: `App dependency cycle: ${cycle}.`,
        })),
        ...(["agents", "apps"] as const).flatMap((kind) =>
          [...owners[kind]].flatMap(([name, owned]) =>
            owned.slice(1).map((duplicate) => ({
              path: ["spaces", duplicate.space, kind, name],
              issue: `${kind === "agents" ? "Agent" : "App"} "${name}" is defined in ${owned.map((entry) => entry.space).join(" and ")}.`,
            })),
          ),
        ),
        ...[...owners.agents.values()]
          .flat()
          .filter((owned) => Agent.reserved.has(owned.name))
          .map((owned) => ({
            path: ["spaces", owned.space, "agents", owned.name],
            issue: `The name ${owned.name} is reserved.`,
          })),
        ...spaces.flatMap(([space, declaration]) =>
          declaration.uses.agents.flatMap((name, index) => {
            const path = ["spaces", space, "uses", "agents", index]
            if (name in declaration.agents)
              return [{ path, issue: `Space "${space}" owns agent "${name}", so it does not list it in uses.` }]
            if (!owners.agents.has(name))
              return [{ path, issue: `Space "${space}" uses agent "${name}", which no space defines.` }]
            return []
          }),
        ),
        ...[
          ...spaces.map(([space, declaration]) => ({
            noun: "Space",
            path: ["spaces", space],
            name: space,
            renamedFrom: declaration.renamedFrom,
            defined: (earlier: string) => earlier in spec.spaces,
          })),
          ...spaces.flatMap(([space, declaration]) =>
            Object.entries(declaration.agents).map(([name, owned]) => ({
              noun: "Agent",
              path: ["spaces", space, "agents", name],
              name,
              renamedFrom: owned.renamedFrom,
              defined: (earlier: string) => owners.agents.has(earlier),
            })),
          ),
          ...apps.map((owned) => ({
            noun: "App",
            path: ["spaces", owned.space, "apps", owned.name],
            name: owned.name,
            renamedFrom: owned.app.renamedFrom,
            defined: (earlier: string) => owners.apps.has(earlier),
          })),
        ].flatMap((renamed) =>
          (renamed.renamedFrom ?? []).filter(renamed.defined).map((earlier) => ({
            path: [...renamed.path, "renamedFrom"],
            issue: `${renamed.noun} "${renamed.name}" is renamed from "${earlier}", which the spec still defines.`,
          })),
        ),
        ...(["skills", "mcps"] as const).flatMap((kind) =>
          [
            ...Map.groupBy(
              apps.flatMap((owned) =>
                Object.keys(owned.app[kind]).map((name) => ({ space: owned.space, name: owned.name, resource: name })),
              ),
              (entry) => entry.resource,
            ),
          ].flatMap(([name, defined]) =>
            defined.slice(1).map((duplicate) => ({
              path: ["spaces", duplicate.space, "apps", duplicate.name, kind, name],
              issue: `${kind === "skills" ? "Skill" : "MCP"} "${name}" is defined in apps ${defined.map((entry) => entry.name).join(" and ")}. Move it into an app that both depend on.`,
            })),
          ),
        ),
        ...spaces.flatMap(([space, declaration]) => {
          const agents = new Set([...Object.keys(declaration.agents), ...declaration.uses.agents])
          return [
            ...Object.entries(declaration.schedules).map(([name, schedule]) => ({
              kind: "schedules" as const,
              name,
              agent: schedule.agent,
            })),
            ...Object.entries(declaration.webhooks).map(([name, webhook]) => ({
              kind: "webhooks" as const,
              name,
              agent: webhook.agent,
            })),
            ...Object.entries(declaration.channels).map(([name, channel]) => ({
              kind: "channels" as const,
              name,
              agent: channel.agent,
            })),
          ].flatMap((runner) =>
            !runner.agent || agents.has(runner.agent)
              ? []
              : [
                  {
                    path: ["spaces", space, runner.kind, runner.name, "agent"],
                    issue: `${runners[runner.kind]} "${runner.name}" in space "${space}" runs on agent "${runner.agent}", which is not in the space.`,
                  },
                ],
          )
        }),
        ...spaces.flatMap(([space, declaration]) => {
          const agents = new Set(["ren", ...Object.keys(declaration.agents), ...declaration.uses.agents])
          return (declaration.factory?.agents ?? []).flatMap((entry, index) =>
            agents.has(entry.agent)
              ? []
              : [
                  {
                    path: ["spaces", space, "factory", "agents", index, "agent"],
                    issue: `The factory of space "${space}" names agent "${entry.agent}", which is not in the space.`,
                  },
                ],
          )
        }),
      ]
    }),
  )
  .annotate({ identifier: "Infra.Spec" })

export interface SpaceBindings extends Schema.Schema.Type<typeof SpaceBindings> {}
export const SpaceBindings = Schema.Struct({
  timezone: Schema.optionalKey(Schema.TimeZoneNamedFromString),
  channels: Schema.Record(Primitive.Slug, Channel.Target).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  profiles: Schema.Record(Primitive.Slug, Schema.Array(AppProfile.Slug))
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({})))
    .annotate({ description: "For each app, the slugs of its shared profiles that list this space." }),
  webhooks: Schema.Record(Primitive.Slug, Schema.Struct({ secret: Credential.Ref })).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
}).annotate({ identifier: "Infra.SpaceBindings" })

export interface Bindings extends Schema.Schema.Type<typeof Bindings> {}
export const Bindings = Schema.Struct({
  organization: Schema.NonEmptyString.annotate({ description: "The slug of the organization." }),
  spaces: Schema.Record(Primitive.Slug, SpaceBindings).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
}).annotate({ identifier: "Infra.Bindings" })

export const Kind = Schema.Literals([
  "organization",
  "space",
  "agent",
  "membership",
  "app",
  "schedule",
  "channel",
  "profile",
  "memory",
]).annotate({
  identifier: "Infra.Kind",
})
export type Kind = typeof Kind.Type

export interface Value extends Schema.Schema.Type<typeof Value> {}
export const Value = Schema.Struct({
  field: Schema.String.annotate({ description: "The field, with dots for nested fields: settings.instructions." }),
  ren: Schema.optionalKey(Schema.String.annotate({ description: "The value in Ren. Without it, Ren has none." })),
  folder: Schema.optionalKey(
    Schema.String.annotate({ description: "The value in the folder. Without it, the folder has none." }),
  ),
}).annotate({ identifier: "Infra.Value", description: "A field that differs between Ren and the folder, as text." })

export interface Change extends Schema.Schema.Type<typeof Change> {}
export const Change = Schema.Struct({
  action: Schema.Literals(["create", "update", "archive"]).annotate({
    description: "What apply does to make Ren match the folder.",
  }),
  status: Schema.optionalKey(
    Schema.Literals(["conflict", "changed", "new"]).annotate({
      description:
        "Without it, apply runs the change. conflict: changed in the folder and in Ren since the lock; apply runs it only with force. changed: changed in Ren only. new: in Ren and not in the lock. Apply skips changed and new, and pull writes them.",
    }),
  ),
  kind: Kind,
  path: Schema.String.annotate({
    description:
      "Where the spec declares it: org, spaces/<slug>, spaces/<slug>/agents/<name>, spaces/<slug>/uses/agents/<name>, spaces/<slug>/apps/<slug>, spaces/<slug>/schedules/<slug>, spaces/<slug>/channels/<slug>, memory/<file>, spaces/<slug>/memory/<file> or deploy.yaml/spaces/<slug>/profiles/<app>/<profile>.",
  }),
  from: Schema.optionalKey(Schema.String.annotate({ description: "The path before a rename or a move." })),
  fields: Schema.Array(Schema.String).annotate({ description: "The fields that an update changes." }),
  values: Schema.optionalKey(Schema.Array(Value)),
}).annotate({ identifier: "Infra.Change" })

export interface Problem extends Schema.Schema.Type<typeof Problem> {}
export const Problem = Schema.Struct({ path: Schema.String, message: Schema.String }).annotate({
  identifier: "Infra.Problem",
})

export interface Lock extends Schema.Schema.Type<typeof Lock> {}
export const Lock = Schema.Struct({
  organization: Bindings.fields.organization,
  resources: Schema.Record(Schema.String, Schema.String).annotate({
    description: "For each resource path, the version that the folder last saw.",
  }),
}).annotate({
  identifier: "Infra.Lock",
  description: "The ren.lock file. Pull and apply write it; plan, apply and pull read it.",
})

export interface PlanInput extends Schema.Schema.Type<typeof PlanInput> {}
export const PlanInput = Schema.Struct({
  spec: Spec,
  bindings: Bindings,
  lock: Schema.optional(Lock.annotate({ description: "Without it, the folder has not pulled yet." })),
}).annotate({ identifier: "Infra.PlanInput" })

export interface Plan extends Schema.Schema.Type<typeof Plan> {}
export const Plan = Schema.Struct({
  changes: Schema.Array(Change),
  problems: Schema.Array(Problem).annotate({ description: "A plan with problems cannot be applied." }),
  digest: Schema.String.annotate({ description: "Apply refuses the plan when the digest has changed." }),
  lock: Lock.annotate({ description: "The lock with the version of each resource that the folder and Ren agree on." }),
}).annotate({ identifier: "Infra.Plan" })

export interface ApplyInput extends Schema.Schema.Type<typeof ApplyInput> {}
export const ApplyInput = Schema.Struct({
  ...PlanInput.fields,
  digest: Schema.String,
  force: Schema.optional(Schema.Boolean.annotate({ description: "Apply the folder over each conflict." })),
}).annotate({
  identifier: "Infra.ApplyInput",
})

export interface Applied extends Schema.Schema.Type<typeof Applied> {}
export const Applied = Schema.Struct({ changes: Schema.Array(Change), lock: Lock }).annotate({
  identifier: "Infra.Applied",
})

export interface PullInput extends Schema.Schema.Type<typeof PullInput> {}
export const PullInput = Schema.Struct({
  spec: Schema.optional(Spec.annotate({ description: "Without it, the folder is empty." })),
  bindings: Schema.optional(Bindings),
  lock: Schema.optional(Lock),
}).annotate({ identifier: "Infra.PullInput" })

export interface PulledApp extends Schema.Schema.Type<typeof PulledApp> {}
export const PulledApp = Schema.Struct({
  ...Struct.pick(App.Info.fields, ["name", "description", "requiredCredentials", "mcps", "skills", "dependsOn"]),
  icon: Schema.optionalKey(Schema.String),
  environment: App.Definition.fields.environment,
}).annotate({ identifier: "Infra.PulledApp", description: "An App.Declaration, as the live app has it." })

export interface PulledSchedule extends Schema.Schema.Type<typeof PulledSchedule> {}
export const PulledSchedule = Schema.Struct({
  ...Schedule.Declaration.fields,
  cron: Schema.String,
  timeZone: Schema.String,
}).annotate({ identifier: "Infra.PulledSchedule", description: "A Schedule.Declaration, as the live schedule has it." })

export interface PulledSpace extends Schema.Schema.Type<typeof PulledSpace> {}
export const PulledSpace = Schema.Struct({
  ...Struct.omit(Space.CreateInput.fields, ["slug"]),
  settings: Settings.Info,
  factory: Schema.optionalKey(FactoryDeclaration),
  agents: Schema.Record(Agent.Name, Agent.Declaration),
  apps: Schema.Record(Primitive.Slug, PulledApp),
  schedules: Schema.Record(Primitive.Slug, PulledSchedule),
  channels: Schema.Record(Primitive.Slug, Channel.Declaration),
  memory: PulledMemory,
  uses: Uses,
}).annotate({ identifier: "Infra.PulledSpace" })

export interface PulledBindings extends Schema.Schema.Type<typeof PulledBindings> {}
export const PulledBindings = Schema.Struct({
  channels: SpaceBindings.fields.channels,
  profiles: SpaceBindings.fields.profiles,
}).annotate({ identifier: "Infra.PulledBindings" })

export interface Pulled extends Schema.Schema.Type<typeof Pulled> {}
export const Pulled = Schema.Struct({
  bindings: Schema.Struct({
    organization: Bindings.fields.organization,
    spaces: Schema.Record(Primitive.Slug, PulledBindings),
  }),
  spec: Schema.Struct({
    org: OrganizationSettings.UpdateInput,
    memory: PulledMemory,
    spaces: Schema.Record(Primitive.Slug, PulledSpace),
  }),
  lock: Lock.annotate({ description: "The lock for the folder once pull writes it." }),
  write: Schema.Array(Schema.String).annotate({ description: "The resources that changed only in Ren: write them." }),
  remove: Schema.Array(Schema.String).annotate({
    description: "The resources that Ren archived and the folder did not change: remove them.",
  }),
  conflicts: Schema.Array(Change).annotate({
    description: "The resources that changed in the folder and in Ren. With any, pull writes nothing.",
  }),
}).annotate({
  identifier: "Infra.Pulled",
  description:
    "The part of the org spec that infra applies today: organization settings and memory, shared spaces with their agents, apps, schedules, channels and memory, and the channel and profile bindings of each space.",
})
