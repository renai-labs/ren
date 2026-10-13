export * as RenderSchemas from "./render-schemas.js"

import { Schema, SchemaRepresentation } from "effect"
import { CodegenAst } from "./codegen-ast.js"
import { SchemaShape } from "./schema-shape.js"

export type Slot = {
  readonly name: string
  readonly schema: Schema.Top
}

export function renderSchemas(slots: ReadonlyArray<Slot>) {
  if (slots.length === 0) return ""
  const classes = new Map(
    slots.flatMap((slot, index) => {
      const tagged = SchemaShape.taggedErrorFields(slot.schema)
      return tagged === undefined ? [] : [[index, tagged] as const]
    }),
  )
  const expanded = [
    ...slots.map((slot, index) => (classes.has(index) ? { name: slot.name, schema: Schema.Never } : slot)),
    ...[...classes.values()].flatMap((tagged, classIndex) =>
      tagged.fields.map(([name, schema]) => ({ name: `Class${classIndex}${name}`, schema })),
    ),
  ]
  const document = SchemaRepresentation.toCodeDocument(
    CodegenAst.codegenRepresentations(expanded.map((slot) => slot.schema.ast)),
  )
  const artifacts = document.artifacts.flatMap((artifact) => {
    if (artifact._tag === "Import") return [artifact.importDeclaration]
    if (artifact._tag === "Enum") return [artifact.code.runtime]
    return [`const ${artifact.identifier} = ${artifact.code.runtime}`]
  })
  const references = [
    ...document.references.nonRecursives.map(({ $ref, code }) => `const ${$ref} = ${code.runtime}`),
    ...Object.entries(document.references.recursives).map(
      ([$ref, code]) => `type ${$ref} = ${code.Type}\nconst ${$ref}: Schema.Codec<${$ref}> = ${code.runtime}`,
    ),
  ]
  const runtime = (index: number) => {
    const code = document.codes[index]
    if (code === undefined) throw new Error(`Codegen produced no runtime for slot ${index}`)
    return code.runtime
  }
  let fieldIndex = slots.length
  const declarations = slots.map((slot, index) => {
    const tagged = classes.get(index)
    if (tagged === undefined) return `const ${slot.name} = ${runtime(index)}`
    const fields = tagged.fields.map(([name]) => `${JSON.stringify(name)}: ${runtime(fieldIndex++)}`).join(", ")
    const annotations = Object.entries({
      httpApiStatus: SchemaShape.resolveHttpApiStatus(slot.schema.ast),
      "~httpApiEncoding": SchemaShape.resolveHttpApiEncoding(slot.schema.ast),
    }).filter((entry) => entry[1] !== undefined)
    const annotate =
      annotations.length === 0
        ? ""
        : `.annotate({ ${annotations.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ")} })`
    return `class ${slot.name}Class extends Schema.TaggedError<${slot.name}Class>(${JSON.stringify(tagged.identifier)})(${JSON.stringify(tagged.tag)}, { ${fields} }) {}\nconst ${slot.name} = ${slot.name}Class${annotate}`
  })
  return [...artifacts, ...references, ...declarations].join("\n\n")
}
