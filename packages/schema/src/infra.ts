export * as Infra from "./infra.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { App } from "./app.js"
import { AppProfile } from "./app-profile.js"
import { Channel } from "./channel.js"
import { Credential } from "./credential.js"
import { Cron } from "./cron.js"
import { EnvironmentTemplate } from "./environment-template.js"
import { OrganizationSettings } from "./organization-settings.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"
import { SpaceSettings } from "./space-settings.js"
import { Webhook } from "./webhook.js"

const records = ["agents", "apps", "crons", "webhooks", "channels"] as const

const runners = { crons: "Cron", webhooks: "Webhook", channels: "Channel" } as const

export const Path = Schema.String.check(
  Schema.isPattern(
    new RegExp(`^spaces/${Primitive.slugPattern}(?:/(?:${records.join("|")})/${Primitive.slugPattern})?$`, "u"),
    {
      message: "Use spaces/<slug> or spaces/<slug>/<agents|apps|crons|webhooks|channels>/<slug>.",
    },
  ),
).annotate({ identifier: "Infra.Path" })

export interface Move extends Schema.Schema.Type<typeof Move> {}
export const Move = Schema.Struct({ from: Path, to: Path }).annotate({ identifier: "Infra.Move" })

export interface Uses extends Schema.Schema.Type<typeof Uses> {}
export const Uses = Schema.Struct({
  agents: Schema.Array(Agent.Name).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
  apps: Schema.Array(Primitive.Slug)
    .annotate({ description: "Registry apps, and custom apps that other spaces own." })
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({ identifier: "Infra.Uses" })

export interface SpaceDeclaration extends Schema.Schema.Type<typeof SpaceDeclaration> {}
export const SpaceDeclaration = Schema.Struct({
  ...Space.CreateInput.fields,
  settings: SpaceSettings.UpdateInput.fields.settings.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({ permissions: [], references: [] })),
  ),
  agents: Schema.Record(Agent.Name, Agent.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  apps: Schema.Record(Primitive.Slug, App.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  crons: Schema.Record(Primitive.Slug, Cron.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  webhooks: Schema.Record(Primitive.Slug, Webhook.Declaration).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
  channels: Schema.Record(Primitive.Slug, Channel.Declaration).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({})),
  ),
  environment: Schema.optionalKey(EnvironmentTemplate.Declaration),
  uses: Uses.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({ agents: [], apps: [] }))),
}).annotate({ identifier: "Infra.SpaceDeclaration" })

export interface Spec extends Schema.Schema.Type<typeof Spec> {}
export const Spec = Schema.Struct({
  org: OrganizationSettings.UpdateInput,
  spaces: Schema.Record(Primitive.Slug, SpaceDeclaration),
  moved: Schema.Array(Move).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
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
      const exists = (path: string) => {
        const parts = path.split("/")
        const space = spec.spaces[parts.at(1) ?? ""]
        const kind = records.find((name) => name === parts.at(2))
        if (!space) return false
        return !kind || (parts.at(3) ?? "") in space[kind]
      }
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
        ...spaces.flatMap(([space, declaration]) =>
          (["agents", "apps"] as const).flatMap((kind) =>
            declaration.uses[kind].flatMap((name, index) => {
              const path = ["spaces", space, "uses", kind, index]
              const noun = kind === "agents" ? "agent" : "app"
              if (name in declaration[kind])
                return [{ path, issue: `Space "${space}" owns ${noun} "${name}", so it does not list it in uses.` }]
              if (kind === "agents" && !owners.agents.has(name))
                return [{ path, issue: `Space "${space}" uses agent "${name}", which no space defines.` }]
              return []
            }),
          ),
        ),
        ...spaces.flatMap(([space, declaration]) => {
          const used = new Set([...Object.keys(declaration.apps), ...declaration.uses.apps])
          return apps
            .filter((owned) => used.has(owned.name))
            .flatMap((owned) =>
              owned.app.dependsOn
                .filter((dependency) => !used.has(dependency))
                .map((dependency) => ({
                  path: ["spaces", space, "uses", "apps"],
                  issue: `Space "${space}" uses app "${owned.name}", which depends on "${dependency}".`,
                })),
            )
        }),
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
            ...Object.entries(declaration.crons).map(([name, cron]) => ({
              kind: "crons" as const,
              name,
              agent: cron.agent,
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
        ...spec.moved.flatMap((move, index) => [
          ...(exists(move.from)
            ? [
                {
                  path: ["moved", index, "from"],
                  issue: `A move from "${move.from}" names a resource that still exists.`,
                },
              ]
            : []),
          ...(exists(move.to)
            ? []
            : [
                {
                  path: ["moved", index, "to"],
                  issue: `A move to "${move.to}" names a resource that does not exist.`,
                },
              ]),
        ]),
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
