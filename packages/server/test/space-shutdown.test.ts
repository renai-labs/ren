import { afterAll, describe, expect, test } from "bun:test"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

describe("space shutdown over HTTP", () => {
  test("a shutdown request starts its run at once, and the space reports when the run has finished", async () => {
    const cookie = sessionCookie(await signUp(app, "shutdown@gmail.com", "Ada"))
    const spaceId = (await (await call(app, cookie, "GET", "/spaces")).json()).items[0].id
    const requested = await call(app, cookie, "POST", `/spaces/${spaceId}/shutdown`, {})
    expect(requested.status).toBe(200)
    const finished = async (): Promise<unknown> => {
      const compute = (await (await call(app, cookie, "GET", `/spaces/${spaceId}`)).json()).compute
      if (compute.shutdown === null && compute.lastShutdown) return compute.lastShutdown
      // ast-grep-ignore: no-test-sleep -- the run reports only through the API, so the test asks again until it has finished
      await Bun.sleep(50)
      return finished()
    }
    expect(await finished()).toMatchObject({ problems: [] })
  })
})
