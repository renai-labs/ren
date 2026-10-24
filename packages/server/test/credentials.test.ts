import { afterAll, describe, expect, test } from "bun:test"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp(undefined, {
  config: {
    ENVELOPE_KEYS: JSON.stringify([
      { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
    ]),
  },
})

afterAll(() => app.dispose())

describe("credentials over HTTP", () => {
  test("no response holds a value: create, list, get, rotate and remove show the preview only", async () => {
    const cookie = sessionCookie(await signUp(app, "credentials@gmail.com", "Ada"))
    const made = await call(app, cookie, "POST", "/credentials", {
      owner: { kind: "org" },
      label: "STRIPE_API_KEY",
      hosts: ["api.stripe.com"],
      value: { type: "key", value: "sk_live_secret_1234" },
    })
    expect(made.status).toBe(200)
    const created = await made.text()
    expect(created).not.toContain("sk_live_secret")
    const info = JSON.parse(created)
    expect(info).toMatchObject({ label: "STRIPE_API_KEY", keyPreview: "1234", owner: { kind: "org" } })
    const texts = await Promise.all([
      call(app, cookie, "GET", "/credentials").then((response) => response.text()),
      call(app, cookie, "GET", `/credentials/${info.id}`).then((response) => response.text()),
      call(app, cookie, "POST", `/credentials/${info.id}/rotate`, {
        value: { type: "key", value: "sk_live_secret_5678" },
      }).then((response) => response.text()),
    ])
    expect(texts.join("\n")).not.toContain("sk_live_secret")
    expect(JSON.parse(texts.at(2) ?? "{}")).toMatchObject({ keyPreview: "5678" })
    const removed = await call(app, cookie, "POST", `/credentials/${info.id}/remove`, {})
    expect(removed.status).toBe(200)
    expect((await (await call(app, cookie, "GET", "/credentials")).json()).items).toEqual([])
  })

  test("a reserved label, a bare * host and a second label on one owner are refused", async () => {
    const cookie = sessionCookie(await signUp(app, "refusals@gmail.com", "Ada"))
    const input = { owner: { kind: "org" }, hosts: ["api.stripe.com"], value: { type: "key", value: "v" } }
    expect((await call(app, cookie, "POST", "/credentials", { ...input, label: "PATH" })).status).toBe(400)
    expect((await call(app, cookie, "POST", "/credentials", { ...input, label: "KEY", hosts: ["*"] })).status).toBe(400)
    expect((await call(app, cookie, "POST", "/credentials", { ...input, label: "KEY" })).status).toBe(200)
    const again = await call(app, cookie, "POST", "/credentials", { ...input, label: "KEY" })
    expect(again.status).toBe(409)
  })
})
