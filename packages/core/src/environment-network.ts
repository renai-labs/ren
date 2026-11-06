export * as EnvironmentNetwork from "./environment-network.js"

import { Credential } from "@ren/schema/credential"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Workload } from "@ren/schema/workload"
import { Context, Effect, Layer, Option } from "effect"
import { AppProfiles } from "./app/profiles.js"
import { AppResolve } from "./app/resolve.js"
import { CredentialSource } from "./credential-source.js"
import { Credentials } from "./credentials.js"

// oxlint-disable-next-line ren/no-comments -- Networking rule 1: npm, PyPI and its file host, the Debian and Ubuntu mirrors, and the Go module proxy with its checksum database.
export const packageManagerHosts = [
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  "deb.debian.org",
  "security.debian.org",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  "proxy.golang.org",
  "sum.golang.org",
]

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- None for unrestricted networking; for limited, every host the machine of the workload may reach (networking rule 1).
  readonly hostsOf: (
    workload: Workload.Info,
    networking: EnvironmentTemplate.Networking,
  ) => Effect.Effect<Option.Option<ReadonlyArray<string>>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/EnvironmentNetwork") {}

const hostOf = (url: string) => Option.fromNullishOr(URL.parse(url)?.hostname)

const ofTemplate = (networking: Extract<EnvironmentTemplate.Networking, { readonly type: "limited" }>) => [
  ...networking.allowedHosts,
  ...(networking.allowPackageManagers ? packageManagerHosts : []),
]

// oxlint-disable-next-line ren/no-comments -- Knows no credentials and no MCP servers: for a deployment or a test without them.
export const layerNone = Layer.succeed(
  Service,
  Service.of({
    hostsOf: (_workload, networking) =>
      Effect.succeed(networking.type === "limited" ? Option.some([...new Set(ofTemplate(networking))]) : Option.none()),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const credentials = yield* Credentials.Service
    // oxlint-disable-next-line ren/no-comments -- Stored credentials and the ones Ren mints for the workload, such as its space's drive, as the egress resolves them.
    const sources = yield* CredentialSource.Service
    const profiles = yield* AppProfiles.Service
    const resolve = yield* AppResolve.Service
    return Service.of({
      hostsOf: Effect.fn("EnvironmentNetwork.hostsOf")(function* (
        workload: Workload.Info,
        networking: EnvironmentTemplate.Networking,
      ) {
        if (networking.type === "unrestricted") return Option.none()
        const scope = yield* credentials.scopeOf(workload)
        if (Option.isNone(scope)) return Option.some([...new Set(ofTemplate(networking))])
        const reached = yield* profiles.reachable(scope.value)
        const candidates = yield* sources.candidates(
          scope.value,
          reached.map((profile) => profile.id),
        )
        const mcps = networking.allowMcpServers
          ? yield* resolve.forScope(scope.value).pipe(
              Effect.map((catalog) =>
                catalog.catalog.mcps.flatMap((entry) =>
                  Option.toArray(
                    Option.flatMap(
                      Option.fromUndefinedOr(
                        entry.declaration.transport.type === "remote" ? entry.declaration.transport.url : entry.url,
                      ),
                      hostOf,
                    ),
                  ),
                ),
              ),
              Effect.catchTag("Primitive.NotFound", () => Effect.succeed([])),
            )
          : []
        // oxlint-disable-next-line ren/no-comments -- A credential for any host would undo the limit, so only named hosts count.
        const credentialHosts = candidates
          .flatMap((candidate) => candidate.hosts)
          .filter((host) => host !== Credential.anyHost)
        return Option.some([...new Set([...ofTemplate(networking), ...mcps, ...credentialHosts])])
      }),
    })
  }),
)
