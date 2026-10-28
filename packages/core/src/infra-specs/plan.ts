export * as InfraPlan from "./plan.js"

import type { Agent } from "@ren/schema/agent"
import type { Infra } from "@ren/schema/infra"
import type { Space } from "@ren/schema/space"
import type { Effect } from "effect"
import type { Actor } from "../actor.js"
import type { Primitive } from "../primitive.js"

export type Failure = Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid

export interface Step {
  readonly change: Infra.Change
  readonly run: Effect.Effect<unknown, Failure>
}

export interface Planned {
  readonly steps: ReadonlyArray<Step>
  readonly removals: ReadonlyArray<Step>
  readonly problems: ReadonlyArray<Infra.Problem>
}

export interface DeclaredSpace {
  readonly slug: string
  readonly declaration: Infra.SpaceDeclaration
  readonly bindings: Infra.SpaceBindings | undefined
  readonly liveId: Space.ID | undefined
}

export interface Context {
  readonly actor: Actor.Info
  readonly spaces: ReadonlyArray<DeclaredSpace>
  readonly shared: ReadonlySet<Space.ID>
  readonly slugOf: (id: Space.ID) => string | undefined
  readonly spaceId: (slug: string) => Effect.Effect<Space.ID>
  readonly agentId: (name: string) => Effect.Effect<Agent.ID>
  readonly agentName: (id: Agent.ID) => string | undefined
  readonly touch: (id: Space.ID | undefined) => void
}

export const step = (
  action: Infra.Change["action"],
  kind: Infra.Change["kind"],
  path: string,
  run: Effect.Effect<unknown, Failure>,
  more: { readonly fields?: ReadonlyArray<string>; readonly from?: string } = {},
): Step => ({
  change: { action, kind, path, fields: more.fields ?? [], ...(more.from && { from: more.from }) },
  run,
})

export const byPath = (left: Step, right: Step) => left.change.path.localeCompare(right.change.path)

export const changed = (fields: Record<string, boolean>) => Object.keys(fields).filter((field) => fields[field])

export const empty: Planned = { steps: [], removals: [], problems: [] }
