import { expect, test } from "bun:test"
import { ArtifactCloudflareCode } from "../src/artifact-provider/cloudflare-code.js"

test("source recovery keeps newly provisioned classes without replacing the old implementations", () => {
  const modules = ArtifactCloudflareCode.modules({
    objects: { NOTES: "Notes", ROOM: "Room", NOTES_ALIAS: "Notes" },
    active: { source: "export class Notes {}", classes: ["Notes"] },
    mode: "serving",
    deploymentId: "deployment",
    proof: "proof",
  })
  expect(modules["main.js"]).toContain('export { Notes } from "./active.js"')
  expect(modules["main.js"]).toContain('export { Room } from "./retained-0.js"')
  expect(modules["active.js"]).toBe("export class Notes {}")
  expect(modules["retained-0.js"]).not.toContain("rejected module")
  expect(modules["retained-0.js"]).toContain("InactiveObject extends DurableObject")
  expect(modules["retained-0.js"]).toContain("InactiveObject as Room")
  expect(modules["main.js"]).toContain('import application from "./active.js"')
  expect(modules["main.js"]?.match(/export \{ Notes \}/gu)).toHaveLength(1)
})

test("artifact names are DNS-safe and preserve case-sensitive artifact identity", () => {
  expect(ArtifactCloudflareCode.name("art_a")).not.toBe(ArtifactCloudflareCode.name("art_A"))
  expect(ArtifactCloudflareCode.name("art_A")).toMatch(/^[a-z][a-z0-9-]{1,62}$/u)
  expect(ArtifactCloudflareCode.name("art_A")).toBe(ArtifactCloudflareCode.name("art_A"))
})

test("stopped publications preserve namespaces without evaluating the application module", () => {
  const modules = ArtifactCloudflareCode.modules({
    mode: "stopped",
    deploymentId: "stop",
    proof: "proof",
    objects: { STATE: "SampleState" },
    active: { source: 'throw new Error("must not execute")', classes: ["SampleState"] },
  })
  expect(modules["active.js"]).toBeUndefined()
  expect(modules["main.js"]).toContain('new Response("Artifact stopped", { status: 410 })')
  expect(modules["retained-0.js"]).toContain("InactiveObject as SampleState")
})
