import { describe, expect, setDefaultTimeout } from "bun:test"
import type { StubModel } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { TestHand } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import type { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import { eq } from "drizzle-orm"
import { Cache, Duration, Effect, Layer, Schedule } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Access } from "../src/access.js"
import { ArtifactWorkerd } from "../src/artifact-provider/workerd.js"
import { ArtifactCloudflare } from "../src/artifact-provider/cloudflare.js"
import { Artifacts } from "../src/artifacts.js"
import { BrainRegistry } from "../src/brain-registry.js"
import { Brains } from "../src/brains.js"
import { BrainProvider } from "../src/brain-provider.js"
import { HandProvider } from "../src/hand-provider.js"
import { Hands } from "../src/hands.js"
import { DurableRunner } from "../src/durable-runner.js"
import { SandboxEgress } from "../src/sandbox-egress.js"
import { MachineNetwork } from "../src/machine-network.js"
import { Bundles } from "../src/bundles.js"
import { SessionRunner } from "../src/session/runner.js"
import { Signer } from "../src/signer.js"
import { Configured } from "./lib/configured.js"
import { TestDrives } from "./lib/drives.js"
import { ArtifactSamples } from "./lib/artifact-samples.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/hand-provider.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"
import { TestCloudflare } from "./lib/cloudflare.js"
import { BunServices } from "@effect/platform-bun"

setDefaultTimeout(120_000)

const stub = Configured.stub

const remote = await realpath(await mkdtemp(join(tmpdir(), "ren-artifact-environment-")))

const environments = Layer.unwrap(
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const executors = yield* Cache.make({
      capacity: 16,
      lookup: (environmentId: Hand.ID) =>
        Layer.buildWithScope(TestHand.layer({ environmentId, workspace: remote }), scope).pipe(
          Effect.flatMap((context) => Effect.provideContext(TestHand.url, context)),
          Effect.orDie,
        ),
    })
    const probe = yield* TestProvider.make({
      endpoint: (environmentId) => Cache.get(executors, environmentId).pipe(Effect.map((url) => ({ url }))),
    })
    return Hands.layer.pipe(
      Layer.provide(DurableRunner.layerMemory),
      Layer.provide([SandboxEgress.layerNone, MachineNetwork.layerNone, Bundles.layer]),
      Layer.provide([Signer.layerLocal, FetchHttpClient.layer]),
      Layer.provide(HandProvider.layer([Effect.succeed(probe.provider)])),
    )
  }),
)

const it = testEffect(
  Layer.mergeAll(
    SessionRunner.layer.pipe(
      Layer.provideMerge(BrainRegistry.layer),
      Layer.provideMerge(
        Host.layerServing(
          { ENVIRONMENT_DIRECTORY: remote },
          Configured.models,
          environments,
          Artifacts.layer.pipe(
            Layer.provide([
              process.env.REN_ARTIFACT_CLOUDFLARE_LIVE === "1" ? ArtifactCloudflare.layer : ArtifactWorkerd.layer,
              Access.layer,
            ]),
            Layer.provide(TestDrives.layer),
          ),
        ),
      ),
      Layer.provideMerge(
        process.env.REN_ARTIFACT_CLOUDFLARE_LIVE === "1" ? TestCloudflare.layer : FetchHttpClient.layer,
      ),
      Layer.provideMerge(Host.runner),
    ),
    Host.runner,
  ).pipe(Layer.provideMerge(Testing.layer), Layer.provideMerge(BunServices.layer)),
)

const create = (code: string) => ({ tool: { name: "execute", input: { code } } })

const lastToolResult = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

describe("artifacts from a chat", () => {
  it.live("a chat on a local brain publishes an artifact that Ren serves at its URL, and updates it there", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionRunner.Service
      const database = yield* Database.Service
      const artifacts = yield* Artifacts.Service
      const http = yield* HttpClient.HttpClient
      const owner = yield* Seed.owner()
      const sessionId = Session.ID.create()
      const published = stub.script(
        create(
          'return await tools.opencode.artifact_create({ title: "Report", files: { "index.html": "<h1>from a chat</h1>" } })',
        ),
      )
      yield* sessions.create(owner, {
        sessionId,
        harness: "opencode",
        interactive: true,
        initialMessage: {
          messageId: Session.MessageID.create(),
          prompt: { text: `publish ${published.marker}` },
          sender: { userId: owner.createdBy },
        },
      })
      const answered = yield* Effect.promise(() => published.called(2))
      const row = (yield* database.db
        .select()
        .from(Database.Schema.artifact)
        .where(eq(Database.Schema.artifact.space_id, owner.spaceId))).at(0)
      if (!row) return yield* Effect.die(new Error(`No artifact was published: ${answered.text}`))
      yield* Effect.addFinalizer(() =>
        artifacts
          .stop({ ...owner, brainId: Brain.ofSession(sessionId) }, row.id)
          .pipe(Effect.andThen(ArtifactSamples.idle(row.id)), Effect.ignore),
      )
      expect(JSON.stringify(answered.body)).toContain(row.id)
      expect(JSON.stringify(answered.body)).toContain("Deployment accepted")
      expect(JSON.stringify(answered.body)).not.toContain(`/api/experimental/artifacts/${row.id}/view/`)
      const completed = yield* Effect.promise(() =>
        stub.waitFor((call) => call.text.includes("Artifact deployment result:") && call.text.includes(row.id)),
      )
      expect(completed.text).toContain('"status":"ready"')
      const deployed = (yield* database.db
        .select()
        .from(Database.Schema.artifact)
        .where(eq(Database.Schema.artifact.id, row.id))).at(0)
      const url = deployed?.url ?? ""
      if (process.env.REN_ARTIFACT_CLOUDFLARE_LIVE === "1") {
        expect(deployed?.provider).toBe(ArtifactCloudflare.id)
        expect(url).toMatch(/^https:\/\/.*\.workers\.dev\//u)
        expect(completed.text).toContain(url)
        yield* Effect.log(`Ren chat Cloudflare artifact: ${row.id} ${url}`)
      }
      expect(yield* http.get(url).pipe(Effect.flatMap((response) => response.text))).toBe("<h1>from a chat</h1>")

      const updated = stub.script(
        create(
          `return await tools.opencode.artifact_update({ id: "${row.id}", baseDeploymentId: "${deployed?.published_deployment_id}", files: { "index.html": "<h1>updated</h1>" } })`,
        ),
      )
      const brains = yield* Brains.Service
      yield* brains.send({
        sessionId,
        messageId: Session.MessageID.create(),
        prompt: { text: `update ${updated.marker}` },
        delivery: "steer",
        sender: { userId: owner.createdBy },
      })
      const update = /deploymentId\\?":\s*\\?"([0-9a-f-]{36})/u
        .exec(lastToolResult(yield* Effect.promise(() => updated.called(2))))
        ?.at(1)
      if (!update) return yield* Effect.die(new Error("The update returned no deploymentId"))
      yield* Effect.promise(() =>
        stub.waitFor((call) => call.text.includes(`"deploymentId":"${update}","status":"ready"`)),
      )
      expect(yield* http.get(url).pipe(Effect.flatMap((response) => response.text))).toBe("<h1>updated</h1>")
    }),
  )

  it.live(
    "a chat on an environment publishes a folder with a binary file that Ren serves byte for byte, and reads it back into a new folder",
    () =>
      Effect.gen(function* () {
        const sessions = yield* SessionRunner.Service
        const database = yield* Database.Service
        const artifacts = yield* Artifacts.Service
        const http = yield* HttpClient.HttpClient
        const brains = yield* Brains.Service
        const owner = yield* Seed.owner()
        const environmentTemplateId = yield* Seed.environmentTemplate(owner.organizationId)
        yield* database.db
          .update(Database.Schema.space)
          .set({
            hand_placement: "remote",
            environment_template_id: environmentTemplateId,
          })
          .where(eq(Database.Schema.space.id, owner.spaceId))
        const sessionId = Session.ID.create()
        const folder = join(remote, sessionId)
        const logo = crypto.getRandomValues(new Uint8Array(384 * 1024))
        yield* Effect.promise(async () => {
          await mkdir(join(folder, "site"), { recursive: true })
          await writeFile(join(folder, "site/index.html"), '<img src="logo.png">')
          await writeFile(join(folder, "site/logo.png"), logo)
        })
        const published = stub.script(
          create('return await tools.opencode.artifact_create({ title: "Site", directory: "site" })'),
        )
        yield* sessions.create(owner, {
          sessionId,
          harness: "opencode",
          interactive: true,
          initialMessage: {
            messageId: Session.MessageID.create(),
            prompt: { text: `publish ${published.marker}` },
            sender: { userId: owner.createdBy },
          },
        })
        const answered = lastToolResult(yield* Effect.promise(() => published.called(2)))
        expect(answered).toContain("Deployment accepted")
        const row = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.space_id, owner.spaceId))).at(0)
        if (!row) return yield* Effect.die(new Error(`No artifact was published: ${answered}`))
        yield* Effect.addFinalizer(() =>
          artifacts
            .stop({ ...owner, brainId: Brain.ofSession(sessionId) }, row.id)
            .pipe(Effect.andThen(ArtifactSamples.idle(row.id)), Effect.ignore),
        )
        const completed = yield* Effect.promise(() =>
          stub.waitFor((call) => call.text.includes("Artifact deployment result:") && call.text.includes(row.id)),
        )
        expect(completed.text).toContain('"status":"ready"')
        const deployed = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.id, row.id))).at(0)
        const url = deployed?.url ?? ""
        expect(yield* http.get(url).pipe(Effect.flatMap((response) => response.text))).toBe('<img src="logo.png">')
        expect(
          new Uint8Array(
            yield* http.get(new URL("logo.png", url).href).pipe(Effect.flatMap((response) => response.arrayBuffer)),
          ),
        ).toEqual(logo)

        const read = stub.script(
          create(`return await tools.opencode.artifact_read({ id: "${row.id}", directory: "copy" })`),
        )
        yield* brains.send({
          sessionId,
          messageId: Session.MessageID.create(),
          prompt: { text: `read ${read.marker}` },
          delivery: "steer",
          sender: { userId: owner.createdBy },
        })
        expect(lastToolResult(yield* Effect.promise(() => read.called(2)))).toContain(join(folder, "copy"))
        expect(yield* Effect.promise(() => Bun.file(join(folder, "copy/logo.png")).bytes())).toEqual(logo)
        expect(yield* Effect.promise(() => Bun.file(join(folder, "copy/index.html")).text())).toBe(
          '<img src="logo.png">',
        )
      }),
  )
})

// oxlint-disable-next-line ren/no-comments -- The deployment holds on a server on this machine, which only a local workerd Worker can reach.
describe.skipIf(process.env.REN_ARTIFACT_CLOUDFLARE_LIVE === "1")("artifacts from a chat on a local provider", () => {
  it.live(
    "a deployment that ends while its chat's brain is asleep wakes the brain, and the chat gets its result once",
    () =>
      Effect.gen(function* () {
        const sessions = yield* SessionRunner.Service
        const database = yield* Database.Service
        const owner = yield* Seed.owner()
        const sessionId = Session.ID.create()
        const entered = Promise.withResolvers<void>()
        const released = Promise.withResolvers<void>()
        const held = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          idleTimeout: 0,
          fetch: async () => {
            entered.resolve()
            await released.promise
            return new Response("woken")
          },
        })
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            released.resolve()
            await held.stop(true)
          }),
        )
        const worker = `export default { fetch: () => fetch("http://127.0.0.1:${held.port}/") }`
        const published = stub.script(
          create(
            `return await tools.opencode.artifact_create({ title: "Asleep", entry: "_worker.js", files: { "_worker.js": ${JSON.stringify(worker)} } })`,
          ),
        )
        yield* sessions.create(owner, {
          sessionId,
          harness: "opencode",
          interactive: true,
          initialMessage: {
            messageId: Session.MessageID.create(),
            prompt: { text: `publish ${published.marker}` },
            sender: { userId: owner.createdBy },
          },
        })
        yield* Effect.promise(() => published.called(2))
        const row = (yield* database.db
          .select()
          .from(Database.Schema.artifact)
          .where(eq(Database.Schema.artifact.space_id, owner.spaceId))).at(0)
        if (!row) return yield* Effect.die(new Error("No artifact was published"))
        const chat = (yield* database.db
          .select({ brainId: Database.Schema.agent_session.brain_id })
          .from(Database.Schema.agent_session)
          .where(eq(Database.Schema.agent_session.id, sessionId))).at(0)
        if (!chat) return yield* Effect.die(new Error("The chat has no brain"))
        const brainId = chat.brainId
        yield* Effect.addFinalizer(() =>
          Effect.flatMap(Artifacts.Service, (artifacts) => artifacts.stop({ ...owner, brainId }, row.id)).pipe(
            Effect.andThen(ArtifactSamples.idle(row.id)),
            Effect.ignore,
          ),
        )
        yield* Effect.promise(() => entered.promise)
        const brain = (yield* database.db
          .select({ binding: Database.Schema.brain.binding })
          .from(Database.Schema.brain)
          .where(eq(Database.Schema.brain.id, brainId))).at(0)
        if (!brain?.binding) return yield* Effect.die(new Error("The chat's brain has no sandbox"))
        const sandbox = brain.binding
        const provider = yield* BrainProvider.first
        yield* provider.keepAlive(sandbox, Duration.millis(1)).pipe(Effect.orDie)
        yield* provider
          .status(sandbox)
          .pipe(
            Effect.orDie,
            Effect.repeat({ until: (status) => status === "paused", schedule: Schedule.spaced("20 millis") }),
          )
        released.resolve()
        const result = `Artifact deployment result: {"artifactId":"${row.id}"`
        const told = yield* Effect.promise(() => stub.waitFor((call) => call.text.includes(result)))
        expect(told.text).toContain('"status":"ready"')
        expect(told.text.split(result).length - 1).toBe(1)
      }),
  )
})
