export * as SlackApp from "./slack-app.js"

import type { Auth } from "@ren/schema/auth"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ChannelSecrets } from "./channel-secrets.js"

export class Failed extends Schema.TaggedError<Failed>()("SlackApp.Failed", {
  message: Schema.String,
  error: Schema.optionalKey(Schema.String),
}) {}

export interface Settings {
  readonly clientId: string
  readonly clientSecret: Redacted.Redacted
  readonly signingSecret: Redacted.Redacted
  readonly api: string
  readonly web: string
  readonly redirectUri: string
}

export const botScopes = [
  "app_mentions:read",
  "channels:history",
  "channels:join",
  "channels:read",
  "chat:write",
  "chat:write.public",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "reactions:read",
  "reactions:write",
  "users:read",
  "users:read.email",
  "users.profile:read",
]

const timeLimit = "10 seconds"

const Answer = Schema.Struct({ ok: Schema.Boolean, error: Schema.optionalKey(Schema.String) })

const trimmed = (url: string) => url.replace(/\/$/u, "")

export const settings = Effect.gen(function* () {
  const clientId = yield* Config.option(Config.String("SLACK_CLIENT_ID"))
  if (Option.isNone(clientId)) return Option.none<Settings>()
  const read = yield* Config.all({
    clientSecret: Config.Redacted("SLACK_CLIENT_SECRET"),
    signingSecret: Config.Redacted("SLACK_SIGNING_SECRET"),
    api: Config.String("SLACK_API_URL").pipe(Config.withDefault("https://slack.com/api")),
    web: Config.String("SLACK_URL").pipe(Config.withDefault("https://slack.com")),
    ren: Config.String("REN_URL").pipe(Config.withDefault("http://localhost:4000")),
  }).pipe(Effect.option)
  if (Option.isNone(read)) {
    yield* Effect.logError(
      "SLACK_CLIENT_ID is set, but SLACK_CLIENT_SECRET or SLACK_SIGNING_SECRET is not; Slack is off",
    )
    return Option.none<Settings>()
  }
  return Option.some<Settings>({
    clientId: clientId.value,
    clientSecret: read.value.clientSecret,
    signingSecret: read.value.signingSecret,
    api: trimmed(read.value.api),
    web: trimmed(read.value.web),
    redirectUri: `${trimmed(read.value.ren)}/channels/slack/callback`,
  })
})

type Param = string | number | boolean | object

export const make = Effect.fnUntraced(function* (app: Settings) {
  const http = yield* HttpClient.HttpClient

  const post = <S extends Schema.Top>(
    method: string,
    params: Readonly<Record<string, Param | undefined>>,
    schema: S,
    token?: Redacted.Redacted,
  ) => {
    const form = Object.fromEntries(
      Object.entries(params).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, typeof value === "object" ? JSON.stringify(value) : String(value)]],
      ),
    )
    const request = HttpClientRequest.post(`${app.api}/${method}`).pipe(
      HttpClientRequest.bodyUrlParams(form),
      token ? HttpClientRequest.bearerToken(Redacted.value(token)) : (request) => request,
    )
    return http.execute(request).pipe(
      Effect.flatMap((response): Effect.Effect<unknown, unknown> =>
        response.status >= 200 && response.status < 300
          ? response.json
          : Effect.fail(new Failed({ message: `Slack answered ${response.status} to ${method}` })),
      ),
      Effect.flatMap((body) =>
        Effect.flatMap(
          Schema.decodeUnknownEffect(Answer)(body),
          (answer): Effect.Effect<S["Type"], unknown, S["DecodingServices"]> =>
            answer.ok
              ? Schema.decodeUnknownEffect(schema)(body)
              : Effect.fail(
                  new Failed({
                    message: `Slack refused ${method}: ${answer.error ?? "no reason"}`,
                    ...(answer.error && { error: answer.error }),
                  }),
                ),
        ),
      ),
      Effect.timeout(timeLimit),
      Effect.mapError((cause) =>
        cause instanceof Failed ? cause : new Failed({ message: `Slack did not answer ${method}: ${String(cause)}` }),
      ),
    )
  }

  return { settings: app, post }
})

export type Client = Effect.Success<ReturnType<typeof make>>

export interface Interface {
  readonly client: Option.Option<Client>
  readonly installOf: (organizationId: Auth.OrganizationID) => Effect.Effect<Option.Option<ChannelSecrets.Found>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SlackApp") {}

export const layerNone = Layer.succeed(
  Service,
  Service.of({ client: Option.none(), installOf: () => Effect.succeedNone }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const secrets = yield* ChannelSecrets.Service
    const found = yield* settings.pipe(Effect.orDie)
    const client = Option.isSome(found) ? Option.some(yield* make(found.value)) : Option.none<Client>()
    return Service.of({
      client,
      installOf: (organizationId) =>
        Option.isNone(client) ? Effect.succeedNone : secrets.ofOrganization(organizationId, "slack"),
    })
  }),
)
