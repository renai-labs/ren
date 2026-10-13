export * as ClientTree from "./client-tree.js"

import type { Types } from "./types.js"

type Node = {
  endpoint?: { readonly value: Types.Endpoint; readonly index: number }
  readonly children: Map<string, Node>
}

export function renderClientTree(
  endpoints: ReadonlyArray<Types.Endpoint>,
  leaf: (endpoint: Types.Endpoint, index: number) => string,
  field: (name: string, value: string) => string,
  separator: string,
) {
  const root: Node = { children: new Map() }
  for (const [index, endpoint] of endpoints.entries()) {
    const node = endpoint.clientPath.reduce((parent, name) => {
      const child: Node = parent.children.get(name) ?? { children: new Map() }
      parent.children.set(name, child)
      return child
    }, root)
    node.endpoint = { value: endpoint, index }
  }
  const render = (node: Node): string =>
    Array.from(node.children, ([name, child]) =>
      field(
        name,
        child.endpoint === undefined ? `{ ${render(child)} }` : leaf(child.endpoint.value, child.endpoint.index),
      ),
    ).join(separator)
  return render(root)
}
