export * as EmitCli from "./emit-cli.js"

import { Context, Schema, SchemaAST } from "effect"
import { OpenApi } from "effect/http-api"
import { Errors } from "./errors.js"
import { Names } from "./names.js"
import { Operations } from "./operations.js"
import { SchemaShape } from "./schema-shape.js"
import type { Types } from "./types.js"

export type Path = readonly [string, ...Array<string>]

export type Lookup = {
  readonly operation: string
  readonly input: string
  readonly output: string
}

export type Command = {
  readonly operation: string
  readonly path: Path
  readonly description?: string
  readonly arguments?: ReadonlyArray<string>
  readonly names?: Readonly<Record<string, string>>
  readonly descriptions?: Readonly<Record<string, string>>
  readonly lookups?: Readonly<Record<string, Lookup>>
}

export type Group = {
  readonly path: Path
  readonly description: string
  readonly alias?: string
}

export type Options = {
  readonly module: string
  readonly api: string
  readonly runtime: string
  readonly groups: ReadonlyArray<Group>
  readonly commands: ReadonlyArray<Command>
}

type Scalar = { readonly type: "string" | "number" | "boolean"; readonly choices?: ReadonlyArray<string> }

type Kind = Scalar & { readonly list: boolean }

type Field = {
  readonly name: string
  readonly cli: string
  readonly source: "params" | "query" | "payload"
  readonly optional: boolean
  readonly positional: boolean
  readonly kind: Kind | undefined
  readonly description: string | undefined
}

const reserved = new Set(["help", "version", "output", "input"])

const fail = (reason: string) => {
  throw new Errors.GenerationError({ reason })
}

const kebab = (name: string) => name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

const present = (ast: SchemaAST.AST) => !SchemaAST.isNull(ast) && !SchemaAST.isUndefined(ast)

function scalar(ast: SchemaAST.AST): Scalar | undefined {
  if (SchemaAST.isUnion(ast)) {
    const members = ast.types.filter(present)
    const choices = members.flatMap((member) =>
      SchemaAST.isLiteral(member) && typeof member.literal === "string" ? [member.literal] : [],
    )
    if (members.length > 0 && choices.length === members.length) return { type: "string", choices }
    const only = members.at(0)
    return members.length === 1 && only !== undefined ? scalar(only) : undefined
  }
  if (SchemaAST.isLiteral(ast))
    return typeof ast.literal === "string" ? { type: "string", choices: [ast.literal] } : undefined
  if (SchemaAST.isString(ast) || SchemaAST.isTemplateLiteral(ast)) return { type: "string" }
  if (SchemaAST.isNumber(ast)) return { type: "number" }
  if (SchemaAST.isBoolean(ast)) return { type: "boolean" }
  return undefined
}

function kind(ast: SchemaAST.AST): Kind | undefined {
  const single = scalar(ast)
  if (single !== undefined) return { ...single, list: false }
  const members = SchemaAST.isUnion(ast) ? ast.types.filter(present) : [ast]
  const only = members.at(0)
  if (members.length !== 1 || only === undefined || !SchemaAST.isArrays(only)) return undefined
  const item = only.elements.length === 0 && only.rest.length === 1 ? only.rest.at(0) : undefined
  const element = item === undefined ? undefined : scalar(item)
  return element === undefined || element.type === "boolean" ? undefined : { ...element, list: true }
}

const description = (ast: SchemaAST.AST): string | undefined =>
  SchemaAST.resolveDescription(ast) ??
  (SchemaAST.isUnion(ast) ? ast.types.filter(present).map(description).find(Boolean) : undefined)

const objects = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.Objects> => {
  if (SchemaAST.isObjects(ast)) return [ast]
  return SchemaAST.isUnion(ast) ? ast.types.flatMap(objects) : []
}

function properties(schema: Schema.Top | undefined, side: "type" | "json") {
  if (schema === undefined) return []
  const ast = side === "type" ? SchemaAST.toType(schema.ast) : SchemaAST.toEncoded(Schema.toCodecJson(schema).ast)
  const all = objects(ast).flatMap((object) => object.propertySignatures)
  return [...new Map(all.map((property) => [String(property.name), property])).values()]
}

const sourcesOf = (endpoint: Types.Endpoint) =>
  [
    ["params", properties(endpoint.params, "type")],
    ["query", properties(endpoint.query, "type")],
    ["payload", properties(endpoint.payloads.at(0), "json")],
  ] as const

export function inputs(endpoint: Types.Endpoint) {
  return sourcesOf(endpoint).flatMap(([source, list]) =>
    list.map((property) => ({ name: String(property.name), source })),
  )
}

const sentence = (text: string | undefined) => text?.split(/(?<=\.)\s/u).at(0)

function fields(endpoint: Types.Endpoint, command: Command): ReadonlyArray<Field> {
  const described = new Map(
    [
      ...properties(endpoint.params, "type"),
      ...properties(endpoint.query, "type"),
      ...properties(endpoint.payloads.at(0), "type"),
    ].map((property) => [String(property.name), sentence(description(property.type))]),
  )
  const sources = sourcesOf(endpoint)
  const omittable = new Set(
    [endpoint.params, endpoint.query]
      .flatMap((schema) =>
        schema === undefined
          ? []
          : objects(SchemaAST.toEncoded(schema.ast)).flatMap((object) => object.propertySignatures),
      )
      .filter((property) => SchemaAST.isOptional(property.type))
      .map((property) => String(property.name)),
  )
  const cli = (name: string) =>
    command.names?.[name] ??
    kebab(command.lookups?.[name] !== undefined && name.endsWith("Id") ? name.slice(0, -2) : name)
  const result = sources.flatMap(([source, list]) =>
    list.map((property): Field => {
      const name = String(property.name)
      const positional = command.arguments?.includes(name) ?? source === "params"
      return {
        name,
        cli: cli(name),
        source,
        optional: source === "payload" ? !positional : SchemaAST.isOptional(property.type) || omittable.has(name),
        positional,
        kind: kind(property.type),
        description: command.descriptions?.[name] ?? described.get(name),
      }
    }),
  )
  const unflagged = result.find(
    (field) => field.kind === undefined && !field.positional && field.source !== "payload" && !field.optional,
  )
  if (unflagged !== undefined) fail(`Required input has no flag: ${command.operation}.${unflagged.name}`)
  const inputs = new Set(result.map((field) => field.name))
  const unknown = [
    ...(command.arguments ?? []),
    ...Object.keys(command.names ?? {}),
    ...Object.keys(command.lookups ?? {}),
    ...Object.keys(command.descriptions ?? {}),
  ].find((name) => !inputs.has(name))
  if (unknown !== undefined) fail(`Unknown input of ${command.operation}: ${unknown}`)
  const order = (field: Field) => (field.positional ? (command.arguments?.indexOf(field.name) ?? 0) : Infinity)
  const named = result
    .filter((field) => field.positional || field.kind !== undefined)
    .toSorted((left, right) => order(left) - order(right))
  const counts = Map.groupBy(named, (field) => field.cli)
  const clash = named.find(
    (field) => (counts.get(field.cli)?.length ?? 0) > 1 || (!field.positional && reserved.has(field.cli)),
  )
  if (clash !== undefined) fail(`Two inputs of ${command.operation} are both named ${clash.cli}`)
  return named
}

const flagTypes = { string: "String", number: "Finite", boolean: "Boolean" } as const

const quote = (value: string) => JSON.stringify(value)

function flag(field: Field) {
  const kindOf = field.kind ?? { type: "string", list: false }
  const base = kindOf.choices
    ? `Flag.Literals(${quote(field.cli)}, ${JSON.stringify(kindOf.choices)})`
    : `Flag.${flagTypes[kindOf.type]}(${quote(field.cli)})`
  const presence = field.optional ? ["Flag.optional"] : []
  const text = kindOf.list
    ? [field.description, "Separate values with commas."].filter(Boolean).join(" ")
    : field.description
  const pipes = [
    ...(kindOf.list ? ["Flag.atLeast(0)", `Flag.withMetavar("list")`] : presence),
    ...(text === undefined ? [] : [`Flag.withDescription(${quote(text)})`]),
  ]
  return pipes.length === 0 ? base : `${base}.pipe(${pipes.join(", ")})`
}

function argument(field: Field) {
  const pipes = [
    ...(field.optional ? ["Argument.optional"] : []),
    ...(field.description === undefined ? [] : [`Argument.withDescription(${quote(field.description)})`]),
  ]
  const base = `Argument.String(${quote(field.cli)})`
  return pipes.length === 0 ? base : `${base}.pipe(${pipes.join(", ")})`
}

function clientCall(group: Types.Group, endpoint: Types.Endpoint) {
  return `client${endpoint.topLevel ? "" : `[${quote(group.identifier)}]`}${endpoint.clientPath.map((part) => `[${quote(part)}]`).join("")}`
}

type Resolved = {
  readonly command: Command
  readonly group: Types.Group
  readonly endpoint: Types.Endpoint
  readonly name: string
  readonly fields: ReadonlyArray<Field>
}

function renderConfig(item: Resolved) {
  const entries = [
    ...item.fields.map((field) => `${quote(field.name)}: ${field.positional ? argument(field) : flag(field)}`),
    ...(item.endpoint.payloads.length > 0
      ? [`"input": Flag.String("input").pipe(Flag.optional, Flag.withDescription("JSON input, @file or @- for stdin"))`]
      : []),
  ]
  return `export const ${item.name} = { ${entries.join(", ")} }`
}

function renderOperation(
  item: Resolved,
  find: (operation: string) => readonly [Types.Group, Types.Endpoint],
  options: Options,
) {
  const bySource = (source: Field["source"]) => {
    const list = item.fields.filter((field) => field.source === source)
    return list.length === 0
      ? []
      : [`${source}: { ${list.map((field) => `${quote(field.name)}: input[${quote(field.name)}]`).join(", ")} }`]
  }
  const lookups = Object.entries(item.command.lookups ?? {}).map(([name, lookup]) => {
    const [group, endpoint] = find(lookup.operation)
    return `${quote(name)}: (client, value) => ${clientCall(group, endpoint)}({ ${quote(lookup.input)}: value }).pipe(Effect.map((found) => found[${quote(lookup.output)}]))`
  })
  const labels = item.fields.map(
    (field) => `${quote(field.name)}: ${quote(field.positional ? `<${field.cli}>` : `--${field.cli}`)}`,
  )
  const parts = [
    ...bySource("params"),
    ...bySource("query"),
    ...bySource("payload"),
    ...(item.endpoint.payloads.length > 0 ? [`input: input["input"]`] : []),
    `labels: { ${labels.join(", ")} }`,
    ...(lookups.length === 0 ? [] : [`lookups: { ${lookups.join(", ")} }`]),
  ]
  const spread = [
    ...(item.endpoint.params === undefined ? [] : ["...request.params"]),
    ...(item.endpoint.query === undefined ? [] : ["...request.query"]),
    ...(item.endpoint.payloads.length === 0
      ? []
      : [SchemaShape.isOpaquePayload(item.endpoint) ? "payload: request.payload" : "...request.payload"]),
  ]
  const hasInput = Operations.inputMode(item.endpoint.input) !== "none"
  const usesInput = item.fields.length > 0 || item.endpoint.payloads.length > 0
  const endpoint = `${options.api}.groups[${quote(item.group.identifier)}].endpoints[${quote(item.endpoint.endpoint.identifier)}]`
  const parameter = usesInput ? `input: Command.Command.Config.Infer<typeof Commands.${item.name}>` : ""
  const call = hasInput
    ? `(client, request) => ${clientCall(item.group, item.endpoint)}({ ${spread.join(", ")} })`
    : `(client) => ${clientCall(item.group, item.endpoint)}()`
  return `export const ${item.name} = (${parameter}) =>\n  Operation.run(${endpoint}, { ${parts.join(", ")} }, ${call})`
}

type Node = {
  readonly name: string
  readonly path: ReadonlyArray<string>
  readonly children: Array<Node>
  leaf?: Resolved
}

function tree(items: ReadonlyArray<Resolved>, groups: ReadonlyArray<Group>) {
  const root: Node = { name: "", path: [], children: [] }
  items.map((item) => {
    const node = item.command.path.reduce<Node>((parent, name) => {
      if (parent.leaf !== undefined) fail(`Command is also a group: ${parent.path.join(" ")}`)
      const existing = parent.children.find((child) => child.name === name)
      if (existing !== undefined) return existing
      const created: Node = { name, path: [...parent.path, name], children: [] }
      parent.children.push(created)
      return created
    }, root)
    if (node.leaf !== undefined) fail(`Command path is used twice: ${node.path.join(" ")}`)
    if (node.children.length > 0) fail(`Command is also a group: ${node.path.join(" ")}`)
    node.leaf = item
    return node
  })
  const describe = (node: Node) => {
    const group = groups.find((each) => each.path.join(" ") === node.path.join(" "))
    if (group === undefined) return fail(`Group needs a description: ${node.path.join(" ")}`)
    return group
  }
  const unused = groups.find(
    (group) =>
      !items.some(
        (item) =>
          item.command.path.length > group.path.length &&
          group.path.every((part, index) => item.command.path.at(index) === part),
      ),
  )
  if (unused !== undefined) fail(`Group has no commands: ${unused.path.join(" ")}`)
  const render = (node: Node): string => {
    if (node.leaf !== undefined) {
      const leaf = node.leaf
      const summary =
        leaf.command.description ?? Context.getOrUndefined(leaf.endpoint.endpoint.annotations, OpenApi.Summary)
      if (summary === undefined) return fail(`Command needs a description: ${node.path.join(" ")}`)
      const input = leaf.fields.length > 0 || leaf.endpoint.payloads.length > 0 ? "input" : ""
      return `Command.make(${quote(node.name)}, ${leaf.name}).pipe(Command.withDescription(${quote(summary)}), Command.withHandler((${input}) => Effect.flatMap(Effect.promise(operations), (module) => module.${leaf.name}(${input}))))`
    }
    const group = describe(node)
    return `Command.make(${quote(node.name)}).pipe(Command.withDescription(${quote(group.description)}), ${group.alias === undefined ? "" : `Command.withAlias(${quote(group.alias)}), `}Command.withSubcommands([${node.children.map(render).join(", ")}]))`
  }
  return root.children.map(render)
}

export function emitCli(contract: Types.Contract, options: Options): Types.Output {
  const endpoints = contract.groups.flatMap((group) => group.endpoints.map((endpoint) => [group, endpoint] as const))
  const find = (operation: string) => {
    const found = endpoints.find((entry) => entry[1].endpoint.identifier === operation)
    return found ?? fail(`Unknown operation: ${operation}`)
  }
  const items = options.commands.map((command): Resolved => {
    const [group, endpoint] = find(command.operation)
    if (endpoint.operation.success === "stream")
      fail(`Streaming operations need a custom command: ${command.operation}`)
    if (endpoint.unwrapData) fail(`Data envelopes are not supported: ${command.operation}`)
    Object.values(command.lookups ?? {}).map((lookup) => find(lookup.operation))
    return {
      command,
      group,
      endpoint,
      name: Names.identifierPart(command.operation),
      fields: fields(endpoint, command),
    }
  })
  const rendered = tree(items, options.groups)
  const commands = `// Generated by @ren/httpapi-codegen. Do not edit.\nimport { Effect } from "effect"\nimport { Argument, Command, Flag } from "effect/cli"\n\nconst operations = () => import("./operations.js")\n\n${items.map(renderConfig).join("\n\n")}\n\nexport const commands = [${rendered.join(", ")}] as const\n`
  const usesLookups = items.some((item) => Object.keys(item.command.lookups ?? {}).length > 0)
  const operations = `// Generated by @ren/httpapi-codegen. Do not edit.\n${usesLookups ? 'import { Effect } from "effect"\n' : ""}import type { Command } from "effect/cli"\nimport { ${options.api} } from ${quote(options.module)}\nimport { Operation } from ${quote(options.runtime)}\nimport type * as Commands from "./commands.js"\n\n${items.map((item) => renderOperation(item, find, options)).join("\n\n")}\n`
  return {
    operations: items.map((item) => item.endpoint.operation),
    files: [
      { path: "commands.ts", content: commands },
      { path: "operations.ts", content: operations },
    ],
  }
}
