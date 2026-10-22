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

  test("a config the provider refuses is a 400 that names the field; a good one makes an environment template a space can link", async () => {
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
    const linked = await call(app, cookie, "POST", "/space-environment-templates", {
      spaceId,
      environmentTemplateId: template.id,
    })
    expect(linked.status).toBe(200)
    const link = await linked.json()
    const listed = await (await call(app, cookie, "GET", `/space-environment-templates?spaceId=${spaceId}`)).json()
    expect(listed.items.map((each: { readonly environmentTemplateId: string }) => each.environmentTemplateId)).toEqual([
      template.id,
    ])
    expect((await call(app, cookie, "DELETE", `/space-environment-templates/${link.id}`)).status).toBe(200)
    expect(
      (await (await call(app, cookie, "GET", `/space-environment-templates?spaceId=${spaceId}`)).json()).items,
    ).toEqual([])
  })
})
