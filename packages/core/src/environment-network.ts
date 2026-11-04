export * as EnvironmentNetwork from "./environment-network.js"

import type { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import type { Environment } from "@ren/schema/environment"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Context, Effect, Layer, Option } from "effect"
import { AppResolve } from "./app/resolve.js"
import { AppProfiles } from "./app/profiles.js"
import { CredentialSource } from "./credential-source.js"
import { Credentials } from "./credentials.js"

// oxlint-disable-next-line ren/no-comments -- environments §3 Networking rule 3: npm, PyPI and its file host, the Debian and Ubuntu mirrors, and the Go module proxy with its checksum database.
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

export interface Subject {
  readonly organizationId: Auth.OrganizationID
  readonly environmentId: Environment.ID
  readonly networking: EnvironmentTemplate.Networking
}

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- None for unrestricted networking; for limited, every host the environment may reach.
  readonly hostsOf: (subject: Subject) => Effect.Effect<Option.Option<ReadonlyArray<string>>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/EnvironmentNetwork") {}

const hostOf = (url: string) => Option.liftThrowable(() => new URL(url).hostname)()

// oxlint-disable-next-line ren/no-comments -- A credential for any host would undo the limit, so only named hosts count.
const isNamed = (host: string) => host !== Credential.anyHost

const ofTemplate = (networking: Extract<EnvironmentTemplate.Networking, { readonly type: "limited" }>) => [
  ...networking.allowedHosts,
  ...(networking.allowPackageManagers ? packageManagerHosts : []),
]

// oxlint-disable-next-line ren/no-comments -- Knows no credentials and no MCP servers: for a deployment or a test without them.
export const layerNone = Layer.succeed(
  Service,
  Service.of({
    hostsOf: (subject) =>
      Effect.succeed(
        subject.networking.type === "limited"
          ? Option.some([...new Set(ofTemplate(subject.networking))])
          : Option.none(),
      ),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const credentials = yield* Credentials.Service
    const profiles = yield* AppProfiles.Service
    const sources = yield* CredentialSource.Service
    const resolve = yield* AppResolve.Service
    return Service.of({
      hostsOf: Effect.fn("EnvironmentNetwork.hostsOf")(function* (subject: Subject) {
        if (subject.networking.type === "unrestricted") return Option.none()
        const networking = subject.networking
        const scope = yield* credentials.scopeOf({ kind: "hand", id: subject.environmentId, generation: 1 })
        if (Option.isNone(scope)) return Option.some([...new Set(ofTemplate(networking))])
        const reached = yield* profiles.reachable(scope.value)
        const candidates = yield* sources.candidates(
          scope.value,
          reached.map((profile) => profile.id),
        )
        const mcps = networking.allowMcpServers
          ? yield* resolve.forScope(scope.value).pipe(
              Effect.map((info) =>
                info.catalog.mcps.flatMap((entry) =>
                  [entry.declaration.transport.type === "remote" ? entry.declaration.transport.url : entry.url].flatMap(
                    (url) => (url ? Option.toArray(hostOf(url)) : []),
                  ),
                ),
              ),
              Effect.catchTag("Primitive.NotFound", () => Effect.succeed([])),
            )
          : []
        return Option.some([
          ...new Set([
            ...ofTemplate(networking),
            ...mcps,
            ...candidates.flatMap((candidate) => candidate.hosts).filter(isNamed),
          ]),
        ])
      }),
    })
  }),
)
