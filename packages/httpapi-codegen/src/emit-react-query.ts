export * as EmitReactQuery from "./emit-react-query.js"

import { ClientTree } from "./client-tree.js"
import { Names } from "./names.js"
import { Operations } from "./operations.js"
import type { Types } from "./types.js"

function renderEndpoint(group: Types.Group, endpoint: Types.Endpoint) {
  const inputMode = Operations.promiseInputMode(endpoint)
  const input = `${Names.promiseTypePrefix(group.identifier, endpoint.clientPath)}Input`
  const key = [group.identifier, ...endpoint.clientPath].map((part) => JSON.stringify(part)).join(", ")
  const call = `client${group.endpoints[0]?.topLevel ? "" : `[${JSON.stringify(group.identifier)}]`}${endpoint.clientPath.map((part) => `[${JSON.stringify(part)}]`).join("")}`
  if (endpoint.endpoint.method !== "GET") {
    const argument = inputMode === "none" ? "" : `input${inputMode === "optional" ? "?" : ""}: ${input}`
    return `mutationKey: () => [${key}] as const, mutationOptions: () => mutationOptions({ mutationKey: [${key}] as const, mutationFn: (${argument}) => ${call}(${inputMode === "none" ? "" : "input"}) })`
  }
  if (inputMode === "none") {
    return `queryKey: () => [${key}] as const, queryOptions: () => queryOptions({ queryKey: [${key}] as const, queryFn: (context) => ${call}({ signal: context.signal }) })`
  }
  return `queryKey: (input?: ${input}) => input === undefined ? [${key}] as const : [${key}, input] as const, queryOptions: (input${inputMode === "optional" ? "?" : ""}: ${input}) => queryOptions({ queryKey: [${key}, input] as const, queryFn: (context) => ${call}(input, { signal: context.signal }) })`
}

export function emitReactQuery(contract: Types.Contract, options: { readonly client: string }): Types.Output {
  const groups = contract.groups.map((group) => ({
    ...group,
    endpoints: group.endpoints.filter((endpoint) => endpoint.operation.success !== "stream"),
  }))
  const inputs = groups.flatMap((group) =>
    group.endpoints.flatMap((endpoint) =>
      Operations.promiseInputMode(endpoint) === "none"
        ? []
        : [`${Names.promiseTypePrefix(group.identifier, endpoint.clientPath)}Input`],
    ),
  )
  const fields = groups.flatMap((group) => {
    if (group.endpoints.length === 0) return []
    const tree = ClientTree.renderClientTree(
      group.endpoints,
      (endpoint) => `{ ${renderEndpoint(group, endpoint)} }`,
      (name, value) => `${JSON.stringify(name)}: ${value}`,
      ", ",
    )
    if (group.endpoints[0]?.topLevel) return [tree]
    return [`${JSON.stringify(group.identifier)}: { ${tree} }`]
  })
  const imports = [
    ...(groups.some((group) => group.endpoints.some((endpoint) => endpoint.endpoint.method === "GET"))
      ? ["queryOptions"]
      : []),
    ...(groups.some((group) => group.endpoints.some((endpoint) => endpoint.endpoint.method !== "GET"))
      ? ["mutationOptions"]
      : []),
  ]
  return {
    operations: Operations.promiseOperations(groups),
    files: [
      {
        path: "query.ts",
        content: `${imports.length === 0 ? "" : `import { ${imports.join(", ")} } from "@tanstack/react-query"\n`}import type { ${["Ren", ...inputs].join(", ")} } from ${JSON.stringify(options.client)}\n\nexport function make(client: ReturnType<typeof Ren.make>) {\n  return { ${fields.join(", ")} }\n}\n`,
      },
      { path: "index.ts", content: 'export * as RenQuery from "./query.js"\n' },
    ],
  }
}
