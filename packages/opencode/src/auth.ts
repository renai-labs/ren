export * as RenAuth from "./auth.js"

import { mkdir, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Auth } from "@ren/schema/auth"
import { Array, Clock, Config, Context, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

export interface Credential extends Schema.Schema.Type<typeof Credential> {}
export const Credential = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
})

export class SignedOut extends Schema.TaggedError<SignedOut>()("RenAuth.SignedOut", { server: Schema.String }) {
  override get message() {
    return `Not signed in to ${this.server}. Run ren login.`
  }
}

export class AuthError extends Schema.TaggedError<AuthError>()("RenAuth.AuthError", { message: Schema.String }) {}

export class Service extends Context.Service<
  Service,
  {
    readonly server: URL
    readonly token: Effect.Effect<string, SignedOut | AuthError>
  }
>()("@ren/opencode/RenAuth") {}

const Stored = Schema.fromJsonString(Schema.Record(Schema.String, Credential))

const Options = Schema.Struct({ url: Schema.optional(Schema.String) })

const ProtectedResource = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.NonEmptyArray(Schema.String),
})

const AuthorizationServer = Schema.Struct({ token_endpoint: Schema.String })

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
})

const renewBefore = 60_000

export const layer = (options: Readonly<Record<string, unknown>>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const env = yield* Config.all({
        url: Config.String("REN_URL").pipe(Config.withDefault("https://api.useren.ai")),
        token: Config.String("REN_TOKEN").pipe(Config.withDefault("")),
        home: Config.String("XDG_CONFIG_HOME").pipe(Config.withDefault(join(homedir(), ".config"))),
      }).pipe(Effect.mapError((error) => new AuthError({ message: error.message })))
      const url =
        (yield* Schema.decodeUnknownEffect(Options)(options).pipe(
          Effect.mapError(() => new AuthError({ message: "The Ren plugin’s url option must be a string." })),
        )).url ?? env.url
      const server = URL.parse(url)
      if (!server || !["http:", "https:"].includes(server.protocol))
        return yield* new AuthError({ message: `Invalid Ren URL: ${url}` })
      const directory = join(env.home, "ren")
      const file = join(directory, "credentials.json")
      const renewing = yield* Semaphore.make(1)

      const read = Effect.tryPromise({
        try: async () => ((await Bun.file(file).exists()) ? Bun.file(file).text() : "{}"),
        catch: () => new AuthError({ message: `Could not read ${file}.` }),
      }).pipe(
        Effect.flatMap((text) =>
          Schema.decodeEffect(Stored)(text).pipe(
            Effect.mapError(() => new AuthError({ message: `Invalid credentials in ${file}. Run ren login.` })),
          ),
        ),
      )

      const renew = Effect.fn("RenAuth.renew")(
        function* (credential: Credential) {
          const ok = HttpClient.filterStatusOk(http)
          const resource = yield* ok
            .get(new URL("/.well-known/oauth-protected-resource", server))
            .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(ProtectedResource)))
          const issuer = new URL(Array.headNonEmpty(resource.authorization_servers))
          const metadata = yield* ok
            .get(new URL(`/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/u, "")}`, issuer))
            .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthorizationServer)))
          const response = yield* http.execute(
            HttpClientRequest.post(metadata.token_endpoint).pipe(
              HttpClientRequest.bodyUrlParams({
                grant_type: "refresh_token",
                refresh_token: credential.refreshToken,
                client_id: Auth.cliClient.client_id,
                resource: resource.resource,
              }),
            ),
          )
          if (response.status === 400 || response.status === 401) return Option.none<Credential>()
          const issued = yield* HttpClientResponse.filterStatusOk(response).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)),
          )
          return Option.some<Credential>({
            accessToken: issued.access_token,
            refreshToken: issued.refresh_token,
            expiresAt: (yield* Clock.currentTimeMillis) + issued.expires_in * 1000,
          })
        },
        Effect.mapError(() => new AuthError({ message: `Could not renew the Ren login for ${server.origin}.` })),
      )

      const token = renewing.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const stored = (yield* read)[server.origin]
          if (!stored) return yield* new SignedOut({ server: server.origin })
          if (stored.expiresAt - renewBefore > now) return stored.accessToken
          const renewed = yield* renew(stored)
          if (Option.isNone(renewed)) {
            const rotated = (yield* read)[server.origin]
            if (rotated && rotated.expiresAt - renewBefore > now) return rotated.accessToken
            return yield* new SignedOut({ server: server.origin })
          }
          const encoded = yield* Schema.encodeEffect(Stored)({ ...(yield* read), [server.origin]: renewed.value }).pipe(
            Effect.mapError(() => new AuthError({ message: `Could not encode the credentials for ${file}.` })),
          )
          yield* Effect.tryPromise({
            try: async () => {
              await mkdir(directory, { recursive: true, mode: 0o700 })
              const temporary = `${file}.${process.pid}`
              await writeFile(temporary, encoded, { mode: 0o600 })
              await rename(temporary, file)
            },
            catch: () => new AuthError({ message: `Could not write ${file}.` }),
          })
          return renewed.value.accessToken
        }),
      )

      return Service.of({ server, token: env.token ? Effect.succeed(env.token) : token })
    }),
  )
