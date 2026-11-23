import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Bundle } from "@ren/schema/bundle"
import { BundleBuild } from "../machine/bundle.js"

const out = await mkdtemp(join(tmpdir(), "ren-bundle-test-"))
const state = { listed: new Array<string>() }

beforeAll(async () => {
  const manifest = await BundleBuild.build(BundleBuild.root, out)
  const dependencies = manifest.bundles.find((bundle) => bundle.kind === "dependencies")
  if (!dependencies) throw new Error("no dependencies bundle")
  state.listed = (await Bun.$`tar -tzf ${join(out, Bundle.keyOf(dependencies))}`.text()).split("\n")
}, 300_000)

afterAll(() => rm(out, { recursive: true, force: true }))

test("the dependencies bundle contains the dependency patch referenced by the root manifest", () => {
  expect(state.listed).toContain("./patches/@modelcontextprotocol%2Fclient@2.3.1.patch")
})

test("the dependencies bundle has no bin links, because bun links a different set of them on each install", () => {
  expect(state.listed.filter((path) => path.includes("/.bin/"))).toEqual([])
})

test("the dependencies bundle has the glibc claude program and not the musl one, because the machines run glibc", () => {
  expect([
    state.listed.some((path) => path.endsWith("/@anthropic-ai/claude-agent-sdk-linux-x64/claude")),
    state.listed.some((path) => path.includes("claude-agent-sdk-linux-x64-musl")),
  ]).toEqual([true, false])
})
