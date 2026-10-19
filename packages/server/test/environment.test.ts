import { afterAll, describe, expect, test } from "bun:test"
import { makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const call = (cookie: string, method: string, path: string, body?: unknown) =>
  app.handler(
    new Request(`http://localhost:4000${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  )

describe("environments over HTTP", () => {
  test("the provider list gives Docker and the JSON Schema that the environment form renders", async () => {
    const cookie = sessionCookie(await signUp(app, "providers@gmail.com", "Ada"))
    const response = await call(cookie, "GET", "/hand-providers")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: "docker",
        capabilities: ["files", "processes"],
        configSchema: expect.objectContaining({
          schema: expect.objectContaining({ required: ["image"] }),
        }),
      }),
    ])
  })

  test("a config the provider refuses is a 400 that names the field; a good one makes the environment", async () => {
    const cookie = sessionCookie(await signUp(app, "environments@gmail.com", "Ada"))
    const spaces = await (await call(cookie, "GET", "/spaces")).json()
    const spaceId = spaces.items[0].id
    const refused = await call(cookie, "POST", "/environments", {
      spaceId,
      name: "Python",
      provider: "docker",
      config: { cpus: 1 },
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ _tag: "InvalidRequestError", field: "config" })
    const made = await call(cookie, "POST", "/environments", {
      spaceId,
      name: "Python",
      provider: "docker",
      config: { image: "ren-executor:latest" },
    })
    expect(made.status).toBe(200)
    const environment = await made.json()
    expect(environment).toMatchObject({ spaceId, provider: "docker", sessionsPerHand: 8 })
    const listed = await (await call(cookie, "GET", `/environments?spaceId=${spaceId}`)).json()
    expect(listed.items.map((each: { readonly id: string }) => each.id)).toEqual([environment.id])
  })
})
