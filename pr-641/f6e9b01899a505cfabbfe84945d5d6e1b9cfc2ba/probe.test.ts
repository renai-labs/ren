import { expect, setDefaultTimeout } from "bun:test"
import { Session } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { testEffect } from "@ren/executor/testing"
import { Session as RenSession } from "@ren/schema/session"
import { Effect, Layer, Option, Ref } from "effect"
import { HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import type { OpenCodeMcp } from "../src/harness/opencode/mcp.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { ManagedMcp } from "../test/lib/managed-mcp.js"
import { Shared } from "../test/lib/shared.js"

setDefaultTimeout(120_000)
const it = testEffect(Layer.empty)
const stub = Shared.stub()
const out = process.env.QA_OUT ?? "/tmp/opencode/qa-641/out"

const queries = [
  "artifact",
  "publish an artifact",
  "publish a page to share",
  "dashboard at its own URL",
  "build a website",
]

it.live("probe: catalog and search for the artifact tools in a crowded ren namespace", () =>
  Effect.gen(function* () {
    const filler = Array.from({ length: 300 }, (_, index) => `tool_${String(index).padStart(3, "0")}`)
    const peer = yield* ManagedMcp.make(filler)
    const current = yield* Ref.make(Option.some("host-1"))
    const ren: OpenCodeMcp.RenAccess = { address: Effect.succeed(Option.some(peer.url)), token: Ref.get(current) }
    const access = Shared.access(undefined, stub.url)
    const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "qa-641-"))))
    const server = yield* OpenCodeServer.make(
      (replacements) =>
        createEmbeddedRoutes(
          {
            database: { path: ":memory:" },
            config: { directory, project: false, content: Shared.vars(stub.url).OPENCODE_CONFIG },
            models: { fetch: false },
            fs: { filewatcher: false, fff: false },
          },
          replacements,
        ).pipe(Layer.provide(HttpServer.layerServices)),
      access.endpoints,
      () => Effect.succeedNone,
      Option.none(),
      {
        saved: Option.none(),
        directoryOf: (sessionId) => join(directory, sessionId),
        makeDirectory: (path) => Effect.promise(() => mkdir(path, { recursive: true })),
        ren: Option.some(ren),
      },
    )
    const harness = yield* OpenCodeHarness.make(server, access.endpoints)
    const sessionId = RenSession.ID.create()
    yield* harness.start({ sessionId, harness: "opencode", interactive: true })
    const code = `const found = {}
for (const query of ${JSON.stringify(queries)}) {
  const result = await search({ query, limit: 5 })
  found[query] = result.items.map((item) => item.path)
}
return found`
    const script = stub.script({ tools: [{ name: "execute", input: { code } }] })
    yield* server.client.session
      .prompt({ sessionID: Session.ID.make(sessionId), text: `${script.marker} make me an artifact` })
      .pipe(Effect.orDie)
    yield* server.client.experimental.session.wait({ sessionID: Session.ID.make(sessionId) }).pipe(Effect.orDie)
    const system = script.calls.at(0)?.system ?? ""
    const searched = script.calls.at(-1)?.body.messages.findLast((message) => message.role === "tool")?.content
    yield* Effect.promise(async () => {
      await mkdir(out, { recursive: true })
      await writeFile(join(out, "system.txt"), system)
      await writeFile(join(out, "search.json"), String(searched))
    })
    expect(system.length).toBeGreaterThan(0)
  }),
)
