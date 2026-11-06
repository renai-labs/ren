import { afterAll, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const Created = Schema.Struct({ id: Schema.String, url: Schema.String })

const Page = Schema.Struct({ items: Schema.Array(Schema.Struct({ outcome: Schema.String, verified: Schema.Boolean })) })

const send = (url: string, init: RequestInit = {}) => {
  const parsed = new URL(url)
  return app.handler(new Request(`http://localhost:4000${parsed.pathname}${parsed.search}`, init))
}

describe("POST /webhooks/:id/:token", () => {
  test("needs no login, answers a handshake as text, records a request, and leaves the API actions of the webhook to the API", async () => {
    const cookie = sessionCookie(await signUp(app, "webhooks@gmail.com", "Ada"))
    const space = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
      await (await call(app, cookie, "POST", "/spaces", { name: "Growth" })).json(),
    )
    const created = Schema.decodeUnknownSync(Created)(
      await (
        await call(app, cookie, "POST", "/webhooks", {
          spaceId: space.id,
          name: "Graph",
          message: "Read the change.",
          parser: {
            handshake:
              'has(query.validationToken) ? {"status": 200, "contentType": "text/plain", "body": query.validationToken} : null',
          },
        })
      ).json(),
    )
    const challenged = await send(`${created.url}?validationToken=abc`, { method: "POST" })
    expect([challenged.status, challenged.headers.get("content-type"), await challenged.text()]).toEqual([
      200,
      "text/plain",
      "abc",
    ])
    const posted = await send(created.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"value":[]}',
    })
    expect(posted.status).toBe(202)
    expect((await send(`${created.url}x`, { method: "POST", body: "{}" })).status).toBe(404)
    expect((await call(app, cookie, "POST", `/webhooks/${created.id}/rotateUrl`, {})).status).toBe(200)
    expect((await send(created.url, { method: "POST", body: "{}" })).status).toBe(404)
    const deliveries = Schema.decodeUnknownSync(Page)(
      await (await call(app, cookie, "GET", `/webhook-deliveries?webhookId=${created.id}`)).json(),
    )
    expect(deliveries.items).toEqual([
      { outcome: "recorded", verified: true },
      { outcome: "answered", verified: false },
    ])
  })
})
