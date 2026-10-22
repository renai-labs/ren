import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import { Compile, EmitEffectImported, EmitPromise, EmitReactQuery, type Types } from "../src/index.js"

class Missing extends Schema.TaggedError<Missing>()("Missing", { message: Schema.String }) {}

class SignedRequest extends HttpApiMiddleware.Service<SignedRequest>()("SignedRequest", {
  requiredForClient: true,
}) {}

function api(endpoint: HttpApiEndpoint.Constraint) {
  return HttpApi.make("test").add(HttpApiGroup.make("session").add(endpoint))
}

function file(output: Types.Output, path: string) {
  return output.files.find((item) => item.path === path)?.content
}

function recorder(respond: () => Response) {
  const requests: Array<Request> = []
  return {
    requests,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return respond()
    },
  }
}

async function emittedModule(output: Types.Output) {
  const directory = await mkdtemp(join(tmpdir(), "ren-httpapi-codegen-"))
  const dispose = () => rm(directory, { recursive: true, force: true })

  try {
    // oxlint-disable-next-line ren/no-comments -- Finish each write before cleanup can run, even when a later write fails.
    await Array.fromAsync(output.files, (item) => Bun.write(join(directory, item.path), item.content))
    // ast-grep-ignore: no-dynamic-import-path, -- The module is emitted into a temporary directory at runtime, so its path cannot be literal.
    const module = await import(`${join(directory, "index.ts")}?t=${crypto.randomUUID()}`)
    return { module, [Symbol.asyncDispose]: dispose }
  } catch (cause) {
    await dispose()
    throw cause
  }
}

describe("HttpApiCodegen.generate", () => {
  test("keeps custom input validation in the imported API while emitting Promise wire inputs", async () => {
    const contract = Compile.compile(
      api(
        HttpApiEndpoint.post("create", "/session", {
          payload: Schema.Struct({
            title: Schema.String.check(Schema.makeFilter((value) => value.trim() !== "" || "Title required")),
          }),
          success: Schema.String,
        }),
      ),
    )
    const effect = EmitEffectImported.emitEffectImported(contract, { module: "@example/api", api: "Api" })
    expect(file(effect, "client.ts")).toContain("HttpApiClient.make(Api, options)")
    await using emitted = await emittedModule(EmitPromise.emitPromise(contract))
    const recorded = recorder(() => Response.json("created"))
    const client = emitted.module.Ren.make({ baseUrl: "http://localhost", fetch: recorded.fetch })
    expect(await client.session.create({ title: "Task" })).toBe("created")
    expect(await recorded.requests[0]?.json()).toEqual({ title: "Task" })
  })

  test("emits an Effect client against an imported API", () => {
    const output = EmitEffectImported.emitEffectImported(
      Compile.compile(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
      { module: "@example/api", api: "Api" },
    )
    const client = file(output, "client.ts")

    expect(client).toContain('import { Api } from "@example/api"')
    expect(client).toContain("HttpApiClient.make(Api, options)")
  })

  test("keeps a required empty struct payload in imported Effect and Promise requests", () => {
    const contract = Compile.compile(
      api(HttpApiEndpoint.post("empty", "/session", { payload: Schema.Struct({}), success: Schema.String })),
    )

    expect(
      file(EmitEffectImported.emitEffectImported(contract, { module: "@example/api", api: "Api" }), "client.ts"),
    ).toContain("payload: { }")
    expect(file(EmitPromise.emitPromise(contract), "client.ts")).toContain("body: { }")
  })

  test("omits the Promise SSE reader when no endpoint streams", () => {
    const plain = EmitPromise.emitPromise(
      Compile.compile(api(HttpApiEndpoint.get("health", "/health", { success: Schema.String }))),
    )
    const streaming = EmitPromise.emitPromise(
      Compile.compile(
        api(HttpApiEndpoint.get("subscribe", "/event", { success: HttpApiSchema.StreamSse({ data: Schema.String }) })),
      ),
    )

    expect(file(plain, "client.ts")).not.toContain("const sse =")
    expect(file(plain, "client.ts")).not.toContain("maxSseEventBytes")
    expect(file(streaming, "client.ts")).toContain("const sse =")
  })

  test("erases brands from Promise wire types", () => {
    const output = EmitPromise.emitPromise(
      Compile.compile(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String.pipe(Schema.brand("SessionID")) },
            success: Schema.Struct({ data: Schema.String.pipe(Schema.brand("SessionID")) }),
          }),
        ),
      ),
    )
    const types = file(output, "types.ts")

    expect(types).toContain('readonly "sessionID": string')
    expect(types).not.toContain("Brand")
  })

  test("emits mutable Promise outputs without restricting inputs", () => {
    const output = EmitPromise.emitPromise(
      Compile.compile(
        api(
          HttpApiEndpoint.post("create", "/session", {
            payload: Schema.Struct({ values: Schema.Array(Schema.String) }),
            success: Schema.Struct({ data: Schema.Array(Schema.Struct({ values: Schema.Array(Schema.String) })) }),
          }),
        ),
      ),
      { mutableOutputs: true },
    )
    const types = file(output, "types.ts")

    expect(types).toContain('readonly "values": ReadonlyArray<string>')
    expect(types).toContain(
      'export type SessionCreateOutput = ({ "data": Array<{ "values": Array<string> }> })["data"]',
    )
  })

  test.each([
    {
      name: "keeps conflicting shapes distinct",
      first: Schema.Struct({ value: Schema.String }).annotate({ identifier: "Shared" }),
      second: Schema.Struct({ value: Schema.Number }).annotate({ identifier: "Shared" }),
      expected: [
        'export type Shared = { readonly "value": string }',
        'export type Shared1 = { readonly "value": number }',
        'readonly "first": Shared, readonly "second": Shared1',
      ],
    },
    {
      name: "shares one name for equivalent shapes",
      first: Schema.String.annotate({ identifier: "Shared", description: "first" }),
      second: Schema.String.annotate({ identifier: "Shared", description: "second" }),
      expected: ["export type Shared = string", 'readonly "first": Shared, readonly "second": Shared }'],
    },
    {
      name: "disambiguates identifiers that flatten to one name",
      first: Schema.String.annotate({ identifier: "ExampleName" }),
      second: Schema.String.annotate({ identifier: "Example_Name" }),
      expected: ["export type ExampleName = string", "export type ExampleName2 = string"],
    },
  ])("$name in Promise reference types", (row) => {
    const types = file(
      EmitPromise.emitPromise(
        Compile.compile(
          api(
            HttpApiEndpoint.get("get", "/session", {
              success: Schema.Struct({ first: row.first, second: row.second }),
            }),
          ),
        ),
      ),
      "types.ts",
    )

    for (const line of row.expected) expect(types).toContain(line)
  })

  test.each([
    {
      endpoint: HttpApiEndpoint.get("text", "/text", { success: Schema.String.pipe(HttpApiSchema.asText()) }),
      message: "Unsupported Promise success encoding: session.text",
    },
    {
      endpoint: HttpApiEndpoint.get("read", "/file/*/tail", { success: Schema.String }),
      message: "Unsupported Promise path wildcard: /file/*/tail",
    },
    {
      endpoint: HttpApiEndpoint.get("events", "/events", {
        success: HttpApiSchema.StreamSse({ data: Schema.String, error: Missing }),
      }),
      message: "Unsupported Promise stream: session.events",
    },
  ])("rejects a Promise transport that is not implemented: $message", (row) => {
    expect(() => EmitPromise.emitPromise(Compile.compile(api(row.endpoint)))).toThrow(row.message)
  })

  test("runs a Promise GET through fetch", async () => {
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(
        Compile.compile(
          api(
            HttpApiEndpoint.get("session.get", "/session/:sessionID", {
              params: { sessionID: Schema.String },
              success: Schema.Struct({ data: Schema.String }),
            }),
          ),
        ),
      ),
    )
    const server = recorder(() => Response.json({ data: "hello" }))
    const client = emitted.module.Ren.make({
      baseUrl: "https://example.com/base?tenant=one#fragment",
      fetch: server.fetch,
    })

    expect(await client.session.get({ sessionID: "a/b" })).toBe("hello")
    expect(server.requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "https://example.com/base/session/a%2Fb"],
    ])
  })

  test("maps a no-content response to undefined", async () => {
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(
        Compile.compile(
          api(
            HttpApiEndpoint.post("interrupt", "/session/:sessionID/interrupt", {
              params: { sessionID: Schema.String },
              success: HttpApiSchema.NoContent,
            }),
          ),
        ),
      ),
    )
    const client = emitted.module.Ren.make({
      baseUrl: "https://example.com",
      fetch: recorder(() => new Response(null, { status: 204 })).fetch,
    })

    expect(await client.session.interrupt({ sessionID: "session" })).toBeUndefined()
  })

  test("sends flattened query, header and payload inputs", async () => {
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(
        Compile.compile(
          api(
            HttpApiEndpoint.post("prompt", "/session/:sessionID", {
              params: { sessionID: Schema.String },
              query: { resume: Schema.optional(Schema.Boolean) },
              headers: { "x-trace-id": Schema.String },
              payload: Schema.Struct({ prompt: Schema.String }),
              success: Schema.Struct({ data: Schema.String }),
            }),
          ),
        ),
      ),
    )
    const server = recorder(() => Response.json({ data: "admitted" }))
    const client = emitted.module.Ren.make({ baseUrl: "https://example.com", fetch: server.fetch })

    expect(
      await client.session.prompt({ sessionID: "session", resume: true, "x-trace-id": "trace", prompt: "hello" }),
    ).toBe("admitted")
    const request = server.requests[0]
    expect(request?.url).toBe("https://example.com/session/session?resume=true")
    expect(request?.headers.get("x-trace-id")).toBe("trace")
    expect(await request?.json()).toEqual({ prompt: "hello" })
  })

  test.each([
    {
      kind: "union",
      schema: Schema.Union([
        Schema.Struct({ type: Schema.Literal("local"), command: Schema.Array(Schema.String) }),
        Schema.Struct({ type: Schema.Literal("remote"), url: Schema.String }),
      ]),
      payload: { type: "local", command: ["ren"] },
    },
    { kind: "array", schema: Schema.Array(Schema.String), payload: ["ren"] },
    { kind: "primitive", schema: Schema.String, payload: "ren" },
    { kind: "record", schema: Schema.Record(Schema.String, Schema.Number), payload: { ren: 1 } },
  ])("sends an opaque $kind payload as the direct JSON body", async (row) => {
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(
        Compile.compile(
          api(HttpApiEndpoint.post("set", "/session", { payload: row.schema, success: HttpApiSchema.NoContent })),
        ),
      ),
    )
    const server = recorder(() => new Response(null, { status: 204 }))
    const client = emitted.module.Ren.make({ baseUrl: "https://example.com", fetch: server.fetch })

    await client.session.set({ payload: row.payload })

    expect(await server.requests[0]?.json()).toEqual(row.payload)
  })

  test("rejects with declared tagged errors and exports a type guard", async () => {
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(
        Compile.compile(
          api(
            HttpApiEndpoint.get("get", "/session/:sessionID", {
              params: { sessionID: Schema.String },
              success: Schema.Struct({ data: Schema.String }),
              error: Missing.pipe(HttpApiSchema.status(404)),
            }),
          ),
        ),
      ),
    )
    const client = emitted.module.Ren.make({
      baseUrl: "https://example.com",
      fetch: recorder(() => Response.json({ _tag: "Missing", message: "gone" }, { status: 404 })).fetch,
    })

    const error = await client.session.get({ sessionID: "missing" }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: "Missing", message: "gone", _tag: "Missing" })
    expect(emitted.module.isMissing(error)).toBeTrue()
  })

  test("rejects with the tagged error a server-only middleware declares", async () => {
    class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}, { httpApiStatus: 401 }) {}
    class Authorization extends HttpApiMiddleware.Service<Authorization>()("Authorization", { error: Unauthorized }) {}
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(
        Compile.compile(
          api(HttpApiEndpoint.get("get", "/session", { success: Schema.String }).middleware(Authorization)),
        ),
      ),
    )
    const client = emitted.module.Ren.make({
      baseUrl: "https://example.com",
      fetch: recorder(() => Response.json({ _tag: "Unauthorized" }, { status: 401 })).fetch,
    })

    await expect(client.session.get()).rejects.toMatchObject({ name: "Unauthorized", _tag: "Unauthorized" })
  })

  test.each([
    {
      failure: "a transport failure",
      respond: (): Response => {
        throw new TypeError("offline")
      },
      reason: "Transport",
    },
    { failure: "an undeclared status", respond: () => Response.json({}, { status: 503 }), reason: "UnexpectedStatus" },
    {
      failure: "a malformed body",
      respond: () => new Response("{", { headers: { "content-type": "application/json" } }),
      reason: "MalformedResponse",
    },
  ])("rejects $failure with ClientError", async (row) => {
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(Compile.compile(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String })))),
    )
    const client = emitted.module.Ren.make({ baseUrl: "https://example.com", fetch: recorder(row.respond).fetch })

    const error = await client.session.get().catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(emitted.module.ClientError)
    expect(error).toMatchObject({ reason: row.reason })
  })

  test("iterates a Promise SSE stream lazily without reconnecting", async () => {
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(
        Compile.compile(
          api(
            HttpApiEndpoint.get("subscribe", "/event", {
              query: { after: Schema.optional(Schema.Number) },
              success: HttpApiSchema.StreamSse({
                data: Schema.Struct({ type: Schema.String, count: Schema.NumberFromString }),
              }),
            }),
          ),
        ),
      ),
    )
    const encoder = new TextEncoder()
    const server = recorder(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"type":"ready","count":"1"}\r'))
              controller.enqueue(encoder.encode("\n\r\n"))
              controller.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    )
    const client = emitted.module.Ren.make({ baseUrl: "https://example.com", fetch: server.fetch })
    const events = client.session.subscribe({ after: 2 })

    expect(server.requests).toEqual([])
    expect(await Array.fromAsync(events)).toEqual([{ type: "ready", count: "1" }])
    expect(server.requests.map((request) => request.url)).toEqual(["https://example.com/event?after=2"])
  })

  test("runs nested operation IDs as nested Promise methods", async () => {
    await using emitted = await emittedModule(
      EmitPromise.emitPromise(
        Compile.compile(
          HttpApi.make("test").add(
            HttpApiGroup.make("session")
              .add(
                HttpApiEndpoint.get("list", "/session/instructions", { success: Schema.String }).annotateMerge(
                  OpenApi.annotations({ identifier: "session.instructions.list" }),
                ),
              )
              .add(
                HttpApiEndpoint.put("put", "/session/instructions", { success: Schema.String }).annotateMerge(
                  OpenApi.annotations({ identifier: "session.instructions.put" }),
                ),
              ),
          ),
        ),
      ),
    )
    const server = recorder(() => Response.json("ok"))
    const client = emitted.module.Ren.make({ baseUrl: "https://example.com", fetch: server.fetch })

    expect(await client.session.instructions.list()).toBe("ok")
    expect(await client.session.instructions.put()).toBe("ok")
    expect(server.requests.map((request) => request.method)).toEqual(["GET", "PUT"])
  })

  test.each([
    { inputMode: "none", endpoint: HttpApiEndpoint.get("health", "/health", { success: Schema.String }) },
    {
      inputMode: "optional",
      endpoint: HttpApiEndpoint.get("list", "/session", {
        query: { limit: Schema.optional(Schema.String) },
        success: Schema.String,
      }),
    },
    {
      inputMode: "required",
      endpoint: HttpApiEndpoint.get("get", "/session/:sessionID", {
        params: { sessionID: Schema.String },
        query: { includeArchived: Schema.optional(Schema.String) },
        success: Schema.String,
      }),
    },
  ])("compiles an operation with $inputMode input", (row) => {
    expect(Compile.compile(api(row.endpoint)).groups[0]?.endpoints[0]?.operation.inputMode).toBe(row.inputMode)
  })

  test.each([
    {
      message: "Client endpoint name collision: session.instructions.list",
      compile: () =>
        Compile.compile(
          HttpApi.make("test").add(
            HttpApiGroup.make("session")
              .add(
                HttpApiEndpoint.get("first", "/first", { success: Schema.String }).annotateMerge(
                  OpenApi.annotations({ identifier: "session.instructions.list" }),
                ),
              )
              .add(
                HttpApiEndpoint.get("second", "/second", { success: Schema.String }).annotateMerge(
                  OpenApi.annotations({ identifier: "session.instructions.list" }),
                ),
              ),
          ),
        ),
    },
    {
      message: "Client name collision: status",
      compile: () =>
        Compile.compile(
          HttpApi.make("test")
            .add(HttpApiGroup.make("status").add(HttpApiEndpoint.get("get", "/nested", { success: Schema.String })))
            .add(
              HttpApiGroup.make("system", { topLevel: true }).add(
                HttpApiEndpoint.get("status", "/status", { success: Schema.String }),
              ),
            ),
        ),
    },
    {
      message: "Client group type collision: FooBar",
      compile: () =>
        Compile.compile(
          HttpApi.make("test")
            .add(HttpApiGroup.make("foo_bar").add(HttpApiEndpoint.get("get", "/first", { success: Schema.String })))
            .add(HttpApiGroup.make("foo.bar").add(HttpApiEndpoint.get("get", "/second", { success: Schema.String }))),
        ),
    },
    {
      message: "Client endpoint type collision: SessionFooBar",
      compile: () =>
        Compile.compile(
          HttpApi.make("test").add(
            HttpApiGroup.make("session")
              .add(
                HttpApiEndpoint.get("first", "/first", { success: Schema.String }).annotateMerge(
                  OpenApi.annotations({ identifier: "session.foo.bar" }),
                ),
              )
              .add(
                HttpApiEndpoint.get("second", "/second", { success: Schema.String }).annotateMerge(
                  OpenApi.annotations({ identifier: "session.foo-bar" }),
                ),
              ),
          ),
        ),
    },
  ])("rejects a client name collision: $message", (row) => {
    expect(row.compile).toThrow(row.message)
  })

  test.each([
    {
      message: "Input field collision: id",
      endpoint: HttpApiEndpoint.post("prompt", "/session/:id", {
        params: { id: Schema.String },
        payload: Schema.Struct({ id: Schema.String }),
        success: Schema.Void,
      }),
    },
    {
      message: "Opaque payload field collision: session.configure.payload conflicts with query.payload",
      endpoint: HttpApiEndpoint.post("configure", "/session", {
        query: { payload: Schema.String },
        payload: Schema.Union([Schema.String, Schema.Number]),
        success: Schema.String,
      }),
    },
    {
      message: "Multiple payload schemas: session.prompt",
      endpoint: HttpApiEndpoint.post("prompt", "/session", {
        payload: [Schema.Struct({ text: Schema.String }), Schema.Struct({ count: Schema.Number })],
        success: Schema.String,
      }),
    },
    {
      message: "Multiple success schemas: session.get",
      endpoint: HttpApiEndpoint.get("get", "/session", { success: [Schema.String, Schema.Number] }),
    },
    {
      message: "Client middleware requires adapter: SignedRequest",
      endpoint: HttpApiEndpoint.get("get", "/session", { success: Schema.String }).middleware(SignedRequest),
    },
  ])("rejects an endpoint the client cannot represent: $message", (row) => {
    expect(() => Compile.compile(api(row.endpoint))).toThrow(row.message)
  })

  test.each([
    { kind: "an opaque declaration", success: Schema.declare((input): input is URL => input instanceof URL) },
    {
      kind: "a check without portable metadata",
      success: Schema.Number.check(Schema.makeFilter((value) => (value > 0 ? undefined : "positive"))),
    },
  ])("rejects $kind as an unportable schema", (row) => {
    expect(() => Compile.compile(api(HttpApiEndpoint.get("get", "/session", { success: row.success })))).toThrow(
      "Unportable schema: session.get.success",
    )
  })

  test("emits TanStack Query factories for every non-streaming operation", () => {
    const query = file(
      EmitReactQuery.emitReactQuery(
        Compile.compile(
          HttpApi.make("test").add(
            HttpApiGroup.make("session")
              .add(HttpApiEndpoint.get("health", "/session/health", { success: Schema.String }))
              .add(
                HttpApiEndpoint.get("list", "/session", {
                  query: { archived: Schema.optional(Schema.Boolean) },
                  success: Schema.String,
                }),
              )
              .add(
                HttpApiEndpoint.post("interrupt", "/session/:sessionID/interrupt", {
                  params: { sessionID: Schema.String },
                  success: HttpApiSchema.NoContent,
                }),
              )
              .add(
                HttpApiEndpoint.get("subscribe", "/event", {
                  success: HttpApiSchema.StreamSse({ data: Schema.String }),
                }),
              ),
          ),
        ),
        { client: "../client/index.js" },
      ),
      "query.ts",
    )

    expect(query).toContain('queryKey: ["session", "health"] as const')
    expect(query).toContain('queryKey: ["session", "list", input] as const')
    expect(query).toContain('mutationKey: ["session", "interrupt"] as const')
    expect(query).not.toContain("subscribe")
  })
})
