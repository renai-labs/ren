export * as Webhook from "./webhook.js"

import { Effect, Schema } from "effect"
import { Agent } from "./agent.js"
import { Auth } from "./auth.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"
import { WriteResult } from "./write-result.js"

export const ID = Identifier.make("whk", "Webhook.ID")
export type ID = typeof ID.Type

export const Mode = Schema.Literals(["listening", "live"]).annotate({
  identifier: "Webhook.Mode",
  description:
    "`listening`: Ren records each request and starts no chat. `live`: the parser starts or continues chats.",
})
export type Mode = typeof Mode.Type

export const ModeReason = Schema.Literals(["owner_left", "agent_removed", "parser_broken"]).annotate({
  identifier: "Webhook.ModeReason",
  description:
    "Why Ren switched the webhook to listening. `owner_left`: its owner left the space. `agent_removed`: its agent left the space. `parser_broken`: 5 requests in a row broke the parser.",
})
export type ModeReason = typeof ModeReason.Type

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

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  slug: Primitive.Slug.annotate({ description: "Unique among the live webhooks of its space." }),
  name: Schema.String,
  url: Schema.String.annotate({ description: "The address that the provider sends requests to. It holds a token." }),
  ownerId: Auth.UserID.annotate({
    description: "The person who last changed the message, the parser or the agent. Chats run as this person.",
  }),
  agentId: Schema.NullOr(Agent.ID).annotate({ description: "Null: chats run on ren." }),
  mode: Mode,
  modeReason: Schema.NullOr(ModeReason),
  message: Schema.String,
  parser: Parser,
  hasSigningSecret: Schema.Boolean,
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
  name: Primitive.Name,
  slug: Schema.optional(Primitive.Slug).annotate({
    description: "Without it, Ren makes one from the name and adds -2, -3, … when it is taken.",
  }),
  message: Message,
  parser: Schema.optional(Parser).annotate({ description: "Without it, every request starts a chat." }),
  agentId: Schema.optional(Agent.ID).annotate({ description: "An agent of the space. Without it, ren." }),
}).annotate({
  identifier: "Webhook.CreateInput",
  description: "A new webhook is listening: it records requests and starts no chat until it is live.",
})

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: Schema.optional(Primitive.Name),
  message: Schema.optional(Message),
  parser: Schema.optional(Parser),
  agentId: Schema.optional(Schema.NullOr(Agent.ID)),
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

export const Declaration = Schema.Struct({
  agent: Schema.optionalKey(Agent.Name.annotate({ description: "Without it, the webhook runs on the ren agent." })),
  purpose: Schema.NonEmptyString,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(true))),
}).annotate({ identifier: "Webhook.Declaration" })
export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}

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
  },
})
