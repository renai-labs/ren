import { afterAll, expect, test } from "bun:test"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()
afterAll(() => app.dispose())

test("app edits replace the definition with a revision; a stale revision is 409; invalid input writes nothing", async () => {
  const cookie = sessionCookie(await signUp(app, "app-owner@gmail.com", "Ada"))
  const spaces = await (await call(app, cookie, "GET", "/spaces")).json()
  const ownerSpaceId = spaces.items[0].id
  const made = await call(app, cookie, "POST", "/apps", {
    slug: "notes",
    ownerSpaceId,
    name: "Notes",
    description: "Write notes",
    icon: "https://example.com/icon.png",
  })
  expect(made.status).toBe(200)
  const created = await made.json()
  const refused = await call(app, cookie, "PATCH", `/apps/${created.id}`, {
    expectedRevision: created.revision,
    skills: { notes: { type: "upstream", upstream: { url: "https://github.com/acme/skills", path: "../escape" } } },
  })
  expect(refused.status).toBe(400)
  const updated = await call(app, cookie, "PATCH", `/apps/${created.id}`, {
    expectedRevision: created.revision,
    mcps: {
      local: {
        name: "Local",
        description: "Run local",
        transport: { type: "local", command: ["server", "a b"], cwd: "./tools", env: { MODE: "literal" } },
        auth: { type: "none" },
        timeouts: { startup: 1000, catalog: 2000, execution: 3000 },
      },
    },
  })
  expect(updated.status).toBe(200)
  expect(await updated.json()).toMatchObject({
    name: "Notes",
    revision: created.revision + 1,
    mcps: { local: { transport: { cwd: "./tools", env: { MODE: "literal" } } } },
  })
  const stale = await call(app, cookie, "PATCH", `/apps/${created.id}`, { expectedRevision: created.revision })
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ message: "The app changed. Reload before saving." })
  const foreign = sessionCookie(await signUp(app, "app-foreign@gmail.com", "Grace"))
  expect((await call(app, foreign, "GET", `/apps/${created.id}`)).status).toBe(404)
})

test("the chat and the space list profiles with gaps (P1, P2, P15)", async () => {
  const cookie = sessionCookie(await signUp(app, "app-profiles@gmail.com", "Ana"))
  const spaces = await (await call(app, cookie, "GET", "/spaces")).json()
  const spaceId = spaces.items[0].id
  const created = await (
    await call(app, cookie, "POST", "/apps", {
      slug: "mail",
      ownerSpaceId: spaceId,
      name: "Mail",
      description: "Mail",
      mcps: {
        gmail: {
          name: "Gmail",
          description: "Gmail",
          transport: { type: "remote", url: "https://gmail.example.com/mcp" },
          auth: { type: "oauth", tokenEndpointAuth: "none" },
        },
      },
    })
  ).json()
  const profiles = await (await call(app, cookie, "GET", `/app-profiles?appId=${created.id}`)).json()
  expect(profiles.items).toHaveLength(1)
  const reached = await call(app, cookie, "GET", `/spaces/${spaceId}/profiles`)
  expect(reached.status).toBe(200)
  expect((await reached.json()).profiles).toMatchObject([
    { appId: created.id, items: [{ item: { mcp: "gmail" }, status: "missing" }] },
  ])
  const mine = await call(app, cookie, "POST", "/app-profiles", {
    appId: created.id,
    name: "Ana",
    slug: "ana",
    kind: "private",
  })
  expect(mine.status).toBe(200)
  const removed = await call(app, cookie, "DELETE", `/app-profiles/${(await mine.json()).id}`)
  expect(removed.status).toBe(200)
})

test("app.get and app.list leave out skill content; app-skills.get returns it to those who can see the app", async () => {
  const cookie = sessionCookie(await signUp(app, "app-skills@gmail.com", "Ada"))
  const spaces = await (await call(app, cookie, "GET", "/spaces")).json()
  const created = await (
    await call(app, cookie, "POST", "/apps", {
      slug: "guides",
      ownerSpaceId: spaces.items[0].id,
      name: "Guides",
      description: "Write guides",
      skills: {
        guide: {
          type: "content",
          description: "Write a guide",
          instructions: "Follow the outline.",
          files: { "scripts/outline.mjs": "export const outline = []" },
        },
      },
    })
  ).json()
  const summary = { type: "content", description: "Write a guide", requiredCredentials: [] }
  expect(created.skills).toEqual({ guide: summary })
  expect((await (await call(app, cookie, "GET", `/apps/${created.id}`)).json()).skills).toEqual({ guide: summary })
  const listed = await (await call(app, cookie, "GET", "/apps")).json()
  expect(listed.items.find((each: { readonly id: string }) => each.id === created.id).skills).toEqual({
    guide: summary,
  })
  const skills = await call(app, cookie, "GET", `/apps/${created.id}/skills`)
  expect(skills.status).toBe(200)
  expect(await skills.json()).toEqual({
    guide: {
      ...summary,
      instructions: "Follow the outline.",
      files: { "scripts/outline.mjs": "export const outline = []" },
    },
  })
  expect((await call(app, cookie, "GET", "/apps/guides/skills")).status).toBe(200)
  const foreign = sessionCookie(await signUp(app, "app-skills-foreign@gmail.com", "Grace"))
  expect((await call(app, foreign, "GET", `/apps/${created.id}/skills`)).status).toBe(404)
})
