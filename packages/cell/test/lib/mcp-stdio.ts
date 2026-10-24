import { Schema } from "effect"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"

const decode = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
      method: Schema.String,
      params: Schema.optionalKey(Schema.Struct({ protocolVersion: Schema.optionalKey(Schema.String) })),
    }),
  ),
)

appendFileSync("started", `${process.pid}\n`)

const reply = (id: unknown, result: unknown) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)

for await (const line of createInterface({ input: process.stdin })) {
  const request = decode(line)
  if (request.id === undefined) continue
  if (request.method === "initialize")
    reply(request.id, {
      protocolVersion: request.params?.protocolVersion ?? "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "ren-stdio-test", version: "1" },
    })
  else if (request.method === "tools/list")
    reply(request.id, {
      tools: [{ name: "where", description: "Where the server runs", inputSchema: { type: "object", properties: {} } }],
    })
  else if (request.method === "tools/call")
    reply(request.id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            cwd: process.cwd(),
            argv: process.argv.slice(2),
            value: process.env.REN_TEST_VALUE,
            marker: existsSync("marker.txt") ? readFileSync("marker.txt", "utf8") : null,
          }),
        },
      ],
    })
  else reply(request.id, {})
}
