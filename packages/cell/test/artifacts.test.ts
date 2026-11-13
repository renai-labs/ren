import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Artifact } from "@ren/schema/artifact"
import { ManagedRuntime, Schema } from "effect"
import { Shared } from "./lib/shared.js"
import { TestCell } from "./lib/test-cell.js"

setDefaultTimeout(60_000)

const runtime = ManagedRuntime.make(Shared.layer)
let celld: Shared.Runtime
beforeAll(async () => {
  celld = await runtime.runPromise(Shared.Service)
}, 120_000)
afterAll(() => runtime.dispose())
const stub = Shared.stub()

const run = (code: string) => ({ name: "execute", input: { code } })

describe("artifacts", () => {
  test("a chat publishes, reads, updates and deletes an artifact through Ren with OpenCode's artifact tools", async () => {
    const opened = await TestCell.make(celld)
    await opened.models()
    await opened.start()
    const created = stub.script({
      tool: run(
        'return await tools.opencode.artifact_create({ title: "Report", files: { "index.html": "<h1>v1</h1>", "ren-artifact.json": JSON.stringify({ durableObjects: { STATE: "SampleState" } }), "_worker.js": "export class SampleState {}; export default { fetch: () => new Response() }" } })',
      ),
    })
    await opened.prompt(created.marker)
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })
    const published = [...celld.ren.artifacts.keys()]
    expect(published).toHaveLength(1)
    const id = published.at(0) ?? Artifact.ID.make("art_missing")
    const first = celld.ren.artifacts.get(id)
    if (!first) throw new Error("Artifact was not stored")
    expect(new TextDecoder().decode(first.files["index.html"])).toBe("<h1>v1</h1>")
    expect(first.config.durableObjects).toEqual({ STATE: "SampleState" })
    const accepted = await created.called(2)
    expect(JSON.stringify(accepted.body)).toContain("Deployment accepted")
    const deploymentId = first.info.publishedDeploymentId ?? "missing deployment"
    expect(JSON.stringify(accepted.body)).toContain(deploymentId)
    expect<string | undefined>(first.sessionId).toBe(opened.id)

    const updated = stub.script({
      tools: [
        run(`return await tools.opencode.artifact_read({ id: "${id}" })`),
        run(`return await tools.opencode.artifact_status({ id: "${id}", deploymentId: "${deploymentId}" })`),
        run(
          `return await tools.opencode.artifact_update({ id: "${id}", baseDeploymentId: "${deploymentId}", files: { "index.html": "<h1>v2</h1>", "app.js": "1", "ren-artifact.json": JSON.stringify({ durableObjects: { STATE: "SampleState" } }), "_worker.js": "export class SampleState {}; export default { fetch: () => new Response() }" } })`,
        ),
      ],
    })
    await opened.prompt(updated.marker)
    const read = Schema.decodeUnknownSync(Schema.String)(
      (await updated.called(2)).body.messages.findLast((message) => message.role === "tool")?.content,
    )
    expect(JSON.parse(read)).toMatchObject({
      info: { id, title: "Report", entry: "index.html", url: first.info.url, publishedDeploymentId: deploymentId },
    })
    expect(read).not.toContain("<h1>v1</h1>")
    const status = Schema.decodeUnknownSync(Schema.String)(
      (await updated.called(3)).body.messages.findLast((message) => message.role === "tool")?.content,
    )
    expect(JSON.parse(status)).toMatchObject({
      artifactId: id,
      deploymentId,
      status: "ready",
    })
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })
    const second = celld.ren.artifacts.get(id)
    if (!second) throw new Error("Updated artifact was not stored")
    expect(Object.keys(second.files).toSorted()).toEqual(["_worker.js", "app.js", "index.html", "ren-artifact.json"])
    expect(second.config.durableObjects).toEqual(first.config.durableObjects)
    expect(second.info.url).toBe(first.info.url)
    expect(celld.ren.artifacts.size).toBe(1)
    expect<string | undefined>(second.baseDeploymentId).toBe(deploymentId)
    const outputs = JSON.stringify(await opened.messages())
    expect(outputs).toContain("Deployment accepted")
    expect(outputs).toContain("deploymentId")
    expect(outputs).toContain("does not mean the app is live")
    expect(outputs).toContain(deploymentId)

    const deleted = stub.script({ tool: run(`return await tools.opencode.artifact_delete({ id: "${id}" })`) })
    await opened.prompt(deleted.marker)
    const stopped = Schema.decodeUnknownSync(Schema.String)(
      (await deleted.called(2)).body.messages.findLast((message) => message.role === "tool")?.content,
    )
    expect(JSON.parse(stopped)).toEqual({ id, status: "stopping" })
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })
    expect(celld.ren.artifacts.get(id)?.deployed).toBe(false)
    expect(celld.ren.artifacts.get(id)?.files).toEqual(second.files)
  })

  test("a deploy whose answer is lost is sent again as the same deployment", async () => {
    const opened = await TestCell.make(celld)
    await opened.models()
    await opened.start()
    celld.ren.loseDeployAnswer()
    const created = stub.script({
      tool: run('return await tools.opencode.artifact_create({ title: "Retried", files: { "index.html": "again" } })'),
    })
    await opened.prompt(created.marker)
    await created.called(2)
    const published = [...celld.ren.artifacts.values()].find((artifact) => artifact.info.title === "Retried")
    const deployments = [...(published?.deployments.keys() ?? [])]
    expect(deployments).toHaveLength(1)
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })
  })

  test("artifact_update refuses an update that does not name the deployment it starts from", async () => {
    const opened = await TestCell.make(celld)
    await opened.models()
    await opened.start()
    const created = stub.script({
      tool: run('return await tools.opencode.artifact_create({ title: "Based", files: { "index.html": "v1" } })'),
    })
    await opened.prompt(created.marker)
    await created.called(2)
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })
    const id = [...celld.ren.artifacts.entries()].find((entry) => entry[1].info.title === "Based")?.[0] ?? "art_missing"
    const before = celld.ren.artifacts.get(Artifact.ID.make(id))?.deployments.size
    const updated = stub.script({
      tool: run(`return await tools.opencode.artifact_update({ id: "${id}", files: { "index.html": "v2" } })`),
    })
    await opened.prompt(updated.marker)
    const answer = JSON.stringify(
      (await updated.called(2)).body.messages.findLast((message) => message.role === "tool"),
    )
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })
    expect(answer).toContain("baseDeploymentId")
    expect(celld.ren.artifacts.get(Artifact.ID.make(id))?.deployments.size).toBe(before)
  })
})
