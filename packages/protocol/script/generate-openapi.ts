import { OpenApi } from "effect/http-api"
import { format } from "oxfmt"
import { fileURLToPath } from "url"
import { ClientApi } from "../src/client.js"
import { UsageIngestApi } from "../src/usage-ingest.js"
import { checkContract } from "./contract.js"
import { stabilizeOpenApi } from "./openapi-stabilize.js"

const violations = checkContract(ClientApi)
if (violations.length > 0) {
  console.error(["API contract violations:", ...violations].join("\n- "))
  process.exit(1)
}

const documents = [
  { target: fileURLToPath(new URL("../openapi.json", import.meta.url)), spec: OpenApi.fromApi(ClientApi) },
  {
    target: fileURLToPath(new URL("../usage-ingest.openapi.json", import.meta.url)),
    spec: OpenApi.fromApi(UsageIngestApi),
  },
]

const rendered = await Promise.all(
  documents.map(async (document) => {
    const formatted = await format(document.target, JSON.stringify(stabilizeOpenApi(document.spec), null, 2), {
      printWidth: 120,
    })
    if (formatted.errors.length > 0) throw new Error(formatted.errors.map((error) => error.message).join("\n"))
    return { target: document.target, code: formatted.code }
  }),
)

if (process.argv.includes("--check")) {
  const stale = await Promise.all(
    rendered.map(async (document) => (await Bun.file(document.target).text()) !== document.code),
  )
  if (stale.some(Boolean)) {
    console.error("Generated OpenAPI document is stale. Run `bun run generate` from packages/protocol.")
    process.exit(1)
  }
  process.exit(0)
}

await Promise.all(rendered.map((document) => Bun.write(document.target, document.code)))
