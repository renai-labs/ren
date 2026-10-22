import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import type { StubModel } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { SqlClient } from "effect/sql"
import { TestEnvironment } from "@ren/executor/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import type { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrainHost } from "../src/brain-host.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { Models } from "../src/models.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(180_000)

const stub = Shared.stub()
const environmentTemplateId = EnvironmentTemplate.ID.create()
const newer = await Effect.runPromise(Signature.generate("newer"))
const brainId = Brain.ID.create()

const encodedKeys = (keys: ReadonlyArray<Signature.PrivateKey>) =>
  JSON.stringify(keys.map((key) => ({ id: key.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key) })))

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () => Effect.sync(() => Shared.access({ stub: Shared.apiKey("sk-environments") }, stub.url)),
  }),
)

// oxlint-disable-next-line ren/no-comments -- Every test machine's executor runs in this process and works in one folder, so Ren's ENVIRONMENT_DIRECTORY names a real path on each of them.
const remote = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-remote-")))

interface Machine {
  readonly serve: (environmentId: Environment.ID) => Promise<string>
  readonly dispose: () => Promise<void>
}

const machine = (publicKeys?: readonly [Signature.PublicKey, ...Array<Signature.PublicKey>]): Machine => {
  const served = new Map<Environment.ID, { readonly url: Promise<string>; readonly dispose: () => Promise<void> }>()
  return {
    serve: (environmentId) => {
      const found = served.get(environmentId)
      if (found) return found.url
      const runtime = ManagedRuntime.make(
        TestEnvironment.layer({ environmentId, workspace: remote, ...(publicKeys && { publicKeys }) }),
      )
      const url = runtime.runPromise(TestEnvironment.url)
      served.set(environmentId, { url, dispose: () => runtime.dispose() })
      return url
    },
    dispose: async () => {
      await Promise.all([...served.values()].map((each) => each.dispose()))
    },
  }
}

interface CoreConfig {
  readonly target: Machine
  readonly keys?: ReadonlyArray<Signature.PrivateKey>
}

const database = ManagedRuntime.make(Testing.layer)
const placed = new Map<Environment.ID, Machine>()
const disposed = new Set<Machine>()
const issued: Array<string> = []
const port = await Effect.runPromise(Host.freePort)
const root = await mkdtemp(join(tmpdir(), "ren-core-brains-"))

const dispose = async (each: Machine) => {
  disposed.add(each)
  await each.dispose()
}

const stackOf = async (config: CoreConfig) => {
  const probe = await Effect.runPromise(
    TestProvider.make({
      endpoint: (environmentId) => {
        const on = placed.get(environmentId) ?? config.target
        placed.set(environmentId, on)
        return disposed.has(on)
          ? Effect.fail(
              new EnvironmentProvider.Gone({ message: `the machine of environment ${environmentId} is gone` }),
            )
          : Effect.promise(() => on.serve(environmentId)).pipe(Effect.map((url) => ({ url: new URL(url) })))
      },
    }),
  )
  return Host.stack({
    port,
    root,
    config: {
      ENVIRONMENT_DIRECTORY: remote,
      ENVIRONMENT_TOKEN_LIFETIME: "20 seconds",
      ...(config.keys && { ENVIRONMENT_KEYS: encodedKeys(config.keys) }),
    },
    models,
    environments: Environments.layer.pipe(Layer.provide(EnvironmentProvider.layer([Effect.succeed(probe.provider)]))),
  }).pipe(
    Layer.provide(
      Layer.succeedContext(await database.runPromise(Effect.context<Database.Service | SqlClient.SqlClient>())),
    ),
  )
}

type Stack = Layer.Success<Awaited<ReturnType<typeof stackOf>>>

// oxlint-disable-next-line ren/no-comments -- Ren is two parts here: the services the test calls, and the Ren Host API the brains call. The test can take the API down and keep calling Ren.
const ren = {
  current: { target: machine() } as CoreConfig,
  services: undefined as ManagedRuntime.ManagedRuntime<Stack, unknown> | undefined,
  api: undefined as ManagedRuntime.ManagedRuntime<never, unknown> | undefined,
}

const startApi = async () => {
  const services = ren.services
  if (!services) throw new Error("Ren is not started")
  ren.api = ManagedRuntime.make(
    Host.serve(port, (endpoint, effect) =>
      endpoint !== "environments.access"
        ? effect
        : effect.pipe(
            Effect.tap((value) =>
              Effect.sync(() => {
                if (Schema.is(Environment.Access)(value)) issued.push(Redacted.value(value.token))
              }),
            ),
          ),
    ).pipe(Layer.provide(Layer.succeedContext(await services.context()))),
  )
  await ren.api.context()
}

const stopApi = async () => {
  await ren.api?.dispose()
  ren.api = undefined
}

const startRen = async (config: CoreConfig) => {
  ren.current = config
  ren.services = ManagedRuntime.make(await stackOf(config))
  await startApi()
}

const restartRen = async (config: CoreConfig) => {
  await stopApi()
  await ren.services?.dispose()
  await startRen(config)
}

const withRen = <A, E>(effect: Effect.Effect<A, E, Stack>) => {
  const services = ren.services
  if (!services) throw new Error("Ren is not started")
  return services.runPromise(effect)
}

let organizationId: Auth.OrganizationID
let spaceId: Space.ID
let creator: Auth.UserID

const shell = (command: string) => ({ tool: { name: "shell", input: { command } } })

const lastToolResult = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

const start = async (input: { readonly withTemplate?: boolean; readonly first?: StubModel.Script } = {}) => {
  const sessionId = await database.runPromise(Seed.session({ organizationId, spaceId, createdBy: creator, brainId }))
  await withRen(
    BrainHost.Service.use((brain) =>
      brain.start(
        {
          sessionId,
          harness: "opencode",
          interactive: false,
          ...(input.withTemplate !== false && { environmentTemplateId }),
          ...(input.first && {
            initialMessage: {
              messageId: Session.MessageID.create(),
              prompt: { text: `${input.first.marker} go` },
              sender: { userId: creator },
            },
          }),
        },
        { organizationId, spaceId, brainId },
      ),
    ),
  )
  return sessionId
}

// oxlint-disable-next-line ren/no-comments -- A start runs in the background; its first message shows that the chat exists before a test sends more.
const started = async (input: { readonly withTemplate?: boolean } = {}) => {
  const first = stub.script(shell("true"))
  const sessionId = await start({ ...input, first })
  await first.called(2)
  return sessionId
}

const turn = async (sessionId: Session.ID, command: string) => {
  const script = stub.script(shell(command))
  await withRen(
    BrainHost.Service.use((brain) =>
      brain.send({
        sessionId,
        messageId: Session.MessageID.create(),
        prompt: { text: `${script.marker} use the tool` },
        delivery: "steer",
        sender: { userId: "user_1" },
      }),
    ),
  )
  return lastToolResult(await script.called(2))
}

const brainRow = async () => {
  const rows = await database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      return yield* db.db
        .select({ generation: Database.Schema.brain.generation, url: Database.Schema.brain.url })
        .from(Database.Schema.brain)
        .where(eq(Database.Schema.brain.id, brainId))
    }),
  )
  const row = rows.at(0)
  if (!row?.url) throw new Error(`Brain ${brainId} has no sandbox`)
  return { home: join(root, `${brainId}-${row.generation}`), url: row.url }
}

const home = async () => (await brainRow()).home

const answers = async (url: string): Promise<void> => {
  const response = await fetch(`${url}/ren/state`).catch(() => undefined)
  if (response && response.status !== 503) return
  // ast-grep-ignore: no-test-sleep -- the sandbox's loop starts the brain's process again; the test waits until it answers
  await Bun.sleep(200)
  return answers(url)
}

// oxlint-disable-next-line ren/no-comments -- Kills the brain's Bun process only, not the sandbox's loop or the executor; the loop starts the brain again, as on E2B.
const crashBrain = async () => {
  const brain = await brainRow()
  const binding = await Bun.file(join(brain.home, ".ren", "sandbox.json")).json()
  await Bun.spawn(["pkill", "-KILL", "-g", String(binding.pid), "-f", "^bun .*cell/src/bun\\.ts"]).exited
  // ast-grep-ignore: no-test-sleep -- the loop waits 1 second before it starts the brain again
  await Bun.sleep(500)
  await answers(brain.url)
}

const setArchived = (archived: boolean) =>
  database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      yield* db.db
        .update(Database.Schema.environment_template)
        .set({ archived_at: archived ? new Date() : null })
        .where(eq(Database.Schema.environment_template.id, environmentTemplateId))
    }),
  )

describe("environments of chats on a local sandbox brain", () => {
  beforeAll(async () => {
    organizationId = await database.runPromise(Seed.organization())
    await database.runPromise(Seed.ren())
    await database.runPromise(
      Seed.environmentTemplate(organizationId, { id: environmentTemplateId, sessionsPerEnvironment: 1 }),
    )
    spaceId = await database.runPromise(Seed.team(organizationId))
    creator = (await database.runPromise(Seed.user())).id
    await startRen({ target: machine() })
  }, 240_000)

  afterAll(async () => {
    await stopApi()
    await ren.services?.runPromise(Effect.scoped(Layer.build(Host.destroyBrains)))
    await ren.services?.dispose()
    await Promise.all([...new Set(placed.values())].map((each) => each.dispose()))
    await database.dispose()
    await rm(root, { recursive: true, force: true })
  })

  test("one brain runs a chat with a template on its environment, and a chat without one on its own sandbox", async () => {
    const command = 'echo "on:$EXECUTOR_ENVIRONMENT_ID"; pwd'
    const own = stub.script(shell(command))
    const ownId = await start({ withTemplate: false, first: own })
    const ownOutput = lastToolResult(await own.called(2))
    expect(ownOutput).toContain(`on:${Environment.ofBrain(brainId)}`)
    expect(ownOutput).toContain(`/workspace/${ownId}`)
    const templated = stub.script(shell(command))
    const templatedId = await start({ first: templated })
    expect(lastToolResult(await templated.called(2))).toContain(join(remote, templatedId))
  })

  test("a turn longer than the environment token's lifetime continues, with new tokens from the Ren Host API", async () => {
    const sessionId = await started()
    const before = issued.length
    expect(await turn(sessionId, "sleep 30; echo outlived")).toBe(JSON.stringify("outlived\n"))
    expect(issued.length - before).toBeGreaterThanOrEqual(1)
  })

  test("two chats on one environment machine keep their folders apart", async () => {
    const one = await started()
    const two = await started()
    await turn(one, "echo one > mine.txt")
    expect(await turn(two, "ls")).toBe(JSON.stringify("(no output)"))
    expect(await Bun.file(join(remote, one, "mine.txt")).text()).toBe("one\n")
  })

  test("after a brain crash and a Ren restart a chat reaches the same environment and folder", async () => {
    const sessionId = await started()
    await turn(sessionId, "echo kept > kept.txt")
    await crashBrain()
    await restartRen(ren.current)
    expect(await turn(sessionId, "cat kept.txt")).toBe(JSON.stringify("kept\n"))
  })

  test("a Ren restarted between an environment token and its refresh gives the refresh", async () => {
    const sessionId = await started()
    expect(await turn(sessionId, "echo first")).toBe(JSON.stringify("first\n"))
    await restartRen(ren.current)
    const before = issued.length
    // ast-grep-ignore: no-test-sleep -- the real 20-second environment token must reach its refresh window
    await Bun.sleep(15_000)
    expect(await turn(sessionId, "echo refreshed")).toBe(JSON.stringify("refreshed\n"))
    expect(issued.length - before).toBeGreaterThanOrEqual(1)
  })

  test("an environment that is gone is replaced after one failed call, and the old machine is not used again", async () => {
    const original = machine()
    const replacement = machine()
    const config = ren.current
    await restartRen({ ...config, target: original })
    const sessionId = await started()
    expect(await turn(sessionId, "echo on-original")).toBe(JSON.stringify("on-original\n"))
    await dispose(original)
    await restartRen({ ...config, target: replacement })
    expect(await turn(sessionId, "pwd")).toContain("does not answer")
    expect(await turn(sessionId, "pwd")).toContain(join(remote, sessionId))
    await restartRen(config)
    await dispose(replacement)
  })

  test("Ren down during a turn: tools work until the token expires, then Ren does not answer, then it works again", async () => {
    const sessionId = await started()
    expect(await turn(sessionId, "echo fresh")).toBe(JSON.stringify("fresh\n"))
    await stopApi()
    expect(await turn(sessionId, "echo still")).toBe(JSON.stringify("still\n"))
    // ast-grep-ignore: no-test-sleep -- the real 20-second environment token must expire while Ren is down
    await Bun.sleep(21_000)
    expect(await turn(sessionId, "echo expired")).toContain("Ren does not answer")
    await startApi()
    // ast-grep-ignore: no-test-sleep -- the brain waits 30 seconds before it asks Ren again
    await Bun.sleep(31_000)
    expect(await turn(sessionId, "echo back")).toBe(JSON.stringify("back\n"))
  })

  test("an archived environment template gives no access to the next tool call, and the chat goes on", async () => {
    const sessionId = await started()
    expect(await turn(sessionId, "echo before")).toBe(JSON.stringify("before\n"))
    await setArchived(true)
    await crashBrain()
    expect(await turn(sessionId, "echo after")).toContain("No access to an environment")
    const chat = stub.script({ reply: "still here" })
    await withRen(
      BrainHost.Service.use((brain) =>
        brain.send({
          sessionId,
          messageId: Session.MessageID.create(),
          prompt: { text: `${chat.marker} hello` },
          delivery: "steer",
          sender: { userId: "user_1" },
        }),
      ),
    )
    await chat.called(1)
    await setArchived(false)
  })

  test("a new signing key works on an executor that knows it, and an old executor refuses the token clearly", async () => {
    const knowing = machine([newer.publicKey, TestEnvironment.keys.publicKey])
    const old = machine()
    const config = ren.current
    const keys = [newer.privateKey, TestEnvironment.keys.privateKey]
    await restartRen({ keys, target: knowing })
    const onKnowing = await started()
    expect(await turn(onKnowing, "echo knows")).toBe(JSON.stringify("knows\n"))
    await restartRen({ keys, target: old })
    const onOld = await started()
    expect(await turn(onOld, "echo old")).toContain("refused the access token")
    await restartRen(config)
    await Promise.all([dispose(knowing), dispose(old)])
  })

  test("no environment token issued in this suite is in the brain's logs or a model request", async () => {
    const logs = await Bun.file(join(await home(), ".ren", "brain.log")).text()
    const requests = JSON.stringify(stub.calls.map((call) => call.body))
    expect(issued.length).toBeGreaterThan(0)
    expect(issued.filter((token) => logs.includes(token) || requests.includes(token))).toEqual([])
  })
})
