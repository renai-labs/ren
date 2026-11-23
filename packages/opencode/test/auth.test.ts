import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Auth } from "@ren/schema/auth"
import { ConfigProvider, Effect, Fiber, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { RenAuth } from "../src/auth.js"

const Stored = Schema.fromJsonString(Schema.Record(Schema.String, RenAuth.Credential))

const issued = { access_token: "renewed", refresh_token: "refresh-2", expires_in: 3600 }

const requests: Array<URLSearchParams> = []
const revoked: Array<URLSearchParams> = []
let answer: (form: URLSearchParams) => Response | Promise<Response> = () => Response.json(issued)

const oauth = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const url = new URL(request.url)
    if (url.pathname === "/.well-known/oauth-protected-resource")
      return Response.json({ resource: url.origin, authorization_servers: [`${url.origin}/auth`] })
    if (url.pathname === "/.well-known/oauth-authorization-server/auth")
      return Response.json({
        authorization_endpoint: `${url.origin}/auth/oauth2/authorize`,
        token_endpoint: `${url.origin}/auth/oauth2/token`,
        revocation_endpoint: `${url.origin}/auth/oauth2/revoke`,
      })
    if (url.pathname === "/auth/oauth2/revoke") {
      revoked.push(new URLSearchParams(await request.text()))
      return new Response(null, { status: 200 })
    }
    if (url.pathname !== "/auth/oauth2/token") return new Response(null, { status: 404 })
    const form = new URLSearchParams(await request.text())
    requests.push(form)
    return answer(form)
  },
})
const server = oauth.url.origin

afterAll(() => oauth.stop(true))

beforeEach(() => {
  requests.length = 0
  revoked.length = 0
  answer = () => Response.json(issued)
})

const configHome = async (stored?: Record<string, RenAuth.Credential>) => {
  const home = await mkdtemp(join(tmpdir(), "ren-opencode-"))
  if (stored) await Bun.write(join(home, "ren", "credentials.json"), JSON.stringify(stored))
  return home
}

const read = async (home: string) =>
  Schema.decodeUnknownSync(Stored)(await Bun.file(join(home, "ren", "credentials.json")).text())

const run = <A, E>(
  effect: Effect.Effect<A, E, RenAuth.Service | RenAuth.Login>,
  env: Record<string, string>,
  options: Record<string, unknown> = {},
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(RenAuth.layer(options)),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
      Effect.result,
    ),
  )

const serverUrl = Effect.gen(function* () {
  const auth = yield* RenAuth.Service
  return auth.server.href
})
const token = Effect.gen(function* () {
  const auth = yield* RenAuth.Service
  return yield* auth.token
})

const login = (accessToken: string, expiresIn: number) => ({
  accessToken,
  refreshToken: "refresh-1",
  expiresAt: Date.now() + expiresIn,
})

test("the server URL is the url option, then REN_URL, then production, and only http and https are accepted", async () => {
  expect(await run(serverUrl, { REN_URL: "http://env.example" }, { url: "http://option.example" })).toEqual(
    expect.objectContaining({ success: "http://option.example/" }),
  )
  expect(await run(serverUrl, { REN_URL: "http://env.example" })).toEqual(
    expect.objectContaining({ success: "http://env.example/" }),
  )
  expect(await run(serverUrl, {})).toEqual(expect.objectContaining({ success: "https://api.useren.ai/" }))
  expect(await run(serverUrl, {}, { url: "ftp://option.example" })).toEqual(
    expect.objectContaining({ failure: expect.any(RenAuth.AuthError) }),
  )
  expect(await run(serverUrl, { REN_URL: "not-a-url" })).toEqual(
    expect.objectContaining({ failure: expect.any(RenAuth.AuthError) }),
  )
})

test("REN_TOKEN wins over the credentials file, and a stored login is used only for the server that issued it", async () => {
  const home = await configHome({ [server]: login("stored", 3_600_000) })

  expect(await run(token, { XDG_CONFIG_HOME: home, REN_URL: server, REN_TOKEN: "from-env" })).toEqual(
    expect.objectContaining({ success: "from-env" }),
  )
  expect(await run(token, { XDG_CONFIG_HOME: home, REN_URL: server })).toEqual(
    expect.objectContaining({ success: "stored" }),
  )
  expect(await run(token, { XDG_CONFIG_HOME: home, REN_URL: "http://127.0.0.1:9" })).toEqual(
    expect.objectContaining({ failure: new RenAuth.SignedOut({ server: "http://127.0.0.1:9" }) }),
  )
  expect(requests).toEqual([])
})

test("a login within a minute of expiry is renewed with the CLI's client and written back in the CLI's format", async () => {
  const other = login("other", 3_600_000)
  const home = await configHome({ [server]: login("expiring", 30_000), "https://other.example": other })

  expect(await run(token, { XDG_CONFIG_HOME: home, REN_URL: server })).toEqual(
    expect.objectContaining({ success: "renewed" }),
  )
  expect(requests.map((form) => Object.fromEntries(form))).toEqual([
    {
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      client_id: Auth.cliClient.client_id,
      resource: server,
    },
  ])
  const stored = await read(home)
  expect(stored).toEqual({
    [server]: { accessToken: "renewed", refreshToken: "refresh-2", expiresAt: expect.any(Number) },
    "https://other.example": other,
  })
  expect(stored[server]?.expiresAt).toBeGreaterThan(Date.now() + 3_500_000)
  expect((await stat(join(home, "ren", "credentials.json"))).mode & 0o777).toBe(0o600)
})

test("concurrent callers share one renewal", async () => {
  const home = await configHome({ [server]: login("expiring", 30_000) })

  const tokens = await run(
    Effect.all(
      Array.from({ length: 5 }, () => token),
      { concurrency: "unbounded" },
    ),
    {
      XDG_CONFIG_HOME: home,
      REN_URL: server,
    },
  )

  expect(tokens).toEqual(expect.objectContaining({ success: Array.from({ length: 5 }, () => "renewed") }))
  expect(requests).toHaveLength(1)
})

test("without a login, or when the server refuses the renewal, the plugin is signed out until a login appears", async () => {
  const home = await configHome()
  const store = (stored: RenAuth.Credential) =>
    Effect.promise(() => Bun.write(join(home, "ren", "credentials.json"), JSON.stringify({ [server]: stored })))
  answer = () => Response.json({ error: "invalid_grant" }, { status: 400 })

  const results = await run(
    Effect.gen(function* () {
      const missing = yield* Effect.flip(token)
      yield* store(login("expiring", 30_000))
      const refused = yield* Effect.flip(token)
      yield* store(login("logged-in", 3_600_000))
      return { missing, refused, loggedIn: yield* token }
    }),
    { XDG_CONFIG_HOME: home, REN_URL: server },
  )

  expect(results).toEqual(
    expect.objectContaining({
      success: {
        missing: new RenAuth.SignedOut({ server }),
        refused: new RenAuth.SignedOut({ server }),
        loggedIn: "logged-in",
      },
    }),
  )
})

test("a renewal refused because the ren CLI already rotated the login uses the CLI's new login", async () => {
  const home = await configHome({ [server]: login("expiring", 30_000) })
  answer = async () => {
    await Bun.write(join(home, "ren", "credentials.json"), JSON.stringify({ [server]: login("from-cli", 3_600_000) }))
    return Response.json({ error: "invalid_grant" }, { status: 400 })
  }

  expect(await run(token, { XDG_CONFIG_HOME: home, REN_URL: server })).toEqual(
    expect.objectContaining({ success: "from-cli" }),
  )
})

const challenge = async (verifier: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url")

const visit = (url: string) =>
  Effect.promise(() =>
    fetch(url).then(
      async (response) => ({ status: response.status, text: await response.text() }),
      () => ({ status: 0, text: "closed" }),
    ),
  )

const authorize = Effect.gen(function* () {
  const auth = yield* RenAuth.Service
  const login = yield* RenAuth.Login
  const authorization = yield* login.authorize
  const url = new URL(authorization.url)
  const redirect = url.searchParams.get("redirect_uri") ?? ""
  const state = url.searchParams.get("state") ?? ""
  return { auth, login, authorization, url, redirect, state }
})

test("sign-in sends the browser to Ren with PKCE and the CLI's client, takes the code at a loopback listener that answers once, and stores the login in the CLI's format", async () => {
  const other = login("other", 3_600_000)
  const home = await configHome({ "https://other.example": other })

  const result = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* authorize
        const stray = yield* visit(`${started.redirect}?code=stolen&state=other`)
        const page = yield* visit(`${started.redirect}?code=the-code&state=${started.state}`)
        const credential = yield* started.authorization.credential
        const after = yield* visit(`${started.redirect}?code=again&state=${started.state}`)
        yield* started.login.store(credential)
        return { ...started, stray, page, after, token: yield* started.auth.token }
      }),
    ),
    { XDG_CONFIG_HOME: home, REN_URL: server },
  )

  expect(result).toEqual(expect.objectContaining({ success: expect.anything() }))
  if (result._tag !== "Success") return
  const url = result.success.url
  expect(`${url.origin}${url.pathname}`).toBe(`${server}/auth/oauth2/authorize`)
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: "code",
    client_id: Auth.cliClient.client_id,
    redirect_uri: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/u),
    scope: "openid offline_access ren",
    state: expect.stringMatching(/^[\w-]{20,}$/u),
    code_challenge: expect.any(String),
    code_challenge_method: "S256",
    resource: server,
  })
  expect(result.success.stray.status).toBe(400)
  expect(result.success.page.text).toContain("You can close this tab.")
  expect(result.success.after).toEqual({ status: 0, text: "closed" })
  const exchanged = requests.map((form) => Object.fromEntries(form))
  expect(exchanged).toEqual([
    {
      grant_type: "authorization_code",
      code: "the-code",
      code_verifier: expect.stringMatching(/^[\w-]{43}$/u),
      redirect_uri: result.success.redirect,
      client_id: Auth.cliClient.client_id,
      resource: server,
    },
  ])
  expect(await challenge(String(exchanged.at(0)?.["code_verifier"]))).toBe(
    String(url.searchParams.get("code_challenge")),
  )
  expect(result.success.token).toBe("renewed")
  expect(await read(home)).toEqual({
    [server]: { accessToken: "renewed", refreshToken: "refresh-2", expiresAt: expect.any(Number) },
    "https://other.example": other,
  })
  expect((await stat(join(home, "ren", "credentials.json"))).mode & 0o777).toBe(0o600)
})

test("a redirect URL pasted from a browser that cannot reach the listener completes the sign-in, and one from another sign-in is refused", async () => {
  const home = await configHome()

  const result = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* authorize
        const refused = yield* Effect.flip(started.authorization.redirect(`${started.redirect}?code=x&state=other`))
        yield* started.authorization.redirect(`${started.redirect}?code=pasted&state=${started.state}`)
        return { refused, credential: yield* started.authorization.credential }
      }),
    ),
    { XDG_CONFIG_HOME: home, REN_URL: server },
  )

  expect(result).toEqual(
    expect.objectContaining({
      success: {
        refused: expect.any(RenAuth.SignInFailed),
        credential: expect.objectContaining({ accessToken: "renewed" }),
      },
    }),
  )
  expect(requests.map((form) => form.get("code"))).toEqual(["pasted"])
})

test("a denied consent, or no answer within 5 minutes, fails the sign-in and closes the listener", async () => {
  const home = await configHome()
  const env = { XDG_CONFIG_HOME: home, REN_URL: server }

  const denied = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* authorize
        const page = yield* visit(
          `${started.redirect}?error=access_denied&error_description=The+user+denied+access&state=${started.state}`,
        )
        const failure = yield* Effect.flip(started.authorization.credential)
        return { page: page.text, failure, after: yield* visit(started.redirect) }
      }),
    ),
    env,
  )
  const timedOut = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* authorize
        const waiting = yield* Effect.forkChild(Effect.flip(started.authorization.credential))
        yield* Effect.yieldNow
        yield* TestClock.adjust("5 minutes")
        const failure = yield* Fiber.join(waiting)
        return { failure, after: yield* visit(started.redirect) }
      }),
    ).pipe(Effect.provide(TestClock.layer())),
    env,
  )

  expect(denied).toEqual(
    expect.objectContaining({
      success: {
        page: expect.stringContaining("Sign-in was cancelled."),
        failure: new RenAuth.SignInFailed({ message: "The user denied access" }),
        after: { status: 0, text: "closed" },
      },
    }),
  )
  expect(timedOut).toEqual(
    expect.objectContaining({
      success: {
        failure: new RenAuth.SignInFailed({ message: "Sign-in timed out after 5 minutes." }),
        after: { status: 0, text: "closed" },
      },
    }),
  )
  expect(requests).toEqual([])
})

test("sign-out revokes the refresh token with the CLI's client and removes only this server's login", async () => {
  const other = login("other", 3_600_000)
  const home = await configHome({ [server]: login("stored", 3_600_000), "https://other.example": other })

  const result = await run(
    Effect.gen(function* () {
      const auth = yield* RenAuth.Service
      const login = yield* RenAuth.Login
      const first = yield* login.signOut
      const second = yield* login.signOut
      return { first, second, token: yield* Effect.flip(auth.token) }
    }),
    { XDG_CONFIG_HOME: home, REN_URL: server },
  )

  expect(result).toEqual(
    expect.objectContaining({ success: { first: true, second: false, token: new RenAuth.SignedOut({ server }) } }),
  )
  expect(revoked.map((form) => Object.fromEntries(form))).toEqual([
    { token: "refresh-1", token_type_hint: "refresh_token", client_id: Auth.cliClient.client_id },
  ])
  expect(await read(home)).toEqual({ "https://other.example": other })
})

test("with REN_TOKEN, sign-in and sign-out fail as coming from the environment and leave the stored logins alone", async () => {
  const stored = { [server]: login("stored", 3_600_000) }
  const home = await configHome(stored)

  const result = await run(
    Effect.scoped(
      Effect.gen(function* () {
        const login = yield* RenAuth.Login
        return [yield* Effect.flip(login.authorize), yield* Effect.flip(login.signOut)]
      }),
    ),
    { XDG_CONFIG_HOME: home, REN_URL: server, REN_TOKEN: "from-env" },
  )

  expect(result).toEqual(
    expect.objectContaining({ success: [new RenAuth.FromEnvironment(), new RenAuth.FromEnvironment()] }),
  )
  expect(await read(home)).toEqual(stored)
  expect(revoked).toEqual([])
})
