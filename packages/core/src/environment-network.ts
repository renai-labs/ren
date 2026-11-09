export * as EnvironmentNetwork from "./environment-network.js"

import { Credential } from "@ren/schema/credential"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Workload } from "@ren/schema/workload"
import { Config, Context, Effect, Layer, Option } from "effect"
import { AppProfiles } from "./app/profiles.js"
import { AppResolve } from "./app/resolve.js"
import { CredentialSource } from "./credential-source.js"
import { Credentials } from "./credentials.js"
import { Models } from "./models.js"

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
  // oxlint-disable-next-line ren/no-comments -- None for unrestricted networking; for limited, every host the machine of the workload may reach, Ren's own included (networking rule 1).
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

// oxlint-disable-next-line ren/no-comments -- Every machine reaches Ren's server: start.sh fetches Ren's code there (EN26), and a brain pulls from it (EN40).
const renServer = Config.option(Config.String("REN_URL")).pipe(
  Effect.map((url) => Option.toArray(Option.flatMap(url, hostOf))),
  Effect.orDie,
)

// oxlint-disable-next-line ren/no-comments -- Knows no credentials, no MCP servers and no inference: for a deployment or a test without them.
export const layerNone = Layer.effect(
  Service,
  Effect.gen(function* () {
    const server = yield* renServer
    return Service.of({
      hostsOf: (_workload, networking) =>
        Effect.succeed(
          networking.type === "limited"
            ? Option.some([...new Set([...ofTemplate(networking), ...server])])
            : Option.none(),
        ),
    })
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
    const server = yield* renServer
    // oxlint-disable-next-line ren/no-comments -- EN40: a brain also reaches the inference address it is given, which can differ from Ren's own.
    const inference = Option.toArray(
      Option.flatMap(yield* (yield* Models.Service).inference, (found) => hostOf(found.baseUrl)),
    )
    const ofSpace = Effect.fnUntraced(function* (
      scope: Credentials.Scope,
      networking: Extract<EnvironmentTemplate.Networking, { readonly type: "limited" }>,
    ) {
      const reached = yield* profiles.reachable(scope)
      const candidates = yield* sources.candidates(
        scope,
        reached.map((profile) => profile.id),
      )
      const mcps = networking.allowMcpServers
        ? yield* resolve.forScope(scope).pipe(
            Effect.map((found) =>
              found.catalog.mcps.flatMap((entry) => {
                const url = entry.declaration.transport.type === "remote" ? entry.declaration.transport.url : entry.url
                return url ? Option.toArray(hostOf(url)) : []
              }),
            ),
            Effect.catchTag("Primitive.NotFound", () => Effect.succeed([])),
          )
        : []
      // oxlint-disable-next-line ren/no-comments -- A credential for any host would undo the limit, so only named hosts count.
      const credentialHosts = candidates
        .flatMap((candidate) => candidate.hosts)
        .filter((host) => host !== Credential.anyHost)
      return [...mcps, ...credentialHosts]
    })
    return Service.of({
      hostsOf: Effect.fn("EnvironmentNetwork.hostsOf")(function* (
        workload: Workload.Info,
        networking: EnvironmentTemplate.Networking,
      ) {
        if (networking.type === "unrestricted") return Option.none()
        const scope = yield* credentials.scopeOf(workload)
        return Option.some([
          ...new Set([
            ...ofTemplate(networking),
            ...server,
            ...(workload.kind === "brain" ? inference : []),
            ...(Option.isSome(scope) ? yield* ofSpace(scope.value, networking) : []),
          ]),
        ])
      }),
    })
  }),
)
