import { OpenApi } from "effect/http-api"
import { format } from "oxfmt"
import { fileURLToPath } from "url"
import { ClientApi } from "../src/client.js"
import { checkContract } from "./contract.js"
import { stabilizeOpenApi } from "./openapi-stabilize.js"

const violations = checkContract(ClientApi)
if (violations.length > 0) {
  console.error(["API contract violations:", ...violations].join("\n- "))
  process.exit(1)
}

const target = fileURLToPath(new URL("../openapi.json", import.meta.url))
const formatted = await format(target, JSON.stringify(stabilizeOpenApi(OpenApi.fromApi(ClientApi)), null, 2), {
  printWidth: 120,
})
if (formatted.errors.length > 0) throw new Error(formatted.errors.map((error) => error.message).join("\n"))
const document = formatted.code

if (process.argv.includes("--check")) {
  if ((await Bun.file(target).text()) !== document) {
    console.error("Generated OpenAPI document is stale. Run `bun run generate` from packages/protocol.")
    process.exit(1)
  }
  process.exit(0)
}

await Bun.write(target, document)
