import { afterAll, expect, test } from "bun:test"
import { ChannelProvider } from "@ren/core/channel-provider"
import { Effect, Layer } from "effect"
import { Routes } from "../src/routes.js"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const echo = Effect.succeedSome<ChannelProvider.Provider>({
  id: "slack",
  verify: (request) =>
    request.headers.get("x-signature") === `signed:${request.body}`
      ? Effect.void
      : Effect.fail(new ChannelProvider.Unauthorized({ message: "bad signature" })),
  parse: (request) => Effect.succeed({ _tag: "Handshake", body: { raw: request.body } }),
  fetchFile: () => Effect.fail(new ChannelProvider.FileUnavailable({ message: "no files" })),
  context: () => Effect.succeedNone,
  send: () => Effect.void,
  progress: () => Effect.void,
  email: () => Effect.succeedNone,
  installUrl: (state) => `https://slack.test/install?state=${state}`,
  completeInstall: (query) =>
    query.team
      ? Effect.succeed({ workspace: query.team, name: "Acme" })
      : Effect.fail(new ChannelProvider.InstallFailed({ message: "Slack refused the install." })),
  changedOnProvider: () => false,
  revoke: () => Effect.void,
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

test("an install starts from the API and ends at the callback, which sends the person back to the app", async () => {
  const cookie = sessionCookie(await signUp(app, "channel-installer@gmail.com", "Ada"))
  const started = await call(app, cookie, "POST", "/channel-installs/start", { provider: "slack" })
  expect(started.status).toBe(200)
  const state = new URL((await started.json()).redirectUrl).searchParams.get("state") ?? ""
  const back = await app.handler(
    new Request(`http://localhost:4000/channels/slack/callback?state=${state}&team=T01`, { headers: { cookie } }),
  )
  expect(back.status).toBe(302)
  expect(back.headers.get("location")).toBe("http://localhost:5173/app/settings/channels/slack?installed=Acme")
  expect((await (await call(app, cookie, "GET", "/channel-installs")).json()).items).toMatchObject([
    { provider: "slack", workspace: "T01", name: "Acme", installedBy: { name: "Ada" } },
  ])
  const again = await app.handler(new Request(`http://localhost:4000/channels/slack/callback?state=${state}&team=T01`))
  expect(new URL(again.headers.get("location") ?? "").searchParams.get("error")).toBe(
    "This install link was already used, or Ren did not make it. Start the install again.",
  )
})
