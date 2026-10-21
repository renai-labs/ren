export * as Infra from "./infra.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { OrganizationSettings } from "./organization-settings.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"
import { SpaceSettings } from "./space-settings.js"

export interface Uses extends Schema.Schema.Type<typeof Uses> {}
export const Uses = Schema.Struct({
  agents: Schema.Array(Agent.Name).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({ identifier: "Infra.Uses" })

export interface SpaceDeclaration extends Schema.Schema.Type<typeof SpaceDeclaration> {}
export const SpaceDeclaration = Schema.Struct({
  ...Space.CreateInput.fields,
  settings: SpaceSettings.UpdateInput.fields.settings.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed({ permissions: [], references: [] })),
  ),
  agents: Schema.Record(Agent.Name, Agent.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  uses: Uses.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({ agents: [] }))),
}).annotate({ identifier: "Infra.SpaceDeclaration" })

export interface Spec extends Schema.Schema.Type<typeof Spec> {}
export const Spec = Schema.Struct({
  org: OrganizationSettings.UpdateInput,
  spaces: Schema.Record(Primitive.Slug, SpaceDeclaration),
})
  .check(
    Schema.makeFilter((spec) => {
      const spaces = Object.entries(spec.spaces)
      const owners = Map.groupBy(
        spaces.flatMap(([slug, space]) => Object.keys(space.agents).map((name) => ({ slug, name }))),
        (owned) => owned.name,
      )
      return [
        ...[...owners].flatMap(([name, owned]) =>
          owned.slice(1).map((duplicate) => ({
            path: ["spaces", duplicate.slug, "agents", name],
            issue: `Agent "${name}" is defined in ${owned.map((entry) => entry.slug).join(" and ")}.`,
          })),
        ),
        ...spaces.flatMap(([slug, space]) =>
          space.uses.agents.flatMap((name, index) => {
            const path = ["spaces", slug, "uses", "agents", index]
            if (name in space.agents)
              return [{ path, issue: `Space "${slug}" owns agent "${name}", so it does not list it in uses.` }]
            if (!owners.has(name))
              return [{ path, issue: `Space "${slug}" uses agent "${name}", which no space defines.` }]
            return []
          }),
        ),
      ]
    }),
  )
  .annotate({ identifier: "Infra.Spec" })
