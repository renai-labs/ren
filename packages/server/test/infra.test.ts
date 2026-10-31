import { afterAll, expect, test } from "bun:test"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()
afterAll(() => app.dispose())

test("the spec that pull returns plans with no changes, and apply takes the plan's digest", async () => {
  const cookie = sessionCookie(await signUp(app, "infra-owner@gmail.com", "Ada"))
  const pulled = await call(app, cookie, "POST", "/infra/pull", {})
  expect(pulled.status).toBe(200)
  const body = await pulled.json()

  const unchanged = await (await call(app, cookie, "POST", "/infra/plan", body)).json()
  expect(unchanged).toMatchObject({ changes: [], problems: [], lock: body.lock })

  const spaces = { ...body.spec.spaces, design: { name: "Design" } }
  const input = { ...body, spec: { ...body.spec, spaces } }
  const plan = await (await call(app, cookie, "POST", "/infra/plan", input)).json()
  expect(plan.changes).toEqual([{ action: "create", kind: "space", path: "spaces/design", fields: [] }])
  const stale = await call(app, cookie, "POST", "/infra/apply", { ...input, digest: "stale" })
  expect(stale.status).toBe(409)
  const applied = await call(app, cookie, "POST", "/infra/apply", { ...input, digest: plan.digest })
  expect(applied.status).toBe(200)
  expect(Object.keys((await applied.json()).lock.resources)).toContain("spaces/design")
  expect((await (await call(app, cookie, "GET", "/spaces/design")).json()).name).toBe("Design")
})
