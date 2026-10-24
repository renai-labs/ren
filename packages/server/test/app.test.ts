import { afterAll, expect, test } from "bun:test"
import { call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()
afterAll(() => app.dispose())

test("app handlers retain omitted metadata, reject invalid execution before writing and hide private IDs", async () => {
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
  const updated = await call(app, cookie, "PATCH", `/apps/${created.id}`, { name: "Updated" })
  expect(updated.status).toBe(200)
  expect(await updated.json()).toMatchObject({
    name: "Updated",
    description: "Write notes",
    icon: "https://example.com/icon.png",
    latestReleaseId: created.latestReleaseId,
  })
  const refused = await call(app, cookie, "POST", "/app-releases", {
    appId: created.id,
    expectedLatestReleaseId: created.latestReleaseId,
    skills: { notes: { type: "upstream", upstream: { url: "https://github.com/acme/skills", path: "../escape" } } },
  })
  expect(refused.status).toBe(400)
  const releases = await (await call(app, cookie, "GET", `/app-releases?appId=${created.id}`)).json()
  expect(releases.total).toBe(1)
  const release = await call(app, cookie, "POST", "/app-releases", {
    appId: created.id,
    expectedLatestReleaseId: created.latestReleaseId,
    mcps: {
      local: {
        name: "Local",
        description: "Run local",
        transport: { type: "local", command: ["server", "a b"], cwd: "./tools", env: { MODE: "literal" } },
        auth: { type: "none" },
        timeouts: { startup: 1000, catalog: 2000, execution: 3000 },
      },
    },
    skills: {
      notes: {
        type: "upstream",
        upstream: { url: "https://github.com/acme/skills", path: "." },
        requiredCredentials: [{ kind: "env", name: "NOTES_KEY" }],
      },
    },
  })
  expect(release.status).toBe(200)
  expect(await release.json()).toMatchObject({
    mcps: {
      local: {
        transport: { cwd: "./tools", env: { MODE: "literal" } },
        timeouts: { startup: 1000, catalog: 2000, execution: 3000 },
      },
    },
    skills: { notes: { upstream: { path: "." }, requiredCredentials: [{ kind: "env", name: "NOTES_KEY" }] } },
  })
  const foreign = sessionCookie(await signUp(app, "app-foreign@gmail.com", "Grace"))
  expect((await call(app, foreign, "GET", `/apps/${created.id}`)).status).toBe(404)
  expect((await call(app, foreign, "PATCH", `/apps/${created.id}`, { name: "Stolen" })).status).toBe(404)
})
