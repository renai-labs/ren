import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Signature } from "@ren/environment-api/signature"
import { Shared, TestToken, Wrangler } from "@ren/cell/testing"
import type { StubModel } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { TestEnvironment } from "@ren/executor/testing"
import type { Auth } from "@ren/schema/auth"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrainHost } from "../src/brain-host.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { Models } from "../src/models.js"
import { TestProvider } from "./lib/environment-provider.js"
import { RenHostApiTest } from "./lib/ren-host-api.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(180_000)

const wrangler = process.env.CELL_RUNTIME === "wrangler"
const stub = Shared.stub()
const environmentTemplateId = EnvironmentTemplate.ID.create()
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
  readonly serve: (environmentId: Environment.ID) => Promise<string>
  readonly dispose: () => Promise<void>
}

const sandbox = async (id: string, publicKeys?: readonly [Signature.PublicKey, ...Array<Signature.PublicKey>]) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-lifecycle-")))
  const served = new Map<Environment.ID, { readonly url: Promise<string>; readonly dispose: () => Promise<void> }>()
  const serve = (environmentId: Environment.ID) => {
    const found = served.get(environmentId)
    if (found) return found.url
    const runtime = ManagedRuntime.make(
      TestEnvironment.layer({ environmentId, workspace: directory, ...(publicKeys && { publicKeys }) }),
    )
    const url = runtime.runPromise(TestEnvironment.url)
    served.set(environmentId, { url, dispose: () => runtime.dispose() })
    return url
  }
  const dispose = async () => {
    await Promise.all([...served.values()].map((each) => each.dispose()))
  }
  return { id, directory, serve, dispose }
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
  readonly target: Sandbox
  readonly lifetime?: string
  readonly keys?: ReadonlyArray<Signature.PrivateKey>
  readonly present?: boolean
}

const placed = new Map<Environment.ID, Sandbox>()

const disposed = new Set<Sandbox>()

const dispose = async (each: Sandbox) => {
  disposed.add(each)
  await each.dispose()
}

const brainHost = async (cellUrl: string, config: CoreConfig) => {
  const context = await database.runPromise(Effect.context<Database.Service>())
  await database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      yield* db.db
        .update(Database.Schema.environment_template)
        .set({ archived_at: config.present === false ? new Date() : null })
        .where(eq(Database.Schema.environment_template.id, environmentTemplateId))
    }),
  )
  const probe = await Effect.runPromise(
    TestProvider.make({
      endpoint: (environmentId) => {
        const on = placed.get(environmentId) ?? config.target
        placed.set(environmentId, on)
        return disposed.has(on)
          ? Effect.fail(
              new EnvironmentProvider.Gone({ message: `the sandbox of environment ${environmentId} is gone` }),
            )
          : Effect.promise(() => on.serve(environmentId)).pipe(Effect.map((url) => ({ url: new URL(url) })))
      },
    }),
  )
  return Host.layerWith(
    {
      CELL_URL: cellUrl,
      CELL_KEYS: TestToken.vars.CELL_KEYS,
      ENVIRONMENT_KEYS: JSON.stringify((config.keys ?? [TestEnvironment.keys.privateKey]).map(encodedKey)),
      ...(config.lifetime && { ENVIRONMENT_TOKEN_LIFETIME: config.lifetime }),
    },
    models,
    Environments.layer.pipe(
      Layer.provide(EnvironmentProvider.layer([Effect.succeed(probe.provider)])),
      Layer.provide(Layer.succeedContext(context)),
    ),
  )
}

let cell: Wrangler.Instance
let first: Sandbox
let organizationId: Auth.OrganizationID
let spaceId: Space.ID
let current: CoreConfig

const startCore = async (config: CoreConfig) => {
  current = config
  const api = HttpRouter.toWebHandler(
    RenHostApiTest.layer((endpoint, effect) =>
      endpoint !== "environments.access"
        ? effect
        : effect.pipe(
            Effect.tap((value) =>
              Effect.sync(() => {
                if (Schema.is(Environment.Access)(value)) core.issued.push(Redacted.value(value.token))
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
          interactive: false,
          environmentTemplateId,
          ...input,
        },
        { organizationId, spaceId },
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
    await database.runPromise(
      Seed.environmentTemplate(organizationId, { id: environmentTemplateId, sessionsPerEnvironment: 1 }),
    )
    spaceId = await database.runPromise(Seed.team(organizationId))
    await startCore({ target: first, lifetime: "20 seconds" })
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

  test("a turn longer than the environment token's lifetime continues, with new tokens from the Ren Host API", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    const before = core.issued.length
    expect(await turn(sessionId, "sleep 30; echo outlived")).toBe(JSON.stringify("outlived\n"))
    expect(core.issued.length - before).toBeGreaterThanOrEqual(2)
  })

  test("two sessions, each in its own cell, share a sandbox and keep their folders apart", async () => {
    const one = Session.ID.create()
    const two = Session.ID.create()
    await Promise.all([start(one), start(two)])
    await turn(one, "echo one > mine.txt")
    expect(await turn(two, "ls")).toBe(JSON.stringify("(no output)"))
    expect(await Bun.file(join(first.directory, one, "mine.txt")).text()).toBe("one\n")
  })

  test("after a cell restart and a Ren restart a session reaches the same sandbox and folder", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    await turn(sessionId, "echo kept > kept.txt")
    await cell.crash()
    await restartCore(current)
    await cell.start()
    expect(await turn(sessionId, "cat kept.txt")).toBe(JSON.stringify("kept\n"))
  })

  test("a Ren restarted between an environment token and its refresh gives the refresh", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    expect(await turn(sessionId, "echo first")).toBe(JSON.stringify("first\n"))
    await restartCore(current)
    const before = core.issued.length
    // ast-grep-ignore: no-test-sleep -- the real 20-second environment token must reach its refresh window
    await Bun.sleep(15_000)
    expect(await turn(sessionId, "echo refreshed")).toBe(JSON.stringify("refreshed\n"))
    expect(core.issued.length - before).toBeGreaterThanOrEqual(1)
  })

  test("an environment that is gone is replaced after one failed call, and the old sandbox is not used again", async () => {
    const original = await sandbox("sandbox-b")
    const replacement = await sandbox("sandbox-b")
    const config = current
    await restartCore({ ...config, target: original })
    const sessionId = Session.ID.create()
    await start(sessionId)
    expect(await turn(sessionId, "pwd")).toContain(original.directory)
    await dispose(original)
    await restartCore({ ...config, target: replacement })
    expect(await turn(sessionId, "pwd")).toContain("does not answer")
    expect(await turn(sessionId, "pwd")).toContain(join(replacement.directory, sessionId))
    await restartCore(config)
    await dispose(replacement)
  })

  test("Ren down during a turn: tools work until the token expires, then Ren does not answer, then it works again", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    expect(await turn(sessionId, "echo fresh")).toBe(JSON.stringify("fresh\n"))
    await core.stop()
    expect(await turn(sessionId, "echo still")).toBe(JSON.stringify("still\n"))
    // ast-grep-ignore: no-test-sleep -- the real 20-second environment token must expire while Ren is down
    await Bun.sleep(21_000)
    expect(await turn(sessionId, "echo expired")).toContain("Ren does not answer")
    await startCore(current)
    // ast-grep-ignore: no-test-sleep -- the cell waits 30 seconds before it asks Ren again
    await Bun.sleep(31_000)
    expect(await turn(sessionId, "echo back")).toBe(JSON.stringify("back\n"))
  })

  test("an archived environment template gives no access to the next tool call, and the chat goes on", async () => {
    const sessionId = Session.ID.create()
    await start(sessionId)
    expect(await turn(sessionId, "echo before")).toBe(JSON.stringify("before\n"))
    const config = current
    await restartCore({ ...config, present: false })
    await cell.crash()
    await cell.start()
    expect(await turn(sessionId, "echo after")).toContain("No access to an environment")
    const chat = stub.script({ reply: "still here" })
    await send(sessionId, chat)
    await chat.called(1)
    await restartCore(config)
  })

  test("a new signing key works on an executor that knows it, and an old executor refuses the token clearly", async () => {
    const knowing = await sandbox("sandbox-new", [newer.publicKey, TestEnvironment.keys.publicKey])
    const old = await sandbox("sandbox-old")
    const config = current
    const signedByNewer = { lifetime: "20 seconds", keys: [newer.privateKey, TestEnvironment.keys.privateKey] }
    await restartCore({ ...signedByNewer, target: knowing })
    const onKnowing = Session.ID.create()
    await start(onKnowing)
    expect(await turn(onKnowing, "echo knows")).toBe(JSON.stringify("knows\n"))
    await restartCore({ ...signedByNewer, target: old })
    const onOld = Session.ID.create()
    await start(onOld)
    expect(await turn(onOld, "echo old")).toContain("refused the access token")
    await restartCore(config)
    await Promise.all([dispose(knowing), dispose(old)])
  })

  test("no environment token issued in this suite is in the cell's logs or a model request", async () => {
    const logs = await cell.logs()
    const requests = JSON.stringify(stub.calls.map((call) => call.body))
    expect(core.issued.length).toBeGreaterThan(0)
    expect(core.issued.filter((token) => logs.includes(token) || requests.includes(token))).toEqual([])
  })
})
