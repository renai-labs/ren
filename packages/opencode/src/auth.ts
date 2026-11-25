export * as RenAuth from "./auth.js"

import { mkdir, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Auth } from "@ren/schema/auth"
import { Array, Clock, Config, Context, Deferred, Effect, Layer, Option, Schema, type Scope, Semaphore } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

export interface Credential extends Schema.Schema.Type<typeof Credential> {}
export const Credential = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
})

export class SignedOut extends Schema.TaggedError<SignedOut>()("RenAuth.SignedOut", { server: Schema.String }) {
  override get message() {
    return `Not signed in to ${this.server}. Run /ren:login.`
  }
}

export class AuthError extends Schema.TaggedError<AuthError>()("RenAuth.AuthError", { message: Schema.String }) {}

export class SignInFailed extends Schema.TaggedError<SignInFailed>()("RenAuth.SignInFailed", {
  message: Schema.String,
}) {}

export class FromEnvironment extends Schema.TaggedError<FromEnvironment>()("RenAuth.FromEnvironment", {}) {
  override get message() {
    return "Ren uses REN_TOKEN from the environment. Unset it to sign in or out from OpenCode."
  }
}

export interface Authorization {
  readonly url: string
  readonly redirect: (url: string) => Effect.Effect<void, SignInFailed>
  readonly credential: Effect.Effect<Credential, SignInFailed | AuthError>
}

export class Service extends Context.Service<
  Service,
  {
    readonly server: URL
    readonly token: Effect.Effect<string, SignedOut | AuthError>
  }
>()("@ren/opencode/RenAuth") {}

export class Login extends Context.Service<
  Login,
  {
    readonly environment: boolean
    readonly authorize: Effect.Effect<Authorization, AuthError | FromEnvironment, Scope.Scope>
    readonly store: (credential: Credential) => Effect.Effect<void, AuthError>
    readonly signOut: Effect.Effect<boolean, AuthError | FromEnvironment>
  }
>()("@ren/opencode/RenAuth/Login") {}

const Stored = Schema.fromJsonString(Schema.Record(Schema.String, Credential))

const Options = Schema.Struct({ url: Schema.optional(Schema.String) })

const ProtectedResource = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.NonEmptyArray(Schema.String),
})

const AuthorizationServer = Schema.Struct({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  revocation_endpoint: Schema.optionalKey(Schema.String),
})

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
})

const renewBefore = 60_000

const random = (size: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(size))).toString("base64url")

export const layer = (options: Readonly<Record<string, unknown>>) =>
  Layer.effectContext(
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
      const writing = yield* Semaphore.make(1)

      const read = Effect.tryPromise({
        try: async () => ((await Bun.file(file).exists()) ? Bun.file(file).text() : "{}"),
        catch: () => new AuthError({ message: `Could not read ${file}.` }),
      }).pipe(
        Effect.flatMap((text) =>
          Schema.decodeEffect(Stored)(text).pipe(
            Effect.mapError(() => new AuthError({ message: `Invalid credentials in ${file}. Run /ren:login.` })),
          ),
        ),
      )

      const write = Effect.fn("RenAuth.write")(function* (stored: typeof Stored.Type) {
        const encoded = yield* Schema.encodeEffect(Stored)(stored).pipe(
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
      })

      const discover = Effect.gen(function* () {
        const ok = HttpClient.filterStatusOk(http)
        const resource = yield* ok
          .get(new URL("/.well-known/oauth-protected-resource", server))
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(ProtectedResource)))
        const issuer = new URL(Array.headNonEmpty(resource.authorization_servers))
        const metadata = yield* ok
          .get(new URL(`/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/u, "")}`, issuer))
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthorizationServer)))
        return { ...metadata, resource: resource.resource }
      }).pipe(Effect.withSpan("RenAuth.discover"))

      const grant = Effect.fn("RenAuth.grant")(function* (
        endpoints: Effect.Success<typeof discover>,
        params: Record<string, string>,
      ) {
        const response = yield* http.execute(
          HttpClientRequest.post(endpoints.token_endpoint).pipe(
            HttpClientRequest.bodyUrlParams({
              ...params,
              client_id: Auth.cliClient.client_id,
              resource: endpoints.resource,
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
      })

      const token = writing.withPermit(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const stored = (yield* read)[server.origin]
          if (!stored) return yield* new SignedOut({ server: server.origin })
          if (stored.expiresAt - renewBefore > now) return stored.accessToken
          const renewed = yield* discover.pipe(
            Effect.flatMap((endpoints) =>
              grant(endpoints, { grant_type: "refresh_token", refresh_token: stored.refreshToken }),
            ),
            Effect.mapError(() => new AuthError({ message: `Could not renew the Ren login for ${server.origin}.` })),
          )
          if (Option.isNone(renewed)) {
            const rotated = (yield* read)[server.origin]
            if (rotated && rotated.expiresAt - renewBefore > now) return rotated.accessToken
            return yield* new SignedOut({ server: server.origin })
          }
          yield* write({ ...(yield* read), [server.origin]: renewed.value })
          return renewed.value.accessToken
        }),
      )

      const authorize = Effect.gen(function* () {
        if (env.token) return yield* new FromEnvironment()
        const endpoints = yield* discover.pipe(
          Effect.mapError(() => new AuthError({ message: `Could not reach Ren at ${server.origin} to sign in.` })),
        )
        const verifier = random(32)
        const state = random(16)
        const callback = yield* Deferred.make<URLSearchParams>()
        const listener = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: (request) => {
                const params = new URL(request.url).searchParams
                if (new URL(request.url).pathname !== "/callback") return new Response("Not found", { status: 404 })
                if (params.get("state") !== state)
                  return new Response("This is not the sign-in Ren is waiting for.", { status: 400 })
                Deferred.doneUnsafe(callback, Effect.succeed(params))
                return new Response(
                  `<!doctype html><title>Ren</title><body style="font:16px system-ui;margin:4rem;text-align:center"><p>${params.has("code") ? "Signed in to Ren." : "Sign-in was cancelled."}</p><p>You can close this tab.</p></body>`,
                  { headers: { "content-type": "text/html; charset=utf-8" } },
                )
              },
            }),
          ),
          (served) => Effect.promise(() => served.stop()),
        )
        const redirectUri = `http://127.0.0.1:${listener.port}/callback`
        const authorizeUrl = new URL(endpoints.authorization_endpoint)
        authorizeUrl.search = new URLSearchParams({
          response_type: "code",
          client_id: Auth.cliClient.client_id,
          redirect_uri: redirectUri,
          scope: "openid offline_access ren",
          state,
          code_challenge: Buffer.from(
            yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
          ).toString("base64url"),
          code_challenge_method: "S256",
          resource: endpoints.resource,
        }).toString()
        return {
          url: authorizeUrl.href,
          redirect: Effect.fn("RenAuth.redirect")(function* (pasted: string) {
            const params = URL.parse(pasted.trim())?.searchParams
            if (params?.get("state") !== state)
              return yield* new SignInFailed({ message: "That is not the address of this sign-in." })
            yield* Deferred.succeed(callback, params)
          }),
          credential: Effect.gen(function* () {
            const params = yield* Deferred.await(callback).pipe(
              Effect.timeoutOrElse({
                duration: "5 minutes",
                orElse: () => Effect.fail(new SignInFailed({ message: "Sign-in timed out after 5 minutes." })),
              }),
              Effect.ensuring(Effect.promise(() => listener.stop())),
            )
            const code = params.get("code")
            if (!code)
              return yield* new SignInFailed({ message: params.get("error_description") ?? "Sign-in was cancelled." })
            const issued = yield* grant(endpoints, {
              grant_type: "authorization_code",
              code,
              code_verifier: verifier,
              redirect_uri: redirectUri,
            }).pipe(
              Effect.mapError(() => new AuthError({ message: `Could not finish signing in to ${server.origin}.` })),
            )
            if (Option.isNone(issued))
              return yield* new SignInFailed({ message: "Ren refused the sign-in. Run /ren:login again." })
            return issued.value
          }).pipe(Effect.withSpan("RenAuth.credential")),
        } satisfies Authorization
      }).pipe(Effect.withSpan("RenAuth.authorize"))

      const signOut = Effect.gen(function* () {
        if (env.token) return yield* new FromEnvironment()
        return yield* writing.withPermit(
          Effect.gen(function* () {
            const stored = yield* read
            const current = stored[server.origin]
            if (!current) return false
            yield* discover.pipe(
              Effect.flatMap((endpoints) => {
                const revocation = endpoints.revocation_endpoint
                if (!revocation) return Effect.void
                return http.execute(
                  HttpClientRequest.post(revocation).pipe(
                    HttpClientRequest.bodyUrlParams({
                      token: current.refreshToken,
                      token_type_hint: "refresh_token",
                      client_id: Auth.cliClient.client_id,
                    }),
                  ),
                )
              }),
              Effect.ignore,
            )
            yield* write(Object.fromEntries(Object.entries(stored).filter((entry) => entry.at(0) !== server.origin)))
            return true
          }),
        )
      }).pipe(Effect.withSpan("RenAuth.signOut"))

      return Context.make(Service, { server, token: env.token ? Effect.succeed(env.token) : token }).pipe(
        Context.add(Login, {
          environment: env.token !== "",
          authorize,
          store: (credential) =>
            writing
              .withPermit(Effect.flatMap(read, (stored) => write({ ...stored, [server.origin]: credential })))
              .pipe(Effect.withSpan("RenAuth.store")),
          signOut,
        }),
      )
    }),
  )
