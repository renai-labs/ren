export * as Provider from "./provider.js"

import { Schema } from "effect"
import { ModelGateway } from "./model-gateway.js"
import { Models } from "./models.js"
import { RenInference } from "./ren-inference.js"

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  last4: Schema.String.annotate({ description: "The last 4 characters of the key." }),
  testedAt: Schema.DateTimeUtc,
  savedBy: Schema.NullOr(RenInference.KeyOwner),
}).annotate({ identifier: "Provider.Key" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  mark: Schema.NonEmptyString,
  payer: ModelGateway.Payer,
  builtIn: Schema.Boolean.annotate({
    description: "The provider needs no connection: the deployment holds its credential.",
  }),
  enabled: Schema.Boolean,
  method: Schema.optionalKey(Models.Method).annotate({ description: "Absent on a built-in provider." }),
  methods: Schema.Array(Models.Method),
  fields: Schema.Array(ModelGateway.Field),
  key: Schema.NullOr(Key),
  seats: Schema.Array(RenInference.Connection).annotate({
    description: "The members’ subscriptions, for a provider with the subscription method.",
  }),
  modelCount: Schema.Int.annotate({ description: "The provider’s models that are on." }),
  canManage: Schema.Boolean.annotate({ description: "True for admins and owners (Providers P7)." }),
}).annotate({
  identifier: "Provider.Info",
  description: "One provider of the organization, as the Providers page shows it.",
})

export interface Available extends Schema.Schema.Type<typeof Available> {}
export const Available = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  mark: Schema.NonEmptyString,
  modelCount: Schema.Int,
  fields: Schema.Array(ModelGateway.Field),
  added: Schema.Boolean,
}).annotate({ identifier: "Provider.Available", description: "One provider of the Connect provider page." })

export interface Page extends Schema.Schema.Type<typeof Page> {}
export const Page = Schema.Struct({
  providers: Schema.Array(Info).annotate({
    description: "The built-in providers first, then the providers the organization added.",
  }),
  available: Schema.Array(Available),
}).annotate({ identifier: "Provider.Page" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  method: Schema.optional(Models.Method),
}).annotate({ identifier: "Provider.UpdateInput" })

export interface KeyInput extends Schema.Schema.Type<typeof KeyInput> {}
export const KeyInput = Schema.Struct({
  fields: Schema.Record(
    Schema.String,
    Schema.RedactedFromValue(Schema.String.check(Schema.isMaxLength(20_000))),
  ).annotate({
    description: "The Connect form’s fields. Ren forwards them to the provider’s gateway once and never stores them.",
  }),
}).annotate({ identifier: "Provider.KeyInput" })

export interface TestResult extends Schema.Schema.Type<typeof TestResult> {}
export const TestResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optionalKey(Schema.String).annotate({ description: "The vendor’s message when the test failed." }),
}).annotate({ identifier: "Provider.TestResult" })

export interface Model extends Schema.Schema.Type<typeof Model> {}
export const Model = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  price: Schema.optional(Models.Price).annotate({ description: "Absent for a model the organization pays itself." }),
  free: Schema.Boolean,
  enabled: Schema.Boolean,
}).annotate({ identifier: "Provider.Model" })

export interface ModelList extends Schema.Schema.Type<typeof ModelList> {}
export const ModelList = Schema.Struct({
  canManage: Schema.Boolean,
  models: Schema.Array(Model),
}).annotate({
  identifier: "Provider.ModelList",
  description: "A provider’s models and their switches. A new model is always on.",
})

export interface ModelListInput extends Schema.Schema.Type<typeof ModelListInput> {}
export const ModelListInput = Schema.Struct({
  models: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, enabled: Schema.Boolean })),
}).annotate({ identifier: "Provider.ModelListInput" })
