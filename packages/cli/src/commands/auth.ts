export * as AuthCommand from "./auth.js"

import { Auth } from "@ren/schema/auth"
import { Deferred, Effect } from "effect"
import type { Command } from "effect/cli"
import type { Commands } from "../commands.js"
import { Connection } from "../services/connection.js"
import { Credentials } from "../services/credentials.js"
import { OAuth } from "../services/oauth.js"
import { Output } from "../services/output.js"

const random = (size: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(size))).toString("base64url")

export const login = Effect.fn("AuthCommand.login")(function* (
  input: Command.Command.Config.Infer<typeof Commands.loginOptions>,
) {
  const connection = yield* Connection.Service
  const credentials = yield* Credentials.Service
  const output = yield* Output.Service
  const server = yield* connection.server
  const endpoints = yield* OAuth.discover(server)
  const verifier = random(32)
  const state = random(16)
  const callback = yield* Deferred.make<URLSearchParams>()
  const listener = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => {
          const url = new URL(request.url)
          if (url.pathname !== "/callback") return new Response("Not found", { status: 404 })
          Deferred.doneUnsafe(callback, Effect.succeed(url.searchParams))
          return new Response(
            `<!doctype html><title>Ren CLI</title><body style="font:16px system-ui;margin:4rem;text-align:center"><p>${url.searchParams.has("code") ? "Signed in to Ren." : "Sign-in was cancelled."}</p><p>You can close this tab.</p></body>`,
            { headers: { "content-type": "text/html; charset=utf-8" } },
          )
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop()),
  )
  const redirectUri = `http://127.0.0.1:${listener.port}/callback`
  const authorize = new URL(endpoints.authorization_endpoint)

  authorize.search = new URLSearchParams({
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
  yield* output.diagnostic(`Sign in to Ren in your browser:\n${authorize.href}`)
  if (!input.noBrowser)
    yield* Effect.try(() =>
      Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", authorize.href], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }).unref(),
    ).pipe(Effect.ignore)
  const params = yield* Deferred.await(callback).pipe(
    Effect.timeoutOrElse({
      duration: "5 minutes",
      orElse: () => Effect.fail(new Error("Timed out waiting for sign-in.")),
    }),
  )
  if (params.get("state") !== state) return yield* Effect.fail(new Error("Sign-in failed. Try again."))
  const code = params.get("code")
  if (!code) return yield* Effect.fail(new Error(params.get("error_description") ?? "Sign-in was cancelled."))
  const credential = yield* OAuth.token(endpoints, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  })
  const client = yield* connection.connect(credential.accessToken)
  const me = yield* client.me.get()
  yield* credentials.set(server, credential)
  yield* output.result(`Logged in as ${me.user.email}${me.organization ? ` in ${me.organization.name}` : ""}.`)
})

export const logout = Effect.gen(function* () {
  const connection = yield* Connection.Service
  const credentials = yield* Credentials.Service
  const output = yield* Output.Service
  const server = yield* connection.server
  const stored = yield* credentials.get(server)
  if (!stored) return yield* output.result(`Not logged in to ${server.origin}.`)
  yield* OAuth.discover(server).pipe(
    Effect.flatMap((endpoints) => OAuth.revoke(endpoints, stored)),
    Effect.ignore,
  )
  yield* credentials.remove(server)
  yield* output.result(`Logged out of ${server.origin}.`)
})

export const whoami = Effect.gen(function* () {
  const connection = yield* Connection.Service
  const output = yield* Output.Service
  const client = yield* connection.client
  const me = yield* client.me.get()
  yield* output.result(me.organization ? `${me.user.email} in ${me.organization.name}` : me.user.email)
})
