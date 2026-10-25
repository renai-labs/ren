import { afterAll, expect, test } from "bun:test"
import { ChannelProvider } from "@ren/core/channel-provider"
import { Effect, Layer } from "effect"
import { Routes } from "../src/routes.js"
import { makeApp } from "./lib/app.js"

const echo = Effect.succeed<ChannelProvider.Provider>({
  id: "slack",
  verify: (request) =>
    request.headers.get("x-signature") === `signed:${request.body}`
      ? Effect.void
      : Effect.fail(new ChannelProvider.Unauthorized({ message: "bad signature" })),
  parse: (request) => Effect.succeed({ _tag: "Handshake", body: { raw: request.body } }),
  fetchFile: () => Effect.fail(new ChannelProvider.FileUnavailable({ message: "no files" })),
})

const app = makeApp(Routes.layer.pipe(Layer.provide(ChannelProvider.layer([echo]))))
afterAll(() => app.dispose())

const post = (path: string, body: string, signature: string) =>
  app.handler(
    new Request(`http://localhost:4000${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-signature": signature },
      body,
    }),
  )

test("POST /channels/:provider needs no login, gives the provider the raw body, and answers with the core's reply", async () => {
  const body = "token=abc&challenge=c%201"
  const answered = await post("/channels/slack", body, `signed:${body}`)
  expect(answered.status).toBe(200)
  expect(await answered.json()).toEqual({ raw: body })
  expect((await post("/channels/slack", body, "signed:other")).status).toBe(401)
  expect((await post("/channels/linear", body, `signed:${body}`)).status).toBe(404)
})
