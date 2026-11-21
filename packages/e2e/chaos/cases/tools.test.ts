import { StubModel } from "@ren/cell/testing"
import { TestAccess } from "@ren/brain/testing"
import { HandConnections } from "@ren/brain/hand/connections"
import { HandSession } from "@ren/brain/hand/session"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import { ExecutorAdapter } from "../lib/adapters/executor.js"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { SessionDriver } from "../lib/drivers/session.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

describe.skipIf(Platform.wrangler !== undefined)("tools through the cell's dispatcher", () => {
  const lane: { stack?: Stack.Instance; environment?: Stack.Hand } = {}

  const current = () => {
    if (!lane.stack || !lane.environment) throw new Error("the stack did not start")
    return { stack: lane.stack, environment: lane.environment }
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
    lane.environment = await lane.stack.environment("tools")
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  const attached = (options: { readonly interactive?: boolean } = {}) =>
    current().stack.session({ environment: current().environment, start: options })

  const operationsSince = (from: number) =>
    current()
      .environment.proxy.seen.slice(from)
      .map((entry) => entry.operation)

  const read = async (sessionId: string, name: string) =>
    (await current().environment.instance.observe(["cat", `${sessionId}/${name}`])).stdout

  test("patch, which OpenCode offers to GPT models in place of edit and write, adds, updates and deletes files on the environment", async () => {
    const stack = current().stack
    const endpoint = stack.access().endpoints[0]
    if (!endpoint) throw new Error("the access has no endpoint")
    const gpt = {
      id: "gpt-5-chaos",
      type: "chat" as const,
      protocol: "openai-chat" as const,
      name: "GPT Chaos",
      limit: { context: 100_000, output: 4000 },
    }
    stack.provider.modelInfo.set([...StubModel.defaultModels, StubModel.modelEntry(endpoint.id, gpt.id)])
    const session = await stack.session({
      models: { endpoints: [{ ...endpoint, models: [...endpoint.models, gpt] }] },
      environment: current().environment,
      start: { model: { endpointId: endpoint.id, modelId: gpt.id } },
    })
    const stem = crypto.randomUUID().slice(0, 8)
    await current().environment.instance.observe([
      "sh",
      "-c",
      `mkdir -p ${session.sessionId} && cd ${session.sessionId} && printf 'one\\ntwo\\n' > update-${stem}.txt; printf 'x\\n' > delete-${stem}.txt`,
    ])
    const patchText = [
      "*** Begin Patch",
      `*** Add File: add-${stem}.txt`,
      "+added",
      `*** Update File: update-${stem}.txt`,
      "@@",
      " one",
      "-two",
      "+three",
      `*** Delete File: delete-${stem}.txt`,
      "*** End Patch",
    ].join("\n")
    const turn = await session.turn([ModelProvider.tool("patch", { patchText }), ModelProvider.text("done")])
    const call = await turn.script.called(2, 60_000)
    expect(call.tools).not.toContain("edit")
    expect(call.toolResults).toContain("Success")
    expect(await read(session.sessionId, `add-${stem}.txt`)).toBe("added\n")
    expect(await read(session.sessionId, `update-${stem}.txt`)).toBe("one\nthree\n")
    expect(
      (await current().environment.instance.observe(["test", "-e", `${session.sessionId}/delete-${stem}.txt`]))
        .exitCode,
    ).not.toBe(0)
  })

  test("a chat-only turn, a question answered through the client, and brain and external tools run without executor traffic", async () => {
    const session = await attached({ interactive: true })
    const inputs: Readonly<Record<string, unknown>> = {
      skill: { id: "missing-skill" },
      webfetch: { url: `${current().stack.providerProxy.url}/not-found`, format: "text" },
      list_mcp_resources: {},
      read_mcp_resource: { server: "missing", uri: "missing://resource" },
    }
    const from = current().environment.proxy.seen.length
    const probe = await session.turn([ModelProvider.text("which tools")])
    const offered = (await probe.script.called(1)).tools.filter((tool) => inputs[tool] !== undefined)
    await session.settled()
    expect(offered.length).toBeGreaterThan(0)
    const asked = await session.turn([
      ModelProvider.tool("question", {
        questions: [{ question: "Which colour?", header: "Colour", options: [{ label: "Teal", description: "teal" }] }],
      }),
      ModelProvider.text("thanks"),
    ])
    const form = await SessionDriver.firstForm(session.opencode, session.id)
    await session.opencode.session.form.reply({
      sessionID: session.id,
      formID: form.id,
      answer: { [form.fields[0].key]: "Teal" },
    })
    expect((await asked.script.called(2, 60_000)).toolResults).toContain("Teal")
    await session.settled()
    const turn = await session.turn([
      ...offered.map((tool) => ModelProvider.tool(tool, inputs[tool])),
      ModelProvider.text("done"),
    ])
    await turn.script.called(offered.length + 1, 60_000)
    await session.settled()
    expect(operationsSince(from)).toEqual([])
  })

  test.skipIf(Platform.docker !== undefined)(
    "a paused container ends a running shell call in its time limit, and stops the command once it runs again",
    async () => {
      const stack = current().stack
      const environment = await stack.dockerEnvironment("paused")
      const session = await stack.session({ environment })
      const marker = `paused-${crypto.randomUUID().slice(0, 8)}`
      const turn = await session.turn([
        ModelProvider.tool("shell", { command: `echo started; sleep 300; echo ${marker}` }),
        ModelProvider.text("ok"),
      ])
      await Wait.until("the command to start in the container", 60_000, async () =>
        (await environment.instance.observe(["pgrep", "-f", marker])).exitCode === 0 ? true : undefined,
      )
      await environment.instance.freeze()
      const started = Date.now()
      const result = (await turn.script.called(2, 120_000)).toolResults
      expect(Date.now() - started).toBeLessThan(75_000)
      expect(result).toContain("did not finish")
      await environment.instance.thaw()
      await Wait.until("the executor to stop the command", 90_000, async () =>
        (await environment.instance.observe(["pgrep", "-f", marker])).exitCode !== 0 ? true : undefined,
      )
      await session.settled()
    },
    300_000,
  )

  test.skipIf(Platform.docker !== undefined)(
    "grep on a container with no rg fails the tool call with a clear cause",
    async () => {
      const stack = current().stack
      const environment = await stack.dockerEnvironment("no-rg")
      await environment.container.asRoot(["rm", "-f", "/usr/bin/rg"])
      const session = await stack.session({ environment })
      const turn = await session.turn([ModelProvider.tool("grep", { pattern: "needle" }), ModelProvider.text("ok")])
      const result = (await turn.script.called(2, 120_000)).toolResults
      expect(result).toContain("ripgrep execution failed")
      await session.settled()
    },
    300_000,
  )

  test.skipIf(Platform.docker !== undefined)(
    "a script for zsh runs in the default shell of a Debian container that has no zsh",
    async () => {
      const environment = await current().stack.dockerEnvironment("no-zsh")
      expect((await environment.instance.observe(["sh", "-c", "command -v zsh || echo none"])).stdout.trim()).toBe(
        "none",
      )
      const sessionId = Session.ID.create()
      const access = await ExecutorAdapter.access({
        url: environment.proxy.url,
        environmentId: environment.instance.environmentId,
        brain: Brain.ofSession(sessionId),
        directory: `/workspace/${sessionId}`,
      })
      const stdout = await Effect.runPromise(
        Effect.gen(function* () {
          const connections = Context.get(
            yield* Layer.build(
              HandConnections.layer.pipe(
                Layer.provide(TestAccess.fixed(new Map([[sessionId, access]]))),
                Layer.provide(FetchHttpClient.layer),
              ),
            ),
            HandConnections.Service,
          )
          const session = HandSession.make(connections, sessionId, (signal) => signal)
          const handle = yield* session.spawner.spawn(ChildProcess.make("/bin/zsh", ["-c", "echo $((6 * 7))"]))
          return yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
        }).pipe(Effect.scoped),
      )
      expect(stdout).toBe("42\n")
    },
    300_000,
  )
})
