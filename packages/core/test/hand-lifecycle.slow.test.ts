import { HandProvider } from "../src/hand-provider.js"
import { FetchHttpClient } from "effect/http"
import { SandboxEgress } from "../src/sandbox-egress.js"
import { MachineNetwork } from "../src/machine-network.js"
import { Bundles } from "../src/bundles.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import type { StubModel } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { SqlClient } from "effect/sql"
import { TestHand } from "@ren/executor/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { MachineTemplate } from "@ren/schema/machine-template"
import { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime, Redacted, Schedule, Schema } from "effect"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Brains } from "../src/brains.js"
import { MachineProvider } from "../src/machine-provider.js"
import { Hands } from "../src/hands.js"
import { DurableRunner } from "../src/durable-runner.js"
import { Models } from "../src/models.js"
import { TestProvider } from "./lib/hand-provider.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"
import { Signer } from "../src/signer.js"

setDefaultTimeout(90_000)

const stub = Shared.stub()
const environmentTemplateId = MachineTemplate.ID.create()
const newer = await Effect.runPromise(Signature.generate("newer"))
const brainId = Brain.ID.create()

const encodedKeys = (keys: ReadonlyArray<Signature.PrivateKey>) =>
  JSON.stringify(keys.map((key) => ({ id: key.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key) })))

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    inference: Shared.inference(),
    revision: Effect.succeed("test"),
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () => Effect.sync(() => Shared.access({ stub: Shared.apiKey("sk-environments") }, stub.url)),
  }),
)

// oxlint-disable-next-line ren/no-comments -- Every test machine's executor runs in this process and works in one folder, so Ren's ENVIRONMENT_DIRECTORY names a real path on each of them.
const remote = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-remote-")))

interface Machine {
  readonly serve: (environmentId: Hand.ID) => Promise<string>
  readonly dispose: () => Promise<void>
}

const machine = (publicKeys?: readonly [Signature.PublicKey, ...Array<Signature.PublicKey>]): Machine => {
  const served = new Map<Hand.ID, { readonly url: Promise<string>; readonly dispose: () => Promise<void> }>()
  return {
    serve: (environmentId) => {
      const found = served.get(environmentId)
      if (found) return found.url
      const runtime = ManagedRuntime.make(
        TestHand.layer({ environmentId, workspace: remote, ...(publicKeys && { publicKeys }) }),
      )
      const url = runtime.runPromise(TestHand.url)
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
const placed = new Map<Hand.ID, Machine>()
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
      place: (environmentId) => {
        placed.set(environmentId, config.target)
        return Effect.promise(() => config.target.serve(environmentId)).pipe(Effect.map((url) => ({ url })))
      },
      endpoint: (environmentId) => {
        const on = placed.get(environmentId)
        return !on || disposed.has(on)
          ? Effect.fail(new MachineProvider.Gone({ message: `the machine of environment ${environmentId} is gone` }))
          : Effect.promise(() => on.serve(environmentId)).pipe(Effect.map((url) => ({ url })))
      },
    }),
  )
  return Host.stack({
    port,
    root,
    keepBrains: true,
    config: {
      ENVIRONMENT_DIRECTORY: remote,
      ENVIRONMENT_TOKEN_LIFETIME: "20 seconds",
      ...(config.keys && { ENVIRONMENT_KEYS: encodedKeys(config.keys) }),
    },
    models,
    environments: Hands.layer
      .pipe(Layer.provide(DurableRunner.layerMemory))
      .pipe(Layer.provide([SandboxEgress.layerNone, MachineNetwork.layerNone, Bundles.layer]))
      .pipe(Layer.provide([Signer.layerLocal, FetchHttpClient.layer]))
      .pipe(Layer.provide(HandProvider.layer([Effect.succeed(probe.provider)]))),
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
                if (Schema.is(Hand.Access)(value)) issued.push(Redacted.value(value.token))
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

const start = async (input: { readonly first?: StubModel.Script } = {}) => {
  const sessionId = await database.runPromise(Seed.session({ organizationId, spaceId, createdBy: creator, brainId }))
  await withRen(
    Brains.Service.use((brain) =>
      brain.start(
        {
          sessionId,
          harness: "opencode",
          interactive: false,
          hand: { placement: "remote", environmentTemplateId },
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
const started = async () => {
  const first = stub.script(shell("true"))
  const sessionId = await start({ first })
  await first.called(2)
  return sessionId
}

const send = (sessionId: Session.ID, script: StubModel.Script) =>
  withRen(
    Brains.Service.use((brain) =>
      brain.send({
        sessionId,
        messageId: Session.MessageID.create(),
        prompt: { text: `${script.marker} use the tool` },
        delivery: "steer",
        sender: { userId: "user_1" },
      }),
    ),
  )

const turn = async (sessionId: Session.ID, command: string) => {
  const script = stub.script(shell(command))
  await send(sessionId, script)
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

describe("environments of chats on a local sandbox brain", () => {
  beforeAll(async () => {
    organizationId = await database.runPromise(Seed.organization())
    await database.runPromise(Seed.ren())
    await database.runPromise(
      Seed.environmentTemplate(organizationId, { id: environmentTemplateId, sessionsPerEnvironment: 1 }),
    )
    spaceId = await database.runPromise(Seed.team(organizationId))
    await database.runPromise(
      Effect.gen(function* () {
        const db = yield* Database.Service
        yield* db.db
          .update(Database.Schema.space)
          .set({ hand_placement: "remote", environment_template_id: environmentTemplateId })
          .where(eq(Database.Schema.space.id, spaceId))
      }),
    )
    creator = (await database.runPromise(Seed.user())).id
    await database.runPromise(Seed.join(spaceId, creator))
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

  test("a chat in a space with a remote hand runs its commands on its environment, in its own folder", async () => {
    const templated = stub.script(shell("pwd"))
    const templatedId = await start({ first: templated })
    expect(lastToolResult(await templated.called(2))).toContain(join(remote, templatedId))
  })

  test.todo("a turn longer than the environment token's lifetime continues, with new tokens from the Ren Host API (hangs: a command over about 3 s on a hand reached without the egress never returns)", async () => {
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

  test.todo("after a brain crash and a Ren restart a chat reaches the same environment and folder (fails at times: the first environment access after a Ren restart gets a transport error on a hand reached without the egress)", async () => {
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

  // oxlint-disable-next-line ren/no-comments -- One turn, four commands: a turn holds its access, and the next turn asks Ren again. Each reply's delay places a command: Ren goes down before the second, the third starts after the 20-second token expired, and the fourth after Ren is back and the brain's 30-second wait ended.
  test("Ren down during a turn: its commands work until the token expires, then fail, then work again after Ren is back", async () => {
    const sessionId = await started()
    const tools = ["echo fresh", "echo still", "echo expired", "echo back"].map((command) => shell(command).tool)
    const script = stub.script({ tools })
    await send(sessionId, script)
    await script.called(1)
    script.set({ tools, dripMs: 3_000 })
    expect(lastToolResult(await script.called(2))).toBe(JSON.stringify("fresh\n"))
    await stopApi()
    script.set({ tools, dripMs: 21_000 })
    expect(lastToolResult(await script.called(3))).toBe(JSON.stringify("still\n"))
    script.set({ tools, dripMs: 31_000 })
    expect(lastToolResult(await script.called(4))).toMatch(/Ren does not answer|access to the environment expired/)
    await startApi()
    expect(lastToolResult(await script.called(5))).toBe(JSON.stringify("back\n"))
  })

  test("a new signing key works on an executor that knows it, and an old executor refuses the token clearly", async () => {
    const knowing = machine([newer.publicKey, TestHand.keys.publicKey])
    const old = machine()
    const config = ren.current
    const keys = [newer.privateKey, TestHand.keys.privateKey]
    await restartRen({ keys, target: knowing })
    const onKnowing = await started()
    expect(await turn(onKnowing, "echo knows")).toBe(JSON.stringify("knows\n"))
    // oxlint-disable-next-line ren/no-comments -- A running command holds the chat's seat, so the next chat gets a machine of its own.
    await send(onKnowing, stub.script(shell("touch held; sleep 120")))
    await Effect.runPromise(
      Effect.promise(() => Bun.file(join(remote, onKnowing, "held")).exists()).pipe(
        Effect.repeat({ until: (isHeld) => isHeld, schedule: Schedule.spaced("100 millis") }),
        Effect.timeout("30 seconds"),
      ),
    )
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
