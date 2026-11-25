import { expect, test } from "@playwright/test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"
import { Me, Stored, login, ren } from "./lib/cli.js"
import { createUser, password, serverURL, signIn, uniqueEmail } from "./lib/servers.js"

test("ren manages a space and its members by slug", async ({ request }) => {
  const email = uniqueEmail("cli-space")
  await createUser(request, { name: "Grace Hopper", email })
  const token = (await signIn(request, { email, password })).headers()["set-auth-token"] ?? ""
  const env = { REN_TOKEN: token }
  const Space = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        id: Schema.String,
        slug: Schema.String,
        name: Schema.String,
        description: Schema.NullishOr(Schema.String),
      }),
    ),
  )

  const created = Space((await ren(["space", "create", "--name", "Docs", "--slug", "docs"], env)).stdout)
  expect(Space((await ren(["spaces", "get", "docs"], env)).stdout).id).toBe(created.id)
  const input = JSON.stringify({ name: "Docs Team", description: "Draft" })
  const updated = await ren(["space", "update", "docs", "--input", input, "--description", "Writes the docs"], env)
  expect(Space(updated.stdout)).toMatchObject({ id: created.id, name: "Docs Team", description: "Writes the docs" })

  const members = await ren(["space", "member", "list", "docs"], env)
  const Page = Schema.Struct({ items: Schema.Array(Schema.Unknown), total: Schema.Number })
  expect(Schema.decodeUnknownSync(Schema.fromJsonString(Page))(members.stdout).total).toBeGreaterThan(0)
  const pretty = await ren(["space", "list", "--output", "pretty"], env)
  expect(pretty.stdout).toMatch(/^ID +SLUG +NAME/u)
  expect(pretty.stdout).toContain("docs")
  expect(pretty.stdout).toMatch(/Page 1 of 1, \d+ total\.\n$/u)

  await expect(ren(["space", "update", "docs", "--name", ""], env)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('"path":"--name"'),
  })
  await ren(["space", "archive", "docs"], env)
  await expect(ren(["space", "get", "docs"], env)).rejects.toMatchObject({
    stderr: expect.stringContaining('"type":"NotFoundError"'),
  })
})

test("ren health reports server health", async () => {
  const result = await ren(["health"])
  const health = Schema.Struct({ status: Schema.String, version: Schema.String })
  expect(Schema.decodeUnknownSync(Schema.fromJsonString(health))(result.stdout)).toEqual({
    status: "ok",
    version: "local",
  })
})

test("ren signs in through the browser, refreshes its session and signs out", async ({ page }) => {
  const email = uniqueEmail("cli")
  await createUser(page.request, { name: "Ada Lovelace", email })
  const config = await mkdtemp(join(tmpdir(), "ren-e2e-"))
  const env = { XDG_CONFIG_HOME: config }

  expect(Me(await login(page, env)).user.email).toBe(email)
  expect(Me((await ren(["whoami"], env)).stdout).user.email).toBe(email)

  const file = join(config, "ren", "credentials.json")
  const signedIn = Schema.decodeUnknownSync(Stored)(await readFile(file, "utf8"))
  const session = signedIn[serverURL] ?? {}
  await writeFile(file, JSON.stringify({ [serverURL]: { ...session, expiresAt: 0 } }))
  expect(Me((await ren(["whoami"], env)).stdout).user.email).toBe(email)
  const refreshed = Schema.decodeUnknownSync(Stored)(await readFile(file, "utf8"))[serverURL] ?? {}
  expect(refreshed["refreshToken"]).not.toBe(session["refreshToken"])
  expect(refreshed["expiresAt"]).toBeGreaterThan(Date.now())

  const loggedOut = Schema.Struct({ server: Schema.String, loggedOut: Schema.Boolean })
  expect(Schema.decodeUnknownSync(Schema.fromJsonString(loggedOut))((await ren(["logout"], env)).stdout)).toEqual({
    server: serverURL,
    loggedOut: true,
  })
  await expect(ren(["whoami", "--output", "pretty"], env)).rejects.toMatchObject({
    code: 1,
    stderr: `Not logged in to ${serverURL}. Run ren login.\n`,
  })
})
