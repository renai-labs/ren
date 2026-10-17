import { afterAll } from "bun:test"
import { Platform } from "./platform.js"
import { Process } from "./process.js"

const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

const hostOf = (value: string | undefined) => (value ? [new URL(value.replace("{name}", "x")).hostname] : [])

const allowed = new Set([
  ...(Platform.mode === "live"
    ? [...hostOf(process.env.CHAOS_LIVE_BASE_URL), ...hostOf(process.env.CHAOS_LITELLM_ADMIN_URL)]
    : []),
  ...(Platform.mode === "deployed"
    ? [...hostOf(process.env.CHAOS_E2B_API ?? "https://api.e2b.dev"), ...hostOf(process.env.CHAOS_CLOUDFLARE_URL)]
    : []),
])

const deployedSuffixes =
  Platform.mode === "deployed" ? [`.${process.env.CHAOS_E2B_DOMAIN ?? "e2b.app"}`, ".workers.dev"] : []

const violations: Array<string> = []

const original = globalThis.fetch

globalThis.fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (
      loopback.has(url.hostname) ||
      allowed.has(url.hostname) ||
      deployedSuffixes.some((suffix) => url.hostname.endsWith(suffix))
    )
      return original(input, init)
    const message = `chaos test attempted a non-loopback request to ${url.host}`
    violations.push(message)
    return Promise.reject(new Error(message))
  },
  { preconnect: original.preconnect },
)

afterAll(() => {
  if (violations.length > 0) throw new Error(violations.join("\n"))
})

const interrupted = () => void Process.interrupt().finally(() => process.exit(130))

process.once("SIGINT", interrupted)
process.once("SIGTERM", interrupted)

for (const entry of Object.entries(Platform.unmet))
  if (entry[1] !== undefined) process.stderr.write(`chaos: ${entry[0]} cases skip: ${entry[1]}\n`)
