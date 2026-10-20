import { afterAll, describe, expect, test } from "bun:test"
import { SessionToken } from "@ren/host-api/session-token"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { makeApp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const key = { id: "test", secret: "a-test-cell-key-of-at-least-32-characters" }
const iat = Math.floor(Date.now() / 1000)
const exp = iat + 600

const post = (path: string, authorization?: string) =>
  app.handler(
    new Request(`http://localhost${path}`, { method: "POST", headers: authorization ? { authorization } : {} }),
  )

const hostToken = (sid: Session.ID, org: Auth.OrganizationID) =>
  Effect.runPromise(SessionToken.sign(key, { sid, scope: "host", org, iat, exp }))

describe("Ren Host API: environments.access and host.refresh", () => {
  test("answer 403 without a host token, or with a server, client, expired or foreign-key token", async () => {
    const sid = Session.ID.create()
    const org = Auth.OrganizationID.create()
    const tokens = await Promise.all([
      Effect.runPromise(SessionToken.sign(key, { sid, scope: "server", exp })),
      Effect.runPromise(SessionToken.sign(key, { sid, scope: "client", exp })),
      Effect.runPromise(SessionToken.sign(key, { sid, scope: "host", org, iat, exp: exp - 1200 })),
      Effect.runPromise(
        SessionToken.sign(
          { id: "test", secret: "another-key-of-at-least-32-characters" },
          { sid, scope: "host", org, iat, exp },
        ),
      ),
    ])
    const paths = ["/host/environment/access", "/host/token/refresh"]
    const statuses = await Promise.all([
      ...paths.map((path) => post(path).then((response) => response.status)),
      ...paths.flatMap((path) =>
        tokens.map((token) => post(path, `Bearer ${token}`).then((response) => response.status)),
      ),
    ])
    expect(statuses).toEqual(Array.from({ length: 10 }, () => 403))
  })

  test("a session with no environment gets a typed not found, not a forbidden", async () => {
    const response = await post(
      "/host/environment/access",
      `Bearer ${await hostToken(Session.ID.create(), Auth.OrganizationID.create())}`,
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ _tag: "EnvironmentNotFoundError" })
  })

  test("a valid host token gets a fresh host token for the same brain, without the model flow", async () => {
    const sid = Session.ID.create()
    const org = Auth.OrganizationID.create()
    const response = await post("/host/token/refresh", `Bearer ${await hostToken(sid, org)}`)
    expect(response.status).toBe(200)
    const body: { readonly hostToken: string } = await response.json()
    const claims = await Effect.runPromise(SessionToken.verify([key], body.hostToken))
    expect(claims._tag === "Some" && claims.value).toEqual(expect.objectContaining({ sid, scope: "host", org }))
  })

  test("a host token signed with the retiring key works, and one signed with a removed key is refused", async () => {
    const retiring = { id: "retiring", secret: "a-retiring-cell-key-of-at-least-32-chars" }
    const rotating = makeApp(undefined, { config: { CELL_KEYS: JSON.stringify([key, retiring]) } })
    const sign = (signer: typeof key) =>
      Effect.runPromise(
        SessionToken.sign(signer, {
          sid: Session.ID.create(),
          scope: "host",
          org: Auth.OrganizationID.create(),
          iat,
          exp,
        }),
      )
    const removed = { id: "removed", secret: "a-removed-cell-key-of-at-least-32-chars" }
    const statuses = await Promise.all(
      [await sign(retiring), await sign(removed)].map((token) =>
        rotating
          .handler(
            new Request("http://localhost/host/token/refresh", {
              method: "POST",
              headers: { authorization: `Bearer ${token}` },
            }),
          )
          .then((response) => response.status),
      ),
    )
    await rotating.dispose()
    expect(statuses).toEqual([200, 403])
  })

  test("no host token or environment token is in the server's log", async () => {
    const logs: Array<string> = []
    const logged = makeApp(undefined, { logs })
    const sid = Session.ID.create()
    const valid = await hostToken(sid, Auth.OrganizationID.create())
    const expired = await Effect.runPromise(
      SessionToken.sign(key, { sid, scope: "host", org: Auth.OrganizationID.create(), iat, exp: iat - 60 }),
    )
    const responses = await Promise.all(
      ["/host/environment/access", "/host/token/refresh"].flatMap((path) =>
        [valid, expired, "not-a-token"].map((token) =>
          logged.handler(
            new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` } }),
          ),
        ),
      ),
    )
    const issued = await Promise.all(responses.map((response) => response.text()))
    await logged.dispose()
    const refreshed = issued.flatMap((body) => body.match(/"hostToken":"([^"]+)"/)?.slice(1) ?? [])
    expect(logs.length).toBeGreaterThan(0)
    expect([valid, expired, ...refreshed].filter((token) => logs.some((line) => line.includes(token)))).toEqual([])
  })
})
