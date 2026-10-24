export * as Platform from "./platform.js"

import { Schema } from "effect"

export const mode = Schema.decodeUnknownSync(Schema.Literals(["local", "live", "deployed"]))(
  process.env.CHAOS_MODE ?? "local",
)

const probe = (command: ReadonlyArray<string>) =>
  Bun.spawnSync([...command], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const unless = (requirement: { readonly met: boolean; readonly reason: string }) =>
  requirement.met ? undefined : requirement.reason

export const wrangler = unless({
  met: probe(["node", "--version"]),
  reason: "Node.js is required to run local Wrangler",
})

export const docker = unless({ met: probe(["docker", "info"]), reason: "the Docker daemon is not reachable" })

export const github = unless({
  met: probe(["git", "ls-remote", "--exit-code", "https://github.com/anthropics/skills", "HEAD"]),
  reason: "GitHub is not reachable for the real remote skill",
})

export const live = unless({
  met: mode !== "local" && Boolean(process.env.CHAOS_LIVE_MODEL),
  reason: "live model cases run under chaos:live or chaos:deployed with CHAOS_LIVE_MODEL set",
})

export const litellm = unless({
  met: Boolean(process.env.CHAOS_LITELLM_ADMIN_URL && process.env.CHAOS_LITELLM_ADMIN_KEY),
  reason: "LiteLLM key cases need CHAOS_LITELLM_ADMIN_URL and CHAOS_LITELLM_ADMIN_KEY",
})

export const e2b = unless({
  met: mode === "deployed" && Boolean(process.env.E2B_API_KEY && process.env.CHAOS_E2B_TEMPLATE),
  reason: "E2B cases run under chaos:deployed with E2B_API_KEY and CHAOS_E2B_TEMPLATE",
})

export const cloudflare = unless({
  met: mode === "deployed" && Boolean(process.env.CHAOS_CLOUDFLARE_URL),
  reason: "Cloudflare cases run under chaos:deployed with CHAOS_CLOUDFLARE_URL",
})

export const slow = unless({
  met: Boolean(process.env.CHAOS_SLOW),
  reason: "slow cases wait out OpenCode's retry schedule; set CHAOS_SLOW=1",
})

export const soak = unless({
  met: Boolean(process.env.CHAOS_SOAK_MS),
  reason: "soak cases run with CHAOS_SOAK_MS set to a duration",
})

export const unmet = { wrangler, docker, github, live, litellm, e2b, cloudflare, slow, soak }
