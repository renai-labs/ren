import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { gzipSync } from "zlib"

const budget = { javascript: 220 * 1024, css: 50 * 1024 }
const outDir = await mkdtemp(path.join(os.tmpdir(), "ren-app-bundle-"))

afterAll(() => rm(outDir, { recursive: true, force: true }))

test(
  "the initial page stays within its gzip budget",
  async () => {
    const build = Bun.spawn(["bunx", "vite", "build", "--outDir", outDir, "--emptyOutDir"], {
      cwd: path.resolve(import.meta.dir, ".."),
      env: { ...process.env, NODE_ENV: "production" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await build.exited
    if (exitCode !== 0) throw new Error(await new Response(build.stderr).text())
    const html = await Bun.file(path.join(outDir, "index.html")).text()
    expect(html).toContain('src="/app/assets/')
    const gzipSize = async (pattern: RegExp) => {
      const files = new Set(
        Array.from(html.matchAll(pattern), (match) => path.join(outDir, (match[1] ?? "").replace(/^\/app\//, ""))),
      )
      const sizes = await Promise.all(
        Array.from(files, async (file) => gzipSync(await Bun.file(file).arrayBuffer()).byteLength),
      )
      return sizes.reduce((total, size) => total + size, 0)
    }
    const initial = {
      javascript: await gzipSize(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g),
      css: await gzipSize(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g),
    }
    expect(initial.javascript).toBeGreaterThan(0)
    expect(initial.javascript).toBeLessThanOrEqual(budget.javascript)
    expect(initial.css).toBeLessThanOrEqual(budget.css)
  },
  { timeout: 60_000 },
)
