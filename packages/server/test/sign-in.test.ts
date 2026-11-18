import { afterAll, expect, test } from "bun:test"
import { authRequest, call, makeApp, sessionCookie, signUp } from "./lib/app.js"

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

const scheme = "ren-dev"

test("the mobile app, which sends no Origin header, signs in, calls Ren and signs out with its stored cookie", async () => {
  const email = `ada-${crypto.randomUUID()}@acme.test`
  await signUp(app, email)
  const mobile = (path: string, cookie?: string) =>
    new Request(`http://localhost:4000${path}`, {
      method: path.startsWith("/auth/") ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "expo-origin": `${scheme}://192.168.1.20:8081`,
        ...(cookie && { cookie }),
      },
      ...(path.startsWith("/auth/") && {
        body: JSON.stringify(path === "/auth/sign-out" ? {} : { email, password: "correct horse battery staple" }),
      }),
    })
  const cookie = sessionCookie(await app.handler(mobile("/auth/sign-in/email")))
  expect((await app.handler(mobile("/me", cookie))).status).toBe(200)
  expect((await app.handler(mobile("/auth/sign-out", cookie))).status).toBe(200)
  expect((await app.handler(mobile("/me", cookie))).status).toBe(401)
})

const mobileSocial = (provider: string) =>
  new Request("http://localhost:4000/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:4000", "expo-origin": `${scheme}://` },
    body: JSON.stringify({
      provider,
      callbackURL: `${scheme}:///`,
      newUserCallbackURL: `${scheme}:///`,
      errorCallbackURL: `${scheme}:///`,
    }),
  })

test("the mobile app can start Sign in with Google", async () => {
  const started = await app.handler(mobileSocial("google"))
  expect(started.status).toBe(200)
  expect(new URL((await started.json()).url).origin).toBe("https://accounts.google.com")
})

test("the mobile app signs in with Slack in the browser and gets its session back on the app's own link", async () => {
  const started = await withSlack.handler(mobileSocial("slack"))
  const authorize = new URL((await started.json()).url)
  const oauthState = started.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .find((cookie) => cookie.includes(".oauth_state="))
    ?.split("=")
    .slice(1)
    .join("=")
  const slack = `https://slack.com${authorize.pathname}${authorize.search}`
  const proxy = await withSlack.handler(
    new Request(
      `http://localhost:4000/auth/expo-authorization-proxy?${new URLSearchParams({
        authorizationURL: slack,
        ...(oauthState && { oauthState }),
      })}`,
    ),
  )
  expect(proxy.headers.get("location")).toBe(slack)
  const callback = await withSlack.handler(
    new Request(`http://localhost:4000/auth/callback/slack?code=ana&state=${authorize.searchParams.get("state")}`, {
      headers: { cookie: sessionCookie(proxy) },
    }),
  )
  const back = new URL(callback.headers.get("location") ?? "")
  expect(back.href.startsWith(`${scheme}:///`)).toBe(true)
  const session = back.searchParams.get("cookie")?.match(/[\w.-]*session_token=[^;]+/)?.[0] ?? ""
  expect((await call(withSlack, session, "GET", "/me")).status).toBe(200)
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
