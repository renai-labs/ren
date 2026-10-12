import { expect, test } from "@playwright/test"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { serverURL } from "./lib/servers.js"

const cli = fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url))

test("ren health reports server health", async () => {
  const result = await promisify(execFile)("bun", [cli, "health"], { env: { ...process.env, REN_URL: serverURL } })
  expect(JSON.parse(result.stdout)).toEqual({ status: "ok", version: "local" })
})
