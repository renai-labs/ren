import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Bundle } from "@ren/schema/bundle"
import { BundleBuild } from "../e2b/bundle.js"
import { Stage } from "../e2b/stage.js"

const out = await mkdtemp(join(tmpdir(), "ren-bundle-test-"))
afterAll(() => rm(out, { recursive: true, force: true }))

test("the dependencies bundle contains the dependency patch referenced by the root manifest", async () => {
  const manifest = await BundleBuild.build(Stage.root, out)
  const dependencies = manifest.bundles.find((bundle) => bundle.kind === "dependencies")
  if (!dependencies) throw new Error("no dependencies bundle")
  const listed = await Bun.$`tar -tzf ${join(out, Bundle.fileOf(dependencies))}`.text()
  expect(listed.split("\n")).toContain("./patches/@modelcontextprotocol%2Fclient@2.3.1.patch")
}, 300_000)
