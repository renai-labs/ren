export * as SandboxProvider from "./sandbox-provider.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import type { Environment } from "@ren/schema/environment"
import type { Space } from "@ren/schema/space"
import { Context, type DateTime, type Duration, type Effect, Option, Redacted, Schema, type Stream } from "effect"

export class Gone extends Schema.TaggedError<Gone>()("SandboxProvider.Gone", { message: Schema.String }) {}

export class Failed extends Schema.TaggedError<Failed>()("SandboxProvider.Failed", { message: Schema.String }) {}

export class Capacity extends Schema.TaggedError<Capacity>()("SandboxProvider.Capacity", {
  message: Schema.String,
  retryAfter: Schema.Duration,
}) {}

export type Status = "running" | "paused" | "gone"

export interface Created {
  readonly binding: Schema.Json
  readonly url: string
}

export interface Hand {
  readonly url: string
  readonly workspace: Environment.Directory
}

export interface Lost {
  readonly brainId: Brain.ID
  readonly generation: number
}

export interface Metered {
  readonly id: string
  readonly sandboxId: string
  readonly brainId: Brain.ID
  readonly generation: number
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly endedAt: DateTime.Utc
  readonly durationMs: number
  readonly vcpuMs: number
  readonly memoryMibMs: number
  readonly costMicroUsd: number
}

export interface Listed {
  readonly binding: Schema.Json
  readonly brainId: Brain.ID
  readonly generation: number
}

// oxlint-disable-next-line ren/no-comments -- Where the sandbox's outbound traffic goes, with the proxy login that names its workload, and the egress CA it must trust (README C2, C38, C44). The provider gives the login to its platform; the sandbox never sees it.
export interface Proxy {
  readonly address: string
  readonly username: string
  readonly password: Redacted.Redacted
  readonly ca: Option.Option<string>
}

export interface Interface {
  readonly kind: string
  // oxlint-disable-next-line ren/no-comments -- Whether this provider can send a sandbox's traffic through the egress with a proxy login (E2B BYOP, HTTPS_PROXY locally). Ren puts a brain behind the egress only when the provider can.
  readonly canEgress: boolean
  readonly canMount: boolean
  readonly template: string | null
  readonly create: (input: {
    readonly brainId: Brain.ID
    readonly generation: number
    readonly organizationId: Auth.OrganizationID
    readonly spaceId: Space.ID
    readonly env: Readonly<Record<string, string>>
    readonly proxy: Option.Option<Proxy>
  }) => Effect.Effect<Created, Failed | Capacity>
  readonly connect: (
    binding: Schema.Json,
    proxy: Option.Option<Proxy>,
  ) => Effect.Effect<{ readonly url: string }, Gone | Failed | Capacity>
  readonly keepAlive: (binding: Schema.Json, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly destroy: (binding: Schema.Json) => Effect.Effect<void, Failed>
  readonly status: (binding: Schema.Json) => Effect.Effect<Status, Failed>
  readonly hand: (binding: Schema.Json) => Effect.Effect<Hand, Failed>
  readonly lost: Stream.Stream<Lost>
  readonly list: Effect.Effect<ReadonlyArray<Listed>, Failed>
  readonly metered: (since: Option.Option<DateTime.Utc>) => Effect.Effect<ReadonlyArray<Metered>, Failed>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SandboxProvider") {}

export const caVariables = [
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "AWS_CA_BUNDLE",
] as const

// oxlint-disable-next-line ren/no-comments -- For a host where the workload itself names the proxy (local development, README §7): every client reads HTTPS_PROXY or HTTP_PROXY; traffic to the brain's own hand and server stays local (README §6.10 rule 4); every CA variable names the egress CA (C44).
export const proxyEnv = (proxy: Proxy, caPath: string): Readonly<Record<string, string>> => {
  const url = `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(Redacted.value(proxy.password))}@${proxy.address}`
  return {
    HTTPS_PROXY: url,
    HTTP_PROXY: url,
    https_proxy: url,
    http_proxy: url,
    NO_PROXY: "localhost,127.0.0.1,0.0.0.0,::1",
    no_proxy: "localhost,127.0.0.1,0.0.0.0,::1",
    ...(Option.isSome(proxy.ca) ? Object.fromEntries(caVariables.map((name) => [name, caPath])) : {}),
  }
}
