export * as Compile from "./compile.js"

import type { SchemaAST } from "effect"
import { HttpApi, type HttpApiGroup } from "effect/http-api"
import { BuildEndpoint } from "./build-endpoint.js"
import { BuildGroups } from "./build-groups.js"
import type { Types } from "./types.js"

export function compile<Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
): Types.Contract {
  const endpoints: Array<Types.Endpoint> = []
  const portable = new Map<SchemaAST.AST, boolean>()
  HttpApi.reflect(api, {
    onGroup() {},
    onEndpoint(source) {
      endpoints.push(BuildEndpoint.buildEndpoint(source, portable))
    },
  })
  const groups = BuildGroups.buildGroups(endpoints)
  BuildGroups.assertClientNames(groups)
  return { groups }
}
