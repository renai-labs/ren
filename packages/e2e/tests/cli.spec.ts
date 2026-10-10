import { expect, test } from "@playwright/test"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const cli = fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url))

test("ren health reports server health", async ({ baseURL }) => {
  const result = await promisify(execFile)("bun", [cli, "health"], { env: { ...process.env, REN_URL: baseURL } })
  expect(JSON.parse(result.stdout)).toEqual({ status: "ok", version: "local" })
})
