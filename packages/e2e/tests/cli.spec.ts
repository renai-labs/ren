import { expect, test } from "@playwright/test"
import { execFile } from "node:child_process"
import { Schema } from "effect"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { serverURL } from "./lib/servers.js"

const cli = fileURLToPath(new URL("../../cli/src/index.ts", import.meta.url))

test("ren health reports server health", async () => {
  const result = await promisify(execFile)("bun", [cli, "health"], { env: { ...process.env, REN_URL: serverURL } })
  const health = Schema.Struct({ status: Schema.String, version: Schema.String })
  expect(Schema.decodeUnknownSync(Schema.fromJsonString(health))(result.stdout)).toEqual({
    status: "ok",
    version: "local",
  })
})
