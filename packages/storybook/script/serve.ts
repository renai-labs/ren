import path from "path"
import { Schema } from "effect"
import { Port } from "@ren/util/port"
import { testPort } from "../support/stories.js"

const root = path.resolve(import.meta.dir, "../storybook-static")

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
