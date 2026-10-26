export * as Access from "./access.js"

import type { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import type { Space } from "@ren/schema/space"
import { Context, Effect, Layer, Schema } from "effect"
import type { Actor } from "./actor.js"
import { AgentPolicy } from "./agent/policy.js"
import { CredentialPolicy } from "./credential/policy.js"
import { OAuthAppPolicy } from "./oauth-app/policy.js"
import { AppPolicy } from "./app/policy.js"
import { AppProfilePolicy } from "./app/profile-policy.js"
import { EnvironmentTemplatePolicy } from "./environment-templates/policy.js"
import { RenInferencePolicy } from "./ren-inference/policy.js"
import { SessionPolicy } from "./session/policy.js"
import { SettingsPolicy } from "./settings/policy.js"
import { SpacePolicy } from "./space/policy.js"
import { TaskPolicy } from "./task/policy.js"

export interface Resource {
  readonly relationships: ReadonlyArray<string>
  readonly spaceId?: Space.ID
  // oxlint-disable-next-line ren/no-comments -- The owning organization; null for Ren's own records. A statement on all reaches only the actor's.
  readonly organizationId?: Auth.OrganizationID | null
}

export const organization: Resource = { relationships: [] }

export interface Request {
  readonly actor: Actor.Info
  readonly action: string
  readonly resource: Resource
}

export interface Plan {
  readonly isAllowedEverywhere: boolean
  readonly allowedWhere: ReadonlyArray<string>
  readonly spaceId?: Space.ID
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
      (statement) =>
        statement.actions.includes(action) &&
        statement.roles.some((role) => actor.roles.includes(role)) &&
        (!actor.agent || statement.agents),
    )
    return {
      isAllowedEverywhere: applicableStatements.some((statement) => statement.on === Policy.everywhere),
      allowedWhere: applicableStatements.map((statement) => statement.on).filter((on) => on !== Policy.everywhere),
      ...(actor.agent && { spaceId: actor.agent.spaceId }),
    }
  }
  return {
    plan,
    isAllowed: (request) => {
      const allowed = plan(request.actor, request.action)
      if (allowed.spaceId && request.resource.spaceId && allowed.spaceId !== request.resource.spaceId) return false
      const isOwn =
        // ast-grep-ignore: no-nullish-comparison, -- null means Ren's own record.
        request.resource.organizationId === undefined ||
        request.resource.organizationId === request.actor.organizationId
      return (
        (allowed.isAllowedEverywhere && isOwn) ||
        allowed.allowedWhere.some((relationship) => request.resource.relationships.includes(relationship))
      )
    },
  }
}

export const documents = Schema.decodeUnknownEffect(Policy.Documents)([
  ...SpacePolicy.documents,
  ...EnvironmentTemplatePolicy.documents,
  ...SettingsPolicy.documents,
  ...AgentPolicy.documents,
  ...AppPolicy.documents,
  ...AppProfilePolicy.documents,
  ...TaskPolicy.documents,
  ...SessionPolicy.documents,
  ...CredentialPolicy.documents,
  ...OAuthAppPolicy.documents,
  ...RenInferencePolicy.documents,
])

export const layer = Layer.effect(
  Service,
  documents.pipe(
    Effect.map((documents) => Service.of(make(documents))),
    Effect.orDie,
  ),
)
