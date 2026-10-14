export * as Policy from "./policy.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"
import { SpaceMember } from "./space-member.js"

export const Action = Schema.Literals([
  Primitive.action(Space.definition, "list"),
  Primitive.action(Space.definition, "get"),
  Primitive.action(Space.definition, "create"),
  Primitive.action(Space.definition, "update"),
  Primitive.action(Space.definition, "archive"),
  Primitive.action(SpaceMember.definition, "list"),
  Primitive.action(SpaceMember.definition, "create"),
  Primitive.action(SpaceMember.definition, "archive"),
]).annotate({ identifier: "Policy.Action" })
export type Action = typeof Action.Type

export const Scope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("global") }),
  Schema.Struct({ kind: Schema.Literal("organization"), id: Auth.OrganizationID }),
  Schema.Struct({ kind: Schema.Literal("space"), id: Space.ID }),
]).annotate({ identifier: "Policy.Scope" })
export type Scope = typeof Scope.Type

export const Subject = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("everyone") }),
  Schema.Struct({ kind: Schema.Literal("user"), id: Auth.UserID }),
  Schema.Struct({ kind: Schema.Literal("agent") }),
]).annotate({ identifier: "Policy.Subject" })
export type Subject = typeof Subject.Type

export const Resource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("organization"), id: Auth.OrganizationID }),
  Schema.Struct({ kind: Schema.Literal("space"), id: Space.ID }),
  Schema.Struct({ kind: Schema.Literal("space-member"), id: SpaceMember.ID }),
]).annotate({ identifier: "Policy.Resource" })
export type Resource = typeof Resource.Type

export const ResourceSelector = Schema.Union([
  Resource,
  Schema.Struct({ kind: Schema.Literals(["organization", "space", "space-member"]), id: Schema.Literal("*") }),
]).annotate({ identifier: "Policy.ResourceSelector" })
export type ResourceSelector = typeof ResourceSelector.Type

export const Condition = Schema.Literals([
  "organization-member",
  "organization-administrator",
  "space-member",
]).annotate({ identifier: "Policy.Condition" })
export type Condition = typeof Condition.Type

export interface Statement extends Schema.Schema.Type<typeof Statement> {}
export const Statement = Schema.Struct({
  id: Schema.NonEmptyString,
  scope: Scope,
  effect: Schema.Literals(["allow", "deny"]),
  subjects: Schema.NonEmptyArray(Subject),
  actions: Schema.NonEmptyArray(Action),
  resources: Schema.NonEmptyArray(ResourceSelector),
  when: Schema.optionalKey(Schema.NonEmptyArray(Condition)),
}).annotate({ identifier: "Policy.Statement" })
