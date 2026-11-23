import { expect, test } from "@playwright/test"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Schema } from "effect"
import { Me, Stored, login, ren } from "./lib/cli.js"
import { createUser, serverURL, uniqueEmail } from "./lib/servers.js"

const whoami = fileURLToPath(new URL("../../opencode/script/whoami.ts", import.meta.url))
const account = fileURLToPath(new URL("../script/opencode-account.ts", import.meta.url))

test("the OpenCode plugin uses and renews the ren CLI's login, and the CLI keeps working after", async ({ page }) => {
  const email = uniqueEmail("opencode")
  await createUser(page.request, { name: "Ada Lovelace", email })
  const config = await mkdtemp(join(tmpdir(), "ren-e2e-"))
  const env = { XDG_CONFIG_HOME: config }
  await login(page, env)
  const file = join(config, "ren", "credentials.json")
  const session = Schema.decodeUnknownSync(Stored)(await readFile(file, "utf8"))[serverURL] ?? {}
  await writeFile(file, JSON.stringify({ [serverURL]: { ...session, expiresAt: 0 } }))

  const plugin = await promisify(execFile)("bun", [whoami], { env: { ...process.env, REN_URL: serverURL, ...env } })

  expect(Me(plugin.stdout).user.email).toBe(email)
  const renewed = Schema.decodeUnknownSync(Stored)(await readFile(file, "utf8"))[serverURL] ?? {}
  expect(renewed["refreshToken"]).not.toBe(session["refreshToken"])
  expect(renewed["expiresAt"]).toBeGreaterThan(Date.now())
  expect(Me((await ren(["whoami"], env)).stdout).user.email).toBe(email)
})

test("the OpenCode plugin signs in and out by itself, and the ren CLI shares that login, which each can renew", async ({
  page,
}) => {
  test.slow()
  const email = uniqueEmail("opencode-login")
  await createUser(page.request, { name: "Ada Lovelace", email })
  const config = await mkdtemp(join(tmpdir(), "ren-e2e-"))
  const env = { XDG_CONFIG_HOME: config }
  const plugin = () => promisify(execFile)("bun", [whoami], { env: { ...process.env, REN_URL: serverURL, ...env } })

  const signedIn = await login(page, env, [account, "login"])
  expect(Me(signedIn.trim().split("\n").at(-1)).user.email).toBe(email)
  expect(Me((await plugin()).stdout).user.email).toBe(email)
  const file = join(config, "ren", "credentials.json")
  const issued = Schema.decodeUnknownSync(Stored)(await readFile(file, "utf8"))[serverURL] ?? {}
  await writeFile(file, JSON.stringify({ [serverURL]: { ...issued, expiresAt: 0 } }))
  expect(Me((await ren(["whoami"], env)).stdout).user.email).toBe(email)
  const renewed = Schema.decodeUnknownSync(Stored)(await readFile(file, "utf8"))[serverURL] ?? {}
  expect(renewed["refreshToken"]).not.toBe(issued["refreshToken"])

  const signedOut = await promisify(execFile)("bun", [account, "logout"], {
    env: { ...process.env, REN_URL: serverURL, ...env },
  })
  expect(signedOut.stdout.trim().split("\n").at(-1)).toBe(JSON.stringify({ server: serverURL, signedOut: true }))
  await expect(plugin()).rejects.toThrow("Run /ren:login.")
  await expect(ren(["whoami"], env)).rejects.toThrow("Not logged in")
})
