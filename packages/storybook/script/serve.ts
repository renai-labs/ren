import path from "path"
import { Schema } from "effect"
import { Port } from "@ren/util/port"
import { testPort } from "../support/stories.js"

const root = path.resolve(import.meta.dir, "../storybook-static")

const build = Bun.spawn([process.execPath, "turbo", "build", "--filter=@ren/storybook", "--output-logs=errors-only"], {
  cwd: path.resolve(import.meta.dir, "../../.."),
  stdout: "inherit",
  stderr: "inherit",
})
if ((await build.exited) !== 0) throw new Error("The Storybook build failed")

Bun.serve({
  port: Schema.decodeUnknownSync(Port.FromString)(process.argv[2] ?? String(testPort)),
  hostname: "127.0.0.1",
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    const file = Bun.file(path.join(root, pathname === "/" ? "index.html" : path.normalize(pathname)))
    if (await file.exists()) return new Response(file)
    return new Response("Not found", { status: 404 })
  },
})
