import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Auth } from "@ren/schema/auth"
import { ConfigProvider, Effect, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { RenAuth } from "../src/auth.js"

const Stored = Schema.fromJsonString(Schema.Record(Schema.String, RenAuth.Credential))

const issued = { access_token: "renewed", refresh_token: "refresh-2", expires_in: 3600 }

const requests: Array<URLSearchParams> = []
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
      })
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
  effect: Effect.Effect<A, E, RenAuth.Service>,
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
