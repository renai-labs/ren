import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Artifact } from "@ren/schema/artifact"
import { ManagedRuntime } from "effect"
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
  test("a chat publishes, reads, updates and deletes an artifact through Ren, and cannot pick OpenCode's local provider", async () => {
    const opened = await TestCell.make(celld)
    await opened.models()
    await opened.start()
    celld.ren.artifactDeploying(true)
    const created = stub.script({
      tool: run(
        'return await tools.opencode.artifact_create({ title: "Report", files: { "index.html": "<h1>v1</h1>" } })',
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
    const accepted = await created.called(2)
    expect(JSON.stringify(accepted.body)).toContain("Deployment accepted")
    expect(JSON.stringify(accepted.body)).toContain(first.info.activeDeploymentId ?? "missing deployment")
    celld.ren.artifactDeploying(false)
    const notification = await stub.waitFor(
      (call) => call.text.includes("Artifact deployment result:") && call.text.includes(id),
    )
    expect(notification.text).toContain('"status":"ready"')
    expect(notification.text).toContain(first.info.activeDeploymentId ?? "missing deployment")
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })

    const updated = stub.script({
      tools: [
        run(`return await tools.opencode.artifact_read({ id: "${id}" })`),
        run(`return await tools.artifact_status({ id: "${id}", deploymentId: "${first.info.activeDeploymentId}" })`),
        run(
          `return await tools.opencode.artifact_update({ id: "${id}", files: { "index.html": "<h1>v2</h1>", "app.js": "1" } })`,
        ),
        run(
          'return await tools.opencode.artifact_create({ title: "Elsewhere", files: { "index.html": "x" }, provider: "local" })',
        ),
      ],
    })
    await opened.prompt(updated.marker)
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })
    const second = celld.ren.artifacts.get(id)
    expect(Object.keys(second?.files ?? {}).toSorted()).toEqual(["app.js", "index.html"])
    expect(second?.info.url).toBe(first.info.url)
    expect(celld.ren.artifacts.size).toBe(1)
    const outputs = JSON.stringify(await opened.messages())
    expect(outputs).toContain("<h1>v1</h1>")
    expect(outputs).toContain("Publish artifacts with Ren")
    expect(outputs).toContain("Deployment accepted")
    expect(outputs).toContain("deploymentId")
    expect(outputs).toContain("does not mean the app is live")
    expect(outputs).toContain(first.info.activeDeploymentId ?? "missing deployment")

    const deleted = stub.script({ tool: run(`return await tools.opencode.artifact_delete({ id: "${id}" })`) })
    await opened.prompt(deleted.marker)
    await opened.opencode.experimental.session.wait({ sessionID: opened.id })
    expect(celld.ren.artifacts.get(id)?.deployed).toBe(false)
    expect(celld.ren.artifacts.get(id)?.files).toEqual(second?.files)
  })

  test("an accepted deployment reports its background failure in the chat", async () => {
    const opened = await TestCell.make(celld)
    await opened.models()
    await opened.start()
    celld.ren.artifactError("Worker failed to start")
    try {
      const created = stub.script({
        tool: run(
          'return await tools.opencode.artifact_create({ title: "Broken", files: { "index.html": "broken" } })',
        ),
      })
      await opened.prompt(created.marker)
      const notification = await stub.waitFor(
        (call) => call.text.includes("Artifact deployment result:") && call.text.includes("Worker failed to start"),
      )
      expect(notification.text).toContain('"status":"failed"')
      await opened.opencode.experimental.session.wait({ sessionID: opened.id })
      expect(JSON.stringify(await opened.messages())).toContain("Deployment accepted")
    } finally {
      celld.ren.artifactError(null)
    }
  })
})
