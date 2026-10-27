import { expect, test } from "@playwright/test"
import { execFile, spawn } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Schema } from "effect"
import { createUser, serverURL, uniqueEmail } from "./lib/servers.js"

const cli = fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url))

const ren2 = (args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  promisify(execFile)("bun", [cli, ...args], { env: { ...process.env, REN_URL: serverURL, ...env } })

const Stored = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))),
)

const Me = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ user: Schema.Struct({ email: Schema.String }) })),
)

test("ren2 health reports server health", async () => {
  const result = await ren2(["health"])
  const health = Schema.Struct({ status: Schema.String, version: Schema.String })
  expect(Schema.decodeUnknownSync(Schema.fromJsonString(health))(result.stdout)).toEqual({
    status: "ok",
    version: "local",
  })
})

test("ren2 signs in through the browser, refreshes its session and signs out", async ({ page }) => {
  const email = uniqueEmail("cli")
  await createUser(page.request, { name: "Ada Lovelace", email })
  const config = await mkdtemp(join(tmpdir(), "ren2-e2e-"))
  const env = { XDG_CONFIG_HOME: config }

  const login = spawn("bun", [cli, "login", "--no-browser"], {
    env: { ...process.env, REN_URL: serverURL, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => login.on("exit", resolve))
  const stdout: Array<string> = []
  login.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString()))
  const url = await new Promise<string>((resolve) =>
    createInterface({ input: login.stderr }).on("line", (line) => {
      if (line.startsWith("http")) resolve(line)
    }),
  )
  await page.goto(url)
  await page.getByRole("button", { name: "Allow access" }).click()
  await expect(page.getByText("You can close this tab.")).toBeVisible()
  expect(await exited).toBe(0)
  expect(Me(stdout.join("")).user.email).toBe(email)
  expect(Me((await ren2(["whoami"], env)).stdout).user.email).toBe(email)

  const file = join(config, "ren2", "credentials.json")
  const signedIn = Schema.decodeUnknownSync(Stored)(await readFile(file, "utf8"))
  const session = signedIn[serverURL] ?? {}
  await writeFile(file, JSON.stringify({ [serverURL]: { ...session, expiresAt: 0 } }))
  expect(Me((await ren2(["whoami"], env)).stdout).user.email).toBe(email)
  const refreshed = Schema.decodeUnknownSync(Stored)(await readFile(file, "utf8"))[serverURL] ?? {}
  expect(refreshed["refreshToken"]).not.toBe(session["refreshToken"])
  expect(refreshed["expiresAt"]).toBeGreaterThan(Date.now())

  const loggedOut = Schema.Struct({ server: Schema.String, loggedOut: Schema.Boolean })
  expect(Schema.decodeUnknownSync(Schema.fromJsonString(loggedOut))((await ren2(["logout"], env)).stdout)).toEqual({
    server: serverURL,
    loggedOut: true,
  })
  await expect(ren2(["whoami", "--output", "pretty"], env)).rejects.toMatchObject({
    code: 1,
    stderr: `Not logged in to ${serverURL}. Run ren2 login.\n`,
  })
})
