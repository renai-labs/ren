export * as Webhook from "./webhook.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { AppIdentity } from "./app/identity.js"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"
import { WriteResult } from "./write-result.js"

export const ID = Identifier.make("whk", "Webhook.ID")
export type ID = typeof ID.Type

export const RequestID = Identifier.make("whr", "WebhookRequest.ID")
export type RequestID = typeof RequestID.Type

export const Mode = Schema.Literals(["listening", "live"]).annotate({
  identifier: "Webhook.Mode",
  description:
    "`listening`: Ren records each request and starts no chat. `live`: the parser starts or continues chats.",
})
export type Mode = typeof Mode.Type

export const ModeReason = Schema.Literals(["owner_left", "agent_removed", "parser_broken", "preset_removed"]).annotate({
  identifier: "Webhook.ModeReason",
  description:
    "Why Ren switched the webhook to listening. `owner_left`: the owner and the fallback user left the space. `agent_removed`: its agent left the space. `parser_broken`: 5 requests in a row broke the parser. `preset_removed`: the app is gone, or no longer has the preset.",
})
export type ModeReason = typeof ModeReason.Type

export const RequestOutcome = Schema.Literals([
  "queued",
  "started",
  "continued",
  "failed",
  "recorded",
  "throttled",
  "answered",
  "rejected",
  "ignored",
  "duplicate",
]).annotate({
  identifier: "WebhookRequest.Outcome",
  description:
    "`queued`: passed the parser and waits for its chat. `started` or `continued`: a chat. `failed`: the chat did not take it. `recorded`: listening, or the owner or the agent left. `throttled`: over 60 requests a minute. `answered`: a handshake. `rejected`: too large, or a wrong or missing signature. `ignored`: the filter was false, or an expression failed. `duplicate`: an earlier request had its event ID.",
})
export type RequestOutcome = typeof RequestOutcome.Type

export const maximumMessageLength = 20_000

export const maximumExpressionLength = 1_000

export const maximumBodyBytes = 1_000_000

export const brokenToListen = 5

export const Message = Schema.Trim.check(
  Schema.isNonEmpty({ message: "Message is required." }),
  Schema.isMaxLength(maximumMessageLength, { message: `Use ${maximumMessageLength} characters or fewer.` }),
).annotate({ identifier: "Webhook.Message" })

export const Expression = Schema.String.check(
  Schema.isTrimmed({ message: "Remove spaces at the start and end." }),
  Schema.isNonEmpty({ message: "Write an expression, or leave the field out." }),
  Schema.isMaxLength(maximumExpressionLength, { message: `Use ${maximumExpressionLength} characters or fewer.` }),
).annotate({
  identifier: "Webhook.Expression",
  description: "A CEL expression over `method`, `query`, `headers` (lowercase names) and `body`.",
})

export const HeaderName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9-]+$/u, { message: "Use a lowercase header name, such as x-ren-secret." }),
).annotate({ identifier: "Webhook.HeaderName" })

export const Signature = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }).annotate({ description: "The URL token only." }),
  Schema.Struct({ kind: Schema.Literal("header"), header: HeaderName }).annotate({
    description: "The header is equal to the signing secret.",
  }),
  Schema.Struct({
    kind: Schema.Literal("hmac"),
    header: HeaderName,
    encoding: Schema.Literals(["hex", "base64"]),
    prefix: Schema.optionalKey(Schema.String.annotate({ description: "Text before the digest, such as sha256=." })),
  }).annotate({ description: "HMAC-SHA256 of the body with the signing secret, in the header." }),
  Schema.Struct({ kind: Schema.Literal("standard") }).annotate({
    description: "The Standard Webhooks spec (Svix, Clerk, Resend). Refuses a request older than 5 minutes.",
  }),
  Schema.Struct({ kind: Schema.Literal("stripe") }).annotate({
    description: "The stripe-signature header. Refuses a request older than 5 minutes.",
  }),
]).annotate({ identifier: "Webhook.Signature", description: "How Ren checks the sender of a request." })
export type Signature = typeof Signature.Type

export interface Parser extends Schema.Schema.Type<typeof Parser> {}
export const Parser = Schema.Struct({
  signature: Signature.pipe(Schema.withDecodingDefaultKey(Effect.succeed({ kind: "none" as const }))),
  handshake: Schema.optionalKey(
    Expression.annotate({
      description:
        "Before the signature check: a map { status, contentType?, body } answers the request; null goes on.",
    }),
  ),
  signedHandshake: Schema.optionalKey(
    Expression.annotate({
      description: "After the signature check, with sign(text): a map answers the request; null goes on.",
    }),
  ),
  filter: Schema.optionalKey(
    Expression.annotate({ description: "A bool. Without it, every request starts or continues a chat." }),
  ),
  eventId: Schema.optionalKey(
    Expression.annotate({ description: "A string: the provider’s ID of the event. Ren drops a duplicate." }),
  ),
  threadKey: Schema.optionalKey(
    Expression.annotate({ description: "A string. Requests with the same key go into the same chat." }),
  ),
  title: Schema.optionalKey(Expression.annotate({ description: "A string: the title of a new chat." })),
}).annotate({ identifier: "Webhook.Parser", description: "The CEL expressions that tell what a request does." })

export const SecretSource = Schema.Literals(["ren", "provider"]).annotate({
  identifier: "Webhook.SecretSource",
  description: "`ren`: Ren makes the signing secret when the preset is turned on. `provider`: the person pastes it.",
})
export type SecretSource = typeof SecretSource.Type

export interface Preset extends Schema.Schema.Type<typeof Preset> {}
export const Preset = Schema.Struct({
  name: Primitive.Name,
  description: Schema.NonEmptyString,
  message: Message,
  ...Parser.fields,
  secret: SecretSource,
  setup: Schema.NonEmptyString.annotate({ description: "The steps after turn-on, in Markdown." }),
}).annotate({
  identifier: "Webhook.Preset",
  description: "A webhook that an app declares. A space turns it on; its name, message and parser stay in the app.",
})

export const Source = Schema.Union([
  Schema.TaggedStruct("custom", {
    name: Primitive.Name,
    message: Message,
    parser: Parser.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))).annotate({
      description: "Without it, every request starts a chat.",
    }),
  }),
  Schema.TaggedStruct("preset", {
    appId: AppIdentity.ID,
    preset: Primitive.Slug.annotate({ description: "The key of the preset in the app’s webhooks." }),
  }),
]).annotate({
  identifier: "Webhook.Source",
  description: "A custom webhook with its own name, message and parser, or a preset of an app that the space reaches.",
})
export type Source = typeof Source.Type

export interface PresetOf extends Schema.Schema.Type<typeof PresetOf> {}
export const PresetOf = Schema.Struct({
  appId: AppIdentity.ID,
  appName: Schema.String,
  preset: Primitive.Slug,
  secret: Schema.NullOr(SecretSource).annotate({ description: "Null when the app no longer has the preset." }),
  setup: Schema.NullOr(Schema.String).annotate({ description: "Null when the app no longer has the preset." }),
  updatedAt: Schema.DateTimeUtc.annotate({ description: "When the publisher last changed the app." }),
}).annotate({ identifier: "Webhook.PresetOf", description: "The app and the preset that a preset webhook reads." })

export interface LastRequest extends Schema.Schema.Type<typeof LastRequest> {}
export const LastRequest = Schema.Struct({
  id: RequestID,
  receivedAt: Schema.DateTimeUtc,
  outcome: RequestOutcome,
  broken: Schema.Boolean,
}).annotate({ identifier: "Webhook.LastRequest" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  slug: Primitive.Slug.annotate({ description: "Unique among the webhooks of its space that are not archived." }),
  name: Schema.String,
  url: Schema.String.annotate({ description: "The address that the provider sends requests to. It holds a token." }),
  preset: Schema.NullOr(PresetOf).annotate({ description: "Null for a custom webhook." }),
  ownerId: Auth.UserID.annotate({
    description:
      "The person who last changed the message, the parser or the agent. Chats run as this person while they are in the space.",
  }),
  fallbackUserId: Schema.NullOr(Auth.UserID).annotate({
    description: "Chats run as this person when the owner left the space.",
  }),
  agentId: Schema.NullOr(Agent.ID).annotate({ description: "Null: chats run on ren." }),
  mode: Mode,
  modeReason: Schema.NullOr(ModeReason),
  message: Schema.NullOr(Schema.String).annotate({ description: "Null when the app no longer has the preset." }),
  parser: Schema.NullOr(Parser).annotate({ description: "Null when the app no longer has the preset." }),
  hasSigningSecret: Schema.Boolean,
  lastRequest: Schema.NullOr(LastRequest),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Webhook.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID).annotate({ description: "Without it, the webhooks of every space you are in." }),
  ...Pagination.fields(50),
}).annotate({ identifier: "Webhook.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Webhook.Page" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  spaceId: Space.ID,
  source: Source,
  slug: Schema.optional(Primitive.Slug).annotate({
    description: "Without it, Ren makes one from the name and adds -2, -3, … when it is taken.",
  }),
  agentId: Schema.optional(Agent.ID).annotate({ description: "An agent of the space. Without it, ren." }),
}).annotate({
  identifier: "Webhook.CreateInput",
  description: "A new webhook is listening: it records requests and starts no chat until it is live.",
})

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Primitive.Name).annotate({ description: "Not for a preset." }),
  message: Schema.optional(Message).annotate({ description: "Not for a preset." }),
  parser: Schema.optional(Parser).annotate({ description: "Not for a preset." }),
  agentId: Schema.optional(Schema.NullOr(Agent.ID)),
  fallbackUserId: Schema.optional(Schema.NullOr(Auth.UserID)).annotate({
    description: "Only yourself, or null to remove it.",
  }),
  mode: Schema.optional(Mode).annotate({
    description:
      "`live` needs the owner and the agent in the space, and a signing secret when the signature needs one.",
  }),
}).annotate({
  identifier: "Webhook.UpdateInput",
  description: "A change to the message, the parser or the agent makes you its owner.",
})

export interface SigningSecretInput extends Schema.Schema.Type<typeof SigningSecretInput> {}
export const SigningSecretInput = Schema.Struct({
  secret: Schema.optional(Schema.NonEmptyString).annotate({
    description: "The secret that the provider gave. Without it, Ren makes one and returns it once.",
  }),
}).annotate({ identifier: "Webhook.SigningSecretInput" })

const NoInput = Schema.Struct({}).annotate({ identifier: "Webhook.NoInput" })

const Secret = WriteResult.Secret(Info).annotate({ identifier: "Webhook.Secret" })

export const TestOutcome = Schema.Literals(["answered", "passed", "ignored", "duplicate", "rejected"]).annotate({
  identifier: "Webhook.TestOutcome",
  description:
    "`answered`: a handshake answers it. `passed`: it would start or continue a chat. `ignored`: the filter is false, or an expression failed. `duplicate`: an earlier request had its event ID. `rejected`: its signature was not checked or was wrong.",
})
export type TestOutcome = typeof TestOutcome.Type

export interface Tested extends Schema.Schema.Type<typeof Tested> {}
export const Tested = Schema.Struct({
  requestId: RequestID,
  outcome: TestOutcome,
  broken: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
  eventId: Schema.NullOr(Schema.String),
  threadKey: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
}).annotate({ identifier: "Webhook.Tested", description: "What the parser would do with one recorded request." })

export interface TestInput extends Schema.Schema.Type<typeof TestInput> {}
export const TestInput = Schema.Struct({
  parser: Schema.optional(Parser).annotate({ description: "Without it, the parser of the webhook." }),
  requestIds: Schema.optional(Schema.Array(RequestID)).annotate({ description: "Without it, the last 20 requests." }),
}).annotate({ identifier: "Webhook.TestInput" })

export interface TestResult extends Schema.Schema.Type<typeof TestResult> {}
export const TestResult = Schema.Struct({ items: Schema.Array(Tested) }).annotate({
  identifier: "Webhook.TestResult",
  description: "What the parser would do with each request. Saves nothing.",
})

export interface Replayed extends Schema.Schema.Type<typeof Replayed> {}
export const Replayed = Schema.Struct({
  replayed: Schema.Int.annotate({ description: "The requests that this call queued." }),
  remaining: Schema.Int.annotate({
    description: "The requests that are left to replay. Call again while it is above 0.",
  }),
}).annotate({ identifier: "Webhook.Replayed" })

const agentField = Schema.optionalKey(
  Agent.Name.annotate({ description: "Without it, the webhook runs on the ren agent." }),
)

export interface CustomDeclaration extends Schema.Schema.Type<typeof CustomDeclaration> {}
export const CustomDeclaration = Schema.Struct({
  name: Schema.optionalKey(Primitive.Name.annotate({ description: "Without it, the slug." })),
  agent: agentField,
  message: Message,
  ...Parser.fields,
}).annotate({ identifier: "Webhook.CustomDeclaration" })

export interface PresetDeclaration extends Schema.Schema.Type<typeof PresetDeclaration> {}
export const PresetDeclaration = Schema.Struct({
  app: Primitive.Slug.annotate({ description: "The slug of an app that the space reaches." }),
  preset: Primitive.Slug.annotate({ description: "The key of the preset in the app’s webhooks." }),
  agent: agentField,
}).annotate({ identifier: "Webhook.PresetDeclaration" })

export const Declaration = Schema.Union([PresetDeclaration, CustomDeclaration]).annotate({
  identifier: "Webhook.Declaration",
  description:
    "A webhook in webhooks.yaml. Apply creates it listening; its mode, URL and signing secret stay live state.",
})
export type Declaration = typeof Declaration.Type

export const definition = Primitive.define({
  name: "webhook",
  plural: "webhooks",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
  actions: {
    rotateUrl: { input: NoInput, result: Info },
    setSigningSecret: { input: SigningSecretInput, result: Secret },
    revealSigningSecret: { input: NoInput, result: Secret },
    test: { input: TestInput, result: TestResult },
    replay: { input: NoInput, result: Replayed },
  },
})
