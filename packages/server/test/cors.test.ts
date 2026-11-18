import { afterAll, expect, test } from "bun:test"
import { makeApp, origin } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

test.each([
  {
    name: "answers preflight requests from trusted origins",
    request: () =>
      new Request("http://localhost/me", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type",
        },
      }),
    allowed: { origin, credentials: "true" },
  },
  {
    name: "allows credentialed auth requests from trusted origins",
    request: () =>
      new Request("http://localhost:4000/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: "grace@example.com", password: "correct horse battery staple", name: "Grace" }),
      }),
    allowed: { origin, credentials: "true" },
  },
  {
    name: "withholds CORS headers from other origins",
    request: () => new Request("http://localhost/health", { headers: { origin: "https://evil.example" } }),
    allowed: { origin: null },
  },
])("$name", async (row) => {
  const response = await app.handler(row.request())
  expect(response.ok).toBe(true)
  expect({
    origin: response.headers.get("access-control-allow-origin"),
    credentials: response.headers.get("access-control-allow-credentials"),
  }).toMatchObject(row.allowed)
})

test("allows the headers that PostHog adds to requests to the server", async () => {
  const headers = ["x-posthog-session-id", "x-posthog-window-id", "x-posthog-distinct-id"]
  const response = await app.handler(
    new Request("http://localhost/me", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": headers.join(","),
      },
    }),
  )
  expect(response.headers.get("access-control-allow-headers")?.split(",")).toEqual(expect.arrayContaining(headers))
})

test("gzips an API body for a browser that accepts it, and sends it plain to a client that does not", async () => {
  const plain = await app.handler(new Request("http://localhost/openapi.json"))
  const compressed = await app.handler(
    new Request("http://localhost/openapi.json", { headers: { "accept-encoding": "gzip, deflate, br, zstd" } }),
  )
  const text = await plain.text()
  const bytes = new Uint8Array(await compressed.arrayBuffer())
  expect({
    plain: plain.headers.get("content-encoding"),
    compressed: compressed.headers.get("content-encoding"),
    vary: compressed.headers.get("vary"),
  }).toEqual({ plain: null, compressed: "gzip", vary: "Origin, Accept-Encoding" })
  expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(text)
  expect(bytes.length).toBeLessThan(text.length / 4)
})
