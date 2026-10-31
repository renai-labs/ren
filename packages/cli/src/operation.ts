export * as Operation from "./operation.js"

import { Effect, Option, Predicate, Record, Schema, SchemaAST, SchemaIssue } from "effect"
import { type HttpApiEndpoint, HttpApiSchema } from "effect/http-api"
import { Connection } from "./services/connection.js"
import { Output } from "./services/output.js"

type Scalar = string | number | boolean

type Value = Scalar | ReadonlyArray<Scalar> | Option.Option<Scalar>

type Values = Readonly<Record<string, Value>>

interface Input {
  readonly params?: Values
  readonly query?: Values
  readonly payload?: Values
  readonly input?: Option.Option<string>
  readonly labels: Readonly<Record<string, string>>
  readonly lookups?: Readonly<
    Record<string, (client: Connection.Client, value: string) => Effect.Effect<string, unknown>>
  >
}

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

const Page = Schema.Struct({
  items: Schema.Array(Schema.Unknown),
  page: Schema.Number,
  pageSize: Schema.Number,
  total: Schema.Number,
})

const columns = ["id", "slug", "name", "title", "path", "status", "email", "role", "kind", "createdAt"]

type Plain = Scalar | ReadonlyArray<Scalar>

const plain = (value: Value) =>
  Option.flatMap(Option.isOption(value) ? value : Option.some(value), (each): Option.Option<Plain> => {
    if (typeof each !== "object") return Option.some(each)
    const items = each.flatMap((item): ReadonlyArray<Scalar> =>
      typeof item === "string"
        ? item
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        : [item],
    )
    return items.length > 0 ? Option.some(items) : Option.none()
  })

const asJson = (values: Values) => Record.getSomes(Record.map(values, plain))

const asStrings = (values: Values) =>
  Record.map(asJson(values), (value) => (typeof value === "object" ? value.map(String) : String(value)))

const objects = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.Objects> => {
  if (SchemaAST.isObjects(ast)) return [ast]
  return SchemaAST.isUnion(ast) ? ast.types.flatMap(objects) : []
}

const accepts = (schema: Schema.Top | undefined, name: string, value: unknown) => {
  const property = schema
    ? objects(SchemaAST.toType(schema.ast))
        .flatMap((object) => object.propertySignatures)
        .find((each) => each.name === name)
    : undefined
  return property ? Schema.is(Schema.make<Schema.Top>(property.type))(value) : false
}

const problems = (error: Schema.SchemaError, labels: Input["labels"]) =>
  Output.Failure.problems(
    formatter(error.issue).issues.map((issue) => {
      const keys = (issue.path ?? []).map((segment) => String(typeof segment === "object" ? segment.key : segment))
      const label = labels[keys.at(0) ?? ""]
      const field = (label ? keys.slice(1) : keys).join(".")
      const path = label ?? "--input"
      return field === "" ? { path, message: issue.message } : { path, field, message: issue.message }
    }),
  )

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- HttpApiClient decodes and encodes these same endpoint schemas without services, so they need none here.
const serviceless = (schema: Schema.Top) => schema as Schema.Codec<unknown, unknown>

const decode = (schema: Schema.Top | undefined, value: unknown, labels: Input["labels"]) =>
  schema
    ? Schema.decodeUnknownEffect(serviceless(schema))(value).pipe(
        Effect.map(Option.some),
        Effect.mapError((error) => problems(error, labels)),
      )
    : Effect.succeedNone

const read = Effect.fn("Operation.read")(function* (input: Option.Option<string>) {
  if (Option.isNone(input)) return {}
  const source = input.value
  const text = source.startsWith("@")
    ? yield* Effect.tryPromise({
        try: () => (source === "@-" ? Bun.stdin.text() : Bun.file(source.slice(1)).text()),
        catch: () =>
          new Output.Failure({ message: `Can’t read ${source.slice(1) === "-" ? "stdin" : source.slice(1)}.` }),
      })
    : source
  const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
    Effect.mapError(() => new Output.Failure({ message: "--input must be JSON." })),
  )
  if (!Predicate.isObject(parsed)) return yield* new Output.Failure({ message: "--input must be a JSON object." })
  return parsed
})

const heading = (key: string) => key.replaceAll(/[A-Z]/g, (letter) => ` ${letter}`).toUpperCase()

const cell = (value: unknown) => {
  if (Predicate.isNullish(value)) return "-"
  return typeof value === "string" ? value : JSON.stringify(value)
}

const table = (items: ReadonlyArray<unknown>) => {
  if (items.length === 0) return "No results."
  const rows = items.filter(Predicate.isObject)
  const keys = columns.filter((key) => rows.some((row) => key in row))
  if (rows.length < items.length || keys.length === 0) return Bun.YAML.stringify(items, null, 2).trimEnd()
  const lines = [keys.map(heading), ...rows.map((row) => keys.map((key) => cell(row[key])))]
  const widths = keys.map((_, index) => Math.max(...lines.map((line) => line.at(index)?.length ?? 0)))
  return lines
    .map((line) =>
      line
        .map((value, index) => value.padEnd(widths.at(index) ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n")
}

export const render = (value: unknown) => {
  if (Schema.is(Page)(value)) {
    const pages = Math.max(1, Math.ceil(value.total / value.pageSize))
    const next = value.page < pages ? ` Next: --page ${value.page + 1}` : ""
    return `${table(value.items)}\n\nPage ${value.page} of ${pages}, ${value.total} total.${next}`
  }
  if (Array.isArray(value)) return table(value)
  if (Predicate.isObject(value) && Array.isArray(value["items"]) && Object.keys(value).length === 1)
    return table(value["items"])
  if (Predicate.isObject(value)) return Bun.YAML.stringify(value, null, 2).trimEnd()
  return String(value)
}

export const run = <
  E extends HttpApiEndpoint.ConstraintRequest & Pick<HttpApiEndpoint.Top, "params" | "query" | "payload" | "success">,
  A,
  Failure,
>(
  endpoint: E,
  input: Input,
  call: (client: Connection.Client, request: HttpApiEndpoint.Request<E>) => Effect.Effect<A, Failure>,
) =>
  Effect.gen(function* () {
    const connection = yield* Connection.Service
    const output = yield* Output.Service
    const client = yield* connection.client
    const payloadSchema = [...endpoint.payload.values()].flatMap((payload) => payload.schemas).at(0)
    const resolve = (values: Values | undefined, schema: Schema.Top | undefined) =>
      Effect.all(
        Record.map(values ?? {}, (value, name): Effect.Effect<Value, unknown> => {
          const lookup = input.lookups?.[name]
          const found = plain(value)
          if (!lookup || Option.isNone(found)) return Effect.succeed(value)
          const one = (item: Scalar, sample: unknown) =>
            typeof item !== "string" || accepts(schema, name, sample) ? Effect.succeed(item) : lookup(client, item)
          return typeof found.value === "object"
            ? Effect.forEach(found.value, (item) => one(item, [item]))
            : one(found.value, found.value)
        }),
      )
    const params = yield* decode(
      endpoint.params,
      asStrings(yield* resolve(input.params, endpoint.params)),
      input.labels,
    )
    const query = yield* decode(endpoint.query, asStrings(yield* resolve(input.query, endpoint.query)), input.labels)
    const payload = payloadSchema
      ? yield* decode(
          Schema.toCodecJson(payloadSchema),
          { ...(yield* read(input.input ?? Option.none())), ...asJson(yield* resolve(input.payload, payloadSchema)) },
          input.labels,
        )
      : Option.none()
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Each part was decoded by the endpoint's own schema, which HttpApiEndpoint stores with an erased type.
    const request = Record.getSomes({ params, query, payload }) as HttpApiEndpoint.Request<E>
    const result = yield* call(client, request)
    const success = [...endpoint.success].at(0)
    if (!success || HttpApiSchema.isNoContent(success.ast)) {
      if (output.format === "pretty") yield* output.print("Done.")
      return
    }
    const schema = serviceless(success)
    const encoded = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(result)
    yield* output.result(schema, result, render(encoded))
  })
