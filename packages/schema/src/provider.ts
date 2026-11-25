export * as Provider from "./provider.js"

import { Schema } from "effect"
import { InferencePlugin } from "./inference-plugin.js"
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
  logo: Schema.optionalKey(Schema.String).annotate({ description: "The address of the provider’s logo." }),
  payer: InferencePlugin.Payer,
  builtIn: Schema.Boolean.annotate({
    description: "The provider needs no connection: the deployment holds its credential.",
  }),
  added: Schema.Boolean.annotate({
    description: "The organization added or changed the provider. A built-in provider is always added.",
  }),
  enabled: Schema.Boolean,
  method: Schema.optionalKey(Models.Method).annotate({ description: "Absent on a built-in provider." }),
  methods: Schema.Array(Models.Method),
  fields: Schema.Array(InferencePlugin.Field),
  key: Schema.NullOr(Key),
  seats: Schema.Array(RenInference.Connection).annotate({
    description: "The members’ subscriptions, for a provider with the subscription method.",
  }),
  modelTypes: Schema.Record(Schema.String, Schema.Int).annotate({
    description:
      "How many of the provider’s models of each type are on; for a provider the organization did not add, how many it offers.",
  }),
  canManage: Schema.Boolean.annotate({ description: "True for admins and owners (Providers P7)." }),
}).annotate({
  identifier: "Provider.Info",
  description: "One provider of the inference plugins, with the organization’s settings of it.",
})

export interface Page extends Schema.Schema.Type<typeof Page> {}
export const Page = Schema.Struct({
  providers: Schema.Array(Info).annotate({
    description: "Every provider: the built-in ones first, then those the organization added, then the others.",
  }),
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
    description:
      "The Connect form’s fields. Ren forwards them to the provider’s inference service once and never stores them.",
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
  type: Models.Type,
  input: Schema.Array(Models.Modality).annotate({ description: "What the model reads." }),
  reasoning: Schema.Boolean.annotate({ description: "The model has reasoning efforts." }),
  context: Schema.optional(Schema.Int).annotate({ description: "The context window, in tokens." }),
  released: Schema.optional(Schema.String).annotate({ description: "The release date, such as `2026-10-02`." }),
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
  description: "A provider’s models and their switches, the latest release first. A new model is always on.",
})

export interface ModelListInput extends Schema.Schema.Type<typeof ModelListInput> {}
export const ModelListInput = Schema.Struct({
  models: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, enabled: Schema.Boolean })),
}).annotate({ identifier: "Provider.ModelListInput" })
