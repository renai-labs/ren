export * as Access from "./access.js"

import { Policy } from "@ren/schema/policy"
import { Context, Effect, Layer, Schema } from "effect"
import { Actor } from "./actor.js"
import { SpacePolicy } from "./space/policy.js"

export interface Resource {
  readonly relationships: ReadonlyArray<string>
}

export interface Request {
  readonly actor: Actor.Info
  readonly action: string
  readonly resource: Resource
}

export interface Plan {
  readonly isAllowedEverywhere: boolean
  readonly allowedWhere: ReadonlyArray<string>
}

export interface Interface {
  readonly plan: (actor: Actor.Info, action: string) => Plan
  readonly isAllowed: (request: Request) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Access") {}

export const make = (documents: ReadonlyArray<Policy.Document>): Interface => {
  const statements = documents.flatMap((document) => document.statements)
  const plan = (actor: Actor.Info, action: string): Plan => {
    const applicableStatements = statements.filter(
      (statement) => statement.actions.includes(action) && statement.roles.some((role) => actor.roles.includes(role)),
    )
    return {
      isAllowedEverywhere: applicableStatements.some((statement) => statement.on === Policy.everywhere),
      allowedWhere: applicableStatements.map((statement) => statement.on).filter((on) => on !== Policy.everywhere),
    }
  }
  return {
    plan,
    isAllowed: (request) => {
      const allowed = plan(request.actor, request.action)
      return (
        allowed.isAllowedEverywhere ||
        allowed.allowedWhere.some((relationship) => request.resource.relationships.includes(relationship))
      )
    },
  }
}

export const documents = Schema.decodeUnknownEffect(Policy.Documents)(SpacePolicy.documents)

export const layer = Layer.effect(
  Service,
  documents.pipe(
    Effect.map((documents) => Service.of(make(documents))),
    Effect.orDie,
  ),
)
