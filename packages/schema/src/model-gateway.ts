export * as ModelGateway from "./model-gateway.js"

import { Schema } from "effect"
import { Models } from "./models.js"

export interface Field extends Schema.Schema.Type<typeof Field> {}
export const Field = Schema.Struct({
  name: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  secret: Schema.Boolean,
  multiline: Schema.optionalKey(Schema.Boolean),
  placeholder: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "ModelGateway.Field", description: "One field of a provider’s Connect form." })

export const Auth = Schema.Union([
  Schema.TaggedStruct("key", { fields: Schema.Array(Field) }).annotate({
    description: "The organization’s own key: the person fills in these fields.",
  }),
  Schema.TaggedStruct("subscription", { signIn: Schema.NonEmptyString }).annotate({
    description: "Each member signs in with their own subscription; `signIn` is the button’s label.",
  }),
  Schema.TaggedStruct("operator", {}).annotate({
    description: "No form: the deployment holds the credential.",
  }),
]).annotate({ identifier: "ModelGateway.Auth" })
export type Auth = typeof Auth.Type

export const Payer = Schema.Literals(["ren", "customer"]).annotate({ identifier: "ModelGateway.Payer" })
export type Payer = typeof Payer.Type

export const Scope = Schema.Literals(["shared", "organization"]).annotate({
  identifier: "ModelGateway.Scope",
  description:
    "`shared`: the same models for every organization. `organization`: the models depend on the organization.",
})
export type Scope = typeof Scope.Type

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  mark: Schema.NonEmptyString,
  payer: Payer,
  protocol: Models.Protocol.annotate({
    description: "How a brain calls the provider’s models, unless a model says otherwise.",
  }),
  auth: Schema.NonEmptyArray(Auth),
  models: Scope,
  modelCount: Schema.optionalKey(Schema.Int).annotate({
    description: "How many models the provider offers, for the Connect provider page.",
  }),
}).annotate({
  identifier: "ModelGateway.Provider",
  description: "One provider a model gateway offers, such as Ren, Anthropic or Groq.",
})

export interface Listed extends Schema.Schema.Type<typeof Listed> {}
export const Listed = Schema.Struct({
  revision: Schema.NonEmptyString,
  models: Schema.Array(Models.Info),
}).annotate({ identifier: "ModelGateway.Listed", description: "A provider’s models for an organization." })

export interface Changed extends Schema.Schema.Type<typeof Changed> {}
export const Changed = Schema.Struct({
  provider: Schema.NonEmptyString,
  organizationId: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({
  identifier: "ModelGateway.Changed",
  description: "A provider’s models changed: for one organization, or for every organization without `organizationId`.",
})
