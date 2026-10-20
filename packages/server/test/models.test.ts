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

const refresh = (authorization?: string) =>
  app.handler(
    new Request("http://localhost/host/models/refresh", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  )

describe("POST /host/models/refresh", () => {
  test("answers 403 without a host token, or with a server, client, expired or foreign-key token", async () => {
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
    const responses = await Promise.all([refresh(), ...tokens.map((token) => refresh(`Bearer ${token}`))])
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403])
  })

  test("answers a valid host token with the brain's access and a new host token for the same brain", async () => {
    const sid = Session.ID.create()
    const org = Auth.OrganizationID.create()
    const response = await refresh(
      `Bearer ${await Effect.runPromise(SessionToken.sign(key, { sid, scope: "host", org, iat, exp }))}`,
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    const claims = await Effect.runPromise(SessionToken.verify([key], body.hostToken))
    expect([body.access, claims._tag === "Some" && claims.value]).toEqual([
      { endpoints: [] },
      expect.objectContaining({ sid, scope: "host", org }),
    ])
  })
})
