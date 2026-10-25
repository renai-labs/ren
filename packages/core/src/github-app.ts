export * as GitHubApp from "./github-app.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import { and, eq } from "drizzle-orm"
import { Cache, Clock, Config, Context, Duration, Effect, Exit, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { createPrivateKey, type KeyObject, sign } from "node:crypto"

export class Failed extends Schema.TaggedError<Failed>()("GitHubApp.Failed", {
  message: Schema.String,
  status: Schema.optionalKey(Schema.Int),
}) {}

export interface Settings {
  readonly appId: string
  readonly slug: string
  readonly botUserId: string
  readonly privateKey: KeyObject
  readonly clientId: string
  readonly clientSecret: Redacted.Redacted
  readonly webhookSecret: Redacted.Redacted
  readonly api: string
  readonly web: string
}

export const apiVersion = "2022-11-28"

export const label = "GITHUB"

const tokenKeptUntilBeforeExpiry = 5 * 60_000

const timeLimit = "10 seconds"

const apiHeaders = { accept: "application/vnd.github+json", "x-github-api-version": apiVersion, "user-agent": "Ren" }

const AccessToken = Schema.Struct({ token: Schema.String, expires_at: Schema.String })

const Installation = Schema.Struct({
  id: Schema.Number,
  account: Schema.NullOr(Schema.Struct({ login: Schema.String })),
})

const UserInstallations = Schema.Struct({
  total_count: Schema.Number,
  installations: Schema.Array(Schema.Struct({ id: Schema.Number })),
})

const Exchanged = Schema.Struct({
  access_token: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
})

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url")

const trimmed = (url: string) => url.replace(/\/$/u, "")

export const settings = Effect.gen(function* () {
  const appId = yield* Config.option(Config.String("GITHUB_APP_ID"))
  if (Option.isNone(appId)) return Option.none<Settings>()
  const read = yield* Config.all({
    slug: Config.String("GITHUB_APP_SLUG"),
    botUserId: Config.String("GITHUB_APP_BOT_USER_ID"),
    privateKey: Config.Redacted("GITHUB_APP_PRIVATE_KEY"),
    clientId: Config.String("GITHUB_APP_CLIENT_ID"),
    clientSecret: Config.Redacted("GITHUB_APP_CLIENT_SECRET"),
    webhookSecret: Config.Redacted("GITHUB_WEBHOOK_SECRET"),
    api: Config.String("GITHUB_API_URL").pipe(Config.withDefault("https://api.github.com")),
    web: Config.String("GITHUB_URL").pipe(Config.withDefault("https://github.com")),
  }).pipe(Effect.option)
  if (Option.isNone(read)) {
    yield* Effect.logError("GITHUB_APP_ID is set, but the other GitHub App settings are not; GitHub is off")
    return Option.none<Settings>()
  }
  const key = Redacted.value(read.value.privateKey).trim()
  const privateKey = yield* Effect.try(() =>
    createPrivateKey(key.startsWith("-----BEGIN") ? key : Buffer.from(key, "base64").toString("utf8")),
  ).pipe(Effect.option)
  if (Option.isNone(privateKey)) {
    yield* Effect.logError("GITHUB_APP_PRIVATE_KEY is not a PEM private key, nor base64 of one; GitHub is off")
    return Option.none<Settings>()
  }
  return Option.some<Settings>({
    ...read.value,
    appId: appId.value,
    privateKey: privateKey.value,
    api: trimmed(read.value.api),
    web: trimmed(read.value.web),
  })
})

export const make = Effect.fnUntraced(function* (app: Settings) {
  const http = yield* HttpClient.HttpClient

  const jwt = Effect.gen(function* () {
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
    const input = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
      JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: app.appId }),
    )}`
    return `${input}.${base64url(sign("sha256", Buffer.from(input), app.privateKey))}`
  })

  const answered = (request: HttpClientRequest.HttpClientRequest, response: HttpClientResponse.HttpClientResponse) =>
    response.status >= 200 && response.status < 300
      ? Effect.succeed(response)
      : response.text.pipe(
          Effect.orElseSucceed(() => ""),
          Effect.flatMap((body) =>
            Effect.fail(
              new Failed({
                message: `GitHub answered ${response.status} to ${request.method} ${request.url}: ${body}`,
                status: response.status,
              }),
            ),
          ),
        )

  const failed = (request: HttpClientRequest.HttpClientRequest) => (cause: unknown) =>
    cause instanceof Failed
      ? cause
      : new Failed({ message: `GitHub did not answer ${request.method} ${request.url}: ${String(cause)}` })

  const json = <S extends Schema.Top>(schema: S, request: HttpClientRequest.HttpClientRequest) =>
    http.execute(request).pipe(
      Effect.flatMap((response) => answered(request, response)),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.timeout(timeLimit),
      Effect.mapError(failed(request)),
    )

  const asApp = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.map(jwt, (token) =>
      request.pipe(HttpClientRequest.setHeaders(apiHeaders), HttpClientRequest.bearerToken(token)),
    )

  const withToken = (request: HttpClientRequest.HttpClientRequest, bearer: Redacted.Redacted) =>
    request.pipe(HttpClientRequest.setHeaders(apiHeaders), HttpClientRequest.bearerToken(Redacted.value(bearer)))

  const installationPath = (id: string) => `${app.api}/app/installations/${encodeURIComponent(id)}`

  const tokens = yield* Cache.makeWith(
    (installationId: string) =>
      Effect.gen(function* () {
        const minted = yield* json(
          AccessToken,
          yield* asApp(HttpClientRequest.post(`${installationPath(installationId)}/access_tokens`)),
        )
        return {
          token: Redacted.make(minted.token),
          expiresAt: Date.parse(minted.expires_at),
          mintedAt: yield* Clock.currentTimeMillis,
        }
      }),
    {
      capacity: 1000,
      timeToLive: (exit) =>
        Exit.isSuccess(exit)
          ? Duration.millis(Math.max(0, exit.value.expiresAt - tokenKeptUntilBeforeExpiry - exit.value.mintedAt))
          : Duration.zero,
    },
  )

  const token = Effect.fn("GitHubApp.token")(function* (installationId: string) {
    const minted = yield* Cache.get(tokens, installationId)
    return { token: minted.token, expiresAt: minted.expiresAt }
  })

  const userInstallationsFrom = (
    userToken: Redacted.Redacted,
    page: number,
    ids: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<string>, Failed> =>
    json(
      UserInstallations,
      withToken(
        HttpClientRequest.get(`${app.api}/user/installations`).pipe(
          HttpClientRequest.setUrlParams({ per_page: "100", page: String(page) }),
        ),
        userToken,
      ),
    ).pipe(
      Effect.flatMap((found) => {
        const all = [...ids, ...found.installations.map((installation) => String(installation.id))]
        return found.installations.length < 100 || all.length >= found.total_count
          ? Effect.succeed(all)
          : userInstallationsFrom(userToken, page + 1, all)
      }),
    )

  return {
    settings: app,
    jwt,
    installUrl: (state: string) =>
      `${app.web}/apps/${encodeURIComponent(app.slug)}/installations/new?state=${encodeURIComponent(state)}`,
    exchangeCode: Effect.fn("GitHubApp.exchangeCode")(function* (code: string) {
      const answer = yield* json(
        Exchanged,
        HttpClientRequest.post(`${app.web}/login/oauth/access_token`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeader("user-agent", "Ren"),
          HttpClientRequest.bodyJsonUnsafe({
            client_id: app.clientId,
            client_secret: Redacted.value(app.clientSecret),
            code,
          }),
        ),
      )
      if (answer.error || !answer.access_token)
        return yield* new Failed({ message: `GitHub refused the code: ${answer.error ?? "no access token"}` })
      return Redacted.make(answer.access_token)
    }),
    userInstallations: Effect.fn("GitHubApp.userInstallations")(function* (userToken: Redacted.Redacted) {
      return yield* userInstallationsFrom(userToken, 1, [])
    }),
    installation: Effect.fn("GitHubApp.installation")(function* (id: string) {
      return yield* json(Installation, yield* asApp(HttpClientRequest.get(installationPath(id))))
    }),
    deleteInstallation: Effect.fn("GitHubApp.deleteInstallation")(function* (id: string) {
      const request = yield* asApp(HttpClientRequest.delete(installationPath(id)))
      yield* http.execute(request).pipe(
        Effect.flatMap((response) => (response.status === 404 ? Effect.void : answered(request, response))),
        Effect.timeout(timeLimit),
        Effect.mapError(failed(request)),
      )
    }),
    token,
    forget: (installationId: string) => Cache.invalidate(tokens, installationId),
    post: (installationId: string, path: string, body: unknown) =>
      token(installationId).pipe(
        Effect.mapError((error) => new Failed({ message: `No installation token: ${error.message}` })),
        Effect.flatMap((minted) => {
          const request = withToken(HttpClientRequest.post(`${app.api}${path}`), minted.token).pipe(
            HttpClientRequest.bodyJsonUnsafe(body),
          )
          return http.execute(request).pipe(
            Effect.flatMap((response) => answered(request, response)),
            Effect.timeout(timeLimit),
            Effect.mapError(failed(request)),
          )
        }),
        Effect.asVoid,
        Effect.withSpan("GitHubApp.post"),
      ),
    read: <S extends Schema.Top>(installationId: string, path: string, schema: S) =>
      token(installationId).pipe(
        Effect.flatMap((minted) => json(schema, withToken(HttpClientRequest.get(`${app.api}${path}`), minted.token))),
        Effect.withSpan("GitHubApp.read"),
      ),
  }
})

export type Client = Effect.Success<ReturnType<typeof make>>

export const hosts = (app: Settings) => {
  const web = new URL(app.web).hostname
  return [`api.${web}`, web, `codeload.${web}`, `uploads.${web}`]
}

export const variables = (app: Settings): Readonly<Record<string, string>> => {
  const placeholder = Credential.placeholder(label)
  const name = `${app.slug}[bot]`
  const email = `${app.botUserId}+${name}@users.noreply.github.com`
  return {
    GITHUB_TOKEN: placeholder,
    GH_TOKEN: placeholder,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${app.web}/.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${placeholder}`).toString("base64")}`,
  }
}

export interface Interface {
  readonly client: Option.Option<Client>
  readonly installationOf: (
    organizationId: Auth.OrganizationID,
  ) => Effect.Effect<Option.Option<{ readonly installation: string; readonly client: Client }>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/GitHubApp") {}

export const layerNone = Layer.succeed(
  Service,
  Service.of({ client: Option.none(), installationOf: () => Effect.succeedNone }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const found = yield* settings.pipe(Effect.orDie)
    const client = Option.isSome(found) ? Option.some(yield* make(found.value)) : Option.none<Client>()
    const install = Database.Schema.channel_install
    return Service.of({
      client,
      installationOf: Effect.fn("GitHubApp.installationOf")(function* (organizationId: Auth.OrganizationID) {
        if (Option.isNone(client)) return Option.none()
        const rows = yield* database.db
          .select({ workspace: install.workspace })
          .from(install)
          .where(and(eq(install.organization_id, organizationId), eq(install.provider, "github")))
          .pipe(Effect.orDie)
        return Option.map(Option.fromNullishOr(rows.at(0)), (row) => ({
          installation: row.workspace,
          client: client.value,
        }))
      }),
    })
  }),
)
