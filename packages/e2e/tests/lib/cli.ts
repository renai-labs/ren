import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import { execFile, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Schema } from "effect"
import { serverURL } from "./servers.js"

const cli = fileURLToPath(new URL("../../../cli/src/index.ts", import.meta.url))

export const ren = (args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  promisify(execFile)("bun", [cli, ...args], { env: { ...process.env, REN_URL: serverURL, ...env } })

export const Stored = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))),
)

export const Me = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ user: Schema.Struct({ email: Schema.String }) })),
)

export const login = async (page: Page, env: Record<string, string>) => {
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
  await page.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(page.getByText("You can close this tab.")).toBeVisible()
  expect(await exited).toBe(0)
  return stdout.join("")
}
