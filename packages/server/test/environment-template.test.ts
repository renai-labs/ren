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

describe("environment templates over HTTP", () => {
  test("the provider list gives Docker and the JSON Schema that the environment template form renders", async () => {
    const cookie = sessionCookie(await signUp(app, "providers@gmail.com", "Ada"))
    const response = await call(cookie, "GET", "/environment-providers")
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
    const refused = await call(cookie, "POST", "/environment-templates", {
      name: "Python",
      provider: "docker",
      config: { cpus: 1 },
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ _tag: "InvalidRequestError", field: "config" })
    const made = await call(cookie, "POST", "/environment-templates", {
      name: "Python",
      provider: "docker",
      config: { image: "ren-executor:latest" },
    })
    expect(made.status).toBe(200)
    const template = await made.json()
    expect(template).toMatchObject({ provider: "docker", sessionsPerEnvironment: 8 })
    const spaces = await (await call(cookie, "GET", "/spaces")).json()
    const spaceId = spaces.items[0].id
    const linked = await call(cookie, "POST", "/space-environment-templates", {
      spaceId,
      environmentTemplateId: template.id,
    })
    expect(linked.status).toBe(200)
    const link = await linked.json()
    const listed = await (await call(cookie, "GET", `/space-environment-templates?spaceId=${spaceId}`)).json()
    expect(listed.items.map((each: { readonly environmentTemplateId: string }) => each.environmentTemplateId)).toEqual([
      template.id,
    ])
    expect((await call(cookie, "DELETE", `/space-environment-templates/${link.id}`)).status).toBe(200)
    expect((await (await call(cookie, "GET", `/space-environment-templates?spaceId=${spaceId}`)).json()).items).toEqual(
      [],
    )
  })
})
