export * as Platform from "./platform.js"

import { Schema } from "effect"

export const mode = Schema.decodeUnknownSync(Schema.Literals(["local", "live", "deployed"]))(
  process.env.CHAOS_MODE ?? "local",
)

const probe = (command: ReadonlyArray<string>) =>
  Bun.spawnSync([...command], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const unless = (met: boolean, reason: string) => (met ? undefined : reason)

export const wrangler = unless(probe(["node", "--version"]), "Node.js is required to run local Wrangler")

export const docker = unless(probe(["docker", "info"]), "the Docker daemon is not reachable")

export const live = unless(
  mode !== "local" && Boolean(process.env.CHAOS_LIVE_MODEL),
  "live model cases run under chaos:live or chaos:deployed with CHAOS_LIVE_MODEL set",
)

export const litellm = unless(
  Boolean(process.env.CHAOS_LITELLM_ADMIN_URL && process.env.CHAOS_LITELLM_ADMIN_KEY),
  "LiteLLM key cases need CHAOS_LITELLM_ADMIN_URL and CHAOS_LITELLM_ADMIN_KEY",
)

export const e2b = unless(
  mode === "deployed" && Boolean(process.env.E2B_API_KEY && process.env.CHAOS_E2B_TEMPLATE),
  "E2B cases run under chaos:deployed with E2B_API_KEY and CHAOS_E2B_TEMPLATE",
)

export const cloudflare = unless(
  mode === "deployed" && Boolean(process.env.CHAOS_CLOUDFLARE_URL),
  "Cloudflare cases run under chaos:deployed with CHAOS_CLOUDFLARE_URL",
)

export const slow = unless(
  Boolean(process.env.CHAOS_SLOW),
  "slow cases wait out OpenCode's retry schedule; set CHAOS_SLOW=1",
)

export const soak = unless(Boolean(process.env.CHAOS_SOAK_MS), "soak cases run with CHAOS_SOAK_MS set to a duration")

export const unmet = { wrangler, docker, live, litellm, e2b, cloudflare, slow, soak }
