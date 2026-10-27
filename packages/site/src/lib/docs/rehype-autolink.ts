type HastNode = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const HEADINGS = new Set(["h2", "h3", "h4"])

function visit(node: HastNode) {
  for (const child of node.children ?? []) {
    const id = child.properties?.id
    if (
      child.type === "element" &&
      HEADINGS.has(child.tagName ?? "") &&
      typeof id === "string" &&
      child.children?.length
    ) {
      child.children = [
        {
          type: "element",
          tagName: "a",
          properties: { href: `#${id}`, className: ["fd-anchor"] },
          children: child.children,
        },
      ]
      continue
    }
    visit(child)
  }
}

export function rehypeAutolinkHeadings() {
  return (tree: HastNode) => visit(tree)
}
