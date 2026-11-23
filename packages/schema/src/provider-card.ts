export * as ProviderCard from "./provider-card.js"

import { Schema } from "effect"
import { Auth } from "./auth.js"
import { Models } from "./models.js"
import { RenInference } from "./ren-inference.js"

export const ren = "ren"

export interface Field extends Schema.Schema.Type<typeof Field> {}
export const Field = Schema.Struct({
  name: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  secret: Schema.Boolean,
  multiline: Schema.optionalKey(Schema.Boolean),
  placeholder: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "ProviderCard.Field", description: "One field of the Connect dialog." })

const apiKey: Field = { name: "apiKey", label: "API key", secret: true }

export interface Definition {
  readonly id: string
  readonly fields: ReadonlyArray<Field>
  readonly subscription: boolean
}

// oxlint-disable-next-line ren/no-comments -- Providers P5, §16: the OpenCode Console's 35 providers by their models.dev ids. Five need more than a key, as each provider's documentation and the gateway's credential values ask.
export const definitions: ReadonlyArray<Definition> = [
  { id: "anthropic", fields: [apiKey], subscription: true },
  { id: "openai", fields: [apiKey], subscription: true },
  { id: "google", fields: [apiKey], subscription: false },
  {
    id: "azure",
    fields: [
      apiKey,
      { name: "baseUrl", label: "Endpoint", secret: false, placeholder: "https://<resource>.openai.azure.com" },
      { name: "apiVersion", label: "API version", secret: false, placeholder: "2025-04-01-preview" },
    ],
    subscription: false,
  },
  {
    id: "amazon-bedrock",
    fields: [
      { name: "accessKeyId", label: "Access key ID", secret: false },
      { name: "secretAccessKey", label: "Secret access key", secret: true },
      { name: "region", label: "Region", secret: false, placeholder: "us-east-1" },
    ],
    subscription: false,
  },
  {
    id: "google-vertex",
    fields: [
      { name: "project", label: "Project ID", secret: false },
      { name: "location", label: "Location", secret: false, placeholder: "us-central1" },
      { name: "serviceAccountJson", label: "Service account key (JSON)", secret: true, multiline: true },
    ],
    subscription: false,
  },
  ...[
    "xai",
    "meta",
    "zai",
    "deepseek",
    "nvidia",
    "minimax",
    "moonshotai",
    "alibaba",
    "cohere",
    "baseten",
    "cerebras",
    "chutes",
  ].map((id): Definition => ({ id, fields: [apiKey], subscription: false })),
  {
    id: "cloudflare-ai-gateway",
    fields: [
      { name: "accountId", label: "Account ID", secret: false },
      { name: "apiToken", label: "API token", secret: true },
    ],
    subscription: false,
  },
  {
    id: "databricks",
    fields: [
      {
        name: "baseUrl",
        label: "Serving endpoint URL",
        secret: false,
        placeholder: "https://<workspace>/serving-endpoints",
      },
      { name: "token", label: "Access token", secret: true },
    ],
    subscription: false,
  },
  ...[
    "deepinfra",
    "digitalocean",
    "fireworks-ai",
    "groq",
    "togetherai",
    "thinkingmachines",
    "huggingface",
    "mistral",
    "openrouter",
    "poolside",
    "siliconflow",
    "vultr",
    "venice",
    "vercel",
    "xiaomi",
  ].map((id): Definition => ({ id, fields: [apiKey], subscription: false })),
]

export const definitionOf = (id: string) => definitions.find((definition) => definition.id === id)

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  last4: Schema.String.annotate({ description: "The last 4 characters of the key." }),
  testedAt: Schema.DateTimeUtc,
  savedBy: Schema.NullOr(RenInference.KeyOwner),
}).annotate({ identifier: "ProviderCard.Key" })

export interface FreeUsage extends Schema.Schema.Type<typeof FreeUsage> {}
export const FreeUsage = Schema.Struct({
  used: Schema.Int,
  limit: Schema.Int,
  resetsAt: Schema.DateTimeUtc,
}).annotate({ identifier: "ProviderCard.FreeUsage", description: "Today’s free-model requests (Providers P14)." })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  enabled: Schema.Boolean,
  method: Models.Method,
  methods: Schema.Array(Models.Method),
  fields: Schema.Array(Field),
  key: Schema.NullOr(Key),
  seats: Schema.Array(RenInference.Connection).annotate({
    description: "The members’ subscriptions; only Anthropic and OpenAI have them.",
  }),
  modelCount: Schema.Int,
  canManage: Schema.Boolean.annotate({ description: "True for admins and owners (Providers P7)." }),
}).annotate({ identifier: "ProviderCard.Info", description: "One card of the Providers page." })

export interface RenInfo extends Schema.Schema.Type<typeof RenInfo> {}
export const RenInfo = Schema.Struct({
  enabled: Schema.Boolean,
  newModelsOn: Schema.Boolean,
  modelCount: Schema.Int,
  free: Schema.NullOr(FreeUsage).annotate({ description: "Null when the gateway cannot say." }),
  canManage: Schema.Boolean,
}).annotate({ identifier: "ProviderCard.RenInfo", description: "Ren’s card, always the first (Providers P1)." })

export interface Available extends Schema.Schema.Type<typeof Available> {}
export const Available = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  modelCount: Schema.Int,
  fields: Schema.Array(Field),
  added: Schema.Boolean,
}).annotate({ identifier: "ProviderCard.Available", description: "One provider of the Add provider grid." })

export interface Page extends Schema.Schema.Type<typeof Page> {}
export const Page = Schema.Struct({
  ren: RenInfo,
  cards: Schema.Array(Info),
  available: Schema.Array(Available),
}).annotate({ identifier: "ProviderCard.Page" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  method: Schema.optional(Models.Method),
}).annotate({ identifier: "ProviderCard.UpdateInput" })

export interface KeyInput extends Schema.Schema.Type<typeof KeyInput> {}
export const KeyInput = Schema.Struct({
  fields: Schema.Record(
    Schema.String,
    Schema.RedactedFromValue(Schema.String.check(Schema.isMaxLength(20_000))),
  ).annotate({
    description: "The Connect dialog’s fields. Ren forwards them to the model gateway once and never stores them.",
  }),
}).annotate({ identifier: "ProviderCard.KeyInput" })

export interface TestResult extends Schema.Schema.Type<typeof TestResult> {}
export const TestResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.optionalKey(Schema.String).annotate({ description: "The vendor’s message when the test failed." }),
}).annotate({ identifier: "ProviderCard.TestResult" })

export interface RenModel extends Schema.Schema.Type<typeof RenModel> {}
export const RenModel = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  price: Models.Price,
  free: Schema.Boolean,
  enabled: Schema.Boolean,
}).annotate({ identifier: "ProviderCard.RenModel" })

export interface RenModels extends Schema.Schema.Type<typeof RenModels> {}
export const RenModels = Schema.Struct({
  newModelsOn: Schema.Boolean,
  canManage: Schema.Boolean,
  models: Schema.Array(RenModel),
}).annotate({ identifier: "ProviderCard.RenModels" })

export interface RenModelsInput extends Schema.Schema.Type<typeof RenModelsInput> {}
export const RenModelsInput = Schema.Struct({
  newModelsOn: Schema.optional(Schema.Boolean),
  models: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, enabled: Schema.Boolean }))),
}).annotate({ identifier: "ProviderCard.RenModelsInput" })

export interface Changed extends Schema.Schema.Type<typeof Changed> {}
export const Changed = Schema.Struct({ organizationId: Auth.OrganizationID }).annotate({
  identifier: "ProviderCard.Changed",
  description: "The gateway tells Ren that a seat of the organization, or its models, changed.",
})
