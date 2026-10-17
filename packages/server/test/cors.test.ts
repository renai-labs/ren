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
