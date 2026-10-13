export * as Compile from "./compile.js"

import type { SchemaAST } from "effect"
import { HttpApi, type HttpApiGroup } from "effect/http-api"
import { BuildEndpoint } from "./build-endpoint.js"
import { BuildGroups } from "./build-groups.js"
import type { Types } from "./types.js"

export function compile<Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
  options?: {
    readonly groupNames?: Readonly<Record<string, string>>
    readonly omitEndpoints?: ReadonlySet<string>
  },
): Types.Contract {
  const endpoints: Array<Types.Endpoint> = []
  const portable = new Map<SchemaAST.AST, boolean>()
  HttpApi.reflect(api, {
    onGroup() {},
    onEndpoint(source) {
      if (options?.omitEndpoints?.has(source.endpoint.identifier)) return
      const groupName = options?.groupNames?.[source.group.identifier] ?? source.group.identifier
      endpoints.push(BuildEndpoint.buildEndpoint(source, groupName, portable))
    },
  })
  const groups = BuildGroups.buildGroups(endpoints)
  BuildGroups.assertClientNames(groups)
  return { groups }
}
