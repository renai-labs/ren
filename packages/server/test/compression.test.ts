import { afterAll, expect, test } from "bun:test"
import { brotliDecompressSync } from "node:zlib"
import { makeApp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

test("compresses an API body for a browser that accepts it, and sends it plain to a client that does not", async () => {
  const plain = await app.handler(new Request("http://localhost/openapi.json"))
  const compressed = await app.handler(
    new Request("http://localhost/openapi.json", { headers: { "accept-encoding": "gzip, deflate, br, zstd" } }),
  )
  const text = await plain.text()
  const bytes = new Uint8Array(await compressed.arrayBuffer())
  expect({
    plain: plain.headers.get("content-encoding"),
    compressed: compressed.headers.get("content-encoding"),
    vary: compressed.headers.get("vary"),
  }).toEqual({ plain: null, compressed: "br", vary: "Origin, Accept-Encoding" })
  expect(brotliDecompressSync(bytes).toString()).toBe(text)
  expect(bytes.length).toBeLessThan(text.length / 4)
})
