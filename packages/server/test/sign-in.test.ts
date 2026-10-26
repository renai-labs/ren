import { afterAll, expect, test } from "bun:test"
import { makeApp } from "./lib/app.js"

const app = makeApp()
afterAll(() => app.dispose())

test("the sign-in providers need no login, and GitHub is not one when the server has no GitHub App", async () => {
  const answered = await app.handler(new Request("http://localhost:4000/sign-in-providers"))
  expect(answered.status).toBe(200)
  expect(await answered.json()).toEqual({ items: ["google"] })
})
