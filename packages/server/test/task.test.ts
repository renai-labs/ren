import { afterAll, expect, test } from "bun:test"
import { Agent } from "@ren/schema/agent"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()
afterAll(() => app.dispose())

test("an assignment that fails validation is a 400 that names the field, and a start that conflicts is a 409", async () => {
  const cookie = sessionCookie(await signUp(app, "tasks@gmail.com"))
  const spaces = await (await call(app, cookie, "GET", "/spaces")).json()
  const created = await call(app, cookie, "POST", "/tasks", { spaceId: spaces.items[0].id, title: "Ship tasks" })
  expect(created.status).toBe(200)
  const task = await created.json()
  const invalid = await call(app, cookie, "POST", `/tasks/${task.id}/assign`, { agentId: Agent.ID.create() })
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toMatchObject({ _tag: "InvalidRequestError", field: "agentId" })
  expect((await call(app, cookie, "POST", `/tasks/${task.id}/start`, { mode: "continue" })).status).toBe(409)
})
