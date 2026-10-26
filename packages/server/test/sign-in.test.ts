import { afterAll, expect, test } from "bun:test"
import { authRequest, makeApp, sessionCookie } from "./lib/app.js"

const app = makeApp()

const slackServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const path = new URL(request.url).pathname
    if (path === "/api/openid.connect.token")
      return Response.json({ ok: true, access_token: "xoxp-ana", token_type: "Bearer" })
    if (path === "/api/openid.connect.userInfo" && request.headers.get("authorization") === "Bearer xoxp-ana")
      return Response.json({
        ok: true,
        sub: "U01",
        email: `ana-${crypto.randomUUID()}@acme.test`,
        email_verified: true,
        name: "Ana",
        "https://slack.com/team_id": "T01",
        "https://slack.com/user_id": "U01",
      })
    return new Response(null, { status: 404 })
  },
})

const withSlack = makeApp(undefined, {
  config: {
    SLACK_CLIENT_ID: "slack-client",
    SLACK_CLIENT_SECRET: "slack-secret",
    SLACK_SIGNING_SECRET: "slack-signing",
    SLACK_API_URL: `${slackServer.url.origin}/api`,
    SLACK_URL: slackServer.url.origin,
  },
})

afterAll(async () => {
  await Promise.all([app.dispose(), withSlack.dispose()])
  await slackServer.stop(true)
})

test("the sign-in providers need no login, and GitHub and Slack are not ones when the server has neither", async () => {
  const answered = await app.handler(new Request("http://localhost:4000/sign-in-providers"))
  expect(answered.status).toBe(200)
  expect(await answered.json()).toEqual({ items: ["google"] })
})

test("Sign in with Slack keeps the account as team:user, since a Slack user id is unique only in its workspace", async () => {
  expect(await (await withSlack.handler(new Request("http://localhost:4000/sign-in-providers"))).json()).toEqual({
    items: ["google", "slack"],
  })
  const started = await withSlack.handler(
    authRequest("/sign-in/social", { provider: "slack", callbackURL: "http://localhost:5173/app" }),
  )
  const authorize = new URL((await started.json()).url)
  expect(`${authorize.origin}${authorize.pathname}`).toBe(`${slackServer.url.origin}/openid/connect/authorize`)
  const callback = await withSlack.handler(
    new Request(`http://localhost:4000/auth/callback/slack?code=ana&state=${authorize.searchParams.get("state")}`, {
      headers: { cookie: sessionCookie(started) },
    }),
  )
  expect(callback.status).toBe(302)
  const accounts = await withSlack.handler(
    new Request("http://localhost:4000/auth/list-accounts", { headers: { cookie: sessionCookie(callback) } }),
  )
  expect(await accounts.json()).toMatchObject([{ providerId: "slack", accountId: "T01:U01" }])
})
