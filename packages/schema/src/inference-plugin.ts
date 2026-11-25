export * as InferencePlugin from "./inference-plugin.js"

import { Schema } from "effect"
import { Models } from "./models.js"

export interface Field extends Schema.Schema.Type<typeof Field> {}
export const Field = Schema.Struct({
  name: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  secret: Schema.Boolean,
  multiline: Schema.optionalKey(Schema.Boolean),
  placeholder: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "InferencePlugin.Field", description: "One field of a provider’s Connect form." })

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
]).annotate({ identifier: "InferencePlugin.Auth" })
export type Auth = typeof Auth.Type

export const Payer = Schema.Literals(["ren", "customer"]).annotate({ identifier: "InferencePlugin.Payer" })
export type Payer = typeof Payer.Type

export const Scope = Schema.Literals(["shared", "organization"]).annotate({
  identifier: "InferencePlugin.Scope",
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
  modelTypes: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)).annotate({
    description: "How many models of each type the provider offers, such as `{ chat: 30, image: 4 }`.",
  }),
  logo: Schema.optionalKey(Schema.String).annotate({ description: "The address of the provider’s logo." }),
}).annotate({
  identifier: "InferencePlugin.Provider",
  description: "One provider an inference plugin offers, such as Ren, Anthropic or Groq.",
})

export interface Listed extends Schema.Schema.Type<typeof Listed> {}
export const Listed = Schema.Struct({
  revision: Schema.NonEmptyString,
  models: Schema.Array(Models.Info),
}).annotate({ identifier: "InferencePlugin.Listed", description: "A provider’s models for an organization." })

export interface Changed extends Schema.Schema.Type<typeof Changed> {}
export const Changed = Schema.Struct({
  provider: Schema.NonEmptyString,
  organizationId: Schema.NonEmptyString,
}).annotate({
  identifier: "InferencePlugin.Changed",
  description:
    "One organization’s models of a provider changed, such as after a seat sign-in. A change for every organization reaches brains at their next pull.",
})

export interface Window extends Schema.Schema.Type<typeof Window> {}
export const Window = Schema.Struct({
  key: Schema.NonEmptyString.annotate({ description: "The vendor’s window, such as `5h` or `7d`." }),
  title: Schema.String.annotate({
    description: "The inference service’s name of the window, such as “Weekly · Opus”.",
  }),
  percent: Schema.NullOr(Schema.Number).annotate({ description: "How much of the window is used, 0 to 100." }),
  resetsAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "InferencePlugin.Window", description: "One usage window of a seat." })

export const Limit = Schema.Union([
  Schema.TaggedStruct("free", {
    used: Schema.Int,
    limit: Schema.Int,
    resetsAt: Schema.DateTimeUtc,
  }).annotate({ description: "The organization’s free-model requests of today." }),
  Schema.TaggedStruct("seat", {
    id: Schema.NonEmptyString,
    label: Schema.String,
    plan: Schema.optionalKey(Schema.String),
    connectedBy: Schema.optionalKey(Schema.String).annotate({ description: "The Ren user who connected the seat." }),
    windows: Schema.Array(Window),
  }).annotate({ description: "A seat and its usage windows." }),
]).annotate({
  identifier: "InferencePlugin.Limit",
  description:
    "A cap the inference service or a vendor enforces, with a reset: the free cap or a seat’s windows. Not the credit.",
})
export type Limit = typeof Limit.Type
