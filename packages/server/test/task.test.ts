import { afterAll, expect, test } from "bun:test"
import { Agent } from "@ren/schema/agent"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()
afterAll(() => app.dispose())

test("tasks expose assignment validation, review, comments and the trail over HTTP", async () => {
  const cookie = sessionCookie(await signUp(app, "tasks@gmail.com"))
  const spaces = await (await call(app, cookie, "GET", "/spaces")).json()
  const created = await call(app, cookie, "POST", "/tasks", { spaceId: spaces.items[0].id, title: "Ship tasks" })
  expect(created.status).toBe(200)
  const task = await created.json()
  expect((await call(app, cookie, "GET", `/tasks/${task.identifier}`)).status).toBe(200)
  const invalid = await call(app, cookie, "POST", `/tasks/${task.id}/assign`, { agentId: Agent.ID.create() })
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toMatchObject({ _tag: "InvalidRequestError", field: "agentId" })
  expect((await call(app, cookie, "POST", `/tasks/${task.id}/start`, { mode: "continue" })).status).toBe(409)
  const review = await call(app, cookie, "POST", `/tasks/${task.id}/review`, { humanReview: true, reason: "Check API" })
  expect(review.status).toBe(200)
  expect(await review.json()).toMatchObject({ humanReview: true })
  const comment = await call(app, cookie, "POST", "/task-comments", { taskId: task.id, body: "Looks good" })
  expect(comment.status).toBe(200)
  const activity = await call(app, cookie, "GET", `/task-activities?taskId=${task.id}`)
  expect(activity.status).toBe(200)
  expect((await activity.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ type: "comment" })]))
  expect((await call(app, cookie, "DELETE", `/tasks/${task.id}`)).status).toBe(200)
  expect((await call(app, cookie, "GET", `/tasks/${task.id}`)).status).toBe(404)
})
