import { afterAll, expect, test } from "bun:test"
import { makeApp, origin } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

test("allows credentialed requests from trusted origins", async () => {
  const response = await app.handler(
    new Request("http://localhost:4000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "grace@example.com", password: "correct horse battery staple", name: "Grace" }),
    }),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get("access-control-allow-origin")).toBe(origin)
  expect(response.headers.get("access-control-allow-credentials")).toBe("true")
})
