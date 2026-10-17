import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Signature } from "@ren/brain-api/signature"
import { Shared, TestToken, Wrangler } from "@ren/cell/testing"
import type { StubModel } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Machine } from "@ren/executor/testing"
import type { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrainHost } from "../src/brain-host.js"
import { Environments } from "../src/environments.js"
import { Models } from "../src/models.js"
import { HostApiTest } from "./lib/host-api.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(180_000)

const wrangler = process.env.CELL_RUNTIME === "wrangler"
const stub = Shared.stub()
const environmentId = Environment.ID.create()
const newer = await Effect.runPromise(Signature.generate("newer"))

const encodedKey = (key: Signature.PrivateKey) => ({
  id: key.id,
  key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key),
})

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () => Effect.sync(() => Shared.access({ stub: Shared.apiKey("sk-environments") }, stub.url)),
    refreshIfDue: () => Effect.succeedNone,
    revoke: () => Effect.void,
  }),
)

interface Sandbox {
  readonly id: string
  readonly directory: string
  readonly url: string
  readonly dispose: () => Promise<void>
}

const sandbox = async (id: string, publicKeys?: readonly [Signature.PublicKey, ...Array<Signature.PublicKey>]) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-lifecycle-")))
  const runtime = ManagedRuntime.make(
    Machine.layer({ environmentId, workspace: directory, ...(publicKeys && { publicKeys }) }),
  )
  return { id, directory, url: await runtime.runPromise(Machine.url), dispose: () => runtime.dispose() }
}

const port = await (async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const found = Number(probe.url.port)
  await probe.stop(true)
  return found
})()

const database = ManagedRuntime.make(Testing.layer)

const core = {
  stop: () => Promise.resolve(),
  issued: [] as Array<string>,
  accesses: new Map<Session.ID, number>(),
}

interface CoreConfig {
  readonly sandboxes: ReadonlyArray<{
    readonly id: string
    readonly url: string
    readonly generation: number
    readonly workspace: string
  }>
  readonly lifetime?: string
  readonly keys?: ReadonlyArray<Signature.PrivateKey>
  readonly present?: boolean
}

const environmentsConfig = (config: CoreConfig) => ({
  ENVIRONMENTS: JSON.stringify(
    config.present === false ? [] : [{ id: environmentId, capacity: 4, sandboxes: config.sandboxes }],
  ),
  ENVIRONMENT_KEYS: JSON.stringify((config.keys ?? [Machine.keys.privateKey]).map(encodedKey)),
  ...(config.lifetime && { ENVIRONMENT_TOKEN_LIFETIME: config.lifetime }),
})

const brainHost = async (cellUrl: string, config: CoreConfig) => {
  const context = await database.runPromise(Effect.context<Database.Service>())
  return Host.layerWith(
    { CELL_URL: cellUrl, CELL_KEYS: TestToken.vars.CELL_KEYS, ...environmentsConfig(config) },
    models,
    Environments.layer.pipe(Layer.provide(Layer.succeedContext(context))),
  )
}

let cell: Wrangler.Instance
let first: Sandbox
let organizationId: Auth.OrganizationID
let current: CoreConfig

const startCore = async (config: CoreConfig) => {
  current = config
  const api = HttpRouter.toWebHandler(
    HostApiTest.layer((endpoint, effect) =>
      endpoint !== "environments.access"
        ? effect
        : effect.pipe(
            Effect.tap((value) =>
              Effect.sync(() => {
                if (Schema.is(Environment.Access)(value)) core.issued.push(value.token)
              }),
            ),
          ),
    ).pipe(Layer.provide(await brainHost("http://127.0.0.1:9", config)), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: (request) => api.handler(request) })
  core.stop = async () => {
    await server.stop(true)
    await api.dispose()
  }
}

const restartCore = async (config: CoreConfig) => {
  await core.stop()
  await startCore(config)
}

const withHost = async <A, E>(effect: Effect.Effect<A, E, BrainHost.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(await brainHost(cell.url, current))))

const start = (sessionId: Session.ID, input: Partial<Session.StartInput> = {}) =>
  withHost(
    BrainHost.Service.use((brain) =>
      brain.start(
        {
          sessionId,
          harness: "opencode",
          instructions: {},
          interactive: false,
          environment: { environmentId, directory: Environment.sessionDirectory(sessionId) },
          ...input,
        },
        organizationId,
      ),
    ),
  )

const send = (sessionId: Session.ID, script: StubModel.Script) =>
  withHost(
    BrainHost.Service.use((brain) =>
      brain.send(
        {
          sessionId,
          messageId: Session.MessageID.create(),
          prompt: { text: `${script.marker} use the tool` },
          delivery: "steer",
          sender: { userId: "user_1" },
        },
        organizationId,
      ),
    ),
  )

const shell = (command: string) => ({ tool: { name: "shell", input: { command } } })

const lastToolResult = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

const turn = async (sessionId: Session.ID, command: string) => {
  const script = stub.script(shell(command))
  await send(sessionId, script)
  return lastToolResult(await script.called(2))
}

describe.skipIf(!wrangler)("environments from Ren core through a Wrangler cell to an executor", () => {
  beforeAll(async () => {
    first = await sandbox("sandbox-a")
    organizationId = await database.runPromise(Seed.organization())
    await startCore({
      sandboxes: [{ id: first.id, url: first.url, generation: 1, workspace: first.directory }],
      lifetime: "20 seconds",
    })
    cell = await Wrangler.make({ ...Shared.vars(stub.url), REN_URL: `http://127.0.0.1:${port}` })
  }, 240_000)

  afterAll(async () => {
    await cell.dispose()
    await core.stop()
    await first.dispose()
    await database.dispose()
  })

  test("BrainHost starts a session on an environment with its first message, and the model writes a file there", async () => {
    const sessionId = Session.ID.create()
    const script = stub.script(shell("echo from-the-model > written.txt"))
    await start(sessionId, {
      initialMessage: {
        messageId: Session.MessageID.create(),
        prompt: { text: `${script.marker} write it` },
        sender: { userId: "user_1" },
      },
    })
    await script.called(2)
    expect(await Bun.file(join(first.directory, sessionId, "written.txt")).text()).toBe("from-the-model\n")
    expect(await turn(sessionId, "cat written.txt")).toContain("from-the-model")
    expect(await turn(sessionId, "pwd")).toContain(join(first.directory, sessionId))
  })

  test("a turn longer than the environment token's lifetime continues, with new tokens from the Host API", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    const before = core.issued.length
    expect(await turn(sessionId, "sleep 30; echo outlived")).toContain("outlived")
    expect(core.issued.length - before).toBeGreaterThanOrEqual(2)
  })

  test("two sessions, each in its own cell, share a sandbox and keep their folders apart", async () => {
    const one = Session.ID.create()
    const two = Session.ID.create()
    await Promise.all([start(one), start(two)])
    await turn(one, "echo one > mine.txt")
    expect(await turn(two, "ls; pwd")).not.toContain("mine.txt")
    expect(await Bun.file(join(first.directory, one, "mine.txt")).text()).toBe("one\n")
  })

  test("after a cell restart and a Ren restart a session reaches the same sandbox and folder", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    await turn(sessionId, "echo kept > kept.txt")
    await cell.crash()
    await restartCore(current)
    await cell.start()
    expect(await turn(sessionId, "cat kept.txt")).toContain("kept")
  })

  test("a sandbox that Ren replaces is reached after one failed call, and an old one is not used again", async () => {
    const original = await sandbox("sandbox-b")
    const replacement = await sandbox("sandbox-b")
    const config = current
    await restartCore({
      ...config,
      sandboxes: [{ id: "sandbox-b", url: original.url, generation: 1, workspace: original.directory }],
    })
    const sessionId = Session.ID.create()
    await start(sessionId)
    expect(await turn(sessionId, "pwd")).toContain(original.directory)
    await original.dispose()
    await restartCore({
      ...config,
      sandboxes: [{ id: "sandbox-b", url: replacement.url, generation: 2, workspace: replacement.directory }],
    })
    expect(await turn(sessionId, "pwd")).toContain("does not answer")
    expect(await turn(sessionId, "pwd")).toContain(join(replacement.directory, sessionId))
    await restartCore(config)
    await replacement.dispose()
  })

  test("Ren down during a turn: tools work until the token expires, then Ren does not answer, then it works again", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    expect(await turn(sessionId, "echo fresh")).toContain("fresh")
    await core.stop()
    expect(await turn(sessionId, "echo still")).toContain("still")
    // ast-grep-ignore: no-test-sleep -- the real 20-second environment token must expire while Ren is down
    await Bun.sleep(21_000)
    expect(await turn(sessionId, "echo expired")).toContain("Ren does not answer")
    await startCore(current)
    // ast-grep-ignore: no-test-sleep -- the cell waits 30 seconds before it asks Ren again
    await Bun.sleep(31_000)
    expect(await turn(sessionId, "echo back")).toContain("back")
  })

  test("an environment removed from Ren's configuration gives no access to the next tool call, and the chat goes on", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    expect(await turn(sessionId, "echo before")).toContain("before")
    const config = current
    await restartCore({ ...config, present: false })
    await cell.crash()
    await cell.start()
    expect(await turn(sessionId, "echo after")).toContain("No access to a sandbox")
    const chat = stub.script({ reply: "still here" })
    await send(sessionId, chat)
    await chat.called(1)
    await restartCore(config)
  })

  test("a new signing key works on an executor that knows it, and an old executor refuses the token clearly", async () => {
    const knowing = await sandbox("sandbox-new", [newer.publicKey, Machine.keys.publicKey])
    const old = await sandbox("sandbox-old")
    const config = current
    const signedByNewer = { lifetime: "20 seconds", keys: [newer.privateKey, Machine.keys.privateKey] }
    await restartCore({
      ...signedByNewer,
      sandboxes: [{ id: knowing.id, url: knowing.url, generation: 1, workspace: knowing.directory }],
    })
    const onKnowing = Session.ID.create()
    await start(onKnowing)
    expect(await turn(onKnowing, "echo knows")).toContain("knows")
    await restartCore({
      ...signedByNewer,
      sandboxes: [{ id: old.id, url: old.url, generation: 1, workspace: old.directory }],
    })
    const onOld = Session.ID.create()
    await start(onOld)
    expect(await turn(onOld, "echo old")).toContain("refused the access token")
    await restartCore(config)
    await Promise.all([knowing.dispose(), old.dispose()])
  })

  test("no environment token issued in this suite is in the cell's logs or a model request", async () => {
    const logs = await cell.logs()
    const requests = JSON.stringify(stub.calls.map((call) => call.body))
    expect(core.issued.length).toBeGreaterThan(0)
    expect(core.issued.filter((token) => logs.includes(token) || requests.includes(token))).toEqual([])
  })
})
