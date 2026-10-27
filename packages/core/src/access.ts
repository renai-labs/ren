export * as Access from "./access.js"

import type { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import { and, not, or, type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import type { Actor } from "./actor.js"
import { AgentPolicy } from "./agent/policy.js"
import { ChannelInstallPolicy } from "./channel-install/policy.js"
import { ChannelMappingPolicy } from "./channel-mapping/policy.js"
import { CredentialPolicy } from "./credential/policy.js"
import { OAuthAppPolicy } from "./oauth-app/policy.js"
import { AppPolicy } from "./app/policy.js"
import { AppProfilePolicy } from "./app/profile-policy.js"
import { EnvironmentTemplatePolicy } from "./environment-templates/policy.js"
import { RenInferencePolicy } from "./ren-inference/policy.js"
import { SchedulePolicy } from "./schedule/policy.js"
import { SessionPolicy } from "./session/policy.js"
import { SettingsPolicy } from "./settings/policy.js"
import { SpacePolicy } from "./space/policy.js"
import { TaskPolicy } from "./task/policy.js"

// oxlint-disable-next-line ren/no-comments -- access §2: services pass facts; only policy documents decide.
export interface Resource {
  readonly facts: ReadonlyArray<string>
  // oxlint-disable-next-line ren/no-comments -- Null for Ren's own records; a rule with no facts reaches only the actor's org.
  readonly organizationId?: Auth.OrganizationID | null
}

export const organization: Resource = { facts: [] }

export interface Request {
  readonly actor: Actor.Info
  readonly action: string
  readonly resource: Resource
}

// oxlint-disable-next-line ren/no-comments -- The rules for an actor and an action; `where` turns them into SQL.
export interface Plan {
  readonly allow: ReadonlyArray<ReadonlyArray<string>>
  readonly deny: ReadonlyArray<ReadonlyArray<string>>
}

export interface Interface {
  readonly plan: (actor: Actor.Info, action: string) => Plan
  readonly isAllowed: (request: Request) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Access") {}

const holds = (when: ReadonlyArray<string>, facts: ReadonlyArray<string>) => when.every((fact) => facts.includes(fact))

export const make = (documents: ReadonlyArray<Policy.Document>): Interface => {
  const rules = documents.flatMap((document) => document.rules)
  const plan = (actor: Actor.Info, action: string): Plan => {
    const applicable = rules.filter(
      (rule) => rule.actions.includes(action) && rule.roles.some((role) => actor.roles.includes(role)),
    )
    return {
      allow: applicable.filter((rule) => rule.effect === "allow").map((rule) => rule.when),
      deny: applicable.filter((rule) => rule.effect === "deny").map((rule) => rule.when),
    }
  }
  return {
    plan,
    isAllowed: (request) => {
      const found = plan(request.actor, request.action)
      const isOwn =
        // ast-grep-ignore: no-nullish-comparison, -- null means Ren's own record.
        request.resource.organizationId === undefined ||
        request.resource.organizationId === request.actor.organizationId
      return (
        found.allow.some((when) => holds(when, request.resource.facts) && (when.length > 0 || isOwn)) &&
        !found.deny.some((when) => holds(when, request.resource.facts))
      )
    },
  }
}

// oxlint-disable-next-line ren/no-comments -- A fact with no SQL denies.
export const where = (plan: Plan, facts: ReadonlyMap<string, SQL>): SQL => {
  const all = (when: ReadonlyArray<string>, missing: SQL) =>
    when.length === 0 ? sql`true` : (and(...when.map((fact) => facts.get(fact) ?? missing)) ?? sql`true`)
  const allowed = or(...plan.allow.map((when) => all(when, sql`false`))) ?? sql`false`
  return plan.deny.length === 0
    ? allowed
    : (and(allowed, not(or(...plan.deny.map((when) => all(when, sql`true`))) ?? sql`false`)) ?? allowed)
}

export const documents = Schema.decodeUnknownEffect(Policy.Documents)([
  ...SpacePolicy.documents,
  ...SessionPolicy.documents,
  ...EnvironmentTemplatePolicy.documents,
  ...SettingsPolicy.documents,
  ...AgentPolicy.documents,
  ...AppPolicy.documents,
  ...AppProfilePolicy.documents,
  ...TaskPolicy.documents,
  ...CredentialPolicy.documents,
  ...OAuthAppPolicy.documents,
  ...RenInferencePolicy.documents,
  ...ChannelInstallPolicy.documents,
  ...ChannelMappingPolicy.documents,
  ...SchedulePolicy.documents,
])

export const layer = Layer.effect(
  Service,
  documents.pipe(
    Effect.map((documents) => Service.of(make(documents))),
    Effect.orDie,
  ),
)
