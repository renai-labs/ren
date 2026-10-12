import { defineRule } from "@oxlint/plugins"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const COMPONENT = /^(.*)\/packages\/ui\/src\/components\/([a-z0-9-]+)\.tsx$/
const STORYBOOK = /^(.*)\/packages\/storybook\/ui\/([a-z0-9-]+)\.(stories\.tsx|spec\.ts)$/
const NAMESPACE = /^export \* as (\w+) from "\.\/[a-z0-9-]+\.js"/m
const PART = /^export (?:async )?(?:function|const) (\w+)/gm
const REEXPORT = /^export \{([^}]+)\} from /gm

const componentFile = (root: string, name: string) => path.join(root, "packages/ui/src/components", `${name}.tsx`)

const partsOf = (source: string) => [
  ...Array.from(source.matchAll(PART), (match) => match[1] ?? ""),
  ...Array.from(source.matchAll(REEXPORT), (match) => match[1] ?? "")
    .flatMap((list) => list.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && !entry.startsWith("type ")),
]

export const storyCoverage = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep every @ren/ui component paired with a story file that covers its parts." },
    messages: {
      missing: "Add packages/storybook/ui/{{name}}.stories.tsx. Every @ren/ui component has stories.",
      orphan: "No @ren/ui component is named `{{name}}`. Rename or delete this file with its component.",
      import: "Import the component this story file is named after from `@ren/ui/{{name}}`.",
      title: "Remove `title`. Storybook titles stories from their file path.",
      part: "No story uses `{{part}}`. Every exported part needs a story.",
    },
  },
  create(context) {
    const file = context.filename
    const component = COMPONENT.exec(file)
    if (component !== null) {
      const name = component[2] ?? ""
      if (existsSync(path.join(component[1] ?? "", "packages/storybook/ui", `${name}.stories.tsx`))) return {}
      return {
        Program(node) {
          context.report({ node, messageId: "missing", data: { name } })
        },
      }
    }
    const storybook = STORYBOOK.exec(file)
    if (storybook === null) return {}
    const root = storybook[1] ?? ""
    const name = storybook[2] ?? ""
    if (!existsSync(componentFile(root, name))) {
      return {
        Program(node) {
          context.report({ node, messageId: "orphan", data: { name } })
        },
      }
    }
    if (storybook[3] !== "stories.tsx") return {}
    const source = readFileSync(componentFile(root, name), "utf8")
    const namespace = NAMESPACE.exec(source)?.[1]
    const used = new Set<string>()
    const imports = new Set<string>()
    return {
      ImportDeclaration(node) {
        imports.add(String(node.source.value))
      },
      MemberExpression(node) {
        if (node.object.type === "Identifier" && node.object.name === namespace && node.property.type === "Identifier")
          used.add(node.property.name)
      },
      JSXMemberExpression(node) {
        if (node.object.type === "JSXIdentifier" && node.object.name === namespace) used.add(node.property.name)
      },
      Property(node) {
        if (node.key.type !== "Identifier" || node.key.name !== "title") return
        const parent = node.parent
        const owner = parent.type === "ObjectExpression" ? parent.parent : undefined
        const meta =
          owner?.type === "ExportDefaultDeclaration" ||
          (owner?.type === "TSSatisfiesExpression" &&
            owner.parent.type === "VariableDeclarator" &&
            owner.parent.id.type === "Identifier" &&
            owner.parent.id.name === "meta") ||
          (owner?.type === "VariableDeclarator" && owner.id.type === "Identifier" && owner.id.name === "meta")
        if (meta) context.report({ node, messageId: "title" })
      },
      "Program:exit"(node) {
        if (!imports.has(`@ren/ui/${name}`)) context.report({ node, messageId: "import", data: { name } })
        if (namespace === undefined) return
        partsOf(source)
          .filter((part) => !used.has(part))
          .forEach((part) => context.report({ node, messageId: "part", data: { part: `${namespace}.${part}` } }))
      },
    }
  },
})
