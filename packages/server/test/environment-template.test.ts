import { afterAll, describe, expect, test } from "bun:test"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

describe("environment templates over HTTP", () => {
  test("the provider list gives Docker and the JSON Schema that the environment template form renders", async () => {
    const cookie = sessionCookie(await signUp(app, "providers@gmail.com", "Ada"))
    const response = await call(app, cookie, "GET", "/environment-providers")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: "docker",
        configSchema: expect.objectContaining({
          schema: expect.objectContaining({ required: ["image"] }),
        }),
      }),
    ])
  })

  test("a config the provider refuses is a 400 that names the field; a good one makes an environment template that a space can use as its hand", async () => {
    const cookie = sessionCookie(await signUp(app, "environments@gmail.com", "Ada"))
    const refused = await call(app, cookie, "POST", "/environment-templates", {
      name: "Python",
      provider: "docker",
      config: { cpus: 1 },
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ _tag: "InvalidRequestError", field: "config" })
    const made = await call(app, cookie, "POST", "/environment-templates", {
      name: "Python",
      provider: "docker",
      config: { image: "ren-executor:latest" },
    })
    expect(made.status).toBe(200)
    const template = await made.json()
    expect(template).toMatchObject({ provider: "docker", sessionsPerEnvironment: 8 })
    const spaces = await (await call(app, cookie, "GET", "/spaces")).json()
    const spaceId = spaces.items[0].id
    const updated = await call(app, cookie, "PATCH", `/spaces/${spaceId}`, {
      hand: { placement: "remote", environmentTemplateId: template.id },
    })
    expect(updated.status).toBe(200)
    expect((await updated.json()).hand).toEqual({ placement: "remote", environmentTemplateId: template.id })
  })
})
